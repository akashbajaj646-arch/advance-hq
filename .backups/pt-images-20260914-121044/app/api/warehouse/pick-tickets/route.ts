import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Read-only pick ticket lookup for the warehouse floor: the "paper got
// ripped" backstop. Search by PT number, order, PO, or customer; open one
// to see line items with bin locations. No amounts are returned.

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const id = (searchParams.get('id') || '').trim();
  const q = (searchParams.get('q') || '').trim();

  try {
    // ── Detail: one pick ticket with items + bins ──
    if (id) {
      const { data: pt } = await supabaseAdmin
        .from('pick_tickets')
        .select('pick_ticket_id, customer_name, apparel_magic_order_id, invoice_id, customer_po, pick_ticket_date, wms_status, is_void')
        .eq('pick_ticket_id', id)
        .maybeSingle();

      if (!pt) {
        return NextResponse.json({ error: 'Pick ticket not found' }, { status: 404 });
      }

      const { data: items } = await supabaseAdmin
        .from('pick_ticket_items')
        .select('*')
        .eq('pick_ticket_id', id);

      // Enrich items with variant details + per-warehouse bins where we can
      const skuIds = [...new Set((items || []).map((i: any) => i.sku_id).filter(Boolean))];

      let skuInfo: Record<string, any> = {};
      let binMap: Record<string, any[]> = {};
      if (skuIds.length > 0) {
        const [{ data: skus }, { data: bins }] = await Promise.all([
          supabaseAdmin
            .from('product_skus')
            .select('sku_id, product_id, attr_2, size, upc, bin_location')
            .in('sku_id', skuIds),
          supabaseAdmin
            .from('sku_warehouse_locations')
            .select('sku_id, warehouse_id, warehouse_name, bin_location, qty')
            .in('sku_id', skuIds)
            .order('warehouse_id', { ascending: true }),
        ]);
        skus?.forEach(s => { skuInfo[s.sku_id] = s; });
        bins?.forEach(b => {
          if (!binMap[b.sku_id]) binMap[b.sku_id] = [];
          binMap[b.sku_id].push(b);
        });
      }

      // Strip money fields defensively (pick_ticket_items is selected with *)
      const MONEY_KEYS = ['price', 'unit_price', 'amount', 'total', 'total_amount', 'subtotal', 'cost', 'discount', 'discount_amount', 'line_total'];
      const cleanItems = (items || []).map((item: any) => {
        const clean: Record<string, any> = {};
        for (const [k, v] of Object.entries(item)) {
          if (!MONEY_KEYS.some(mk => k === mk || k.endsWith('_' + mk))) clean[k] = v;
        }
        return {
          ...clean,
          _sku: item.sku_id ? skuInfo[item.sku_id] || null : null,
          _bins: item.sku_id ? binMap[item.sku_id] || [] : [],
        };
      });

      return NextResponse.json({ pick_ticket: pt, items: cleanItems });
    }

    // ── List: search pick tickets ──
    let query = supabaseAdmin
      .from('pick_tickets')
      .select('pick_ticket_id, customer_name, apparel_magic_order_id, invoice_id, customer_po, pick_ticket_date, wms_status, is_void');

    if (q) {
      const esc = q.replace(/[%,()]/g, ' ').trim();
      query = query.or(`pick_ticket_id.ilike.%${esc}%,customer_name.ilike.%${esc}%,apparel_magic_order_id.ilike.%${esc}%,customer_po.ilike.%${esc}%`);
    }

    const { data: tickets } = await query
      .order('pick_ticket_date', { ascending: false })
      .limit(30);

    return NextResponse.json({ pick_tickets: tickets || [] });
  } catch (error: any) {
    console.error('Warehouse pick ticket error:', error);
    return NextResponse.json({ error: 'Lookup failed' }, { status: 500 });
  }
}
