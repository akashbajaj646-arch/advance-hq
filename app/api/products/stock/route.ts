import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { amGet } from '@/lib/apparelmagic';

// POST /api/products/stock { sku_ids }
//   → { stock: { [sku_id]: { ok, rows: [{ warehouse_id, qty }], error? } } }
// Live per-warehouse quantities from AM /sku_warehouse (qty field is qty_inventory).
// Used by the "Set to 0" dialog so the user sees exactly what will be wiped.

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

async function readSku(skuId: string) {
  const res = await amGet('sku_warehouse', {
    'pagination[page_size]': '50',
    'parameters[0][field]': 'sku_id',
    'parameters[0][operator]': '=',
    'parameters[0][value]': skuId,
  });
  if (!res.ok && !res.records.length) return { ok: false, rows: [], error: `AM HTTP ${res.status}` };
  const byWh: Record<string, number> = {};
  for (const r of res.records.filter((x: any) => String(x.sku_id) === skuId)) {
    const wh = String(r.warehouse_id ?? r.warehouse ?? '');
    if (!wh) continue;
    const q = parseFloat(r.qty_inventory ?? r.qty ?? '0');
    byWh[wh] = (byWh[wh] || 0) + (isNaN(q) ? 0 : q);
  }
  const rows = Object.entries(byWh).map(([warehouse_id, qty]) => ({ warehouse_id, qty }));
  return { ok: true, rows };
}

export async function POST(request: Request) {
  const session: any = await getSession();
  if (!session) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  try {
    const body = await request.json();
    const skuIds: string[] = Array.isArray(body.sku_ids) ? Array.from(new Set(body.sku_ids.map(String))).slice(0, 100) as string[] : [];
    if (!skuIds.length) return NextResponse.json({ error: 'sku_ids required' }, { status: 400 });

    const stock: Record<string, any> = {};
    for (let i = 0; i < skuIds.length; i += 5) {
      const chunk = skuIds.slice(i, i + 5);
      const results = await Promise.all(chunk.map(readSku));
      chunk.forEach((id, j) => { stock[id] = results[j]; });
    }
    return NextResponse.json({ stock });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
