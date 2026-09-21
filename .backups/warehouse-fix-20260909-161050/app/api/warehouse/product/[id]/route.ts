import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Everything the warehouse floor needs for one product, nothing it doesn't:
// no cost, no wholesale/retail pricing, no vendor terms.

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

    const [{ data: images }, { data: colorwayImages }, { data: skus }] = await Promise.all([
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
        .from('product_skus')
        .select('sku_id, attr_2, attr_3, size, upc, sku_concat, qty_inventory, qty_avail_sell, qty_picked, is_active, bin_location')
        .eq('product_id', productId)
        .order('attr_2', { ascending: true })
        .order('size', { ascending: true }),
    ]);

    // Per-warehouse quantities + bins for every SKU on this product
    const skuIds = (skus || []).map(s => s.sku_id);
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
      skus: skus || [],
      warehouse_locations: warehouseRows,
    });
  } catch (error: any) {
    console.error('Warehouse product error:', error);
    return NextResponse.json({ error: 'Failed to load product' }, { status: 500 });
  }
}
