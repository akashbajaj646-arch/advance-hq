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

function toNum(val: any): number | null {
  if (val === null || val === undefined || val === '') return null;
  const n = parseFloat(val);
  return isNaN(n) ? null : n;
}

function toBool(val: any): boolean {
  return val === '1' || val === 1 || val === true;
}

async function fetchAllInventory() {
  let all: any[] = [];
  let lastId: string | null = null;
  let pageCount = 0;
  const maxPages = 100;

  console.log('Fetching all inventory from ApparelMagic...');

  while (pageCount < maxPages) {
    const auth = getAuthParams();
    const params = new URLSearchParams({
      time: auth.time,
      token: auth.token,
      'pagination[page_size]': '1000'
    });

    if (lastId) {
      params.append('pagination[last_id]', lastId);
    }

    const url = `${BASE_URL}/inventory?${params.toString()}`;
    const response = await fetch(url, { method: 'GET', headers: { 'User-Agent': 'AdvanceHQ/1.0' } });

    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

    const data = await response.json();

    if (data.response && Array.isArray(data.response)) {
      all = all.concat(data.response);
      console.log(`  Page ${pageCount + 1}: ${data.response.length} inventory records (Total: ${all.length})`);
    }

    if (data.meta?.pagination?.last_id) {
      lastId = String(data.meta.pagination.last_id);
      pageCount++;
    } else {
      break;
    }
  }

  return all;
}

export async function POST(request: Request) {
  const startTime = Date.now();

  const { data: syncLog } = await supabase
    .from('sync_log')
    .insert({ sync_type: 'inventory', source: 'apparel_magic', status: 'started' })
    .select().single();

  try {
    console.log('🔄 Starting FULL inventory sync...');

    const inventory = await fetchAllInventory();
    console.log(`✅ Fetched ${inventory.length} inventory records`);

    let created = 0, updated = 0, errors = 0;

    // Process in batches of 50 for upsert efficiency
    const batchSize = 50;

    for (let i = 0; i < inventory.length; i += batchSize) {
      const batch = inventory.slice(i, i + batchSize);

      const rows = batch.map((inv: any) => ({
        sku_id: inv.sku_id,
        product_id: inv.product_id,
        style_number: inv.style_number || null,
        description: inv.description || null,
        attr_2: inv.attr_2 || null,
        attr_3: inv.attr_3 || null,
        size: inv.size || null,
        size_position: inv.size_position || null,
        sku_concat: inv.sku_concat || null,
        attr_2_name: inv.attr_2_name || null,
        attr_3_name: inv.attr_3_name || null,
        attr_2_nrf_id: inv.attr_2_nrf_id || null,
        product_attribute_id: inv.product_attribute_id || null,

        // Quantities
        qty_inventory: toNum(inv.qty_inventory) || 0,
        qty_avail_sell: toNum(inv.qty_avail_sell) || 0,
        qty_alloc: toNum(inv.qty_alloc) || 0,
        qty_avail_alloc: toNum(inv.qty_avail_alloc) || 0,
        qty_open_wip: toNum(inv.qty_open_wip) || 0,
        qty_open_po: toNum(inv.qty_open_po) || 0,
        qty_open_po_no_proj: toNum(inv.qty_open_po_no_proj) || 0,
        qty_otr: toNum(inv.qty_otr) || 0,
        qty_in_transit: toNum(inv.qty_in_transit) || 0,
        qty_open_sales: toNum(inv.qty_open_sales) || 0,
        qty_picked: toNum(inv.qty_picked) || 0,
        qty_invoiced: toNum(inv.qty_invoiced) || 0,
        qty_authorized_to_return: toNum(inv.qty_authorized_to_return) || 0,
        qty_credited: toNum(inv.qty_credited) || 0,
        qty_received: toNum(inv.qty_received) || 0,
        qty_issued: toNum(inv.qty_issued) || 0,
        qty_returned: toNum(inv.qty_returned) || 0,
        qty_required_comp: toNum(inv.qty_required_comp) || 0,
        qty_required_bundles: toNum(inv.qty_required_bundles) || 0,
        qty_min_reorder: toNum(inv.qty_min_reorder) || 0,
        qty_min_inventory: toNum(inv.qty_min_inventory) || 0,
        qty_per_inner_pack: toNum(inv.qty_per_inner_pack),

        // Pricing
        price: toNum(inv.price) || 0,
        retail_price: toNum(inv.retail_price) || 0,
        cost: toNum(inv.cost) || 0,
        cost_base: toNum(inv.cost_base) || 0,
        cost_mfg: toNum(inv.cost_mfg) || 0,
        cost_historical_wa: toNum(inv.cost_historical_wa) || 0,
        cost_historical_wa_old: toNum(inv.cost_historical_wa_old) || 0,
        vendor_cost_base: toNum(inv.vendor_cost_base) || 0,
        price_offset: toNum(inv.price_offset) || 0,
        retail_price_offset: toNum(inv.retail_price_offset) || 0,
        cost_offset: toNum(inv.cost_offset) || 0,
        vendor_cost_offset: toNum(inv.vendor_cost_offset) || 0,

        // Identifiers
        upc_display: inv.upc_display || null,
        upc_11: inv.upc_11 || null,
        sku_alt: inv.sku_alt || null,
        sku: inv.sku || null,
        nrf_size: inv.nrf_size || null,
        analysis_code: inv.analysis_code || null,
        location: inv.location || null,
        web_title: inv.web_title || null,
        weight: toNum(inv.weight) || 0,
        weight_offset: toNum(inv.weight_offset) || 0,

        // Flags
        active: toBool(inv.active),
        is_inventory_tracked: toBool(inv.is_inventory_tracked),
        is_product: toBool(inv.is_product),
        is_component: toBool(inv.is_component),
        is_bundle: toBool(inv.is_bundle),
        joor_sync: inv.joor_sync || '0',

        // Shopify
        shopify_compare_at_price_wholesale: inv.shopify_compare_at_price_wholesale || null,
        shopify_retail_compare_at_price: inv.shopify_retail_compare_at_price || null,

        // Audit
        am_creation_time: inv.creation_time || null,
        am_creation_user_id: inv.creation_user_id || null,
        am_creation_user_name: inv.creation_user_name || null,
        am_last_modified_time: inv.last_modified_time || null,
        am_last_modified_command: inv.last_modified_command || null,
        am_last_modified_user_id: inv.last_modified_user_id || null,
        am_last_modified_user_name: inv.last_modified_user_name || null,
        ref_table: inv.ref_table || null,

        last_synced_at: new Date().toISOString()
      }));

      const { error: upsertError, data: upsertData } = await supabase
        .from('inventory')
        .upsert(rows, { onConflict: 'sku_id' });

      if (upsertError) {
        console.error(`Batch error at offset ${i}:`, upsertError);
        errors += batch.length;
      } else {
        created += batch.length;
      }

      if ((i + batchSize) % 500 === 0 || i + batchSize >= inventory.length) {
        const progress = Math.round(((i + batchSize) / inventory.length) * 100);
        console.log(`Progress: ${Math.min(i + batchSize, inventory.length)}/${inventory.length} (${progress}%)`);
      }
    }

    // Also update product_skus qty fields from inventory data for consistency
    console.log('Updating product_skus quantities from inventory...');
    let skuUpdates = 0;
    for (const inv of inventory) {
      try {
        const { error } = await supabase
          .from('product_skus')
          .update({
            qty_avail_sell: toNum(inv.qty_avail_sell) || 0,
            qty_inventory: toNum(inv.qty_inventory) || 0,
            qty_alloc: toNum(inv.qty_alloc) || 0,
            qty_avail_alloc: toNum(inv.qty_avail_alloc) || 0,
            qty_open_po: toNum(inv.qty_open_po) || 0,
            qty_open_sales: toNum(inv.qty_open_sales) || 0,
            qty_picked: toNum(inv.qty_picked) || 0,
            qty_invoiced: toNum(inv.qty_invoiced) || 0,
            qty_received: toNum(inv.qty_received) || 0,
            qty_issued: toNum(inv.qty_issued) || 0,
            qty_returned: toNum(inv.qty_returned) || 0,
            qty_open_wip: toNum(inv.qty_open_wip) || 0,
            qty_open_po_no_proj: toNum(inv.qty_open_po_no_proj) || 0,
            qty_otr: toNum(inv.qty_otr) || 0,
            last_synced_at: new Date().toISOString()
          })
          .eq('sku_id', inv.sku_id);

        if (!error) skuUpdates++;
      } catch {}
    }
    console.log(`Updated ${skuUpdates} product_skus records with inventory quantities`);

    const duration = Math.round((Date.now() - startTime) / 1000);

    if (syncLog) {
      await supabase.from('sync_log').update({
        status: 'completed',
        records_processed: inventory.length,
        records_created: created,
        records_updated: updated,
        errors,
        completed_at: new Date().toISOString(),
        duration_seconds: duration
      }).eq('id', syncLog.id);
    }

    console.log(`✅ Inventory sync complete! Records: ${created}, SKU updates: ${skuUpdates}, Errors: ${errors}, Duration: ${duration}s`);

    return NextResponse.json({
      success: true,
      stats: {
        inventory_records: created,
        sku_updates: skuUpdates,
        errors,
        duration: `${duration}s`
      }
    });

  } catch (error) {
    console.error('Inventory sync error:', error);
    if (syncLog) {
      await supabase.from('sync_log').update({
        status: 'failed',
        error_details: { message: error instanceof Error ? error.message : 'Unknown error' },
        completed_at: new Date().toISOString()
      }).eq('id', syncLog.id);
    }
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
  }
}
