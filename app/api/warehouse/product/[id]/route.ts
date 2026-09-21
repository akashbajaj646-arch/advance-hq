import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Warehouse product detail. SKUs come from the inventory table (the complete,
// nightly-synced source — product_skus has gaps for products whose per-SKU
// fetch failed during the full product sync), with product_skus as fallback.
// No cost or pricing data is ever returned.

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  const productId = params.id;

  try {
    const { data: product } = await supabaseAdmin
      .from('products')
      .select('product_id, style_number, description, category, season, collection')
      .eq('product_id', productId)
      .maybeSingle();

    if (!product) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }

    const [{ data: images }, { data: colorwayImages }, { data: invSkus }] = await Promise.all([
      supabaseAdmin
        .from('product_images')
        .select('image_url, sort_order')
        .eq('product_id', productId)
        .order('sort_order', { ascending: true }),
      supabaseAdmin
        .from('product_colorway_images')
        .select('attr_2, image_url, sort_order')
        .eq('product_id', productId)
        .order('sort_order', { ascending: true }),
      supabaseAdmin
        .from('inventory')
        .select('sku_id, attr_2, size, size_position, upc_display, sku_concat, qty_inventory, qty_avail_sell, qty_picked, active, bin_location')
        .eq('product_id', productId)
        .order('attr_2', { ascending: true })
        .order('size_position', { ascending: true }),
    ]);

    // Normalize to one SKU shape regardless of source table
    let skus: any[] = (invSkus || []).map(s => ({
      sku_id: s.sku_id,
      attr_2: s.attr_2,
      size: s.size,
      upc: s.upc_display,
      sku_concat: s.sku_concat,
      qty_inventory: s.qty_inventory ?? 0,
      qty_avail_sell: s.qty_avail_sell ?? 0,
      qty_picked: s.qty_picked ?? 0,
      is_active: s.active,
      bin_location: s.bin_location,
    }));

    if (skus.length === 0) {
      const { data: psSkus } = await supabaseAdmin
        .from('product_skus')
        .select('sku_id, attr_2, size, upc, sku_concat, qty_inventory, qty_avail_sell, qty_picked, is_active, bin_location')
        .eq('product_id', productId)
        .order('attr_2', { ascending: true })
        .order('size', { ascending: true });
      skus = (psSkus || []).map(s => ({
        sku_id: s.sku_id,
        attr_2: s.attr_2,
        size: s.size,
        upc: s.upc,
        sku_concat: s.sku_concat,
        qty_inventory: s.qty_inventory ?? 0,
        qty_avail_sell: s.qty_avail_sell ?? 0,
        qty_picked: s.qty_picked ?? 0,
        is_active: s.is_active,
        bin_location: s.bin_location,
      }));
    }

    // Per-warehouse quantities + bins
    const skuIds = skus.map(s => s.sku_id);
    let warehouseRows: any[] = [];
    if (skuIds.length > 0) {
      const { data } = await supabaseAdmin
        .from('sku_warehouse_locations')
        .select('sku_id, warehouse_id, warehouse_name, bin_location, qty')
        .in('sku_id', skuIds)
        .order('warehouse_id', { ascending: true });
      warehouseRows = data || [];
    }

    return NextResponse.json({
      product,
      images: images || [],
      colorway_images: colorwayImages || [],
      skus,
      warehouse_locations: warehouseRows,
    });
  } catch (error: any) {
    console.error('Warehouse product error:', error);
    return NextResponse.json({ error: 'Failed to load product' }, { status: 500 });
  }
}
