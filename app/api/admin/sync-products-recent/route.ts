/**
 * POST /api/admin/sync-products-recent
 *
 * Frequent products sync. High-water-mark on product_id + last_id walk +
 * skip-if-unchanged via AM last_modified_time. For each NEW/changed product it
 * upserts the core product row, then refreshes product_skus and product_images.
 *
 * Scope note: this lightweight route intentionally does NOT re-sync the heavy,
 * rarely-changing child tables (price_groups, specs, bill_of_materials,
 * prepacks, tags, processes, royalties, emblem_placements, buyer_filters).
 * Those remain handled by the full nightly /api/admin/sync-products, which is
 * the backstop. SKUs (inventory/qty) and images ARE refreshed here because
 * they change often and matter for catalog/inventory views.
 *
 * skip-if-unchanged matters here: each changed product triggers two extra AM
 * calls (SKUs + colorway images), so we avoid re-fetching unchanged products.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  '';
const supabase = createClient(supabaseUrl, supabaseKey);

const APPARELMAGIC_API_TOKEN = process.env.APPARELMAGIC_TOKEN || '';
const BASE_URL =
  process.env.NEXT_PUBLIC_APPARELMAGIC_URL ||
  'https://advanceapparels.app.apparelmagic.com/api/json';

const PAGE_SIZE = 200;
const MAX_PAGES = 2;
const MAX_DURATION_MS = 50_000;

function getAuthParams() {
  return { time: Math.floor(Date.now() / 1000).toString(), token: APPARELMAGIC_API_TOKEN };
}
function toNum(val: any): number | null {
  if (val === null || val === undefined || val === '') return null;
  const n = parseFloat(val);
  return isNaN(n) ? null : n;
}
function toBool(val: any): boolean {
  return val === '1' || val === 1 || val === true;
}
function toTimestamp(val: any): string | null {
  if (!val) return null;
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

async function fetchProductsAfter(
  lastId: number | null
): Promise<{ rows: any[]; nextLastId: number | null }> {
  const auth = getAuthParams();
  const params = new URLSearchParams({
    time: auth.time,
    token: auth.token,
    'pagination[page_size]': String(PAGE_SIZE),
  });
  if (lastId !== null) params.append('pagination[last_id]', String(lastId));

  const res = await fetch(BASE_URL + '/products?' + params.toString(), {
    method: 'GET',
    headers: { 'User-Agent': 'AdvanceHQ/1.0' },
  });
  if (!res.ok) throw new Error('AM HTTP ' + res.status);
  const data = await res.json();
  if (data?.meta?.errors && data.meta.errors.length > 0) {
    throw new Error('AM error: ' + JSON.stringify(data.meta.errors));
  }
  const rows = Array.isArray(data?.response) ? data.response : [];
  const raw = data?.meta?.pagination?.last_id;
  const next = raw !== undefined ? parseInt(String(raw), 10) : NaN;
  return { rows, nextLastId: isNaN(next) ? null : next };
}

async function fetchProductSKUs(productId: string): Promise<any[]> {
  const auth = getAuthParams();
  const url = BASE_URL + '/products/' + productId + '/skus?time=' + auth.time + '&token=' + auth.token;
  const res = await fetch(url, { method: 'GET', headers: { 'User-Agent': 'AdvanceHQ/1.0' } });
  if (!res.ok) return [];
  const data = await res.json();
  return data.response || [];
}

async function fetchColorwayImages(productId: string): Promise<{ img: string }[]> {
  const auth = getAuthParams();
  const url = BASE_URL + '/product_attributes?product_id=' + productId + '&time=' + auth.time + '&token=' + auth.token;
  try {
    const res = await fetch(url, { method: 'GET', headers: { 'User-Agent': 'AdvanceHQ/1.0' } });
    if (!res.ok) return [];
    const data = await res.json();
    const colorways = data.response || [];
    const out: { img: string }[] = [];
    for (const cw of colorways) {
      if (Array.isArray(cw.images)) {
        for (const image of cw.images) {
          if (image.img) out.push({ img: image.img });
        }
      }
    }
    return out;
  } catch {
    return [];
  }
}

function buildProductRow(product: any): Record<string, any> {
  return {
    product_id: product.product_id,
    style_number: product.style_number,
    description: product.description || null,
    category: product.category || null,
    price: toNum(product.price) || 0,
    content: product.content || null,
    origin: product.origin || null,
    is_product: toBool(product.is_product),
    is_component: toBool(product.is_component),
    is_bundle: toBool(product.is_bundle),
    is_virtual_bundle: toBool(product.is_virtual_bundle),
    is_gift_card: toBool(product.is_gift_card),
    is_emblem: toBool(product.is_emblem),
    is_inventory_tracked: toBool(product.is_inventory_tracked),
    alt_code: product.alt_code || null,
    group: product.group || null,
    class: product.class || null,
    collection: product.collection || null,
    season: product.season || null,
    size_range_id: product.size_range_id || null,
    seasonality_profile_id: product.seasonality_profile_id || null,
    division_id: product.division_id || null,
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
    retail_price: toNum(product.retail_price),
    margin: toNum(product.margin),
    pct_markup: toNum(product.pct_markup),
    weight: toNum(product.weight),
    weight_unit: product.weight_unit || null,
    box_size: product.box_size || null,
    tariff_code: product.tariff_code || null,
    mid_code: product.mid_code || null,
    care_instructions: product.care_instructions || null,
    unit_of_measure: product.unit_of_measure || null,
    lead_time: product.lead_time || null,
    sample_size: product.sample_size || null,
    is_taxable: toBool(product.is_taxable),
    is_returnable: toBool(product.is_returnable),
    is_note_required: toBool(product.is_note_required),
    notes: product.notes || null,
    production_notes: product.production_notes || null,
    vendor_id: product.vendor_id || null,
    vendor_name: product.vendor_name || null,
    price_break_id: product.price_break_id || null,
    price_break_name: product.price_break_name || null,
    web_title: product.web_title || null,
    web_description: product.web_description || null,
    b2b_web_title: product.b2b_web_title || null,
    b2b_web_description: product.b2b_web_description || null,
    pct_royalty: toNum(product.pct_royalty),
    amount_royalty: toNum(product.amount_royalty),
    licensor: product.licensor || null,
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
    skus_active: product.skus_active || '1',
    am_creation_time: toTimestamp(product.creation_time),
    am_creation_user_id: product.creation_user_id || null,
    am_creation_user_name: product.creation_user_name || null,
    am_last_modified_time: toTimestamp(product.last_modified_time),
    am_last_modified_command: product.last_modified_command || null,
    am_last_modified_user_id: product.last_modified_user_id || null,
    am_last_modified_user_name: product.last_modified_user_name || null,
    tech_pack_layout_id: product.tech_pack_layout_id || null,
    prepack_type: product.prepack_type || null,
    boxes_in_pogi: product.boxes_in_pogi || null,
    pattern_or_silhouette: product.pattern_or_silhouette || null,
    buyer_filter: product.buyer_filter || null,
    size_range_info: product.size_range_info || null,
    attribute_options: product.attribute_options || null,
    last_synced_at: new Date().toISOString(),
  };
}

function buildSkuRow(sku: any, product: any): Record<string, any> {
  return {
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
    last_synced_at: new Date().toISOString(),
  };
}

export async function POST(_request: Request) {
  const startTime = Date.now();

  const logInsert = await supabase
    .from('sync_log')
    .insert({ sync_type: 'products_recent', source: 'apparel_magic', status: 'started' })
    .select()
    .single();
  const syncLogId = logInsert.data ? logInsert.data.id : null;

  try {
    const maxIdRes = await supabase
      .from('products')
      .select('product_id')
      .order('product_id', { ascending: false })
      .limit(1)
      .maybeSingle();
    const maxIdInDb = maxIdRes.data ? parseInt(String(maxIdRes.data.product_id), 10) : 0;
    const startCursor = maxIdInDb > 0 ? maxIdInDb - 1 : null;

    let scanned = 0, created = 0, updated = 0, skipped = 0, errors = 0;
    let skus = 0, images = 0, pagesFetched = 0;
    let cursor: number | null = startCursor;
    let bailReason = '';
    let firstError: string | null = null;

    while (pagesFetched < MAX_PAGES) {
      if (Date.now() - startTime > MAX_DURATION_MS) { bailReason = 'time-budget'; break; }
      const { rows, nextLastId } = await fetchProductsAfter(cursor);
      pagesFetched++;
      if (rows.length === 0) { bailReason = 'empty-page'; break; }

      const ids = rows.map((p: any) => p.product_id).filter(Boolean);
      const existingRes = await supabase
        .from('products')
        .select('product_id, am_last_modified_time')
        .in('product_id', ids);
      const existingMap: Record<string, { exists: boolean; mod: string | null }> = {};
      (existingRes.data || []).forEach((r: any) => {
        existingMap[String(r.product_id)] = { exists: true, mod: r.am_last_modified_time };
      });

      for (const product of rows) {
        scanned++;
        try {
          const key = String(product.product_id);
          const existing = existingMap[key];
          const incomingMod = toTimestamp(product.last_modified_time);
          const existingMod = existing ? existing.mod : undefined;
          const sameMod =
            existing &&
            ((existingMod === null && incomingMod === null) ||
              (existingMod != null && incomingMod != null && Date.parse(existingMod) === Date.parse(incomingMod)));
          if (sameMod) { skipped++; continue; }

          const row = buildProductRow(product);
          const { error: upErr } = await supabase.from('products').upsert(row);
          if (upErr) { errors++; if (!firstError) firstError = 'upsert product ' + key + ': ' + upErr.message; continue; }
          if (existing) updated++; else created++;

          // Images: inline + colorway, refreshed
          await supabase.from('product_images').delete().eq('product_id', product.product_id);
          const allImages: { img: string }[] = [];
          if (Array.isArray(product.images)) {
            for (const img of product.images) if (img.img) allImages.push({ img: img.img });
          }
          const colorway = await fetchColorwayImages(product.product_id);
          for (const img of colorway) {
            if (!allImages.some((e) => e.img === img.img)) allImages.push(img);
          }
          if (allImages.length > 0) {
            const imageRows = allImages.slice(0, 25).map((img, index) => ({
              product_id: product.product_id, image_url: img.img, sort_order: index,
            }));
            const { error: imgErr } = await supabase.from('product_images').insert(imageRows);
            if (imgErr && !firstError) firstError = 'images for product ' + key + ': ' + imgErr.message;
            else images += imageRows.length;
          }

          // SKUs, refreshed
          const skuList = await fetchProductSKUs(product.product_id);
          if (skuList.length > 0) {
            await supabase.from('product_skus').delete().eq('product_id', product.product_id);
            const skuRows = skuList.map((s: any) => buildSkuRow(s, product));
            const { error: skuErr } = await supabase.from('product_skus').insert(skuRows);
            if (skuErr && !firstError) firstError = 'skus for product ' + key + ': ' + skuErr.message;
            else skus += skuRows.length;
          }
        } catch (err) {
          errors++;
          if (!firstError) firstError = 'product ' + product.product_id + ': ' + (err instanceof Error ? err.message : String(err));
        }
      }

      if (nextLastId === null || nextLastId === cursor) { bailReason = 'no-cursor-progress'; break; }
      cursor = nextLastId;
    }
    if (!bailReason) bailReason = 'max-pages';

    const duration = Math.round((Date.now() - startTime) / 1000);
    if (syncLogId) {
      await supabase.from('sync_log').update({
        status: 'completed', records_processed: scanned, records_created: created,
        records_updated: updated, errors, completed_at: new Date().toISOString(),
        duration_seconds: duration,
      }).eq('id', syncLogId);
    }
    return NextResponse.json({
      success: true,
      stats: { scanned, created, updated, skipped, skus, images, errors,
        duration_seconds: duration, pages_fetched: pagesFetched,
        start_cursor: startCursor, end_cursor: cursor, bail_reason: bailReason, first_error: firstError },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    if (syncLogId) {
      await supabase.from('sync_log').update({
        status: 'failed', error_details: { message: msg }, completed_at: new Date().toISOString(),
      }).eq('id', syncLogId);
    }
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
