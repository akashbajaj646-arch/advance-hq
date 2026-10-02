import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getSession } from '@/lib/auth';
import { getProductStatuses, setProductStatus, type ShopifyStore } from '@/lib/shopify';
import { STORES, loadSkuRefs, logControls, readStorePolicies, type SkuRef } from '@/lib/sku-controls';

// GET  /api/products/shopify-status?product_id=X
//   → { b2b: { ok, products: [{id,title,status}], error? }, dtc: {...} }
// POST /api/products/shopify-status { product_id, status: 'DRAFT' | 'ACTIVE' }
//   Sets every Shopify product holding this style's variants, on both stores.
// Shopify products are found through their variants (variant sku === inventory.sku_concat).

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function errText(e: any): string {
  if (!e) return 'Unknown error';
  if (Array.isArray(e)) return e.map(x => x?.message || JSON.stringify(x)).join('; ');
  return e.message || JSON.stringify(e);
}

async function productIdsFor(store: ShopifyStore, refs: SkuRef[]): Promise<{ ok: boolean; ids: string[]; error?: string }> {
  const read = await readStorePolicies(store, refs);
  if (!read.ok) return { ok: false, ids: [], error: read.error };
  const ids = new Set<string>();
  read.map.forEach(v => { if (v?.productId) ids.add(v.productId); });
  return { ok: true, ids: Array.from(ids) };
}

async function statusFor(refs: SkuRef[]) {
  const out: Record<string, any> = {};
  await Promise.all(STORES.map(async store => {
    const p = await productIdsFor(store, refs);
    if (!p.ok) { out[store] = { ok: false, products: [], error: p.error }; return; }
    const s = await getProductStatuses(store, p.ids);
    out[store] = s.ok ? { ok: true, products: s.products } : { ok: false, products: [], error: errText(s.errors) };
  }));
  return out;
}

export async function GET(request: Request) {
  const session: any = await getSession();
  if (!session) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  try {
    const productId = new URL(request.url).searchParams.get('product_id') || '';
    if (!productId) return NextResponse.json({ error: 'product_id required' }, { status: 400 });
    const refs = await loadSkuRefs({ productId });
    return NextResponse.json(await statusFor(refs));
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const session: any = await getSession();
  if (!session) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  const role = session.user?.role || cookies().get('ahq_role')?.value || '';
  if (role !== 'admin' && role !== 'manager') {
    return NextResponse.json({ error: 'Only admins and managers can change Shopify status.' }, { status: 403 });
  }
  const actor = String(session.user?.email || session.user?.name || session.user?.id || '');

  try {
    const { product_id, status } = await request.json();
    const pid = String(product_id || '');
    if (!pid || !['DRAFT', 'ACTIVE'].includes(status)) {
      return NextResponse.json({ error: "product_id and status ('DRAFT' | 'ACTIVE') required" }, { status: 400 });
    }
    const refs = await loadSkuRefs({ productId: pid });
    if (!refs.length) return NextResponse.json({ error: 'No SKUs for this product' }, { status: 404 });

    const before = await statusFor(refs);
    const errors: string[] = [];
    const logs: Record<string, any>[] = [];

    await Promise.all(STORES.map(async store => {
      const b = before[store];
      if (!b?.ok) { errors.push(`${store.toUpperCase()}: ${b?.error || 'lookup failed'}`); return; }
      for (const p of b.products as { id: string; status: string }[]) {
        if (p.status === status) continue;
        const w = await setProductStatus(store, p.id, status);
        logs.push({
          action: 'product_status', store, product_id: pid, sku_id: null, sku_concat: p.id,
          old_value: p.status, new_value: w.ok ? status : p.status, status: w.ok ? 'set' : 'failed',
          detail: w.ok ? null : errText(w.errors), actor,
        });
        if (!w.ok) errors.push(`${store.toUpperCase()}: ${errText(w.errors)}`);
      }
    }));

    await logControls(logs);
    const after = await statusFor(refs);
    return NextResponse.json({ success: errors.length === 0, errors, stores: after }, { status: errors.length ? 207 : 200 });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
