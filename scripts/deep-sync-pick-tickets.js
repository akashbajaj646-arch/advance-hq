#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * scripts/deep-sync-pick-tickets.js
 *
 * Standalone, runs-to-completion deep sync of pick tickets from ApparelMagic
 * into Supabase. Designed to be run locally without any HTTP / serverless
 * function timeout limits.
 *
 * Why this exists:
 *   The /api/admin/sync-pick-tickets route does the same job, but it makes
 *   ~4 sequential Supabase calls per pick ticket (SELECT, UPDATE/INSERT,
 *   DELETE items, then 1 INSERT per item). For 40,000 pick tickets with
 *   ~5 items each, that's ~320,000 sequential round-trips. At 50-150ms
 *   per Supabase call from a local machine, that's hours of wall-clock
 *   time, and on Vercel's serverless functions it just times out.
 *
 *   This script does the same thing in BATCHES: per page (200 PTs from AM),
 *   it issues 3 queries total — one bulk upsert for the PTs, one bulk
 *   delete for items belonging to those PTs, and one bulk insert for the
 *   new items. End-to-end this is ~2-3 orders of magnitude faster.
 *
 * Field mapping is kept identical to the route (app/api/admin/sync-pick-tickets/
 * route.ts) so the data ends up in exactly the same shape — this is the
 * same sync, just batched.
 *
 * Usage:
 *   cd /Users/Akash/advance-hq
 *   node scripts/deep-sync-pick-tickets.js
 *
 * Useful flags (env vars, all optional):
 *   PAGE_SIZE=200          how many PTs per AM page request (max 200)
 *   START_LAST_ID=12345    resume from a specific cursor — useful if you
 *                          had a partial run and want to continue
 *   DRY_RUN=1              fetch from AM and show counts but don't write
 *                          to Supabase. Sanity-check before committing.
 */

const fs = require('fs');
const path = require('path');

// ─── Tiny dotenv replacement (no extra deps) ─────────────────────────
function loadEnvLocal() {
  const envPath = path.resolve(__dirname, '..', '.env.local');
  if (!fs.existsSync(envPath)) {
    console.error(`✗ ${envPath} not found. Run from the repo root.`);
    process.exit(1);
  }
  const raw = fs.readFileSync(envPath, 'utf8');
  for (const line of raw.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let val = m[2].trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
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
  console.error('✗ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}
if (!AM_TOKEN) {
  console.error('✗ Missing APPARELMAGIC_TOKEN in .env.local');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ─── Helpers (mirror the route exactly) ──────────────────────────────

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

// ─── Mappers (lifted from the route, kept 1:1) ───────────────────────

function ptToRow(pt, customerMap, orderMap) {
  return {
    pick_ticket_id: pt.pick_ticket_id,
    order_id: orderMap[pt.order_id] || null,
    apparel_magic_order_id: pt.order_id,
    customer_id: customerMap[pt.customer_id] || null,
    apparel_magic_customer_id: pt.customer_id,
    invoice_id: pt.invoice_id || null,
    customer_name: pt.customer_name || null,
    account_number: pt.account_number || null,
    customer_po: pt.customer_po || null,

    pick_ticket_date: parseDate(pt.date) || pt.date_internal || null,
    date_start: pt.date_start || null,
    date_due: parseDate(pt.date_due) || pt.date_due_internal || null,

    qty: toNum(pt.qty) || 0,
    subtotal: toNum(pt.amount_subtotal) || toNum(pt.amount) || 0,
    total_amount: toNum(pt.amount) || 0,
    amount_subtotal: toNum(pt.amount_subtotal) || 0,
    tax_amount: toNum(pt.amount_tax_total) || 0,
    amount_tax: toNum(pt.amount_tax) || 0,
    amount_tax_2: toNum(pt.amount_tax_2) || 0,
    amount_tax_total: toNum(pt.amount_tax_total) || 0,
    amount_taxable: toNum(pt.amount_taxable) || 0,
    discount_amount: toNum(pt.amount_discount) || 0,
    amount_discount: toNum(pt.amount_discount) || 0,
    override_discount_amount: toNum(pt.override_discount_amount) || 0,
    freight_amount: toNum(pt.amount_freight) || 0,
    amount_freight: toNum(pt.amount_freight) || 0,
    freight_taxable: pt.freight_taxable || '0',
    pct_discount: toNum(pt.pct_discount) || 0,
    tax_rate: toNum(pt.tax_rate) || 0,
    tax_rate_2: toNum(pt.tax_rate_2) || 0,
    tax_first_tax_amount: pt.tax_first_tax_amount || null,
    override_tax_amount: toNum(pt.override_tax_amount) || 0,

    description_misc: pt.description_misc || null,
    qty_misc: toNum(pt.qty_misc) || 0,
    rate_misc: toNum(pt.rate_misc) || 0,
    amount_misc: toNum(pt.amount_misc) || 0,

    ship_to_id: pt.ship_to_id || null,
    ship_to_name: pt.ship_to_name || pt.name || null,
    ship_to_address_1: pt.address_1 || null,
    ship_to_address_2: pt.address_2 || null,
    ship_to_city: pt.city || null,
    ship_to_state: pt.state || null,
    ship_to_zip: pt.postal_code || null,
    ship_to_country: pt.country || null,
    ship_to_phone: pt.phone || null,
    ship_via: pt.ship_via || null,
    tracking_number: pt.tracking_number || null,
    shipping_terms_id: pt.shipping_terms_id || null,
    shipping_info: pt.shipping_info || null,
    itn: pt.itn || null,
    weight: toNum(pt.weight) || 0,
    ups_batch: pt.ups_batch || '0',

    warehouse_id: pt.warehouse_id || null,
    item_warehouses_overridden: pt.item_warehouses_overridden || '0',
    division_id: pt.division_id || null,
    division_name: pt.division_name || null,
    ar_acct: pt.ar_acct || null,
    terms_id: pt.terms_id || null,
    salesperson: pt.salesperson || null,
    commission_rate: pt.commission_rate || null,
    commission: pt.commission || null,
    credit_status: pt.credit_status || null,
    approval_number: pt.approval_number || null,
    status: pt.status || null,
    currency_id: pt.currency_id || null,
    currency_rate: toNum(pt.currency_rate) || 1,

    notes: pt.notes || null,
    private_notes: pt.private_notes || null,

    is_void: toBool(pt.void),
    is_locked: toBool(pt.is_locked),
    is_printed: toBool(pt.is_printed),
    is_emailed: toBool(pt.is_emailed),
    is_picked: toBool(pt.is_picked),
    has_error: pt.error !== '0' && pt.error !== null,
    error: pt.error || '0',

    shipstation_id: pt.shipstation_id || null,
    shipstation_key: pt.shipstation_key || null,
    shipstation_synced: pt.shipstation_synced || '0',
    shipstation_connection_id: pt.shipstation_connection_id || null,

    wms_status: pt.wms_status || 'pending',
    date_shipped: pt.date_shipped || null,
    qty_cartoned: toNum(pt.qty_cartoned) || 0,
    carton_status: pt.carton_status || 'none',

    department_number: pt.department_number || null,
    department_name: pt.department_name || null,
    mark_for_store: pt.mark_for_store || null,
    group_number: pt.group_number || null,
    edi_reference: pt.edi_reference || null,
    event_code: pt.event_code || null,

    am_creation_time: pt.creation_time || null,
    am_creation_user_id: pt.creation_user_id || null,
    am_creation_user_name: pt.creation_user_name || null,
    am_last_modified_time: pt.last_modified_time || null,
    am_last_modified_command: pt.last_modified_command || null,
    am_last_modified_user_id: pt.last_modified_user_id || null,
    am_last_modified_user_name: pt.last_modified_user_name || null,

    last_synced_at: new Date().toISOString(),
  };
}

function itemToRow(item, ptId) {
  return {
    am_item_id: item.id || null,
    pick_ticket_id: ptId,
    order_id: item.order_id || null,
    order_item_id: item.order_item_id || null,
    product_id: item.product_id || null,
    sku_id: item.sku_id || null,
    style_number: item.style_number || null,
    description: item.description || null,
    attr_2: item.attr_2 || null,
    attr_3: item.attr_3 || null,
    size: item.size || null,
    qty: toNum(item.qty) || 0,
    qty_cartoned: toNum(item.qty_cartoned) || 0,
    unit_price: toNum(item.unit_price) || 0,
    amount: toNum(item.amount) || 0,
    warehouse_id: item.warehouse_id || null,
    row_id: item.row_id || null,
    is_taxable: item.is_taxable !== '0',
    retailer_sku: item.retailer_sku || null,
    mark_for_store: item.mark_for_store || null,
    group_number: item.group_number || null,
    edi_reference: item.edi_reference || null,
    upc: item.upc || item.upc_display || null,
    error: item.error || '0',
    notes: item.notes || null,
    location: item.location || null,
    last_synced_at: new Date().toISOString(),
  };
}

// ─── Main ────────────────────────────────────────────────────────────

async function main() {
  console.log('🔄 Deep sync of pick_tickets from ApparelMagic');
  console.log(`   Page size: ${PAGE_SIZE}`);
  console.log(`   AM base:   ${AM_BASE}`);
  console.log(`   Dry run:   ${DRY_RUN ? 'YES (no writes)' : 'no'}`);
  if (START_LAST_ID) console.log(`   Resuming from last_id: ${START_LAST_ID}`);
  console.log('');

  const startTime = Date.now();

  // Open a sync_log row so this run is visible alongside the cron runs.
  let syncLogId = null;
  if (!DRY_RUN) {
    const { data: logRow, error: logErr } = await supabase
      .from('sync_log')
      .insert({
        sync_type: 'pick_tickets',
        source: 'apparel_magic_deep_sync',
        status: 'started',
      })
      .select()
      .single();
    if (logErr) {
      console.warn(`⚠️  Couldn't open sync_log row: ${logErr.message}`);
    } else {
      syncLogId = logRow?.id;
      console.log(`   sync_log id: ${syncLogId}`);
    }
  }

  // Pre-fetch the customer + order maps once. The route does this every
  // run as well; for our purposes a snapshot at the start is fine because
  // we're upserting and a missing FK just becomes NULL (which the route
  // already accepts).
  console.log('📥 Loading customer + order ID maps...');
  const customerMap = {};
  const orderMap = {};
  {
    let page = 0;
    while (true) {
      const { data, error } = await supabase
        .from('customers')
        .select('id, am_customer_id')
        .range(page * 1000, page * 1000 + 999);
      if (error) throw new Error(`customers fetch: ${error.message}`);
      if (!data || data.length === 0) break;
      for (const c of data) customerMap[c.am_customer_id] = c.id;
      if (data.length < 1000) break;
      page++;
    }
  }
  {
    let page = 0;
    while (true) {
      const { data, error } = await supabase
        .from('orders')
        .select('id, apparel_magic_id')
        .range(page * 1000, page * 1000 + 999);
      if (error) throw new Error(`orders fetch: ${error.message}`);
      if (!data || data.length === 0) break;
      for (const o of data) orderMap[o.apparel_magic_id] = o.id;
      if (data.length < 1000) break;
      page++;
    }
  }
  console.log(
    `   ${Object.keys(customerMap).length} customers, ${Object.keys(orderMap).length} orders mapped`
  );
  console.log('');

  let lastId = START_LAST_ID;
  let pageCount = 0;
  let totalPts = 0;
  let totalItems = 0;
  let totalErrors = 0;

  // Loop pages until AM stops returning a last_id.
  while (true) {
    const auth = authParams();
    const params = new URLSearchParams({
      time: auth.time,
      token: auth.token,
      'pagination[page_size]': String(PAGE_SIZE),
    });
    if (lastId) params.append('pagination[last_id]', lastId);

    const url = `${AM_BASE}/pick_tickets?${params.toString()}`;
    let amResp;
    try {
      amResp = await fetch(url, {
        method: 'GET',
        headers: { 'User-Agent': 'AdvanceHQ/deep-sync' },
      });
    } catch (e) {
      console.error(`✗ AM fetch failed on page ${pageCount + 1}: ${e.message}`);
      console.error(`  Resume with: START_LAST_ID=${lastId} node scripts/deep-sync-pick-tickets.js`);
      throw e;
    }

    if (!amResp.ok) {
      console.error(`✗ AM returned HTTP ${amResp.status} on page ${pageCount + 1}`);
      console.error(`  Resume with: START_LAST_ID=${lastId} node scripts/deep-sync-pick-tickets.js`);
      throw new Error(`AM HTTP ${amResp.status}`);
    }

    const amData = await amResp.json();
    const ptArray = Array.isArray(amData.response) ? amData.response : [];
    const totalReported = amData?.meta?.pagination?.total_records;

    if (ptArray.length === 0) {
      console.log(`📦 Page ${pageCount + 1}: empty — assuming we've reached the end.`);
      break;
    }

    // ── Bulk upsert this page's pick_tickets ──
    const ptRows = ptArray.map((pt) => ptToRow(pt, customerMap, orderMap));

    if (!DRY_RUN) {
      const { error: upsertErr } = await supabase
        .from('pick_tickets')
        .upsert(ptRows, { onConflict: 'pick_ticket_id' });
      if (upsertErr) {
        console.error(`✗ pick_tickets upsert failed on page ${pageCount + 1}: ${upsertErr.message}`);
        console.error(`  Resume with: START_LAST_ID=${lastId} node scripts/deep-sync-pick-tickets.js`);
        totalErrors += ptArray.length;
        // Keep going — don't let a single page failure abort the whole run
      }
    }

    // ── Bulk replace items for this page's PTs ──
    // Step 1: delete all existing items for these pick_ticket_ids
    // Step 2: bulk insert the fresh items in one call
    const ptIds = ptArray.map((pt) => pt.pick_ticket_id);
    const itemRows = [];
    for (const pt of ptArray) {
      if (!Array.isArray(pt.pick_ticket_items)) continue;
      for (const item of pt.pick_ticket_items) {
        itemRows.push(itemToRow(item, pt.pick_ticket_id));
      }
    }

    if (!DRY_RUN && ptIds.length > 0) {
      const { error: delErr } = await supabase
        .from('pick_ticket_items')
        .delete()
        .in('pick_ticket_id', ptIds);
      if (delErr) {
        console.error(`✗ pick_ticket_items delete failed on page ${pageCount + 1}: ${delErr.message}`);
      }
    }

    if (!DRY_RUN && itemRows.length > 0) {
      // Supabase has a hard limit around 1000 rows per insert call. Chunk.
      const CHUNK = 500;
      for (let i = 0; i < itemRows.length; i += CHUNK) {
        const slice = itemRows.slice(i, i + CHUNK);
        const { error: insErr } = await supabase.from('pick_ticket_items').insert(slice);
        if (insErr) {
          console.error(
            `✗ pick_ticket_items insert chunk failed on page ${pageCount + 1}: ${insErr.message}`
          );
          totalErrors++;
        }
      }
    }

    totalPts += ptArray.length;
    totalItems += itemRows.length;
    pageCount++;

    const elapsed = Math.round((Date.now() - startTime) / 1000);
    const rate = totalPts / Math.max(elapsed, 1);
    const eta =
      totalReported && rate > 0
        ? `~${Math.round((totalReported - totalPts) / rate)}s remaining`
        : '';
    const totalStr = totalReported ? `/${totalReported}` : '';
    console.log(
      `📦 Page ${pageCount}: +${ptArray.length} PTs, +${itemRows.length} items · ` +
        `total ${totalPts}${totalStr} · ${elapsed}s elapsed · ${rate.toFixed(1)} PTs/sec ${eta}`
    );

    // Advance cursor. If AM didn't return a next cursor, we're done.
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
  console.log(`   Pages processed:  ${pageCount}`);
  console.log(`   PTs synced:       ${totalPts}`);
  console.log(`   Items synced:     ${totalItems}`);
  console.log(`   Errors:           ${totalErrors}`);
  console.log('━'.repeat(60));

  if (!DRY_RUN && syncLogId) {
    await supabase
      .from('sync_log')
      .update({
        status: totalErrors > 0 ? 'completed_with_errors' : 'completed',
        records_processed: totalPts,
        records_created: 0, // upsert doesn't tell us, so we just record total
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
