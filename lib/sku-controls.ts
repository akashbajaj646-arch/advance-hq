// Per-SKU Shopify controls used by the product detail page.
// Variant match: Shopify variant sku === inventory.sku_concat.
// Store semantics (same as automations/run): B2B carries every variant, so a
// missing B2B variant is a failure; DTC intentionally lacks some, so missing is fine.

import { supabaseAdmin } from '@/lib/supabase-admin';
import {
  findVariantsBySkus,
  setInventoryPolicies,
  storeConfig,
  type ShopifyStore,
  type ShopifyVariant,
} from '@/lib/shopify';

export type Policy = 'CONTINUE' | 'DENY';

export type SkuRef = {
  sku_id: string;
  product_id: string | null;
  sku_concat: string | null;
  active: boolean;
};

export type CellResult = {
  ok: boolean;
  status: 'set' | 'unchanged' | 'missing' | 'failed';
  policy?: Policy;
  was?: Policy;
  error?: string;
};

export const STORES: ShopifyStore[] = ['b2b', 'dtc'];

export function isActiveFlag(v: any): boolean {
  return v === true || v === 1 || v === '1' || v === 't' || v === 'true';
}

function errText(e: any): string {
  if (!e) return 'Unknown error';
  if (typeof e === 'string') return e;
  if (Array.isArray(e)) return e.map(x => x?.message || JSON.stringify(x)).join('; ');
  return e.message || JSON.stringify(e);
}

export async function loadSkuRefs(opts: { productId?: string; skuIds?: string[] }): Promise<SkuRef[]> {
  let q = supabaseAdmin.from('inventory').select('sku_id,product_id,sku_concat,active');
  if (opts.skuIds && opts.skuIds.length) q = q.in('sku_id', opts.skuIds);
  else if (opts.productId) q = q.eq('product_id', opts.productId);
  else return [];
  const { data, error } = await q.limit(1000);
  if (error) throw new Error(`inventory read failed: ${error.message}`);
  const seen = new Map<string, SkuRef>();
  for (const r of data || []) {
    const id = String(r.sku_id);
    if (seen.has(id)) continue;
    seen.set(id, {
      sku_id: id,
      product_id: r.product_id != null ? String(r.product_id) : null,
      sku_concat: r.sku_concat || null,
      active: isActiveFlag(r.active),
    });
  }
  return Array.from(seen.values());
}

export async function readStorePolicies(
  store: ShopifyStore,
  refs: SkuRef[]
): Promise<{ ok: boolean; error?: string; map: Map<string, ShopifyVariant | null> }> {
  const map = new Map<string, ShopifyVariant | null>();
  if (!storeConfig(store)) return { ok: false, error: `${store.toUpperCase()} store not configured`, map };
  const res = await findVariantsBySkus(store, refs.map(r => r.sku_concat || '').filter(Boolean));
  if (!res.ok) return { ok: false, error: errText(res.errors), map };
  for (const r of refs) map.set(r.sku_id, r.sku_concat ? res.variants[r.sku_concat] ?? null : null);
  return { ok: true, map };
}

export async function applyPolicy(
  store: ShopifyStore,
  refs: SkuRef[],
  desiredFor: (ref: SkuRef) => Policy
): Promise<Record<string, CellResult>> {
  const results: Record<string, CellResult> = {};
  const read = await readStorePolicies(store, refs);
  if (!read.ok) {
    for (const r of refs) results[r.sku_id] = { ok: false, status: 'failed', error: read.error };
    return results;
  }

  const groups = new Map<string, { ref: SkuRef; variant: ShopifyVariant; desired: Policy }[]>();
  for (const ref of refs) {
    const v = read.map.get(ref.sku_id);
    const desired = desiredFor(ref);
    if (!v) {
      results[ref.sku_id] = store === 'dtc'
        ? { ok: true, status: 'missing' }
        : { ok: false, status: 'missing', error: 'Variant not found on B2B store' };
      continue;
    }
    if (v.inventoryPolicy === desired) {
      results[ref.sku_id] = { ok: true, status: 'unchanged', policy: desired, was: v.inventoryPolicy };
      continue;
    }
    const list = groups.get(v.productId) || [];
    list.push({ ref, variant: v, desired });
    groups.set(v.productId, list);
  }

  for (const [productId, items] of Array.from(groups.entries())) {
    const w = await setInventoryPolicies(store, productId, items.map(i => ({ id: i.variant.id, policy: i.desired })));
    for (const i of items) {
      const got = w.policies[i.variant.id];
      if (got === i.desired) {
        results[i.ref.sku_id] = { ok: true, status: 'set', policy: i.desired, was: i.variant.inventoryPolicy };
      } else {
        results[i.ref.sku_id] = {
          ok: false,
          status: 'failed',
          policy: i.variant.inventoryPolicy,
          was: i.variant.inventoryPolicy,
          error: w.ok ? `Shopify returned ${got ?? 'nothing'}` : errText(w.errors),
        };
      }
    }
  }
  return results;
}

export async function logControls(rows: Record<string, any>[]) {
  if (!rows.length) return;
  const { error } = await supabaseAdmin.from('sku_control_log').insert(rows);
  if (error) console.error('sku_control_log insert failed:', error.message);
}

export function policyLogRows(
  action: string,
  store: ShopifyStore,
  refs: SkuRef[],
  results: Record<string, CellResult>,
  actor: string
) {
  return refs.map(r => {
    const res = results[r.sku_id];
    return {
      action,
      store,
      product_id: r.product_id,
      sku_id: r.sku_id,
      sku_concat: r.sku_concat,
      old_value: res?.was ?? null,
      new_value: res?.policy ?? null,
      status: res?.status ?? 'failed',
      detail: res?.error ?? null,
      actor,
    };
  });
}
