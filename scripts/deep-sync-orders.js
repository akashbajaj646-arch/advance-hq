#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * scripts/deep-sync-orders.js
 *
 * Standalone deep sync of orders + order_items from ApparelMagic.
 *
 * Usage:
 *   cd /Users/Akash/advance-hq
 *   node scripts/deep-sync-orders.js
 *
 * Notes:
 *   - Conflict key for orders: apparel_magic_id
 *   - order_items uses apparel_magic_order_id for delete-then-insert
 *   - Customer FK is mapped from existing customers table
 *   - The order_items.order_id (UUID FK) requires we look up new orders'
 *     IDs after the bulk upsert. Done via SELECT WHERE apparel_magic_id IN (...).
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

const PAGE_SIZE = parseInt(process.env.PAGE_SIZE || '200', 10);
const DRY_RUN = process.env.DRY_RUN === '1';
const START_LAST_ID = process.env.START_LAST_ID || null;

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
function parseDate(dateStr) {
  if (!dateStr) return null;
  const parts = String(dateStr).split('/');
  if (parts.length === 3) {
    return `${parts[2]}-${parts[0].padStart(2, '0')}-${parts[1].padStart(2, '0')}`;
  }
  return dateStr;
}

function orderToRow(order, customerMap) {
  return {
    apparel_magic_id: order.order_id,
    customer_id: customerMap[order.customer_id] || null,
    apparel_magic_customer_id: order.customer_id,
    order_number: order.order_id,
    po_number: order.customer_po || null,
    customer_po: order.customer_po || null,
    order_status: order.status || (toNum(order.qty_shipped) ? 'shipped' : 'open'),
    order_date: parseDate(order.date),
    ship_date: parseDate(order.date_start),
    cancel_date: parseDate(order.date_due),
    customer_name: order.customer_name || null,

    subtotal: toNum(order.amount_subtotal) || 0,
    discount_amount: toNum(order.amount_discount) || 0,
    shipping_amount: toNum(order.amount_freight) || 0,
    tax_amount: toNum(order.amount_tax_total) || 0,
    total_amount: toNum(order.amount) || 0,
    amount_open: toNum(order.amount_open) || 0,
    amount_alloc: toNum(order.amount_alloc) || 0,
    amount_cxl: toNum(order.amount_cxl) || 0,
    amount_shipped: toNum(order.amount_shipped) || 0,
    amount_approved: toNum(order.amount_approved) || 0,
    amount_taxable: toNum(order.amount_taxable) || 0,
    balance: toNum(order.balance) || 0,
    amount_paid: toNum(order.amount_paid) || 0,
    amount_tax_2: toNum(order.amount_tax_2) || 0,
    amount_tax_total: toNum(order.amount_tax_total) || 0,

    qty: toNum(order.qty) || 0,
    qty_open: toNum(order.qty_open) || 0,
    qty_cxl: toNum(order.qty_cxl) || 0,
    qty_alloc: toNum(order.qty_alloc) || 0,
    qty_picked: toNum(order.qty_picked) || 0,
    qty_shipped: toNum(order.qty_shipped) || 0,
    qty_approved: toNum(order.qty_approved) || 0,

    pct_discount: toNum(order.pct_discount) || 0,
    tax_rate: toNum(order.tax_rate) || 0,
    tax_rate_2: toNum(order.tax_rate_2) || 0,
    tax_first_tax_amount: order.tax_first_tax_amount || null,
    override_tax_amount: order.override_tax_amount || '0',

    ship_to_id: order.ship_to_id || null,
    ship_to_name: order.name || order.customer_name || null,
    ship_to_address_1: order.address_1 || null,
    ship_to_address_2: order.address_2 || null,
    ship_to_city: order.city || null,
    ship_to_state: order.state || null,
    ship_to_zip: order.postal_code || null,
    ship_to_country: order.country || null,
    ship_to_phone: order.phone || null,
    ship_via: order.ship_via || null,
    shipping_method: order.ship_via || null,
    shipping_terms_id: order.shipping_terms_id || null,
    shipping_info: order.shipping_info || null,
    weight: toNum(order.weight) || 0,

    warehouse_id: order.warehouse_id || null,
    credit_status: order.credit_status || null,
    approval_number: order.approval_number || null,
    terms_id: order.terms_id || null,
    division_id: order.division_id || null,
    ar_acct: order.ar_acct || null,
    season: order.season || null,
    trade_show: order.season || null,
    currency_id: order.currency_id || null,
    currency_rate: toNum(order.currency_rate) || 1,

    notes: order.notes || null,
    private_notes: order.private_notes || null,

    description_misc: order.description_misc || null,
    qty_misc: toNum(order.qty_misc) || 0,
    rate_misc: toNum(order.rate_misc) || 0,
    amount_misc: toNum(order.amount_misc) || 0,

    error: order.error || '0',
    is_locked: toBool(order.is_locked),

    edi_reference: order.edi_reference || null,
    department_number: order.department_number || null,
    mark_for_store: order.mark_for_store || null,
    mic_code: order.mic_code || null,
    shopify_id: order.shopify_id || null,
    shopify_store_id: order.shopify_store_id || null,

    print_url: order.print_url || null,
    sales_rep: order.salesperson || order.sales_rep || null,
    commissions: order.commissions || null,
    order_udf: order.udf || null,
    order_group: order.order_group || null,

    am_last_modified_time: order.time_modified
      ? new Date(order.time_modified * 1000).toISOString()
      : null,
    am_time_modified: order.time_modified || null,

    last_synced_at: new Date().toISOString(),
  };
}

function orderItemToRow(item, order, orderUuid) {
  return {
    apparel_magic_id: item.id,
    order_id: orderUuid,
    apparel_magic_order_id: order.order_id,
    product_id: item.product_id,
    sku_id: item.sku_id,
    style_number: item.style_number,
    description: item.description || null,
    color: item.attr_2 || null,
    attr_2: item.attr_2 || null,
    attr_3: item.attr_3 || null,
    size: item.size || null,
    item_number: item.item_number || null,
    row_id: item.row_id || null,
    warehouse_id: item.warehouse_id || null,

    quantity_ordered: parseInt(item.qty) || 0,
    qty: toNum(item.qty) || 0,
    qty_alloc: toNum(item.qty_alloc) || 0,
    qty_picked: toNum(item.qty_picked) || 0,
    qty_open: toNum(item.qty_open) || 0,
    quantity_shipped: parseInt(item.qty_shipped) || 0,
    qty_shipped_am: toNum(item.qty_shipped) || 0,
    quantity_cancelled: parseInt(item.qty_cxl) || 0,
    qty_cxl: toNum(item.qty_cxl) || 0,

    unit_price: toNum(item.unit_price) || 0,
    line_total: toNum(item.amount) || 0,
    amount: toNum(item.amount) || 0,
    amount_alloc: toNum(item.amount_alloc) || 0,
    amount_open: toNum(item.amount_open) || 0,
    amount_shipped: toNum(item.amount_shipped) || 0,
    amount_cxl: toNum(item.amount_cxl) || 0,
    discount_percent: toNum(item.pct_discount),

    is_taxable: item.is_taxable !== '0',
    line_status:
      parseInt(item.qty_shipped) > 0
        ? 'shipped'
        : parseInt(item.qty_cxl) >= parseInt(item.qty)
        ? 'cancelled'
        : 'open',
    purchase_order_id: item.purchase_order_id || null,
    purchase_order_item_id: item.purchase_order_item_id || null,
    project_id: item.project_id || null,
    error: item.error || '0',
    notes: item.notes || null,
    mark_for_store: item.mark_for_store || null,
    retailer_sku: item.retailer_sku || null,
    ticketing: item.ticketing || null,

    last_synced_at: new Date().toISOString(),
  };
}

async function main() {
  console.log('🔄 Deep sync of orders from ApparelMagic');
  console.log(`   Page size: ${PAGE_SIZE}`);
  console.log(`   Dry run:   ${DRY_RUN ? 'YES (no writes)' : 'no'}`);
  if (START_LAST_ID) console.log(`   Resuming from last_id: ${START_LAST_ID}`);
  console.log('');

  const startTime = Date.now();

  let syncLogId = null;
  if (!DRY_RUN) {
    const { data: logRow } = await supabase
      .from('sync_log')
      .insert({ sync_type: 'orders', source: 'apparel_magic_deep_sync', status: 'started' })
      .select()
      .single();
    syncLogId = logRow?.id;
    if (syncLogId) console.log(`   sync_log id: ${syncLogId}`);
  }

  console.log('📥 Loading customer ID map...');
  const customerMap = {};
  let cursorPage = 0;
  while (true) {
    const { data, error } = await supabase
      .from('customers')
      .select('id, am_customer_id')
      .range(cursorPage * 1000, cursorPage * 1000 + 999);
    if (error) throw new Error(`customers fetch: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const c of data) customerMap[c.am_customer_id] = c.id;
    if (data.length < 1000) break;
    cursorPage++;
  }
  console.log(`   ${Object.keys(customerMap).length} customers mapped`);
  console.log('');

  let lastId = START_LAST_ID;
  let pageCount = 0;
  let totalOrders = 0;
  let totalItems = 0;
  let totalErrors = 0;

  while (true) {
    const auth = authParams();
    const params = new URLSearchParams({
      time: auth.time,
      token: auth.token,
      'pagination[page_size]': String(PAGE_SIZE),
    });
    if (lastId) params.append('pagination[last_id]', lastId);

    const url = `${AM_BASE}/orders?${params.toString()}`;
    let amResp;
    try {
      amResp = await fetch(url, { method: 'GET', headers: { 'User-Agent': 'AdvanceHQ/deep-sync' } });
    } catch (e) {
      console.error(`✗ AM fetch failed: ${e.message}`);
      console.error(`  Resume with: START_LAST_ID=${lastId} node scripts/deep-sync-orders.js`);
      throw e;
    }
    if (!amResp.ok) {
      console.error(`✗ AM HTTP ${amResp.status}`);
      console.error(`  Resume with: START_LAST_ID=${lastId} node scripts/deep-sync-orders.js`);
      throw new Error(`AM HTTP ${amResp.status}`);
    }

    const amData = await amResp.json();
    const arr = Array.isArray(amData.response) ? amData.response : [];
    const totalReported = amData?.meta?.pagination?.total_records;

    if (arr.length === 0) {
      console.log(`📦 Page ${pageCount + 1}: empty — end of data.`);
      break;
    }

    // 1. Bulk upsert orders
    const orderRows = arr.map((o) => orderToRow(o, customerMap));
    if (!DRY_RUN) {
      const { error } = await supabase
        .from('orders')
        .upsert(orderRows, { onConflict: 'apparel_magic_id' });
      if (error) {
        console.error(`✗ orders upsert failed: ${error.message}`);
        totalErrors += arr.length;
      }
    }

    // 2. Look up the new orders' UUIDs (needed for order_items.order_id)
    let pageItemCount = 0;
    if (!DRY_RUN) {
      const amOrderIds = arr.map((o) => o.order_id);
      const { data: idRows, error: idErr } = await supabase
        .from('orders')
        .select('id, apparel_magic_id')
        .in('apparel_magic_id', amOrderIds);
      if (idErr) {
        console.error(`✗ orders id fetch failed: ${idErr.message}`);
      } else {
        const idMap = {};
        for (const r of idRows || []) idMap[r.apparel_magic_id] = r.id;

        // 3. Build order_items rows for this page
        const itemRows = [];
        for (const o of arr) {
          const orderUuid = idMap[o.order_id];
          if (!orderUuid || !Array.isArray(o.order_items)) continue;
          for (const item of o.order_items) {
            itemRows.push(orderItemToRow(item, o, orderUuid));
          }
        }

        // 4. Delete existing items for this page's orders, then bulk insert
        if (amOrderIds.length > 0) {
          const { error: delErr } = await supabase
            .from('order_items')
            .delete()
            .in('apparel_magic_order_id', amOrderIds);
          if (delErr) console.error(`✗ order_items delete failed: ${delErr.message}`);
        }

        if (itemRows.length > 0) {
          const CHUNK = 500;
          for (let i = 0; i < itemRows.length; i += CHUNK) {
            const slice = itemRows.slice(i, i + CHUNK);
            const { error: insErr } = await supabase.from('order_items').insert(slice);
            if (insErr) {
              console.error(`✗ order_items insert chunk failed: ${insErr.message}`);
              totalErrors++;
            }
          }
          pageItemCount = itemRows.length;
        }
      }
    } else {
      for (const o of arr) {
        if (Array.isArray(o.order_items)) pageItemCount += o.order_items.length;
      }
    }

    totalOrders += arr.length;
    totalItems += pageItemCount;
    pageCount++;

    const elapsed = Math.round((Date.now() - startTime) / 1000);
    const rate = totalOrders / Math.max(elapsed, 1);
    const eta =
      totalReported && rate > 0
        ? `~${Math.round((totalReported - totalOrders) / rate)}s remaining`
        : '';
    const totalStr = totalReported ? `/${totalReported}` : '';
    console.log(
      `📦 Page ${pageCount}: +${arr.length} orders, +${pageItemCount} items · ` +
        `total ${totalOrders}${totalStr} · ${elapsed}s · ${rate.toFixed(1)}/sec ${eta}`
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
  console.log(`   Pages processed: ${pageCount}`);
  console.log(`   Orders synced:   ${totalOrders}`);
  console.log(`   Items synced:    ${totalItems}`);
  console.log(`   Errors:          ${totalErrors}`);
  console.log('━'.repeat(60));

  if (!DRY_RUN && syncLogId) {
    await supabase
      .from('sync_log')
      .update({
        status: totalErrors > 0 ? 'completed_with_errors' : 'completed',
        records_processed: totalOrders,
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
