#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * scripts/deep-sync-shipments.js
 *
 * Standalone deep sync of shipments from ApparelMagic AND ShipStation.
 *
 * Usage:
 *   cd /Users/Akash/advance-hq
 *   node scripts/deep-sync-shipments.js
 *
 * Optional flags:
 *   SKIP_SHIPSTATION=1     skip the ShipStation pull entirely
 *   DRY_RUN=1              fetch but don't write
 *
 * Notes:
 *
 * 1. Three child tables for AM shipments:
 *      shipment_boxes
 *      shipment_box_items   (children of shipment_boxes)
 *      shipment_pallets
 *    The existing route had a real bug here: it called
 *      .delete().eq('am_box_id', ship.boxes.map(b => b.id))
 *    which passes an array to .eq() — invalid PostgREST syntax. The delete
 *    silently succeeded but matched nothing. This script uses .in() with
 *    the array, which actually works.
 *
 * 2. AHQ-created shipments are safe.
 *    The shipments table now contains rows created by AHQ's COD/sig/Saturday
 *    flow (source='advance_hq', no am_shipment_id, no shipstation_id).
 *    Upserting on am_shipment_id only matches AM-source rows. AHQ rows are
 *    untouched.
 *
 * 3. Conflict keys:
 *      AM source: am_shipment_id
 *      SS source: shipstation_id
 *    These are independent — an AM shipment with shipstation_id set just
 *    gets matched/updated through whichever sync touches it.
 *
 * 4. ShipStation pull stays in for parity with the existing nightly cron.
 *    Set SKIP_SHIPSTATION=1 to skip it once you've fully cut over.
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
const SS_KEY = process.env.SHIPSTATION_API_KEY || '';
const SS_SECRET = process.env.SHIPSTATION_API_SECRET || '';

const PAGE_SIZE = parseInt(process.env.PAGE_SIZE || '200', 10);
const DRY_RUN = process.env.DRY_RUN === '1';
const START_LAST_ID = process.env.START_LAST_ID || null;
const SKIP_SHIPSTATION = process.env.SKIP_SHIPSTATION === '1';

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

function shipmentToRow(ship) {
  return {
    am_shipment_id: ship.id,
    am_customer_id: ship.customer_id || null,
    am_invoice_id: ship.invoice_id || null,
    selected_pick_ticket_ids: ship.selected_pick_ticket_ids || null,
    customer_name: ship.customer_name || null,

    ship_date: parseDate(ship.date) || ship.date_internal || null,
    date_shipped: ship.date_shipped || null,
    date_scheduled_delivery: ship.date_scheduled_delivery || null,

    tracking_number: ship.tracking_number || null,
    bill_of_lading: ship.bill_of_lading || null,
    shipping_approval_number: ship.shipping_approval_number || null,
    itn: ship.itn || null,
    // ship_via column does NOT exist in the shipments table — the existing
    // /api/admin/sync-shipments route sends it too and fails silently in
    // try/catch. We just don't send it. AM's ship_via value is captured
    // upstream on pick_tickets.ship_via if that's needed for reporting.
    pro_number: ship.pro_number || null,

    ship_to_name: ship.name || ship.customer_name || null,
    ship_to_address_1: ship.address_1 || null,
    ship_to_address_2: ship.address_2 || null,
    ship_to_city: ship.city || null,
    ship_to_state: ship.state || null,
    ship_to_zip: ship.postal_code || null,
    ship_to_country: ship.country || null,
    ship_to_id: ship.ship_to_id || null,
    shipping_terms_id: ship.shipping_terms_id || null,
    warehouse_id: ship.warehouse_id || null,

    qty: toNum(ship.qty) || 0,
    qty_boxes: ship.qty_boxes || null,
    qty_pallets: ship.qty_pallets || '0',
    weight: toNum(ship.weight) || 0,
    weight_oz: null,

    amount_freight: toNum(ship.amount_freight) || 0,
    foreign_amount_freight: toNum(ship.foreign_amount_freight) || 0,
    freight_taxable: ship.freight_taxable || '0',
    shipment_cost: toNum(ship.amount_freight) || 0,

    currency_id: ship.currency_id || null,
    currency_rate: toNum(ship.currency_rate) || 1,
    currency_name: ship.currency_name || null,

    void: toBool(ship.void),
    is_locked: toBool(ship.is_locked),
    shipment_status: toBool(ship.void) ? 'voided' : 'shipped',
    notes: ship.notes || null,
    division_name: ship.division_name || null,
    print_url: ship.print_url || null,

    shipstation_id: ship.shipstation_id || null,
    shipstation_synced: ship.shipstation_synced || '0',
    shipstation_connection_id: ship.shipstation_connection_id || null,

    am_creation_time: ship.creation_time || null,
    am_creation_user_id: ship.creation_user_id || null,
    am_creation_user_name: ship.creation_user_name || null,
    am_last_modified_time: ship.last_modified_time || null,
    am_last_modified_command: ship.last_modified_command || null,
    am_last_modified_user_id: ship.last_modified_user_id || null,
    am_last_modified_user_name: ship.last_modified_user_name || null,

    last_synced_at: new Date().toISOString(),
  };
}

function boxToRow(box, shipId) {
  return {
    am_box_id: box.id,
    am_shipment_id: shipId,
    box_number: box.box_number || null,
    qty: toNum(box.qty) || 0,
    ucc: box.ucc || null,
    weight: toNum(box.weight) || 0,
    tare_weight: toNum(box.tare_weight) || 0,
    weight_actual: toNum(box.weight_actual),
    length: toNum(box.length) || 0,
    width: toNum(box.width) || 0,
    height: toNum(box.height) || 0,
    sealed: box.sealed || '0',
    tracking_number: box.tracking_number || null,
    pallet_id: box.pallet_id || null,
    last_synced_at: new Date().toISOString(),
  };
}

function boxItemToRow(bi, boxId) {
  return {
    am_item_id: bi.id || null,
    box_id: null,
    am_box_id: boxId,
    pick_ticket_item_id: bi.pick_ticket_item_id || null,
    pick_ticket_id: bi.pick_ticket_id || null,
    invoice_id: bi.invoice_id || null,
    order_id: bi.order_id || null,
    product_id: bi.product_id || null,
    sku_id: bi.sku_id || null,
    style_number: bi.style_number || null,
    description: bi.description || null,
    attr_2: bi.attr_2 || null,
    attr_3: bi.attr_3 || null,
    size: bi.size || null,
    upc: bi.upc || null,
    qty: toNum(bi.qty) || 0,
    weight: toNum(bi.weight) || 0,
    retailer_sku: bi.retailer_sku || null,
    edi_reference: bi.edi_reference || null,
    mark_for_store: bi.mark_for_store || null,
    group_number: bi.group_number || null,
    last_synced_at: new Date().toISOString(),
  };
}

function palletToRow(pallet, shipId) {
  return {
    am_pallet_id: pallet.id || null,
    am_shipment_id: shipId,
    pallet_number: pallet.pallet_number || null,
    weight: toNum(pallet.weight) || 0,
    tare_weight: toNum(pallet.tare_weight) || 0,
    length: toNum(pallet.length) || 0,
    width: toNum(pallet.width) || 0,
    height: toNum(pallet.height) || 0,
    tracking_number: pallet.tracking_number || null,
    last_synced_at: new Date().toISOString(),
  };
}

function ssShipmentToRow(ss) {
  return {
    shipstation_id: String(ss.shipmentId),
    shipstation_order_id: String(ss.orderId),
    tracking_number: ss.trackingNumber || null,
    carrier_code: ss.carrierCode || null,
    carrier_name: ss.carrierCode || null,
    service_code: ss.serviceCode || null,
    shipment_status: 'shipped',
    ship_date: ss.shipDate || null,
    delivery_date: ss.deliveryDate || null,
    weight_oz: ss.weight?.value || null,
    dimensions_length: ss.dimensions?.length || null,
    dimensions_width: ss.dimensions?.width || null,
    dimensions_height: ss.dimensions?.height || null,
    shipment_cost: toNum(ss.shipmentCost) || 0,
    insurance_cost: toNum(ss.insuranceCost) || 0,
    ship_to_name: ss.shipTo?.name || null,
    ship_to_city: ss.shipTo?.city || null,
    ship_to_state: ss.shipTo?.state || null,
    ship_to_zip: ss.shipTo?.postalCode || null,
    ship_to_country: ss.shipTo?.country || null,
    ship_to_address_1: ss.shipTo?.street1 || null,
    ship_to_address_2: ss.shipTo?.street2 || null,
    tracking_url: ss.trackingNumber
      ? `https://www.google.com/search?q=${ss.trackingNumber}`
      : null,
    pick_ticket_id: ss.orderNumber || null,
    last_synced_at: new Date().toISOString(),
  };
}

// ─── AM SYNC ────────────────────────────────────────────────────────
async function syncAM() {
  console.log('━'.repeat(60));
  console.log('Phase 1 — ApparelMagic shipments');
  console.log('━'.repeat(60));

  let lastId = START_LAST_ID;
  let pageCount = 0;
  let totalShipments = 0;
  let totalBoxes = 0;
  let totalBoxItems = 0;
  let totalPallets = 0;
  let totalErrors = 0;

  const startTime = Date.now();

  while (true) {
    const auth = authParams();
    const params = new URLSearchParams({
      time: auth.time,
      token: auth.token,
      'pagination[page_size]': String(PAGE_SIZE),
    });
    if (lastId) params.append('pagination[last_id]', lastId);

    const url = `${AM_BASE}/shipments?${params.toString()}`;
    let amResp;
    try {
      amResp = await fetch(url, { method: 'GET', headers: { 'User-Agent': 'AdvanceHQ/deep-sync' } });
    } catch (e) {
      console.error(`✗ AM fetch failed: ${e.message}`);
      console.error(`  Resume with: START_LAST_ID=${lastId} node scripts/deep-sync-shipments.js`);
      throw e;
    }
    if (!amResp.ok) {
      console.error(`✗ AM HTTP ${amResp.status}`);
      console.error(`  Resume with: START_LAST_ID=${lastId} node scripts/deep-sync-shipments.js`);
      throw new Error(`AM HTTP ${amResp.status}`);
    }

    const amData = await amResp.json();
    const arr = Array.isArray(amData.response) ? amData.response : [];
    const totalReported = amData?.meta?.pagination?.total_records;

    if (arr.length === 0) {
      console.log(`📦 Page ${pageCount + 1}: empty — end of data.`);
      break;
    }

    // 1. Bulk upsert shipments
    const shipRows = arr.map(shipmentToRow);
    if (!DRY_RUN) {
      const { error } = await supabase
        .from('shipments')
        .upsert(shipRows, { onConflict: 'am_shipment_id' });
      if (error) {
        console.error(`✗ shipments upsert failed: ${error.message}`);
        totalErrors += arr.length;
      }
    }

    // 2. Build child rows for this page
    const shipIds = arr.map((s) => s.id);
    const allBoxRows = [];
    const allBoxItemRows = [];
    const allPalletRows = [];

    for (const ship of arr) {
      if (Array.isArray(ship.boxes)) {
        for (const box of ship.boxes) {
          allBoxRows.push(boxToRow(box, ship.id));
          if (Array.isArray(box.box_items)) {
            for (const bi of box.box_items) {
              allBoxItemRows.push(boxItemToRow(bi, box.id));
            }
          }
        }
      }
      if (Array.isArray(ship.pallets)) {
        for (const p of ship.pallets) {
          allPalletRows.push(palletToRow(p, ship.id));
        }
      }
    }

    if (!DRY_RUN) {
      // 3. Bulk delete + bulk insert boxes (and box_items via FK cascade or
      // explicit delete by am_box_id IN (...) — the existing route has a bug
      // here passing an array to .eq() instead of .in().
      const allBoxIds = [];
      for (const ship of arr) {
        if (Array.isArray(ship.boxes)) {
          for (const box of ship.boxes) allBoxIds.push(box.id);
        }
      }
      if (allBoxIds.length > 0) {
        const { error: delBiErr } = await supabase
          .from('shipment_box_items')
          .delete()
          .in('am_box_id', allBoxIds);
        if (delBiErr) console.error(`✗ shipment_box_items delete failed: ${delBiErr.message}`);
      }
      if (shipIds.length > 0) {
        const { error: delBoxErr } = await supabase
          .from('shipment_boxes')
          .delete()
          .in('am_shipment_id', shipIds);
        if (delBoxErr) console.error(`✗ shipment_boxes delete failed: ${delBoxErr.message}`);

        const { error: delPalletErr } = await supabase
          .from('shipment_pallets')
          .delete()
          .in('am_shipment_id', shipIds);
        if (delPalletErr) console.error(`✗ shipment_pallets delete failed: ${delPalletErr.message}`);
      }

      const CHUNK = 500;
      if (allBoxRows.length > 0) {
        for (let i = 0; i < allBoxRows.length; i += CHUNK) {
          const slice = allBoxRows.slice(i, i + CHUNK);
          const { error: insErr } = await supabase.from('shipment_boxes').insert(slice);
          if (insErr) {
            console.error(`✗ shipment_boxes insert failed: ${insErr.message}`);
            totalErrors++;
          }
        }
      }
      if (allBoxItemRows.length > 0) {
        for (let i = 0; i < allBoxItemRows.length; i += CHUNK) {
          const slice = allBoxItemRows.slice(i, i + CHUNK);
          const { error: insErr } = await supabase.from('shipment_box_items').insert(slice);
          if (insErr) {
            console.error(`✗ shipment_box_items insert failed: ${insErr.message}`);
            totalErrors++;
          }
        }
      }
      if (allPalletRows.length > 0) {
        for (let i = 0; i < allPalletRows.length; i += CHUNK) {
          const slice = allPalletRows.slice(i, i + CHUNK);
          const { error: insErr } = await supabase.from('shipment_pallets').insert(slice);
          if (insErr) {
            console.error(`✗ shipment_pallets insert failed: ${insErr.message}`);
            totalErrors++;
          }
        }
      }
    }

    totalShipments += arr.length;
    totalBoxes += allBoxRows.length;
    totalBoxItems += allBoxItemRows.length;
    totalPallets += allPalletRows.length;
    pageCount++;

    const elapsed = Math.round((Date.now() - startTime) / 1000);
    const rate = totalShipments / Math.max(elapsed, 1);
    const eta =
      totalReported && rate > 0
        ? `~${Math.round((totalReported - totalShipments) / rate)}s remaining`
        : '';
    const totalStr = totalReported ? `/${totalReported}` : '';
    console.log(
      `📦 Page ${pageCount}: +${arr.length} ships, +${allBoxRows.length} boxes, ` +
        `+${allBoxItemRows.length} items, +${allPalletRows.length} pallets · ` +
        `total ${totalShipments}${totalStr} · ${elapsed}s · ${rate.toFixed(1)}/sec ${eta}`
    );

    const nextCursor = amData?.meta?.pagination?.last_id;
    if (!nextCursor) {
      console.log('   (no next cursor — reached end)');
      break;
    }
    lastId = String(nextCursor);
  }

  return { totalShipments, totalBoxes, totalBoxItems, totalPallets, totalErrors };
}

// ─── SHIPSTATION SYNC ───────────────────────────────────────────────
async function syncShipStation() {
  console.log('');
  console.log('━'.repeat(60));
  console.log('Phase 2 — ShipStation shipments');
  console.log('━'.repeat(60));

  if (SKIP_SHIPSTATION) {
    console.log('SKIP_SHIPSTATION=1 — skipping ShipStation pull.');
    return { total: 0, errors: 0 };
  }
  if (!SS_KEY || !SS_SECRET) {
    console.log('No ShipStation credentials — skipping.');
    return { total: 0, errors: 0 };
  }

  const authHeader = 'Basic ' + Buffer.from(`${SS_KEY}:${SS_SECRET}`).toString('base64');
  let page = 1;
  let total = 0;
  let errors = 0;
  const startTime = Date.now();

  while (true) {
    const url = `https://ssapi.shipstation.com/shipments?pageSize=500&page=${page}&sortBy=ShipDate&sortDir=DESC`;
    const resp = await fetch(url, {
      headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
    });
    if (!resp.ok) {
      console.error(`✗ ShipStation HTTP ${resp.status} on page ${page}`);
      break;
    }

    const data = await resp.json();
    const arr = Array.isArray(data.shipments) ? data.shipments : [];

    if (arr.length === 0) {
      console.log(`📦 Page ${page}: empty — end of data.`);
      break;
    }

    const rows = arr.map(ssShipmentToRow);
    if (!DRY_RUN) {
      const { error } = await supabase
        .from('shipments')
        .upsert(rows, { onConflict: 'shipstation_id' });
      if (error) {
        console.error(`✗ ShipStation upsert failed: ${error.message}`);
        errors += arr.length;
      }
    }

    total += arr.length;
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    console.log(`📦 Page ${page}: +${arr.length} SS shipments · total ${total} · ${elapsed}s`);

    if (data.pages && page < data.pages) {
      page++;
    } else {
      break;
    }
  }

  return { total, errors };
}

// ─── MAIN ───────────────────────────────────────────────────────────
async function main() {
  console.log('🔄 Deep sync of shipments (AM + ShipStation)');
  console.log(`   Page size: ${PAGE_SIZE}`);
  console.log(`   Dry run:   ${DRY_RUN ? 'YES (no writes)' : 'no'}`);
  console.log(`   ShipStation: ${SKIP_SHIPSTATION ? 'SKIPPED' : 'enabled'}`);
  if (START_LAST_ID) console.log(`   Resuming AM from last_id: ${START_LAST_ID}`);
  console.log('');

  const startTime = Date.now();

  let syncLogId = null;
  if (!DRY_RUN) {
    const { data: logRow } = await supabase
      .from('sync_log')
      .insert({ sync_type: 'shipments', source: 'apparel_magic_deep_sync', status: 'started' })
      .select()
      .single();
    syncLogId = logRow?.id;
    if (syncLogId) console.log(`   sync_log id: ${syncLogId}`);
    console.log('');
  }

  const am = await syncAM();
  const ss = await syncShipStation();

  const duration = Math.round((Date.now() - startTime) / 1000);
  const totalErrors = am.totalErrors + ss.errors;

  console.log('');
  console.log('━'.repeat(60));
  console.log(`✅ Done in ${duration}s`);
  console.log(`   AM shipments:     ${am.totalShipments}`);
  console.log(`   AM boxes:         ${am.totalBoxes}`);
  console.log(`   AM box items:     ${am.totalBoxItems}`);
  console.log(`   AM pallets:       ${am.totalPallets}`);
  console.log(`   SS shipments:     ${ss.total}`);
  console.log(`   Errors:           ${totalErrors}`);
  console.log('━'.repeat(60));

  if (!DRY_RUN && syncLogId) {
    await supabase
      .from('sync_log')
      .update({
        status: totalErrors > 0 ? 'completed_with_errors' : 'completed',
        records_processed: am.totalShipments + ss.total,
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
