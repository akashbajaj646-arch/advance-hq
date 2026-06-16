#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * scripts/deep-sync-payments.js
 *
 * Standalone deep sync of payments from ApparelMagic to Supabase.
 * Same architecture as deep-sync-pick-tickets.js — runs locally with no
 * serverless timeout, batches DB writes per AM page for ~100x speedup
 * over the existing /api/admin/sync-payments route.
 *
 * Usage:
 *   cd /Users/Akash/advance-hq
 *   node scripts/deep-sync-payments.js
 *
 * Optional env vars:
 *   PAGE_SIZE=200          how many records per AM page (max 200)
 *   START_LAST_ID=12345    resume from a specific cursor on retry
 *   DRY_RUN=1              fetch from AM but skip Supabase writes
 *
 * Notes:
 *   Payments have no child table, so this is the simplest of the deep-sync
 *   scripts. Conflict key is am_payment_id. Customer FK is looked up from
 *   the existing customers table.
 */

const fs = require('fs');
const path = require('path');

// ─── Tiny dotenv replacement ────────────────────────────────────────
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
  if (typeof dateStr === 'string' && dateStr.includes('-') && dateStr.length === 10) return dateStr;
  const parts = String(dateStr).split('/');
  if (parts.length === 3) {
    return `${parts[2]}-${parts[0].padStart(2, '0')}-${parts[1].padStart(2, '0')}`;
  }
  return dateStr;
}

// ─── Mapping (matches the route) ────────────────────────────────────
function paymentToRow(p, customerMap) {
  return {
    am_payment_id: p.payment_id,
    customer_id: p.customer_id ? customerMap[p.customer_id] || null : null,
    am_customer_id: p.customer_id || null,
    reference: p.reference || null,
    payment_type: p.payment_type || null,
    amount_received: toNum(p.amt_dr) || 0,
    amount_applied: toNum(p.amount_applied) || 0,
    amount_applied_invoice: toNum(p.amount_applied_invoice) || 0,
    amount_applied_cm: toNum(p.amount_applied_cm) || 0,
    amount_unapplied: toNum(p.amount_unapplied) || 0,
    balance: toNum(p.balance) || 0,
    comment: p.comment || p.notes || null,
    payment_date: parseDate(p.date_internal || p.date),
    void: toBool(p.void),
    deposit_id: p.deposit_id || null,
    is_gateway_payment: toBool(p.is_gateway_payment),
    is_posted: toBool(p.is_locked_financial),
    xero_id: p.xero_id || null,
    shopify_id: p.shopify_id || null,
    last_synced_at: new Date().toISOString(),
  };
}

// ─── Main ────────────────────────────────────────────────────────────
async function main() {
  console.log('🔄 Deep sync of payments from ApparelMagic');
  console.log(`   Page size: ${PAGE_SIZE}`);
  console.log(`   Dry run:   ${DRY_RUN ? 'YES (no writes)' : 'no'}`);
  if (START_LAST_ID) console.log(`   Resuming from last_id: ${START_LAST_ID}`);
  console.log('');

  const startTime = Date.now();

  let syncLogId = null;
  if (!DRY_RUN) {
    const { data: logRow } = await supabase
      .from('sync_log')
      .insert({ sync_type: 'payments', source: 'apparel_magic_deep_sync', status: 'started' })
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
  let totalRows = 0;
  let totalErrors = 0;

  while (true) {
    const auth = authParams();
    const params = new URLSearchParams({
      time: auth.time,
      token: auth.token,
      'pagination[page_size]': String(PAGE_SIZE),
    });
    if (lastId) params.append('pagination[last_id]', lastId);

    const url = `${AM_BASE}/payments?${params.toString()}`;
    let amResp;
    try {
      amResp = await fetch(url, { method: 'GET', headers: { 'User-Agent': 'AdvanceHQ/deep-sync' } });
    } catch (e) {
      console.error(`✗ AM fetch failed on page ${pageCount + 1}: ${e.message}`);
      console.error(`  Resume with: START_LAST_ID=${lastId} node scripts/deep-sync-payments.js`);
      throw e;
    }

    if (!amResp.ok) {
      console.error(`✗ AM returned HTTP ${amResp.status} on page ${pageCount + 1}`);
      console.error(`  Resume with: START_LAST_ID=${lastId} node scripts/deep-sync-payments.js`);
      throw new Error(`AM HTTP ${amResp.status}`);
    }

    const amData = await amResp.json();
    const arr = Array.isArray(amData.response) ? amData.response : [];
    const totalReported = amData?.meta?.pagination?.total_records;

    if (arr.length === 0) {
      console.log(`📦 Page ${pageCount + 1}: empty — assuming end of data.`);
      break;
    }

    const rows = arr.map((p) => paymentToRow(p, customerMap));

    if (!DRY_RUN) {
      const { error } = await supabase
        .from('payments')
        .upsert(rows, { onConflict: 'am_payment_id' });
      if (error) {
        console.error(`✗ payments upsert failed on page ${pageCount + 1}: ${error.message}`);
        console.error(`  Resume with: START_LAST_ID=${lastId} node scripts/deep-sync-payments.js`);
        totalErrors += arr.length;
      }
    }

    totalRows += arr.length;
    pageCount++;

    const elapsed = Math.round((Date.now() - startTime) / 1000);
    const rate = totalRows / Math.max(elapsed, 1);
    const eta =
      totalReported && rate > 0
        ? `~${Math.round((totalReported - totalRows) / rate)}s remaining`
        : '';
    const totalStr = totalReported ? `/${totalReported}` : '';
    console.log(
      `📦 Page ${pageCount}: +${arr.length} payments · total ${totalRows}${totalStr} · ` +
        `${elapsed}s elapsed · ${rate.toFixed(1)}/sec ${eta}`
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
  console.log(`   Payments synced: ${totalRows}`);
  console.log(`   Errors:          ${totalErrors}`);
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
