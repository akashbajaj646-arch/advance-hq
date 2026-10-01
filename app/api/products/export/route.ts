import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getSession } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { amGet } from '@/lib/apparelmagic';
import { STORES, applyPolicy, isActiveFlag, loadSkuRefs, logControls, policyLogRows, readStorePolicies } from '@/lib/sku-controls';

// POST /api/products/export { product_id }
// Step 1 (AM → HQ): re-reads this product's SKUs from AM /inventory and updates
//   active + qty in HQ's inventory and product_skus, so HQ matches AM right now.
// Step 2 (HQ → Shopify): enforces the rule on both stores: inactive SKU → DENY.
//   Active SKUs keep whatever Continue Selling choice is set per store.
// Quantities are NOT pushed: AM's own Shopify integration owns stock levels.
// Triggering AM's native Shopify export is pending an AM API probe.

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(request: Request) {
  const session: any = await getSession();
  if (!session) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  const role = session.user?.role || cookies().get('ahq_role')?.value || '';
  if (role !== 'admin' && role !== 'manager') {
    return NextResponse.json({ error: 'Only admins and managers can export.' }, { status: 403 });
  }
  const actor = String(session.user?.email || session.user?.name || session.user?.id || '');

  try {
    const { product_id } = await request.json();
    const pid = String(product_id || '');
    if (!pid) return NextResponse.json({ error: 'product_id required' }, { status: 400 });

    // Step 1: AM → HQ
    const am: { ok: boolean; refreshed: number; error?: string } = { ok: false, refreshed: 0 };
    const res = await amGet('inventory', {
      'pagination[page_size]': '100',
      'parameters[0][field]': 'product_id',
      'parameters[0][operator]': '=',
      'parameters[0][value]': pid,
    });
    const records = (res.records || []).filter((r: any) => String(r.product_id) === pid);
    if (!records.length) {
      am.error = res.ok ? 'AM returned no SKUs for this product' : `AM fetch failed (HTTP ${res.status})`;
    } else {
      for (const r of records) {
        const flag = isActiveFlag(r.active) ? '1' : '0';
        const qtyInv = Number(r.qty_inventory);
        const qtyAvail = Number(r.qty_avail_sell);
        const invPatch: Record<string, any> = { active: flag };
        const skuPatch: Record<string, any> = { is_active: flag === '1' };
        if (!isNaN(qtyInv)) { invPatch.qty_inventory = qtyInv; skuPatch.qty_inventory = qtyInv; }
        if (!isNaN(qtyAvail)) { invPatch.qty_avail_sell = qtyAvail; skuPatch.qty_avail_sell = Math.trunc(qtyAvail); }
        const { error } = await supabaseAdmin.from('inventory').update(invPatch).eq('sku_id', String(r.sku_id));
        if (error) { am.error = `HQ update failed: ${error.message}`; continue; }
        await supabaseAdmin.from('product_skus').update(skuPatch).eq('sku_id', String(r.sku_id));
        am.refreshed++;
      }
      am.ok = am.refreshed === records.length;
    }

    // Step 2: HQ → Shopify
    const refs = await loadSkuRefs({ productId: pid });
    const inactive = refs.filter(r => !r.active);
    const stores: Record<string, any> = {};
    const logs: Record<string, any>[] = [];

    await Promise.all(STORES.map(async store => {
      if (inactive.length) {
        const results = await applyPolicy(store, inactive, () => 'DENY');
        logs.push(...policyLogRows('export_enforce', store, inactive, results, actor));
        const vals = Object.values(results);
        stores[store] = {
          enforced: vals.filter(v => v.status === 'set').length,
          already_ok: vals.filter(v => v.status === 'unchanged').length,
          missing: vals.filter(v => v.status === 'missing').length,
          failed: vals.filter(v => !v.ok).length,
        };
      } else {
        const read = await readStorePolicies(store, refs);
        stores[store] = read.ok
          ? { enforced: 0, already_ok: 0, missing: refs.filter(r => !read.map.get(r.sku_id)).length, failed: 0 }
          : { enforced: 0, already_ok: 0, missing: 0, failed: refs.length, error: read.error };
      }
    }));

    await logControls(logs);
    return NextResponse.json({ success: am.ok && STORES.every(s => !stores[s]?.failed), am, stores, skus: refs.length });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
