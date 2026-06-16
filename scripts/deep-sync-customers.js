#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * scripts/deep-sync-customers.js
 *
 * Standalone deep sync of customers from ApparelMagic to Supabase.
 * Customers have a child table customer_locations.
 *
 * Usage:
 *   cd /Users/Akash/advance-hq
 *   node scripts/deep-sync-customers.js
 *
 * Notes:
 *   - Conflict key for customers: am_customer_id
 *   - Conflict key for customer_locations: am_ship_to_id
 *   - Locations need a customer_id FK (UUID), looked up from the customers
 *     table after each page's bulk upsert.
 *   - Default page size is 500 (AM allows it for customers).
 *   - The existing route caps at maxPages=20 (=10k customers); this script
 *     has no cap.
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

const PAGE_SIZE = parseInt(process.env.PAGE_SIZE || '500', 10);
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

function customerToRow(c) {
  return {
    am_customer_id: c.customer_id,
    customer_name: c.customer_name || 'Unknown',
    account_number: c.account_number || null,
    email: c.email || null,
    phone: c.phone || null,
    address_1: c.address_1 || null,
    address_2: c.address_2 || null,
    city: c.city || null,
    state: c.state || null,
    postal_code: c.postal_code || null,
    country: c.country || null,
    credit_limit: toNum(c.credit_limit),
    status: c.status || null,
    category: c.category || null,
    terms_id: c.terms_id || null,
    division_id: c.division_id || null,
    price_group: c.price_group || null,
    notes: c.notes || null,
    is_active: c.is_active === '1' || c.is_active === true,
    date_created: c.date_created || null,
    first_name: c.first_name || null,
    last_name: c.last_name || null,
    website: c.website || null,
    shipping_info: c.shipping_info || null,
    pct_discount: toNum(c.pct_discount) || 0,
    royalty_rate: c.royalty_rate || null,
    buyer_filter: c.buyer_filter || null,
    edi_department: c.edi_department || null,
    anet_id: c.anet_id || null,
    currency_id: c.currency_id || null,
    ar_acct: c.ar_acct || null,
    shopify_id: c.shopify_id || null,
    xero_id: c.xero_id || null,
    xero_synced: c.xero_synced || '0',
    quickbooks_id: c.quickbooks_id || null,
    salespeople: c.salespeople || null,
    last_synced_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function locationToRow(loc, amCustomerId, customerUuid) {
  return {
    am_ship_to_id: loc.ship_to_id || `${amCustomerId}-${loc.name || 'main'}`,
    am_customer_id: amCustomerId,
    customer_id: customerUuid || null,
    name: loc.name || null,
    address_1: loc.address_1 || null,
    address_2: loc.address_2 || null,
    city: loc.city || null,
    state: loc.state || null,
    postal_code: loc.postal_code || null,
    country: loc.country || null,
    phone: loc.phone || null,
    email: loc.email || null,
    store_number: loc.store_number || null,
    dc_reference: loc.dc_reference || null,
    department_number: loc.department_number || null,
    tax_rate: toNum(loc.tax_rate) || 0,
    is_main_location: loc.is_main === '1' || false,
    edi_reference: loc.edi_reference || null,
    last_synced_at: new Date().toISOString(),
  };
}

async function main() {
  console.log('🔄 Deep sync of customers from ApparelMagic');
  console.log(`   Page size: ${PAGE_SIZE}`);
  console.log(`   Dry run:   ${DRY_RUN ? 'YES (no writes)' : 'no'}`);
  if (START_LAST_ID) console.log(`   Resuming from last_id: ${START_LAST_ID}`);
  console.log('');

  const startTime = Date.now();

  let syncLogId = null;
  if (!DRY_RUN) {
    const { data: logRow } = await supabase
      .from('sync_log')
      .insert({ sync_type: 'customers', source: 'apparel_magic_deep_sync', status: 'started' })
      .select()
      .single();
    syncLogId = logRow?.id;
    if (syncLogId) console.log(`   sync_log id: ${syncLogId}`);
    console.log('');
  }

  let lastId = START_LAST_ID;
  let pageCount = 0;
  let totalRows = 0;
  let totalLocations = 0;
  let totalErrors = 0;

  while (true) {
    const auth = authParams();
    const params = new URLSearchParams({
      time: auth.time,
      token: auth.token,
      'pagination[page_size]': String(PAGE_SIZE),
    });
    if (lastId) params.append('pagination[last_id]', lastId);

    const url = `${AM_BASE}/customers?${params.toString()}`;
    let amResp;
    try {
      amResp = await fetch(url, { method: 'GET', headers: { 'User-Agent': 'AdvanceHQ/deep-sync' } });
    } catch (e) {
      console.error(`✗ AM fetch failed: ${e.message}`);
      console.error(`  Resume with: START_LAST_ID=${lastId} node scripts/deep-sync-customers.js`);
      throw e;
    }
    if (!amResp.ok) {
      console.error(`✗ AM HTTP ${amResp.status}`);
      console.error(`  Resume with: START_LAST_ID=${lastId} node scripts/deep-sync-customers.js`);
      throw new Error(`AM HTTP ${amResp.status}`);
    }

    const amData = await amResp.json();
    const arr = Array.isArray(amData.response) ? amData.response : [];
    const totalReported = amData?.meta?.pagination?.total_records;

    if (arr.length === 0) {
      console.log(`📦 Page ${pageCount + 1}: empty — end of data.`);
      break;
    }

    // Bulk upsert customers
    const customerRows = arr.map(customerToRow);
    if (!DRY_RUN) {
      const { error } = await supabase
        .from('customers')
        .upsert(customerRows, { onConflict: 'am_customer_id' });
      if (error) {
        console.error(`✗ customers upsert failed: ${error.message}`);
        totalErrors += arr.length;
      }
    }

    // For locations: we need each customer's UUID to populate location.customer_id.
    // After upsert, fetch IDs back in one query.
    let pageLocationCount = 0;
    if (!DRY_RUN) {
      const amIds = arr.map((c) => c.customer_id);
      const { data: rows, error: selErr } = await supabase
        .from('customers')
        .select('id, am_customer_id')
        .in('am_customer_id', amIds);
      if (selErr) {
        console.error(`✗ customers select failed: ${selErr.message}`);
      } else {
        const idMap = {};
        for (const r of rows || []) idMap[r.am_customer_id] = r.id;

        const locationRows = [];
        for (const c of arr) {
          if (!Array.isArray(c.locations)) continue;
          for (const loc of c.locations) {
            locationRows.push(locationToRow(loc, c.customer_id, idMap[c.customer_id]));
          }
        }

        if (locationRows.length > 0) {
          const CHUNK = 500;
          for (let i = 0; i < locationRows.length; i += CHUNK) {
            const slice = locationRows.slice(i, i + CHUNK);
            const { error: locErr } = await supabase
              .from('customer_locations')
              .upsert(slice, { onConflict: 'am_ship_to_id' });
            if (locErr) {
              console.error(`✗ customer_locations upsert failed: ${locErr.message}`);
              totalErrors++;
            }
          }
          pageLocationCount = locationRows.length;
        }
      }
    } else {
      // count locations even in dry run for visibility
      for (const c of arr) {
        if (Array.isArray(c.locations)) pageLocationCount += c.locations.length;
      }
    }

    totalRows += arr.length;
    totalLocations += pageLocationCount;
    pageCount++;

    const elapsed = Math.round((Date.now() - startTime) / 1000);
    const rate = totalRows / Math.max(elapsed, 1);
    const eta =
      totalReported && rate > 0
        ? `~${Math.round((totalReported - totalRows) / rate)}s remaining`
        : '';
    const totalStr = totalReported ? `/${totalReported}` : '';
    console.log(
      `📦 Page ${pageCount}: +${arr.length} customers, +${pageLocationCount} locations · ` +
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
  console.log(`   Pages processed:  ${pageCount}`);
  console.log(`   Customers synced: ${totalRows}`);
  console.log(`   Locations synced: ${totalLocations}`);
  console.log(`   Errors:           ${totalErrors}`);
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
