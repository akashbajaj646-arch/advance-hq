import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// Activate/deactivate SKUs (variants) or a whole product in ApparelMagic,
// then mirror to Supabase. AM has no product-level active flag: products only
// carry a derived skus_active rollup, so "product inactive" = flip every SKU
// via PUT /inventory/{sku_id} with token+time in the body (probed Sep 2026).
// Each write is verified by re-reading the record before Supabase is touched.
// Gated to admin/manager via the ahq_role cookie set at login.

const AM_URL = process.env.NEXT_PUBLIC_APPARELMAGIC_URL || '';
const AM_TOKEN = process.env.APPARELMAGIC_TOKEN || '';

async function readAmActive(skuId: string): Promise<string | null> {
  const time = Math.floor(Date.now() / 1000).toString();
  const url = `${AM_URL}/inventory?parameters[0][field]=sku_id&parameters[0][operator]==&parameters[0][value]=${encodeURIComponent(skuId)}&time=${time}&token=${AM_TOKEN}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'AdvanceHQ/1.0' }, cache: 'no-store' });
  if (!res.ok) return null;
  const data = await res.json();
  const rec = (data.response || [])[0];
  return rec ? String(rec.active ?? '') : null;
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }
  const role = cookies().get('ahq_role')?.value || '';
  if (role !== 'admin' && role !== 'manager') {
    return NextResponse.json({ error: 'Only admins and managers can change active status. If you are one, log out and back in.' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const active: boolean = !!body.active;
    const flag = active ? '1' : '0';

    // Resolve target SKUs: explicit list, or every SKU of a product
    let skuIds: string[] = Array.isArray(body.sku_ids) ? body.sku_ids.map(String) : [];
    if (skuIds.length === 0 && body.product_id) {
      const { data } = await supabaseAdmin
        .from('inventory')
        .select('sku_id')
        .eq('product_id', String(body.product_id));
      skuIds = (data || []).map(r => String(r.sku_id));
    }
    skuIds = [...new Set(skuIds)].filter(Boolean).slice(0, 200);
    if (skuIds.length === 0) {
      return NextResponse.json({ error: 'No SKUs to update' }, { status: 400 });
    }

    const updated: string[] = [];
    const failed: { sku_id: string; reason: string }[] = [];

    for (const skuId of skuIds) {
      try {
        const time = Math.floor(Date.now() / 1000).toString();
        const putRes = await fetch(`${AM_URL}/inventory/${encodeURIComponent(skuId)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', 'User-Agent': 'AdvanceHQ/1.0' },
          body: JSON.stringify({ active: flag, token: AM_TOKEN, time }),
        });
        if (!putRes.ok) {
          failed.push({ sku_id: skuId, reason: `AM HTTP ${putRes.status}` });
          continue;
        }
        // Verify the flip actually landed
        const confirmed = await readAmActive(skuId);
        if (confirmed !== flag) {
          failed.push({ sku_id: skuId, reason: `AM did not apply (still "${confirmed ?? 'unreadable'}")` });
          continue;
        }
        updated.push(skuId);
      } catch (e: any) {
        failed.push({ sku_id: skuId, reason: e.message || 'request failed' });
      }
    }

    // Mirror only the AM-confirmed SKUs
    if (updated.length > 0) {
      await supabaseAdmin.from('inventory').update({ active: flag }).in('sku_id', updated);
      await supabaseAdmin.from('product_skus').update({ is_active: active }).in('sku_id', updated);
    }

    return NextResponse.json({
      success: failed.length === 0,
      active,
      updated,
      failed,
    }, { status: failed.length === 0 ? 200 : 207 });
  } catch (error: any) {
    console.error('Active update error:', error);
    return NextResponse.json({ error: error.message || 'Update failed' }, { status: 500 });
  }
}
