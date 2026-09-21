import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Warehouse search: no pricing/cost data ever leaves this route.
// Handles two flows:
//  1. Scanner flow: exact UPC / SKU / sku_concat match -> direct hit with product_id + sku_id
//  2. Typed flow: style number / description search -> product list with thumbnails

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const q = (searchParams.get('q') || '').trim();
  if (!q) return NextResponse.json({ products: [], direct_hit: null });

  try {
    // 1. Exact identifier match (barcode scan or exact SKU entry)
    let directHit: any = null;
    const { data: skuHits } = await supabaseAdmin
      .from('product_skus')
      .select('sku_id, product_id, attr_2, size')
      .or(`sku_id.eq.${q},upc.eq.${q},sku_concat.eq.${q},sku_alt.eq.${q}`)
      .limit(1);

    if (skuHits && skuHits.length > 0) {
      directHit = skuHits[0];
    } else {
      // UPC sometimes lives only on the inventory record (upc_display / upc_11)
      const { data: invHits } = await supabaseAdmin
        .from('inventory')
        .select('sku_id, product_id, attr_2, size')
        .or(`upc_display.eq.${q},upc_11.eq.${q},sku_id.eq.${q},sku_concat.eq.${q}`)
        .limit(1);
      if (invHits && invHits.length > 0) directHit = invHits[0];
    }

    // 2. Product search
    const esc = q.replace(/[%,()]/g, ' ').trim();
    const { data: products } = await supabaseAdmin
      .from('products')
      .select('product_id, style_number, description, category')
      .or(`style_number.ilike.%${esc}%,description.ilike.%${esc}%,alt_code.ilike.%${esc}%`)
      .order('style_number', { ascending: true })
      .limit(25);

    let results = products || [];

    // Make sure a direct hit's product is in the list even if text search missed it
    if (directHit && !results.some(p => p.product_id === directHit.product_id)) {
      const { data: hitProduct } = await supabaseAdmin
        .from('products')
        .select('product_id, style_number, description, category')
        .eq('product_id', directHit.product_id)
        .maybeSingle();
      if (hitProduct) results = [hitProduct, ...results];
    }

    // Thumbnails
    const ids = results.map(p => p.product_id);
    const imageMap: Record<string, string> = {};
    if (ids.length > 0) {
      const { data: images } = await supabaseAdmin
        .from('product_images')
        .select('product_id, image_url')
        .in('product_id', ids)
        .eq('sort_order', 0);
      images?.forEach(i => { imageMap[i.product_id] = i.image_url; });
    }

    return NextResponse.json({
      direct_hit: directHit,
      products: results.map(p => ({ ...p, image_url: imageMap[p.product_id] || null })),
    });
  } catch (error: any) {
    console.error('Warehouse search error:', error);
    return NextResponse.json({ error: 'Search failed' }, { status: 500 });
  }
}
