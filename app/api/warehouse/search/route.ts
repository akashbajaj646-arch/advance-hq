import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Warehouse search. Priority order matters because AM style numbers and
// internal sku_ids share the same numeric space (style 24701 vs sku_id 24701):
//   1. Exact style number match -> that product wins, no SKU jumping
//   2. Exact UPC / sku_concat / sku_alt / sku_id -> barcode-scan jump to variant
//   3. Text search on style number / description / alt code

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const q = (searchParams.get('q') || '').trim();
  if (!q) return NextResponse.json({ products: [], direct_hit: null });

  try {
    // 1. Exact style number match takes absolute priority
    const { data: exactStyle } = await supabaseAdmin
      .from('products')
      .select('product_id, style_number, description, category')
      .ilike('style_number', q)
      .limit(1);

    let directHit: any = null;
    let exactProduct: any = (exactStyle && exactStyle[0]) || null;

    if (exactProduct) {
      // Auto-open the product; no SKU highlight
      directHit = { product_id: exactProduct.product_id, sku_id: null, attr_2: null, size: null };
    } else {
      // 2. Barcode / exact SKU identifiers (sku_id included only here,
      //    where we already know q is not a style number)
      const { data: skuHits } = await supabaseAdmin
        .from('product_skus')
        .select('sku_id, product_id, attr_2, size')
        .or(`upc.eq.${q},sku_concat.eq.${q},sku_alt.eq.${q},sku_id.eq.${q}`)
        .limit(1);

      if (skuHits && skuHits.length > 0) {
        directHit = skuHits[0];
      } else {
        const { data: invHits } = await supabaseAdmin
          .from('inventory')
          .select('sku_id, product_id, attr_2, size')
          .or(`upc_display.eq.${q},upc_11.eq.${q},sku_concat.eq.${q},sku_id.eq.${q}`)
          .limit(1);
        if (invHits && invHits.length > 0) directHit = invHits[0];
      }
    }

    // 3. Text search
    const esc = q.replace(/[%,()]/g, ' ').trim();
    const { data: products } = await supabaseAdmin
      .from('products')
      .select('product_id, style_number, description, category')
      .or(`style_number.ilike.%${esc}%,description.ilike.%${esc}%,alt_code.ilike.%${esc}%`)
      .order('style_number', { ascending: true })
      .limit(25);

    let results = products || [];

    // Exact style match always sits first
    if (exactProduct) {
      results = [exactProduct, ...results.filter(p => p.product_id !== exactProduct.product_id)];
    } else if (directHit && !results.some(p => p.product_id === directHit.product_id)) {
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
