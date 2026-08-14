import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
);

const AM_TOKEN = process.env.APPARELMAGIC_TOKEN || '';
const AM_BASE = process.env.NEXT_PUBLIC_APPARELMAGIC_URL || 'https://advanceapparels.app.apparelmagic.com/api/json';

function authParams() {
  return { time: Math.floor(Date.now() / 1000).toString(), token: AM_TOKEN };
}

function toNum(val: any): number {
  if (val === null || val === undefined || val === '') return 0;
  const n = parseFloat(val);
  return isNaN(n) ? 0 : n;
}

// ── AM GET (query-string auth) ──
async function amGet(path: string, extra: Record<string, string> = {}) {
  const auth = authParams();
  const params = new URLSearchParams({ time: auth.time, token: auth.token, ...extra });
  const res = await fetch(`${AM_BASE}${path}?${params.toString()}`, {
    method: 'GET',
    headers: { 'User-Agent': 'AdvanceHQ/1.0' },
    cache: 'no-store',
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* Apache HTML etc. */ }
  return { ok: res.ok, status: res.status, json, text };
}

// ── AM POST (time+token form-encoded in BODY — required for writes) ──
async function amPost(path: string, fields: Record<string, string>) {
  const auth = authParams();
  const body = new URLSearchParams({ time: auth.time, token: auth.token, ...fields });
  const res = await fetch(`${AM_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'AdvanceHQ/1.0',
    },
    body: body.toString(),
    cache: 'no-store',
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* HTML error page */ }
  return { ok: res.ok, status: res.status, json, text };
}

// ── Live inventory lookup for one SKU (tries both AM filter styles) ──
// NOTE: AM rejects page_size below 10 — minimum is 10.
async function fetchLiveInventory(skuId: string): Promise<{ live: boolean; record: any | null; filterStyle: string | null }> {
  // Style A: parameters[0][field/operator/value]
  const a = await amGet('/inventory', {
    'parameters[0][field]': 'sku_id',
    'parameters[0][operator]': '=',
    'parameters[0][value]': skuId,
    'pagination[page_size]': '10',
  });
  if (a.ok && Array.isArray(a.json?.response)) {
    const hit = a.json.response.find((r: any) => String(r.sku_id) === String(skuId));
    if (hit && a.json.response.length <= 10) return { live: true, record: hit, filterStyle: 'parameters' };
  }

  // Style B: direct field filter
  const b = await amGet('/inventory', { sku_id: skuId, 'pagination[page_size]': '10' });
  if (b.ok && Array.isArray(b.json?.response)) {
    const hit = b.json.response.find((r: any) => String(r.sku_id) === String(skuId));
    if (hit && b.json.response.length <= 10) return { live: true, record: hit, filterStyle: 'direct' };
  }

  return { live: false, record: null, filterStyle: null };
}

async function getSnapshot(skuId: string) {
  const { data } = await supabase.from('inventory').select('*').eq('sku_id', skuId).limit(1).maybeSingle();
  return data || null;
}

// ── Refresh the Supabase inventory row from a live AM record ──
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

// ── Resolve the virtual "Inventory Adjustment" vendor ──
// AM's documented pattern for no-goods adjustments: create a virtual vendor and
// write receivers against it. Resolution order:
//   1. AM_ADJUSTMENT_VENDOR_ID env var
//   2. AM_ADJUSTMENT_VENDOR_NAME env var (name match)
//   3. Any vendor whose name contains "adjust" (case-insensitive)
let cachedVendor: { id: string; name: string } | null = null;

async function resolveAdjustmentVendor(): Promise<{ vendor: { id: string; name: string } | null; error?: string }> {
  if (cachedVendor) return { vendor: cachedVendor };

  const envId = process.env.AM_ADJUSTMENT_VENDOR_ID;
  if (envId) {
    cachedVendor = { id: envId, name: 'env-configured' };
    return { vendor: cachedVendor };
  }

  const wantedName = (process.env.AM_ADJUSTMENT_VENDOR_NAME || '').toLowerCase();
  const res = await amGet('/vendors', { 'pagination[page_size]': '1000' });
  const vendors = Array.isArray(res.json?.response) ? res.json.response : [];
  if (vendors.length === 0) {
    return { vendor: null, error: `Could not list vendors from ApparelMagic (HTTP ${res.status})` };
  }

  const nameOf = (v: any) => String(v.vendor_name || v.name || v.company || '');
  const idOf = (v: any) => String(v.vendor_id || v.id || '');

  let match = wantedName
    ? vendors.find((v: any) => nameOf(v).toLowerCase() === wantedName)
    : null;
  if (!match) match = vendors.find((v: any) => /adjust/i.test(nameOf(v)));

  if (!match) {
    return {
      vendor: null,
      error: 'No adjustment vendor found. Create a vendor named "Inventory Adjustment" in ApparelMagic (Vendors > New), or set AM_ADJUSTMENT_VENDOR_ID in Vercel env vars.',
    };
  }

  cachedVendor = { id: idOf(match), name: nameOf(match) };
  return { vendor: cachedVendor };
}

export async function POST(request: Request) {
  let body: any = {};
  try { body = await request.json(); } catch { /* empty */ }
  const action = body.action;

  // ── SEARCH: SKU dropdown source (Supabase snapshot — fast) ──
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

  // ── LIVE: current inventory for one SKU (AM first, snapshot fallback) ──
  if (action === 'live') {
    const skuId = String(body.sku_id || '');
    if (!skuId) return NextResponse.json({ error: 'sku_id required' }, { status: 400 });

    const snapshot = await getSnapshot(skuId);
    const liveResult = await fetchLiveInventory(skuId);

    if (liveResult.live) {
      // Keep HQ snapshot fresh as a side benefit
      await refreshSnapshot(liveResult.record);
    }

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

  // ── VENDOR: verify the adjustment vendor resolves (pre-flight check) ──
  if (action === 'vendor') {
    const { vendor, error } = await resolveAdjustmentVendor();
    return NextResponse.json({ vendor, error: error || null });
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

  // ── SUBMIT: set inventory to target via AM adjustment (delta-based) ──
  if (action === 'submit') {
    const skuId = String(body.sku_id || '');
    const targetQty = toNum(body.target_qty);
    const warehouseId = String(body.warehouse_id || '');
    const notes = String(body.notes || '').slice(0, 500);

    if (!skuId) return NextResponse.json({ error: 'sku_id required' }, { status: 400 });
    if (body.target_qty === undefined || body.target_qty === null || body.target_qty === '') {
      return NextResponse.json({ error: 'target_qty required' }, { status: 400 });
    }
    if (!warehouseId) return NextResponse.json({ error: 'warehouse_id required' }, { status: 400 });

    // Re-fetch the CURRENT qty server-side at submit time so the delta is computed
    // against reality, not against whatever the screen was showing.
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
      warehouse_id: warehouseId,
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

    const now = new Date();
    const dateStr = `${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')}/${now.getFullYear()}`;

    // AM's REST API has no /adjustments resource — its documented pattern is a
    // receiver against a virtual "Inventory Adjustment" vendor, qty = the delta.
    const { vendor, error: vendorError } = await resolveAdjustmentVendor();
    if (!vendor) {
      await supabase.from('inventory_adjustments').insert({ ...baseAudit, status: 'error', error: vendorError });
      return NextResponse.json({ error: vendorError }, { status: 422 });
    }

    const fields: Record<string, string> = {
      date: dateStr,
      vendor_id: vendor.id,
      warehouse_id: warehouseId,
      notes: notes || `Advance HQ warehouse adjustment (set to ${targetQty})`,
      'receiver_items[0][sku_id]': skuId,
      'receiver_items[0][qty]': String(delta),
    };

    const endpointUsed = '/receivers';
    const res = await amPost('/receivers', fields);

    const amOk = res.ok && res.json && !res.json.error && !res.json.errors && !(res.json.meta?.errors?.length);
    const amReceiverId =
      res.json?.response?.[0]?.receiver_id ||
      res.json?.response?.[0]?.id ||
      res.json?.receiver_id ||
      null;

    await supabase.from('inventory_adjustments').insert({
      ...baseAudit,
      notes: `${notes ? notes + ' · ' : ''}vendor: ${vendor.name} (${vendor.id})`,
      status: amOk ? 'success' : 'error',
      error: amOk ? null : (res.json?.error || res.json?.meta?.errors?.join?.(', ') || res.json?.errors?.join?.(', ') || `HTTP ${res.status}: ${res.text.slice(0, 300)}`),
      am_adjustment_id: amReceiverId ? String(amReceiverId) : null,
      am_endpoint: endpointUsed,
      am_response: res.json || { raw: res.text.slice(0, 1000) },
    });

    if (!amOk) {
      return NextResponse.json({
        error: 'ApparelMagic rejected the adjustment receiver',
        detail: res.json?.error || res.json?.meta?.errors || res.json?.errors || res.text.slice(0, 300),
        status: res.status,
        endpoint: endpointUsed,
      }, { status: 502 });
    }

    // Verify + refresh local snapshot from AM
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
      am_receiver_id: amReceiverId,
      vendor: vendor.name,
      verified: verify.live && qtyAfter === targetQty,
    });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
