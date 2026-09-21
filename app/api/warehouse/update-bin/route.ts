import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Update a SKU's bin location in ApparelMagic, then mirror to Supabase.
// AM write auth quirk: the legacy /api/json token is read-only when passed as
// query params but accepts writes when token+time ride in the JSON body
// (probed Sep 2026). A no-op PUT returns 200 with empty response, so the only
// proof a change landed is re-reading the record — Supabase is only updated
// after AM's re-read confirms the new value.

const AM_URL = process.env.NEXT_PUBLIC_APPARELMAGIC_URL || '';
const AM_TOKEN = process.env.APPARELMAGIC_TOKEN || '';

async function fetchSkuWarehouseRecords(skuId: string): Promise<any[]> {
  const time = Math.floor(Date.now() / 1000).toString();
  const url = `${AM_URL}/sku_warehouse?parameters[0][field]=sku_id&parameters[0][operator]==&parameters[0][value]=${encodeURIComponent(skuId)}&time=${time}&token=${AM_TOKEN}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'AdvanceHQ/1.0' }, cache: 'no-store' });
  if (!res.ok) throw new Error(`AM read failed: ${res.status}`);
  const data = await res.json();
  return data.response || [];
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const skuId = String(body.sku_id || '').trim();
    const warehouseId = String(body.warehouse_id || '').trim();
    const newBin = String(body.bin_location ?? '').trim().slice(0, 100);

    if (!skuId || !warehouseId) {
      return NextResponse.json({ error: 'sku_id and warehouse_id are required' }, { status: 400 });
    }

    // 1. Find the AM sku_warehouse record id
    const records = await fetchSkuWarehouseRecords(skuId);
    const rec = records.find(r => String(r.warehouse_id) === warehouseId);
    if (!rec?.id) {
      return NextResponse.json({ error: `No AM record for SKU ${skuId} in warehouse ${warehouseId}` }, { status: 404 });
    }

    // 2. Write to AM (token+time in body — query-param token is read-only)
    const time = Math.floor(Date.now() / 1000).toString();
    const putRes = await fetch(`${AM_URL}/sku_warehouse/${rec.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'AdvanceHQ/1.0' },
      body: JSON.stringify({ location: newBin, token: AM_TOKEN, time }),
    });
    if (!putRes.ok) {
      return NextResponse.json({ error: `AM rejected the update (HTTP ${putRes.status})` }, { status: 502 });
    }

    // 3. Re-read to confirm the change actually landed
    const after = await fetchSkuWarehouseRecords(skuId);
    const confirmed = after.find(r => String(r.warehouse_id) === warehouseId);
    const confirmedBin = String(confirmed?.location ?? '').trim();
    if (confirmedBin !== newBin) {
      return NextResponse.json({
        error: `ApparelMagic accepted the request but did not apply it (AM still shows "${confirmedBin || 'empty'}"). Nothing was changed in Advance HQ.`,
      }, { status: 502 });
    }

    // 4. AM confirmed — mirror to Supabase
    await supabaseAdmin
      .from('sku_warehouse_locations')
      .upsert({
        sku_id: skuId,
        warehouse_id: warehouseId,
        bin_location: newBin || null,
        last_synced_at: new Date().toISOString(),
      }, { onConflict: 'sku_id,warehouse_id' });

    // Keep the legacy flat bin field in step for warehouse 1 (its historical source)
    if (warehouseId === '1') {
      await supabaseAdmin.from('inventory').update({ bin_location: newBin || null }).eq('sku_id', skuId);
      await supabaseAdmin.from('product_skus').update({ bin_location: newBin || null }).eq('sku_id', skuId);
    }

    return NextResponse.json({ success: true, sku_id: skuId, warehouse_id: warehouseId, bin_location: newBin || null });
  } catch (error: any) {
    console.error('Bin update error:', error);
    return NextResponse.json({ error: error.message || 'Update failed' }, { status: 500 });
  }
}
