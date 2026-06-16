#!/usr/bin/env node
/**
 * scripts/deep-sync-purchase-orders.js
 *
 * One-shot bulk backfill of ApparelMagic purchase orders into Supabase.
 * Runs OUTSIDE Next (no Vercel timeout). Batched upserts per AM page.
 *
 *   node scripts/deep-sync-purchase-orders.js
 *
 * Env knobs (optional):
 *   PAGE_SIZE=500        AM page size (10-1000, default 500)
 *   START_LAST_ID=1000   resume from a cursor
 *   DRY_RUN=1            fetch + map but don't write
 *
 * Reads .env.local for NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 * APPARELMAGIC_TOKEN, NEXT_PUBLIC_APPARELMAGIC_URL.
 */
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// ---- load .env.local ----
const envPath = path.join(__dirname, '..', '.env.local');
for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) {
    let v = m[2].trim().replace(/^["']|["']$/g, '');
    if (!(m[1] in process.env)) process.env[m[1]] = v;
  }
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TOKEN = process.env.APPARELMAGIC_TOKEN;
const BASE_URL = process.env.NEXT_PUBLIC_APPARELMAGIC_URL || 'https://advanceapparels.app.apparelmagic.com/api/json';
const PAGE_SIZE = parseInt(process.env.PAGE_SIZE || '500', 10);
const DRY_RUN = process.env.DRY_RUN === '1';

if (!SUPABASE_URL || !SERVICE_KEY || !TOKEN) {
  console.error('Missing env. Need NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, APPARELMAGIC_TOKEN in .env.local');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

const toNum = (v) => { if (v === null || v === undefined || v === '') return null; const n = parseFloat(v); return isNaN(n) ? null : n; };
const toBool = (v) => v === '1' || v === 1 || v === true;
const auth = () => 'time=' + Math.floor(Date.now() / 1000) + '&token=' + TOKEN;

function buildPoRow(po) {
  return {
    apparel_magic_id: po.purchase_order_id,
    vendor_id: po.vendor_id || null, vendor_name: po.vendor_name || null, vendor_po: po.vendor_po || null,
    warehouse_id: po.warehouse_id || null, issue_from_warehouse_id: po.issue_from_warehouse_id || null,
    location_id: po.location_id || null, division_id: po.division_id || null,
    project_id: po.project_id || null, project_number: po.project_number || null,
    process_id: po.process_id || null, process_name: po.process_name || null,
    process_description: po.process_description || null, step_number: po.step_number || null,
    receiving_status: po.receiving_status || null, wms_status: po.wms_status || null,
    order_date: po.date_internal || null, date_start: po.date_start_internal || null,
    date_due: po.date_due_internal || null, date_ex_factory: po.date_ex_factory_internal || null,
    name: po.name || null, address_1: po.address_1 || null, address_2: po.address_2 || null,
    city: po.city || null, state: po.state || null, postal_code: po.postal_code || null,
    country: po.country || null, phone: po.phone || null,
    shipping_name: po.shipping_name || null, shipping_address_1: po.shipping_address_1 || null,
    shipping_address_2: po.shipping_address_2 || null, shipping_city: po.shipping_city || null,
    shipping_state: po.shipping_state || null, shipping_postal_code: po.shipping_postal_code || null,
    shipping_country: po.shipping_country || null, shipping_phone: po.shipping_phone || null,
    shipping_address_override: po.shipping_address_override || null,
    ship_via: po.ship_via || null, shipping_terms_id: po.shipping_terms_id || null,
    shipping_info: po.shipping_info || null, tracking_number: po.tracking_number || null,
    terms_id: po.terms_id || null, notes: po.notes || null, private_notes: po.private_notes || null,
    qty: toNum(po.qty) || 0, qty_open: toNum(po.qty_open) || 0, qty_received: toNum(po.qty_received) || 0,
    qty_cxl: toNum(po.qty_cxl) || 0, qty_in_transit: toNum(po.qty_in_transit) || 0,
    amount: toNum(po.amount) || 0, amount_open: toNum(po.amount_open) || 0, amount_cxl: toNum(po.amount_cxl) || 0,
    amount_subtotal: toNum(po.amount_subtotal) || 0, amount_taxable: toNum(po.amount_taxable) || 0,
    amount_tax: toNum(po.amount_tax) || 0, amount_tax_2: toNum(po.amount_tax_2) || 0,
    amount_tax_total: toNum(po.amount_tax_total) || 0, amount_freight: toNum(po.amount_freight) || 0,
    amount_duty: toNum(po.amount_duty) || 0, amount_other: toNum(po.amount_other) || 0,
    amount_landed_cost_est: toNum(po.amount_landed_cost_est) || 0, override_tax_amount: toNum(po.override_tax_amount) || 0,
    tax_rate: toNum(po.tax_rate) || 0, tax_rate_2: toNum(po.tax_rate_2) || 0,
    tax_first_tax_amount: po.tax_first_tax_amount || null, freight_taxable: po.freight_taxable || null,
    currency_id: po.currency_id || null, currency_name: po.currency_name || null, currency_rate: toNum(po.currency_rate) || 1,
    foreign_amount: toNum(po.foreign_amount) || 0, foreign_amount_open: toNum(po.foreign_amount_open) || 0,
    foreign_amount_subtotal: toNum(po.foreign_amount_subtotal) || 0,
    is_locked: toBool(po.is_locked), is_actualized: toBool(po.is_actualized),
    is_printed: toBool(po.is_printed), is_emailed: toBool(po.is_emailed),
    print_url: po.print_url || null,
    am_creation_time: po.creation_time || null, am_creation_user_name: po.creation_user_name || null,
    am_last_modified_time: po.last_modified_time || null, am_last_modified_command: po.last_modified_command || null,
    am_last_modified_user_id: po.last_modified_user_id || null,
    last_synced_at: new Date().toISOString(),
  };
}

function buildItemRow(item, poUuid, amPoId) {
  return {
    am_item_id: item.id || null, purchase_order_id: poUuid, apparel_magic_po_id: amPoId,
    row_id: item.row_id || null, warehouse_id: item.warehouse_id || null,
    product_id: item.product_id || null, sku_id: item.sku_id || null,
    style_number: item.style_number || null, description: item.description || null,
    attr_2: item.attr_2 || null, attr_3: item.attr_3 || null, size: item.size || null,
    upc: item.upc_display || item.upc || null, sku_alt: item.sku_alt || null, location: item.location || null,
    qty: toNum(item.qty) || 0, qty_open: toNum(item.qty_open) || 0, qty_received: toNum(item.qty_received) || 0,
    qty_cxl: toNum(item.qty_cxl) || 0, qty_in_transit: toNum(item.qty_in_transit) || 0,
    unit_cost: toNum(item.unit_cost) || 0, amount: toNum(item.amount) || 0,
    unit_cost_landed_est: toNum(item.unit_cost_landed_est) || 0, amount_landed_est: toNum(item.amount_landed_est) || 0,
    foreign_amount: toNum(item.foreign_amount) || 0, foreign_amount_landed_est: toNum(item.foreign_amount_landed_est) || 0,
    is_taxable: item.is_taxable !== '0', order_item_id: item.order_item_id || null, prepack_id: item.prepack_id || null,
    date_start: item.date_start_internal || null, date_due: item.date_due_internal || null,
    date_ex_factory: item.date_ex_factory_internal || null,
    weight: toNum(item.weight) || 0, notes: item.notes || null, last_synced_at: new Date().toISOString(),
  };
}

async function main() {
  let lastId = process.env.START_LAST_ID ? parseInt(process.env.START_LAST_ID, 10) : null;
  let page = 0, totalPos = 0, totalItems = 0, errors = 0;
  console.log('Deep-syncing purchase orders' + (DRY_RUN ? ' (DRY RUN)' : '') + ' ...');

  while (true) {
    let url = BASE_URL + '/purchase_orders?' + auth() + '&pagination[page_size]=' + PAGE_SIZE;
    if (lastId !== null) url += '&pagination[last_id]=' + lastId;
    const res = await fetch(url, { headers: { 'User-Agent': 'AdvanceHQ-DeepSync/1.0' } });
    if (!res.ok) { console.error('AM HTTP ' + res.status); break; }
    const data = await res.json();
    if (data?.meta?.errors?.length) { console.error('AM error:', data.meta.errors); break; }
    const rows = Array.isArray(data?.response) ? data.response : [];
    if (rows.length === 0) { console.log('No more POs.'); break; }
    page++;

    if (!DRY_RUN) {
      // 1) upsert headers for this page
      const headerRows = rows.map(buildPoRow);
      const up = await supabase.from('purchase_orders').upsert(headerRows, { onConflict: 'apparel_magic_id' });
      if (up.error) { console.error('header upsert error:', up.error.message); errors++; }

      // 2) map AM po id -> uuid, then replace items per page
      const amIds = rows.map((p) => p.purchase_order_id);
      const idRes = await supabase.from('purchase_orders').select('id, apparel_magic_id').in('apparel_magic_id', amIds);
      const uuidByAm = {};
      (idRes.data || []).forEach((r) => { uuidByAm[String(r.apparel_magic_id)] = r.id; });

      await supabase.from('purchase_order_items').delete().in('apparel_magic_po_id', amIds);
      const itemRows = [];
      for (const po of rows) {
        const poUuid = uuidByAm[String(po.purchase_order_id)];
        if (!poUuid || !Array.isArray(po.purchase_order_items)) continue;
        for (const it of po.purchase_order_items) itemRows.push(buildItemRow(it, poUuid, po.purchase_order_id));
      }
      // insert items in chunks of 500
      for (let i = 0; i < itemRows.length; i += 500) {
        const chunk = itemRows.slice(i, i + 500);
        const ins = await supabase.from('purchase_order_items').insert(chunk);
        if (ins.error) { console.error('item insert error:', ins.error.message); errors++; }
      }
      totalItems += itemRows.length;
    }

    totalPos += rows.length;
    const next = data?.meta?.pagination?.last_id;
    console.log('  page ' + page + ': ' + rows.length + ' POs (total ' + totalPos + ', items ' + totalItems + ', next_last_id ' + next + ')');
    if (next === undefined || next === null || parseInt(String(next), 10) === lastId) break;
    lastId = parseInt(String(next), 10);
  }

  console.log('Done. POs: ' + totalPos + ', items: ' + totalItems + ', errors: ' + errors + (DRY_RUN ? ' (dry run, nothing written)' : ''));
}

main().catch((e) => { console.error(e); process.exit(1); });
