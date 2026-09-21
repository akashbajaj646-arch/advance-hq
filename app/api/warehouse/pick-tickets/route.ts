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
      const skuIds: string[] = [...new Set((items || []).map((i: any) => i.sku_id).filter(Boolean))] as string[];

      let skuInfo: Record<string, any> = {};
      let binMap: Record<string, any[]> = {};
      let cwImageMap: Record<string, { attr_2: string | null; image_url: string }[]> = {};
      let firstImageMap: Record<string, string> = {};
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

        // product_skus can have gaps; inventory is the complete source
        const missingSkuIds = skuIds.filter((sid: string) => !skuInfo[sid]);
        if (missingSkuIds.length > 0) {
          const { data: invSkus } = await supabaseAdmin
            .from('inventory')
            .select('sku_id, product_id, attr_2, size, upc_display, bin_location')
            .in('sku_id', missingSkuIds);
          invSkus?.forEach((s: any) => {
            skuInfo[s.sku_id] = { sku_id: s.sku_id, product_id: s.product_id, attr_2: s.attr_2, size: s.size, upc: s.upc_display, bin_location: s.bin_location };
          });
        }

        // Product images for the thumbnails: colorway-attributed first, generic fallback
        const productIds: string[] = [...new Set(Object.values(skuInfo).map((s: any) => s.product_id).filter(Boolean))] as string[];
        if (productIds.length > 0) {
          const [{ data: cwImages }, { data: firstImages }] = await Promise.all([
            supabaseAdmin
              .from('product_colorway_images')
              .select('product_id, attr_2, image_url, sort_order')
              .in('product_id', productIds)
              .order('sort_order', { ascending: true }),
            supabaseAdmin
              .from('product_images')
              .select('product_id, image_url')
              .in('product_id', productIds)
              .eq('sort_order', 0),
          ]);
          cwImages?.forEach((i: any) => {
            if (!cwImageMap[i.product_id]) cwImageMap[i.product_id] = [];
            cwImageMap[i.product_id].push({ attr_2: i.attr_2, image_url: i.image_url });
          });
          firstImages?.forEach((i: any) => { firstImageMap[i.product_id] = i.image_url; });
        }
      }

      // Same loose colorway matching as the product view ("C1" vs "C1 C1")
      const norm = (s: any) => String(s || '').toLowerCase().trim().replace(/\s+/g, ' ');
      const colorMatches = (a: any, b: any) => {
        const na = norm(a); const nb = norm(b);
        if (!na || !nb) return false;
        return na === nb || na.startsWith(nb + ' ') || nb.startsWith(na + ' ') || na.split(' ').includes(nb);
      };
      const imageForItem = (item: any): string | null => {
        const sku = item.sku_id ? skuInfo[item.sku_id] : null;
        if (!sku?.product_id) return null;
        const color = item.attr_2 || item.color || sku.attr_2 || null;
        const cw = cwImageMap[sku.product_id] || [];
        if (color) {
          const match = cw.find((i: any) => colorMatches(i.attr_2, color));
          if (match) return match.image_url;
        }
        return firstImageMap[sku.product_id] || cw[0]?.image_url || null;
      };

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
          _image: imageForItem(item),
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
