import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getSession } from '@/lib/auth';
import {
  STORES,
  applyPolicy,
  loadSkuRefs,
  logControls,
  policyLogRows,
  readStorePolicies,
  type CellResult,
  type Policy,
} from '@/lib/sku-controls';
import type { ShopifyStore } from '@/lib/shopify';

// GET  /api/products/sku-controls?product_id=X
//   → live "continue selling" (inventoryPolicy) per SKU on both Shopify stores
// POST /api/products/sku-controls
//   { action: 'policy', store: 'b2b'|'dtc', sku_ids, policy: 'CONTINUE'|'DENY' }
//   { action: 'sync_active', sku_ids, active }   (called after /api/warehouse/update-active
//     succeeds; mirrors the automation rule: deactivated → DENY, reactivated → CONTINUE, both stores)
// Every write is audit-logged to sku_control_log.

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

async function auth(write: boolean) {
  const session: any = await getSession();
  if (!session) return { error: NextResponse.json({ error: 'Authentication required' }, { status: 401 }) };
  if (write) {
    const role = session.user?.role || cookies().get('ahq_role')?.value || '';
    if (role !== 'admin' && role !== 'manager') {
      return { error: NextResponse.json({ error: 'Only admins and managers can change SKU settings.' }, { status: 403 }) };
    }
  }
  const actor = String(session.user?.email || session.user?.name || session.user?.id || '');
  return { actor };
}

export async function GET(request: Request) {
  const a = await auth(false);
  if (a.error) return a.error;
  try {
    const productId = new URL(request.url).searchParams.get('product_id') || '';
    if (!productId) return NextResponse.json({ error: 'product_id required' }, { status: 400 });
    const refs = await loadSkuRefs({ productId });

    const stores: Record<string, { ok: boolean; error?: string }> = {};
    const skus: Record<string, Record<string, { status: 'found' | 'missing' | 'error'; policy?: Policy }>> = {};
    for (const r of refs) skus[r.sku_id] = {};

    await Promise.all(STORES.map(async store => {
      const read = await readStorePolicies(store, refs);
      stores[store] = { ok: read.ok, error: read.error };
      for (const r of refs) {
        if (!read.ok) { skus[r.sku_id][store] = { status: 'error' }; continue; }
        const v = read.map.get(r.sku_id);
        skus[r.sku_id][store] = v ? { status: 'found', policy: v.inventoryPolicy } : { status: 'missing' };
      }
    }));

    return NextResponse.json({ stores, skus });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const a = await auth(true);
  if (a.error) return a.error;
  try {
    const body = await request.json();
    const skuIds: string[] = Array.isArray(body.sku_ids) ? Array.from(new Set(body.sku_ids.map(String))).slice(0, 200) as string[] : [];
    if (!skuIds.length) return NextResponse.json({ error: 'sku_ids required' }, { status: 400 });
    const refs = await loadSkuRefs({ skuIds });
    if (!refs.length) return NextResponse.json({ error: 'No matching SKUs in inventory' }, { status: 404 });

    const results: Partial<Record<ShopifyStore, Record<string, CellResult>>> = {};
    const logs: Record<string, any>[] = [];

    if (body.action === 'policy') {
      const store = body.store as ShopifyStore;
      const policy = body.policy as Policy;
      if (!STORES.includes(store) || !['CONTINUE', 'DENY'].includes(policy)) {
        return NextResponse.json({ error: 'store and policy are required' }, { status: 400 });
      }
      results[store] = await applyPolicy(store, refs, () => policy);
      logs.push(...policyLogRows('continue_selling', store, refs, results[store]!, a.actor!));
    } else if (body.action === 'sync_active') {
      const active = !!body.active;
      const desired: Policy = active ? 'CONTINUE' : 'DENY';
      logs.push(...refs.map(r => ({
        action: 'am_active', store: null, product_id: r.product_id, sku_id: r.sku_id, sku_concat: r.sku_concat,
        old_value: active ? '0' : '1', new_value: active ? '1' : '0', status: 'set', detail: null, actor: a.actor,
      })));
      await Promise.all(STORES.map(async store => {
        results[store] = await applyPolicy(store, refs, () => desired);
        logs.push(...policyLogRows('active_to_shopify', store, refs, results[store]!, a.actor!));
      }));
    } else {
      return NextResponse.json({ error: "action must be 'policy' or 'sync_active'" }, { status: 400 });
    }

    await logControls(logs);
    const failed = Object.values(results).some(r => Object.values(r || {}).some(c => !c.ok));
    return NextResponse.json({ success: !failed, results }, { status: failed ? 207 : 200 });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
