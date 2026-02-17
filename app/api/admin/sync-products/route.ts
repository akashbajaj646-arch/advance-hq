import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

const APPARELMAGIC_API_TOKEN = process.env.APPARELMAGIC_TOKEN || '';
const BASE_URL = process.env.NEXT_PUBLIC_APPARELMAGIC_URL || 'https://advanceapparels.app.apparelmagic.com/api/json';

function getAuthParams() {
  const time = Math.floor(Date.now() / 1000).toString();
  return { time, token: APPARELMAGIC_API_TOKEN };
}

function toBool(val: any): boolean {
  return val === '1' || val === 1 || val === true;
}

function toNum(val: any, decimals: number = 2): number | null {
  if (val === null || val === undefined || val === '') return null;
  const n = parseFloat(val);
  return isNaN(n) ? null : n;
}

function toTimestamp(val: any): string | null {
  if (!val) return null;
  try {
    const d = new Date(val);
    return isNaN(d.getTime()) ? null : d.toISOString();
  } catch {
    return null;
  }
}

async function fetchAllProducts() {
  let allProducts: any[] = [];
  let lastId: string | null = null;
  let pageCount = 0;
  const maxPages = 10;

  console.log('Starting to fetch ALL products from ApparelMagic...');

  while (pageCount < maxPages) {
    const auth = getAuthParams();
    const params = new URLSearchParams({
      time: auth.time,
      token: auth.token
    });

    params.append('pagination[page_size]', '1000');
    if (lastId) {
      params.append('pagination[last_id]', lastId);
    }

    const url = `${BASE_URL}/products?${params.toString()}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: { 'User-Agent': 'AdvanceHQ/1.0' }
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();

    if (data.response && Array.isArray(data.response)) {
      allProducts = allProducts.concat(data.response);
      console.log(`  Page ${pageCount + 1}: Fetched ${data.response.length} products (Total so far: ${allProducts.length})`);
    }

    if (data.meta?.pagination?.last_id) {
      lastId = String(data.meta.pagination.last_id);
      pageCount++;
    } else {
      console.log(`Finished! No more pages. Total products: ${allProducts.length}`);
      break;
    }
  }

  if (pageCount >= maxPages) {
    console.log(`Stopped at ${maxPages} pages. Total products: ${allProducts.length}`);
  }

  return allProducts;
}

async function fetchProductSKUs(productId: string) {
  const auth = getAuthParams();
  const url = `${BASE_URL}/products/${productId}/skus?time=${auth.time}&token=${auth.token}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: { 'User-Agent': 'AdvanceHQ/1.0' }
  });

  if (!response.ok) {
    console.error(`Failed to fetch SKUs for product ${productId}`);
    return [];
  }

  const data = await response.json();
  return data.response || [];
}

async function fetchColorwayImages(productId: string): Promise<{ img: string }[]> {
  const auth = getAuthParams();
  const url = `${BASE_URL}/product_attributes?product_id=${productId}&time=${auth.time}&token=${auth.token}`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'User-Agent': 'AdvanceHQ/1.0' }
    });

    if (!response.ok) return [];

    const data = await response.json();
    const colorways = data.response || [];
    
    const allImages: { img: string }[] = [];
    
    for (const colorway of colorways) {
      if (colorway.images && Array.isArray(colorway.images)) {
        for (const image of colorway.images) {
          if (image.img) {
            allImages.push({ img: image.img });
          }
        }
      }
    }
    
    return allImages;
  } catch (error) {
    console.error(`Error fetching colorway images for product ${productId}:`, error);
    return [];
  }
}

async function syncChildTables(productId: string, product: any) {
  // Price Groups
  if (product.price_groups && Array.isArray(product.price_groups) && product.price_groups.length > 0) {
    await supabase.from('product_price_groups').delete().eq('product_id', productId);
    const rows = product.price_groups.map((pg: any) => ({
      product_id: productId,
      name: pg.name || 'Unknown',
      price: toNum(pg.price) || 0
    }));
    await supabase.from('product_price_groups').insert(rows);
  }

  // Specs
  if (product.specs && Array.isArray(product.specs) && product.specs.length > 0) {
    await supabase.from('product_specs').delete().eq('product_id', productId);
    const rows = product.specs.map((spec: any, i: number) => ({
      product_id: productId,
      am_spec_id: spec.id || null,
      name: spec.name || null,
      value: spec.value || null,
      sort_order: i
    }));
    await supabase.from('product_specs').insert(rows);
  }

  // Bill of Materials
  if (product.bill_of_materials && Array.isArray(product.bill_of_materials) && product.bill_of_materials.length > 0) {
    await supabase.from('product_bill_of_materials').delete().eq('product_id', productId);
    const rows = product.bill_of_materials.map((bom: any, i: number) => ({
      product_id: productId,
      am_bom_id: bom.id || null,
      component_product_id: bom.product_id || null,
      component_style_number: bom.style_number || null,
      component_description: bom.description || null,
      qty_required: toNum(bom.qty) || 0,
      unit_cost: toNum(bom.unit_cost) || 0,
      notes: bom.notes || null,
      sort_order: i
    }));
    await supabase.from('product_bill_of_materials').insert(rows);
  }

  // Prepacks
  if (product.prepacks && Array.isArray(product.prepacks) && product.prepacks.length > 0) {
    await supabase.from('product_prepacks').delete().eq('product_id', productId);
    const rows = product.prepacks.map((pp: any) => ({
      product_id: productId,
      am_prepack_id: pp.id || null,
      name: pp.name || null,
      data: pp
    }));
    await supabase.from('product_prepacks').insert(rows);
  }

  // Tags
  if (product.tags && Array.isArray(product.tags) && product.tags.length > 0) {
    await supabase.from('product_tags').delete().eq('product_id', productId);
    const rows = product.tags.map((tag: any) => ({
      product_id: productId,
      tag: typeof tag === 'string' ? tag : (tag.name || tag.tag || JSON.stringify(tag))
    }));
    await supabase.from('product_tags').insert(rows);
  }

  // Processes
  if (product.processes && Array.isArray(product.processes) && product.processes.length > 0) {
    await supabase.from('product_processes').delete().eq('product_id', productId);
    const rows = product.processes.map((proc: any, i: number) => ({
      product_id: productId,
      am_process_id: proc.id || null,
      name: proc.name || null,
      vendor_id: proc.vendor_id || null,
      vendor_name: proc.vendor_name || null,
      cost: toNum(proc.cost) || 0,
      notes: proc.notes || null,
      sort_order: i
    }));
    await supabase.from('product_processes').insert(rows);
  }

  // Royalties
  if (product.royalties && Array.isArray(product.royalties) && product.royalties.length > 0) {
    await supabase.from('product_royalties').delete().eq('product_id', productId);
    const rows = product.royalties.map((r: any) => ({
      product_id: productId,
      am_royalty_id: r.id || null,
      name: r.name || null,
      rate: toNum(r.rate) || 0,
      amount: toNum(r.amount) || 0
    }));
    await supabase.from('product_royalties').insert(rows);
  }

  // Emblem Placements
  if (product.emblem_placements && Array.isArray(product.emblem_placements) && product.emblem_placements.length > 0) {
    await supabase.from('product_emblem_placements').delete().eq('product_id', productId);
    const rows = product.emblem_placements.map((ep: any) => ({
      product_id: productId,
      am_placement_id: ep.id || null,
      data: ep
    }));
    await supabase.from('product_emblem_placements').insert(rows);
  }

  // Buyer Filters
  if (product.buyer_filters && Array.isArray(product.buyer_filters) && product.buyer_filters.length > 0) {
    await supabase.from('product_buyer_filters').delete().eq('product_id', productId);
    const rows = product.buyer_filters.map((bf: any) => ({
      product_id: productId,
      filter_value: typeof bf === 'string' ? bf : (bf.name || bf.value || JSON.stringify(bf))
    }));
    await supabase.from('product_buyer_filters').insert(rows);
  }
}

export async function POST(request: Request) {
  try {
    console.log('🔄 Starting FULL product sync...');

    const startTime = Date.now();

    const { data: syncLog } = await supabase
      .from('sync_log')
      .insert({
        sync_type: 'products',
        source: 'apparel_magic',
        status: 'started'
      })
      .select()
      .single();

    console.log('📥 Fetching products from ApparelMagic...');
    const products = await fetchAllProducts();
    console.log(`✅ Fetched ${products.length} products`);

    let syncedProducts = 0;
    let syncedImages = 0;
    let syncedSKUs = 0;
    let syncedChildRecords = 0;
    let errors = 0;

    for (let i = 0; i < products.length; i++) {
      const product = products[i];

      try {
        // ── Full product upsert with ALL fields ──
        const productData: Record<string, any> = {
          product_id: product.product_id,
          style_number: product.style_number,
          description: product.description || null,
          category: product.category || null,
          price: toNum(product.price) || 0,
          content: product.content || null,
          origin: product.origin || null,

          // Type flags
          is_product: toBool(product.is_product),
          is_component: toBool(product.is_component),
          is_bundle: toBool(product.is_bundle),
          is_virtual_bundle: toBool(product.is_virtual_bundle),
          is_gift_card: toBool(product.is_gift_card),
          is_emblem: toBool(product.is_emblem),
          is_inventory_tracked: toBool(product.is_inventory_tracked),

          // Identification
          alt_code: product.alt_code || null,
          group: product.group || null,
          class: product.class || null,
          collection: product.collection || null,
          season: product.season || null,
          size_range_id: product.size_range_id || null,
          seasonality_profile_id: product.seasonality_profile_id || null,
          division_id: product.division_id || null,

          // Costing
          cost: toNum(product.cost),
          cost_base: toNum(product.cost_base),
          cost_labor: toNum(product.cost_labor),
          cost_materials: toNum(product.cost_materials),
          cost_misc: toNum(product.cost_misc),
          cost_landed: toNum(product.cost_landed),
          cost_freight: toNum(product.cost_freight),
          cost_duty: toNum(product.cost_duty),
          cost_auto: product.cost_auto || '0',
          duty_rate: toNum(product.duty_rate),
          vendor_cost_base: toNum(product.vendor_cost_base),
          vendor_currency_id: product.vendor_currency_id || null,

          // Pricing
          retail_price: toNum(product.retail_price),
          margin: toNum(product.margin),
          pct_markup: toNum(product.pct_markup),

          // Physical
          weight: toNum(product.weight),
          weight_unit: product.weight_unit || null,
          box_size: product.box_size || null,

          // Compliance
          tariff_code: product.tariff_code || null,
          mid_code: product.mid_code || null,
          care_instructions: product.care_instructions || null,
          unit_of_measure: product.unit_of_measure || null,
          lead_time: product.lead_time || null,
          sample_size: product.sample_size || null,
          is_taxable: toBool(product.is_taxable),
          is_returnable: toBool(product.is_returnable),
          is_note_required: toBool(product.is_note_required),

          // Notes
          notes: product.notes || null,
          production_notes: product.production_notes || null,

          // Vendor
          vendor_id: product.vendor_id || null,
          vendor_name: product.vendor_name || null,

          // Price break
          price_break_id: product.price_break_id || null,
          price_break_name: product.price_break_name || null,

          // Web / B2B
          web_title: product.web_title || null,
          web_description: product.web_description || null,
          b2b_web_title: product.b2b_web_title || null,
          b2b_web_description: product.b2b_web_description || null,

          // Royalties
          pct_royalty: toNum(product.pct_royalty),
          amount_royalty: toNum(product.amount_royalty),
          licensor: product.licensor || null,

          // Integration fields
          shopify_product_id: product.shopify_product_id || null,
          shopify_sync: product.shopify_sync || '0',
          joor_product_id: product.joor_product_id || null,
          joor_sync: product.joor_sync || '0',
          joor_web_title: product.joor_web_title || null,
          joor_web_description: product.joor_web_description || null,
          joor_sync_colorway_swatches: product.joor_sync_colorway_swatches || '0',
          square_sync: product.square_sync || '0',
          square_web_title: product.square_web_title || null,
          square_web_description: product.square_web_description || null,
          balluun_sync: product.balluun_sync || '0',
          balluun_ext_id: product.balluun_ext_id || null,
          magento_config_product_id: product.magento_config_product_id || null,
          magento_category_id: product.magento_category_id || null,
          magento_attribute_set_id: product.magento_attribute_set_id || null,
          magento_last_price: product.magento_last_price || null,
          magento_sync: product.magento_sync || '0',
          magento_sync_timestamp: product.magento_sync_timestamp || null,

          // SKU status
          skus_active: product.skus_active || '1',

          // Audit trail
          am_creation_time: toTimestamp(product.creation_time),
          am_creation_user_id: product.creation_user_id || null,
          am_creation_user_name: product.creation_user_name || null,
          am_last_modified_time: toTimestamp(product.last_modified_time),
          am_last_modified_command: product.last_modified_command || null,
          am_last_modified_user_id: product.last_modified_user_id || null,
          am_last_modified_user_name: product.last_modified_user_name || null,

          // Tech pack
          tech_pack_layout_id: product.tech_pack_layout_id || null,

          // Packaging
          prepack_type: product.prepack_type || null,
          boxes_in_pogi: product.boxes_in_pogi || null,
          pattern_or_silhouette: product.pattern_or_silhouette || null,

          // Buyer filter (single value field)
          buyer_filter: product.buyer_filter || null,

          // Size range info (JSON)
          size_range_info: product.size_range_info || null,

          // Attribute options
          attribute_options: product.attribute_options || null,

          last_synced_at: new Date().toISOString()
        };

        const { error: productError } = await supabase
          .from('products')
          .upsert(productData);

        if (productError) {
          console.error(`Error syncing product ${product.product_id}:`, productError);
          errors++;
          continue;
        }

        syncedProducts++;

        // ── Sync child tables ──
        try {
          await syncChildTables(product.product_id, product);
          // Count non-empty arrays
          const childArrays = ['price_groups', 'specs', 'bill_of_materials', 'prepacks', 'tags', 'processes', 'royalties', 'emblem_placements', 'buyer_filters'];
          for (const key of childArrays) {
            if (product[key] && Array.isArray(product[key]) && product[key].length > 0) {
              syncedChildRecords += product[key].length;
            }
          }
        } catch (childErr) {
          console.error(`Error syncing child tables for ${product.product_id}:`, childErr);
        }

        // ── Images (same logic as before) ──
        await supabase.from('product_images').delete().eq('product_id', product.product_id);

        const allImages: { img: string }[] = [];
        
        if (product.images && product.images.length > 0) {
          for (const img of product.images) {
            if (img.img) {
              allImages.push({ img: img.img });
            }
          }
        }
        
        const colorwayImages = await fetchColorwayImages(product.product_id);
        for (const img of colorwayImages) {
          if (!allImages.some(existing => existing.img === img.img)) {
            allImages.push(img);
          }
        }

        if (allImages.length > 0) {
          const imagesToInsert = allImages
            .slice(0, 25)
            .map((img, index) => ({
              product_id: product.product_id,
              image_url: img.img,
              sort_order: index
            }));

          const { error: imagesError } = await supabase
            .from('product_images')
            .insert(imagesToInsert);

          if (!imagesError) {
            syncedImages += imagesToInsert.length;
          }
        }

        // ── SKUs ──
        const skus = await fetchProductSKUs(product.product_id);

        if (skus.length > 0) {
          await supabase.from('product_skus').delete().eq('product_id', product.product_id);

          const skusToInsert = skus.map((sku: any) => ({
            sku_id: sku.sku_id,
            product_id: product.product_id,
            style_number: product.style_number,
            attr_2: sku.attr_2 || null,
            attr_3: sku.attr_3 || null,
            size: sku.size || null,
            price: toNum(sku.price) || 0,
            cost: toNum(sku.cost) || 0,
            cost_base: toNum(sku.cost_base),
            cost_mfg: toNum(sku.cost_mfg),
            price_offset: toNum(sku.price_offset),
            cost_offset: toNum(sku.cost_offset),
            weight: toNum(sku.weight),
            weight_offset: toNum(sku.weight_offset),
            qty_avail_sell: parseInt(sku.qty_avail_sell) || 0,
            qty_inventory: toNum(sku.qty_inventory),
            qty_alloc: toNum(sku.qty_alloc),
            qty_avail_alloc: toNum(sku.qty_avail_alloc),
            qty_open_po: toNum(sku.qty_open_po),
            qty_open_sales: toNum(sku.qty_open_sales),
            qty_picked: toNum(sku.qty_picked),
            qty_invoiced: toNum(sku.qty_invoiced),
            qty_authorized_to_return: toNum(sku.qty_authorized_to_return),
            qty_credited: toNum(sku.qty_credited),
            qty_received: toNum(sku.qty_received),
            qty_issued: toNum(sku.qty_issued),
            qty_returned: toNum(sku.qty_returned),
            qty_required_comp: toNum(sku.qty_required_comp),
            qty_min_reorder: toNum(sku.qty_min_reorder),
            qty_min_inventory: toNum(sku.qty_min_inventory),
            qty_open_wip: toNum(sku.qty_open_wip),
            qty_open_po_no_proj: toNum(sku.qty_open_po_no_proj),
            qty_otr: toNum(sku.qty_otr),
            sku_alt: sku.sku_alt || null,
            upc: sku.upc_display || null,
            upc_11: sku.upc_11 || null,
            nrf_size: sku.nrf_size || null,
            attr_2_name: sku.attr_2_name || null,
            attr_3_name: sku.attr_3_name || null,
            web_title: sku.web_title || null,
            location: sku.location || null,
            is_active: toBool(sku.active),
            last_synced_at: new Date().toISOString()
          }));

          const { error: skusError } = await supabase
            .from('product_skus')
            .insert(skusToInsert);

          if (!skusError) {
            syncedSKUs += skusToInsert.length;
          } else {
            console.error(`Error inserting SKUs for ${product.product_id}:`, skusError);
          }
        }

        // ── Progress logging ──
        if ((i + 1) % 50 === 0) {
          const progress = Math.round(((i + 1) / products.length) * 100);
          console.log(`Progress: ${i + 1}/${products.length} (${progress}%) - Products: ${syncedProducts}, Images: ${syncedImages}, SKUs: ${syncedSKUs}, Child records: ${syncedChildRecords}`);
        }

      } catch (error) {
        console.error(`Error processing product ${product.product_id}:`, error);
        errors++;
      }
    }

    const duration = Math.round((Date.now() - startTime) / 1000);

    if (syncLog) {
      await supabase
        .from('sync_log')
        .update({
          status: 'completed',
          records_processed: products.length,
          records_created: syncedProducts,
          records_updated: 0,
          errors: errors,
          completed_at: new Date().toISOString(),
          duration_seconds: duration
        })
        .eq('id', syncLog.id);
    }

    console.log('✅ FULL product sync complete!');
    console.log(`Products: ${syncedProducts}`);
    console.log(`Images: ${syncedImages}`);
    console.log(`SKUs: ${syncedSKUs}`);
    console.log(`Child records: ${syncedChildRecords}`);
    console.log(`Errors: ${errors}`);
    console.log(`Duration: ${duration}s`);

    return NextResponse.json({
      success: true,
      stats: {
        products: syncedProducts,
        images: syncedImages,
        skus: syncedSKUs,
        child_records: syncedChildRecords,
        errors: errors,
        duration: `${duration}s`
      }
    });

  } catch (error) {
    console.error('Sync error:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}
