import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
);

const AM_TOKEN = process.env.APPARELMAGIC_TOKEN || '';
const AM_LEGACY = (process.env.NEXT_PUBLIC_APPARELMAGIC_URL || 'https://advanceapparels.app.apparelmagic.com/api/json').replace(/\/+$/, '');
const AM_MCP_URL = process.env.AM_MCP_URL || 'https://api.apparelmagic.com/mcp';
const AM_MCP_KEY = process.env.AM_MCP_KEY || '';

function authParams() {
  return { time: Math.floor(Date.now() / 1000).toString(), token: AM_TOKEN };
}

function toNum(val: any): number {
  if (val === null || val === undefined || val === '') return 0;
  const n = parseFloat(val);
  return isNaN(n) ? 0 : n;
}

// ══════════════════════════════════════════════════════════════
// Legacy /api/json — reads (inventory, warehouses)
// ══════════════════════════════════════════════════════════════
async function amGet(path: string, extra: Record<string, string> = {}) {
  const auth = authParams();
  const params = new URLSearchParams({ time: auth.time, token: auth.token, ...extra });
  const res = await fetch(`${AM_LEGACY}${path}?${params.toString()}`, {
    method: 'GET',
    headers: { 'User-Agent': 'AdvanceHQ/1.0' },
    cache: 'no-store',
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* HTML */ }
  return { ok: res.ok, status: res.status, json, text };
}

// ══════════════════════════════════════════════════════════════
// MCP client (Streamable HTTP) — writes via api.apparelmagic.com/mcp
// The same surface the ApparelMagic MCP connector uses, auth via X-API-Key.
// ══════════════════════════════════════════════════════════════
function parseMcpBody(text: string): any {
  try { return JSON.parse(text); } catch { /* maybe SSE */ }
  const msgs: any[] = [];
  for (const line of text.split('\n')) {
    const m = line.match(/^data:\s*(.+)$/);
    if (m) { try { msgs.push(JSON.parse(m[1])); } catch { /* skip */ } }
  }
  if (!msgs.length) return null;
  return msgs.find(x => x.result !== undefined || x.error !== undefined) || msgs[msgs.length - 1];
}

// Cached across invocations of a warm serverless instance
let mcpSessionId: string | null = null;
let mcpInitialized = false;
let mcpReqId = 0;

async function mcpRaw(payload: any, expectResponse = true) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream',
    'X-API-Key': AM_MCP_KEY,
    'User-Agent': 'AdvanceHQ/1.0',
  };
  if (mcpSessionId) headers['Mcp-Session-Id'] = mcpSessionId;
  const res = await fetch(AM_MCP_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    cache: 'no-store',
  });
  const sid = res.headers.get('mcp-session-id');
  if (sid) mcpSessionId = sid;
  const text = await res.text();
  return { status: res.status, msg: expectResponse ? parseMcpBody(text) : null, text };
}

async function mcpCallTool(name: string, args: any) {
  return mcpRaw({ jsonrpc: '2.0', id: ++mcpReqId, method: 'tools/call', params: { name, arguments: args } });
}

function mcpToolText(msg: any): string {
  const content = msg?.result?.content;
  if (Array.isArray(content)) return content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n');
  return JSON.stringify(msg?.result ?? msg?.error ?? null);
}

function mcpIsError(msg: any): boolean {
  return !!(msg?.error || msg?.result?.isError);
}

async function mcpInitialize(): Promise<{ ok: boolean; error?: string }> {
  const r = await mcpRaw({
    jsonrpc: '2.0', id: ++mcpReqId, method: 'initialize',
    params: {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'AdvanceHQ', version: '1.0' },
    },
  });
  if (r.status >= 400 || !r.msg?.result) {
    return { ok: false, error: `MCP initialize failed: HTTP ${r.status} ${(r.msg ? JSON.stringify(r.msg) : r.text).slice(0, 200)}` };
  }
  await mcpRaw({ jsonrpc: '2.0', method: 'notifications/initialized' }, false);
  mcpInitialized = true;
  return { ok: true };
}

async function mcpEnsureReady(): Promise<{ ok: boolean; error?: string }> {
  if (!AM_MCP_KEY) {
    return { ok: false, error: 'AM_MCP_KEY env var not set — add the am_… API key in Vercel Environment Variables.' };
  }
  if (!mcpInitialized) {
    const init = await mcpInitialize();
    if (!init.ok) return init;
  }
  return { ok: true };
}

// The exact contract, confirmed via the MCP's own schemas (probe v9):
//   tools/call execute_actions {
//     operationId: "InventoryQtyAdjustmentController.set",
//     requestBody: { items: [{sku_id, target_qty, warehouse_id}], reason, dry_run? }
//   }
const AM_SET_OPERATION_ID = process.env.AM_SET_OPERATION_ID || 'InventoryQtyAdjustmentController.set';

async function mcpSetInventory(skuId: number, targetQty: number, warehouseId: number, reason: string) {
  const ready = await mcpEnsureReady();
  if (!ready.ok) return { ok: false, error: ready.error, raw: '' };

  const args = {
    operationId: AM_SET_OPERATION_ID,
    requestBody: {
      items: [{ sku_id: skuId, target_qty: targetQty, warehouse_id: warehouseId }],
      reason,
    },
  };

  let r = await mcpCallTool('execute_actions', args);

  // Session/connection hiccup — re-handshake once and retry
  if (r.status === 404 || r.msg?.error?.code === -32000) {
    mcpInitialized = false;
    mcpSessionId = null;
    const re = await mcpEnsureReady();
    if (!re.ok) return { ok: false, error: re.error, raw: '' };
    r = await mcpCallTool('execute_actions', args);
  }

  const raw = mcpToolText(r.msg);
  if (r.status >= 400 || mcpIsError(r.msg)) {
    return { ok: false, error: `execute_actions failed: HTTP ${r.status} ${raw.slice(0, 300)}`, raw };
  }
  return { ok: true, error: null as string | null, raw };
}

// ══════════════════════════════════════════════════════════════
// Shared helpers
// ══════════════════════════════════════════════════════════════
async function fetchLiveInventory(skuId: string): Promise<{ live: boolean; record: any | null }> {
  const a = await amGet('/inventory', {
    'parameters[0][field]': 'sku_id',
    'parameters[0][operator]': '=',
    'parameters[0][value]': skuId,
    'pagination[page_size]': '10',
  });
  if (a.ok && Array.isArray(a.json?.response)) {
    const hit = a.json.response.find((r: any) => String(r.sku_id) === String(skuId));
    if (hit) return { live: true, record: hit };
  }
  const b = await amGet('/inventory', { sku_id: skuId, 'pagination[page_size]': '10' });
  if (b.ok && Array.isArray(b.json?.response)) {
    const hit = b.json.response.find((r: any) => String(r.sku_id) === String(skuId));
    if (hit) return { live: true, record: hit };
  }
  return { live: false, record: null };
}

async function getSnapshot(skuId: string) {
  const { data } = await supabase.from('inventory').select('*').eq('sku_id', skuId).limit(1).maybeSingle();
  return data || null;
}

async function refreshSnapshot(record: any) {
  if (!record?.sku_id) return;
  const update: Record<string, any> = { last_synced_at: new Date().toISOString() };
  for (const key of Object.keys(record)) {
    if (key.startsWith('qty_')) update[key] = toNum(record[key]);
  }
  try {
    await supabase.from('inventory').update(update).eq('sku_id', record.sku_id);
  } catch (e) {
    console.error('Snapshot refresh failed:', e);
  }
}

// ══════════════════════════════════════════════════════════════
// Route
// ══════════════════════════════════════════════════════════════
export async function POST(request: Request) {
  let body: any = {};
  try { body = await request.json(); } catch { /* empty */ }
  const action = body.action;

  // ── SEARCH ──
  if (action === 'search') {
    const q = (body.q || '').trim();
    let query = supabase
      .from('inventory')
      .select('sku_id, product_id, style_number, description, attr_2, size, sku_concat, qty_inventory, qty_avail_sell')
      .order('style_number', { ascending: true })
      .limit(25);

    if (q) {
      query = query.or(`style_number.ilike.%${q}%,sku_concat.ilike.%${q}%,description.ilike.%${q}%`);
    }

    const { data, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ results: data || [] });
  }

  // ── LIVE ──
  if (action === 'live') {
    const skuId = String(body.sku_id || '');
    if (!skuId) return NextResponse.json({ error: 'sku_id required' }, { status: 400 });

    const snapshot = await getSnapshot(skuId);
    const liveResult = await fetchLiveInventory(skuId);
    if (liveResult.live) await refreshSnapshot(liveResult.record);

    return NextResponse.json({
      live: liveResult.live,
      record: liveResult.record || snapshot,
      snapshot,
    });
  }

  // ── WAREHOUSES ──
  if (action === 'warehouses') {
    const res = await amGet('/warehouses', { 'pagination[page_size]': '100' });
    const list = Array.isArray(res.json?.response) ? res.json.response : [];
    return NextResponse.json({ warehouses: list });
  }

  // ── HISTORY ──
  if (action === 'history') {
    const { data } = await supabase
      .from('inventory_adjustments')
      .select('id, sku_id, style_number, sku_concat, qty_before, qty_target, qty_delta, status, error, source, created_at')
      .order('created_at', { ascending: false })
      .limit(20);
    return NextResponse.json({ history: data || [] });
  }

  // ── SUBMIT: absolute set via the ApparelMagic MCP ──
  if (action === 'submit') {
    const skuId = String(body.sku_id || '');
    const targetQty = toNum(body.target_qty);
    const warehouseId = parseInt(String(body.warehouse_id || '')) || 0;
    const notes = String(body.notes || '').slice(0, 500);

    if (!skuId) return NextResponse.json({ error: 'sku_id required' }, { status: 400 });
    if (body.target_qty === undefined || body.target_qty === null || body.target_qty === '') {
      return NextResponse.json({ error: 'target_qty required' }, { status: 400 });
    }
    if (!warehouseId) return NextResponse.json({ error: 'warehouse_id required' }, { status: 400 });

    // Current qty for audit + delta display
    const snapshot = await getSnapshot(skuId);
    const liveResult = await fetchLiveInventory(skuId);
    const source = liveResult.live ? 'live' : 'snapshot';
    const current = liveResult.live ? liveResult.record : snapshot;

    if (!current) {
      return NextResponse.json({ error: `SKU ${skuId} not found in ApparelMagic or local snapshot` }, { status: 404 });
    }

    const qtyBefore = toNum(current.qty_inventory);
    const delta = targetQty - qtyBefore;

    const baseAudit = {
      sku_id: skuId,
      style_number: current.style_number || snapshot?.style_number || null,
      sku_concat: current.sku_concat || snapshot?.sku_concat || null,
      warehouse_id: String(warehouseId),
      qty_before: qtyBefore,
      qty_target: targetQty,
      qty_delta: delta,
      source,
      notes: notes || null,
    };

    if (delta === 0) {
      await supabase.from('inventory_adjustments').insert({ ...baseAudit, status: 'noop' });
      return NextResponse.json({ success: true, noop: true, qty_before: qtyBefore, qty_target: targetQty, delta: 0 });
    }

    const reason = notes || `Advance HQ warehouse adjustment (set to ${targetQty})`;
    const result = await mcpSetInventory(parseInt(skuId), targetQty, warehouseId, reason);

    await supabase.from('inventory_adjustments').insert({
      ...baseAudit,
      status: result.ok ? 'success' : 'error',
      error: result.ok ? null : result.error,
      am_endpoint: `mcp:execute_actions:${AM_SET_OPERATION_ID}`,
      am_response: { raw: (result.raw || '').slice(0, 2000) },
    });

    if (!result.ok) {
      return NextResponse.json({
        error: 'ApparelMagic rejected the inventory set',
        detail: result.error,
      }, { status: 502 });
    }

    // Verify via legacy read and refresh the snapshot
    let qtyAfter: number | null = null;
    const verify = await fetchLiveInventory(skuId);
    if (verify.live) {
      qtyAfter = toNum(verify.record.qty_inventory);
      await refreshSnapshot(verify.record);
    } else if (snapshot) {
      await supabase.from('inventory').update({
        qty_inventory: targetQty,
        last_synced_at: new Date().toISOString(),
      }).eq('sku_id', skuId);
      qtyAfter = targetQty;
    }

    return NextResponse.json({
      success: true,
      qty_before: qtyBefore,
      qty_target: targetQty,
      delta,
      qty_after: qtyAfter,
      verified: verify.live && qtyAfter === targetQty,
    });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
