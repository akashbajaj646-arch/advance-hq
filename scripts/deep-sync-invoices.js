#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * scripts/deep-sync-invoices.js
 *
 * Standalone deep sync of invoices + invoice_items from ApparelMagic.
 *
 * Usage:
 *   cd /Users/Akash/advance-hq
 *   node scripts/deep-sync-invoices.js
 *
 * Notes:
 *   - Conflict key for invoices: apparel_magic_id
 *   - invoice_items uses apparel_magic_invoice_id for delete-then-insert
 *   - Customer FK + Order FK both mapped from existing tables
 *   - invoice_items.invoice_id (UUID FK) requires post-upsert lookup
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

function determinePaymentStatus(balance, amountPaid, total) {
  if (balance <= 0 || amountPaid >= total) return 'paid';
  if (amountPaid > 0) return 'partial';
  return 'unpaid';
}

function invoiceToRow(invoice, customerMap, orderMap) {
  const total = toNum(invoice.amount) || 0;
  const amountPaid = toNum(invoice.amount_paid) || 0;
  const balance = toNum(invoice.balance) || 0;

  return {
    apparel_magic_id: invoice.invoice_id,
    order_id: orderMap[invoice.order_id] || null,
    customer_id: customerMap[invoice.customer_id] || null,
    apparel_magic_order_id: invoice.order_id,
    apparel_magic_customer_id: invoice.customer_id,
    invoice_number: invoice.invoice_id,
    invoice_date: parseDate(invoice.date),
    due_date: parseDate(invoice.date_due),
    date_start: invoice.date_start || null,

    subtotal: toNum(invoice.amount_subtotal) || 0,
    discount_amount: toNum(invoice.amount_discount) || 0,
    shipping_amount: toNum(invoice.amount_freight) || 0,
    tax_amount: toNum(invoice.amount_tax) || 0,
    total_amount: total,
    amount_paid: amountPaid,
    balance_due: balance,
    payment_status: determinePaymentStatus(balance, amountPaid, total),
    amount_taxable: toNum(invoice.amount_taxable) || 0,
    amount_open_to_return: toNum(invoice.amount_open_to_return) || 0,
    amount_tax_2: toNum(invoice.amount_tax_2) || 0,
    pct_discount: toNum(invoice.pct_discount) || 0,

    qty: toNum(invoice.qty) || 0,
    qty_open_to_return: toNum(invoice.qty_open_to_return) || 0,

    tax_code: invoice.tax_code || null,
    tax_rate: toNum(invoice.tax_rate) || 0,
    tax_rate_2: toNum(invoice.tax_rate_2) || 0,

    ship_to_id: invoice.ship_to_id || null,
    ship_to_name: invoice.name || null,
    address_1: invoice.address_1 || null,
    address_2: invoice.address_2 || null,
    city: invoice.city || null,
    state: invoice.state || null,
    postal_code: invoice.postal_code || null,
    country: invoice.country || null,
    phone: invoice.phone || null,
    ship_via: invoice.ship_via || null,
    shipping_terms_id: invoice.shipping_terms_id || null,
    tracking_number: invoice.tracking_number || null,
    weight: toNum(invoice.weight) || 0,
    ups_batch: invoice.ups_batch || '0',

    warehouse_id: invoice.warehouse_id || null,
    pick_ticket_id: invoice.pick_ticket_id || null,
    division_id: invoice.division_id || null,
    terms_id: invoice.terms_id || null,
    currency_id: invoice.currency_id || null,
    currency_rate: toNum(invoice.currency_rate) || 1,
    ar_acct: invoice.ar_acct || null,
    season: invoice.season || null,
    salesperson: invoice.salesperson || null,
    department: invoice.department || null,
    customer_po: invoice.customer_po || null,

    notes: invoice.notes || null,
    private_notes: invoice.private_notes || null,
    shipping_info: invoice.shipping_info || null,

    description_misc: invoice.description_misc || null,
    qty_misc: toNum(invoice.qty_misc) || 0,
    rate_misc: toNum(invoice.rate_misc) || 0,
    amount_misc: toNum(invoice.amount_misc) || 0,

    void: toBool(invoice.void),
    is_posted: toBool(invoice.is_posted),
    error: invoice.error || '0',

    magento_order: invoice.magento_order || null,
    shopify_id: invoice.shopify_id || null,
    xero_id: invoice.xero_id || null,
    xero_synced: invoice.xero_synced || '0',
    provider: invoice.provider || null,
    commissions: invoice.commissions || null,

    last_synced_at: new Date().toISOString(),
  };
}

function invoiceItemToRow(item, invoice, invoiceUuid) {
  return {
    am_invoice_item_id: item.id || null,
    invoice_id: invoiceUuid,
    apparel_magic_invoice_id: invoice.invoice_id,
    order_id: item.order_id || invoice.order_id || null,
    order_item_id: item.order_item_id || null,
    credit_memo_id: item.credit_memo_id || null,
    warehouse_id: item.warehouse_id || null,
    row_id: item.row_id || null,
    product_id: item.product_id || null,
    sku_id: item.sku_id || null,
    style_number: item.style_number || null,
    description: item.description || null,
    attr_2: item.attr_2 || null,
    attr_3: item.attr_3 || null,
    size: item.size || null,
    qty: toNum(item.qty) || 0,
    qty_open_to_return: toNum(item.qty_open_to_return) || 0,
    unit_price: toNum(item.unit_price) || 0,
    amount: toNum(item.amount) || 0,
    amount_open_to_return: toNum(item.amount_open_to_return) || 0,
    is_taxable: item.is_taxable !== '0',
    comment: item.comment || null,
    error: item.error || '0',
    notes: item.notes || null,
    last_synced_at: new Date().toISOString(),
  };
}

async function main() {
  console.log('🔄 Deep sync of invoices from ApparelMagic');
  console.log(`   Page size: ${PAGE_SIZE}`);
  console.log(`   Dry run:   ${DRY_RUN ? 'YES (no writes)' : 'no'}`);
  if (START_LAST_ID) console.log(`   Resuming from last_id: ${START_LAST_ID}`);
  console.log('');

  const startTime = Date.now();

  let syncLogId = null;
  if (!DRY_RUN) {
    const { data: logRow } = await supabase
      .from('sync_log')
      .insert({ sync_type: 'invoices', source: 'apparel_magic_deep_sync', status: 'started' })
      .select()
      .single();
    syncLogId = logRow?.id;
    if (syncLogId) console.log(`   sync_log id: ${syncLogId}`);
  }

  console.log('📥 Loading customer + order ID maps...');
  const customerMap = {};
  const orderMap = {};
  let cp = 0;
  while (true) {
    const { data, error } = await supabase
      .from('customers')
      .select('id, am_customer_id')
      .range(cp * 1000, cp * 1000 + 999);
    if (error) throw new Error(`customers fetch: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const c of data) customerMap[c.am_customer_id] = c.id;
    if (data.length < 1000) break;
    cp++;
  }
  cp = 0;
  while (true) {
    const { data, error } = await supabase
      .from('orders')
      .select('id, apparel_magic_id')
      .range(cp * 1000, cp * 1000 + 999);
    if (error) throw new Error(`orders fetch: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const o of data) orderMap[o.apparel_magic_id] = o.id;
    if (data.length < 1000) break;
    cp++;
  }
  console.log(
    `   ${Object.keys(customerMap).length} customers, ${Object.keys(orderMap).length} orders mapped`
  );
  console.log('');

  let lastId = START_LAST_ID;
  let pageCount = 0;
  let totalInvoices = 0;
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

    const url = `${AM_BASE}/invoices?${params.toString()}`;
    let amResp;
    try {
      amResp = await fetch(url, { method: 'GET', headers: { 'User-Agent': 'AdvanceHQ/deep-sync' } });
    } catch (e) {
      console.error(`✗ AM fetch failed: ${e.message}`);
      console.error(`  Resume with: START_LAST_ID=${lastId} node scripts/deep-sync-invoices.js`);
      throw e;
    }
    if (!amResp.ok) {
      console.error(`✗ AM HTTP ${amResp.status}`);
      console.error(`  Resume with: START_LAST_ID=${lastId} node scripts/deep-sync-invoices.js`);
      throw new Error(`AM HTTP ${amResp.status}`);
    }

    const amData = await amResp.json();
    const arr = Array.isArray(amData.response) ? amData.response : [];
    const totalReported = amData?.meta?.pagination?.total_records;

    if (arr.length === 0) {
      console.log(`📦 Page ${pageCount + 1}: empty — end of data.`);
      break;
    }

    const invRows = arr.map((i) => invoiceToRow(i, customerMap, orderMap));
    if (!DRY_RUN) {
      const { error } = await supabase
        .from('invoices')
        .upsert(invRows, { onConflict: 'apparel_magic_id' });
      if (error) {
        console.error(`✗ invoices upsert failed: ${error.message}`);
        totalErrors += arr.length;
      }
    }

    let pageItemCount = 0;
    if (!DRY_RUN) {
      const amInvIds = arr.map((i) => i.invoice_id);
      const { data: idRows, error: idErr } = await supabase
        .from('invoices')
        .select('id, apparel_magic_id')
        .in('apparel_magic_id', amInvIds);
      if (idErr) {
        console.error(`✗ invoice id fetch failed: ${idErr.message}`);
      } else {
        const idMap = {};
        for (const r of idRows || []) idMap[r.apparel_magic_id] = r.id;

        const itemRows = [];
        for (const inv of arr) {
          const invUuid = idMap[inv.invoice_id];
          if (!invUuid || !Array.isArray(inv.invoice_items)) continue;
          for (const item of inv.invoice_items) {
            itemRows.push(invoiceItemToRow(item, inv, invUuid));
          }
        }

        if (amInvIds.length > 0) {
          const { error: delErr } = await supabase
            .from('invoice_items')
            .delete()
            .in('apparel_magic_invoice_id', amInvIds);
          if (delErr) console.error(`✗ invoice_items delete failed: ${delErr.message}`);
        }

        if (itemRows.length > 0) {
          const CHUNK = 500;
          for (let i = 0; i < itemRows.length; i += CHUNK) {
            const slice = itemRows.slice(i, i + CHUNK);
            const { error: insErr } = await supabase.from('invoice_items').insert(slice);
            if (insErr) {
              console.error(`✗ invoice_items insert failed: ${insErr.message}`);
              totalErrors++;
            }
          }
          pageItemCount = itemRows.length;
        }
      }
    } else {
      for (const inv of arr) {
        if (Array.isArray(inv.invoice_items)) pageItemCount += inv.invoice_items.length;
      }
    }

    totalInvoices += arr.length;
    totalItems += pageItemCount;
    pageCount++;

    const elapsed = Math.round((Date.now() - startTime) / 1000);
    const rate = totalInvoices / Math.max(elapsed, 1);
    const eta =
      totalReported && rate > 0
        ? `~${Math.round((totalReported - totalInvoices) / rate)}s remaining`
        : '';
    const totalStr = totalReported ? `/${totalReported}` : '';
    console.log(
      `📦 Page ${pageCount}: +${arr.length} invoices, +${pageItemCount} items · ` +
        `total ${totalInvoices}${totalStr} · ${elapsed}s · ${rate.toFixed(1)}/sec ${eta}`
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
  console.log(`   Pages processed:   ${pageCount}`);
  console.log(`   Invoices synced:   ${totalInvoices}`);
  console.log(`   Items synced:      ${totalItems}`);
  console.log(`   Errors:            ${totalErrors}`);
  console.log('━'.repeat(60));

  if (!DRY_RUN && syncLogId) {
    await supabase
      .from('sync_log')
      .update({
        status: totalErrors > 0 ? 'completed_with_errors' : 'completed',
        records_processed: totalInvoices,
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
