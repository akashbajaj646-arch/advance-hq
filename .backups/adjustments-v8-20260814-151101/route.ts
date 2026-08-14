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
const AM_MODERN = AM_LEGACY.replace(/\/api\/json$/, '/api');

function authParams() {
  return { time: Math.floor(Date.now() / 1000).toString(), token: AM_TOKEN };
}

function toNum(val: any): number {
  if (val === null || val === undefined || val === '') return 0;
  const n = parseFloat(val);
  return isNaN(n) ? 0 : n;
}

// ── Legacy API GET (query-string auth) — reads only ──
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
  try { json = JSON.parse(text); } catch { /* HTML error page */ }
  return { ok: res.ok, status: res.status, json, text };
}

// ── Modern API POST (JSON body) — the write surface behind the AM MCP ──
interface AuthStyle {
  name: string;
  headers?: Record<string, string>;
  query?: Record<string, string>;
}

const AUTH_STYLES: AuthStyle[] = [
  { name: 'bearer', headers: { Authorization: `Bearer ${AM_TOKEN}` } },
  { name: 'x-api-key', headers: { 'X-API-Key': AM_TOKEN } },
  { name: 'x-api-token', headers: { 'X-Api-Token': AM_TOKEN } },
  { name: 'api-key', headers: { 'api-key': AM_TOKEN } },
  { name: 'token-query', query: { token: AM_TOKEN } },
  { name: 'legacy-query', query: { time: '__TIME__', token: AM_TOKEN } },
];

// Cache the working auth style across invocations of a warm serverless instance
let cachedAuthStyle: AuthStyle | null = null;

async function modernPost(path: string, bodyObj: any, style: AuthStyle) {
  const auth = authParams();
  let url = `${AM_MODERN}${path}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'User-Agent': 'AdvanceHQ/1.0',
    ...(style.headers || {}),
  };
  if (style.query) {
    const q: Record<string, string> = {};
    for (const [k, v] of Object.entries(style.query)) q[k] = v === '__TIME__' ? auth.time : v;
    url += '?' + new URLSearchParams(q).toString();
  }
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(bodyObj),
    cache: 'no-store',
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* HTML */ }
  const isHtml = /^\s*<!DOCTYPE|^\s*<html/i.test(text);
  return { ok: res.ok, status: res.status, json, text, isHtml };
}

// Find an auth style the modern API accepts, using a harmless dry_run preview
async function resolveAuthStyle(skuId: number, targetQty: number, warehouseId: number): Promise<{ style: AuthStyle | null; attempts: string[] }> {
  if (cachedAuthStyle) return { style: cachedAuthStyle, attempts: [`cached:${cachedAuthStyle.name}`] };

  const envStyle = process.env.AM_MODERN_AUTH_STYLE;
  const candidates = envStyle
    ? AUTH_STYLES.filter(s => s.name === envStyle).concat(AUTH_STYLES.filter(s => s.name !== envStyle))
    : AUTH_STYLES;

  const dryBody = {
    items: [{ sku_id: skuId, target_qty: targetQty, warehouse_id: warehouseId }],
    reason: 'Advance HQ auth detection (dry run)',
    dry_run: true,
  };

  const attempts: string[] = [];
  for (const style of candidates) {
    const r = await modernPost('/inventory/set', dryBody, style);
    attempts.push(`${style.name}:HTTP${r.status}${r.isHtml ? ':html' : ''}`);
    if (r.status >= 200 && r.status < 300 && r.json && !r.isHtml) {
      cachedAuthStyle = style;
      return { style, attempts };
    }
  }
  return { style: null, attempts };
}

// ── Live inventory lookup (legacy API — page_size minimum is 10) ──
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

  // ── SUBMIT: absolute set via modern /api/inventory/set ──
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

    // Read current qty for the audit trail and delta display
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

    // Resolve which auth style the modern API accepts (harmless dry_run probe, cached)
    const { style, attempts } = await resolveAuthStyle(parseInt(skuId), targetQty, warehouseId);
    if (!style) {
      const err = `Modern API auth failed — attempts: ${attempts.join(', ')}. Set AM_MODERN_AUTH_STYLE or check API key.`;
      await supabase.from('inventory_adjustments').insert({ ...baseAudit, status: 'error', error: err, am_endpoint: '/api/inventory/set' });
      return NextResponse.json({ error: err }, { status: 502 });
    }

    // The actual write — an absolute set, so no read-modify-write race
    const setBody = {
      items: [{ sku_id: parseInt(skuId), target_qty: targetQty, warehouse_id: warehouseId }],
      reason: notes || `Advance HQ warehouse adjustment (set to ${targetQty})`,
    };
    const res = await modernPost('/inventory/set', setBody, style);
    const amOk = res.status >= 200 && res.status < 300 && res.json && !res.isHtml
      && !res.json.error && !(Array.isArray(res.json.errors) && res.json.errors.length);

    await supabase.from('inventory_adjustments').insert({
      ...baseAudit,
      status: amOk ? 'success' : 'error',
      error: amOk ? null : (res.json?.error || res.json?.message || `HTTP ${res.status}: ${res.text.slice(0, 300)}`),
      am_endpoint: `/api/inventory/set (auth: ${style.name})`,
      am_response: res.json || { raw: res.text.slice(0, 1000) },
    });

    if (!amOk) {
      return NextResponse.json({
        error: 'ApparelMagic rejected the inventory set',
        detail: res.json?.error || res.json?.message || res.text.slice(0, 300),
        status: res.status,
      }, { status: 502 });
    }

    // Verify and refresh the local snapshot
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
