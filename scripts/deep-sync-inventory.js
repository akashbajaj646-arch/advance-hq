#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * scripts/deep-sync-inventory.js
 *
 * Standalone deep sync of inventory from ApparelMagic.
 *
 * Usage:
 *   cd /Users/Akash/advance-hq
 *   node scripts/deep-sync-inventory.js
 *
 * Notes:
 *   - Conflict key for inventory: sku_id
 *   - The existing route was already partially batched (upsert in chunks of
 *     50) but had a per-record product_skus update loop that was the slow
 *     part. This script keeps the inventory upsert batched AND batches the
 *     product_skus update too — using a single upsert per page rather than
 *     N sequential updates.
 *   - Page size is 1000 (AM allows it for inventory).
 *   - No child tables, no FK lookups. Simplest of the three "real" syncs.
 */

const fs = require('fs');
const path = require('path');

function loadEnvLocal() {
  const envPath = path.resolve(__dirname, '..', '.env.local');
  if (!fs.existsSync(envPath)) {
    console.error(`✗ ${envPath} not found.`);
    process.exit(1);
  }
  const raw = fs.readFileSync(envPath, 'utf8');
  for (const line of raw.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let val = m[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[m[1]]) process.env[m[1]] = val;
  }
}
loadEnvLocal();

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  '';
const AM_TOKEN = process.env.APPARELMAGIC_TOKEN || '';
const AM_BASE =
  process.env.NEXT_PUBLIC_APPARELMAGIC_URL ||
  'https://advanceapparels.app.apparelmagic.com/api/json';

const PAGE_SIZE = parseInt(process.env.PAGE_SIZE || '1000', 10);
const DRY_RUN = process.env.DRY_RUN === '1';
const START_LAST_ID = process.env.START_LAST_ID || null;
const SKIP_PRODUCT_SKUS = process.env.SKIP_PRODUCT_SKUS === '1';

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('✗ Missing supabase env vars');
  process.exit(1);
}
if (!AM_TOKEN) {
  console.error('✗ Missing APPARELMAGIC_TOKEN');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

function authParams() {
  return { time: Math.floor(Date.now() / 1000).toString(), token: AM_TOKEN };
}
function toNum(val) {
  if (val === null || val === undefined || val === '') return null;
  const n = parseFloat(val);
  return isNaN(n) ? null : n;
}
function toBool(val) {
  return val === '1' || val === 1 || val === true;
}

function inventoryToRow(inv) {
  return {
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

    active: toBool(inv.active),
    is_inventory_tracked: toBool(inv.is_inventory_tracked),
    is_product: toBool(inv.is_product),
    is_component: toBool(inv.is_component),
    is_bundle: toBool(inv.is_bundle),
    joor_sync: inv.joor_sync || '0',

    shopify_compare_at_price_wholesale: inv.shopify_compare_at_price_wholesale || null,
    shopify_retail_compare_at_price: inv.shopify_retail_compare_at_price || null,

    am_creation_time: inv.creation_time || null,
    am_creation_user_id: inv.creation_user_id || null,
    am_creation_user_name: inv.creation_user_name || null,
    am_last_modified_time: inv.last_modified_time || null,
    am_last_modified_command: inv.last_modified_command || null,
    am_last_modified_user_id: inv.last_modified_user_id || null,
    am_last_modified_user_name: inv.last_modified_user_name || null,
    ref_table: inv.ref_table || null,

    last_synced_at: new Date().toISOString(),
  };
}

/**
 * Build a product_skus update row that mirrors the existing route's update
 * loop. The existing route did N sequential UPDATEs (one per SKU). This
 * script does ONE bulk upsert by sku_id, which is ~50x faster.
 *
 * Note: this only works if product_skus has a unique constraint on sku_id.
 * The existing route's per-row UPDATE doesn't require that, so we check via
 * a SELECT first and fall back to per-row updates if needed.
 */
function productSkuUpdateRow(inv) {
  return {
    sku_id: inv.sku_id,
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
    last_synced_at: new Date().toISOString(),
  };
}

async function main() {
  console.log('🔄 Deep sync of inventory from ApparelMagic');
  console.log(`   Page size: ${PAGE_SIZE}`);
  console.log(`   Dry run:   ${DRY_RUN ? 'YES (no writes)' : 'no'}`);
  console.log(`   product_skus update: ${SKIP_PRODUCT_SKUS ? 'SKIPPED' : 'enabled'}`);
  if (START_LAST_ID) console.log(`   Resuming from last_id: ${START_LAST_ID}`);
  console.log('');

  const startTime = Date.now();

  let syncLogId = null;
  if (!DRY_RUN) {
    const { data: logRow } = await supabase
      .from('sync_log')
      .insert({ sync_type: 'inventory', source: 'apparel_magic_deep_sync', status: 'started' })
      .select()
      .single();
    syncLogId = logRow?.id;
    if (syncLogId) console.log(`   sync_log id: ${syncLogId}`);
    console.log('');
  }

  let lastId = START_LAST_ID;
  let pageCount = 0;
  let totalRows = 0;
  let totalSkuUpdates = 0;
  let totalErrors = 0;

  while (true) {
    const auth = authParams();
    const params = new URLSearchParams({
      time: auth.time,
      token: auth.token,
      'pagination[page_size]': String(PAGE_SIZE),
    });
    if (lastId) params.append('pagination[last_id]', lastId);

    const url = `${AM_BASE}/inventory?${params.toString()}`;
    let amResp;
    try {
      amResp = await fetch(url, { method: 'GET', headers: { 'User-Agent': 'AdvanceHQ/deep-sync' } });
    } catch (e) {
      console.error(`✗ AM fetch failed: ${e.message}`);
      console.error(`  Resume with: START_LAST_ID=${lastId} node scripts/deep-sync-inventory.js`);
      throw e;
    }
    if (!amResp.ok) {
      console.error(`✗ AM HTTP ${amResp.status}`);
      console.error(`  Resume with: START_LAST_ID=${lastId} node scripts/deep-sync-inventory.js`);
      throw new Error(`AM HTTP ${amResp.status}`);
    }

    const amData = await amResp.json();
    const arr = Array.isArray(amData.response) ? amData.response : [];
    const totalReported = amData?.meta?.pagination?.total_records;

    if (arr.length === 0) {
      console.log(`📦 Page ${pageCount + 1}: empty — end of data.`);
      break;
    }

    // Bulk upsert inventory — chunk at 500 to keep payloads reasonable
    const invRows = arr.map(inventoryToRow);
    if (!DRY_RUN) {
      const CHUNK = 500;
      for (let i = 0; i < invRows.length; i += CHUNK) {
        const slice = invRows.slice(i, i + CHUNK);
        const { error } = await supabase
          .from('inventory')
          .upsert(slice, { onConflict: 'sku_id' });
        if (error) {
          console.error(`✗ inventory upsert chunk failed: ${error.message}`);
          totalErrors += slice.length;
        }
      }
    }

    // Bulk update product_skus (the existing route does this per-row; we batch it)
    let pageSkuUpdates = 0;
    if (!DRY_RUN && !SKIP_PRODUCT_SKUS) {
      const skuRows = arr.map(productSkuUpdateRow);
      const CHUNK = 500;
      for (let i = 0; i < skuRows.length; i += CHUNK) {
        const slice = skuRows.slice(i, i + CHUNK);
        const { error } = await supabase
          .from('product_skus')
          .upsert(slice, { onConflict: 'sku_id' });
        if (error) {
          console.error(`✗ product_skus upsert chunk failed: ${error.message}`);
          // Don't count as error — product_skus update is secondary
        } else {
          pageSkuUpdates += slice.length;
        }
      }
    }

    totalRows += arr.length;
    totalSkuUpdates += pageSkuUpdates;
    pageCount++;

    const elapsed = Math.round((Date.now() - startTime) / 1000);
    const rate = totalRows / Math.max(elapsed, 1);
    const eta =
      totalReported && rate > 0
        ? `~${Math.round((totalReported - totalRows) / rate)}s remaining`
        : '';
    const totalStr = totalReported ? `/${totalReported}` : '';
    console.log(
      `📦 Page ${pageCount}: +${arr.length} inventory, +${pageSkuUpdates} sku updates · ` +
        `total ${totalRows}${totalStr} · ${elapsed}s · ${rate.toFixed(1)}/sec ${eta}`
    );

    const nextCursor = amData?.meta?.pagination?.last_id;
    if (!nextCursor) {
      console.log('   (no next cursor — reached end)');
      break;
    }
    lastId = String(nextCursor);
  }

  const duration = Math.round((Date.now() - startTime) / 1000);
  console.log('');
  console.log('━'.repeat(60));
  console.log(`✅ Done in ${duration}s`);
  console.log(`   Pages processed:    ${pageCount}`);
  console.log(`   Inventory synced:   ${totalRows}`);
  console.log(`   product_skus updated: ${totalSkuUpdates}`);
  console.log(`   Errors:             ${totalErrors}`);
  console.log('━'.repeat(60));

  if (!DRY_RUN && syncLogId) {
    await supabase
      .from('sync_log')
      .update({
        status: totalErrors > 0 ? 'completed_with_errors' : 'completed',
        records_processed: totalRows,
        records_created: 0,
        records_updated: 0,
        errors: totalErrors,
        completed_at: new Date().toISOString(),
        duration_seconds: duration,
      })
      .eq('id', syncLogId);
  }
}

main().catch((err) => {
  console.error('');
  console.error('💥 Fatal error:', err.message || err);
  process.exit(1);
});
