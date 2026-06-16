/**
 * POST /api/admin/sync-shipments-recent
 *
 * Frequent ApparelMagic shipments sync. High-water-mark on am_shipment_id +
 * last_id walk + skip-if-unchanged via AM last_modified_time. Refreshes
 * shipment_boxes / shipment_box_items / shipment_pallets per shipment.
 *
 * This route syncs ApparelMagic shipments only (not ShipStation — that path
 * is being retired and uses separate credentials).
 *
 * ⚠️ KNOWN SCHEMA DRIFT: the full shipments sync has historically failed
 * silently on every row because the mapper references a `ship_via` column and
 * relies on a unique index on am_shipment_id that may not exist. This route
 * does NOT use upsert (so it doesn't need the unique index), and it surfaces
 * the first DB error into sync_log.first_error instead of swallowing it. If
 * you see `first_error` mention `ship_via` (or any column), reconcile the
 * shipments table schema, then this route will sync cleanly.
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
const MAX_PAGES = 3;
const MAX_DURATION_MS = 45_000;

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
function parseDate(dateStr: string | null): string | null {
  if (!dateStr) return null;
  const parts = dateStr.split('/');
  if (parts.length === 3) {
    return parts[2] + '-' + parts[0].padStart(2, '0') + '-' + parts[1].padStart(2, '0');
  }
  return dateStr;
}

async function fetchShipmentsAfter(
  lastId: number | null
): Promise<{ rows: any[]; nextLastId: number | null }> {
  const auth = getAuthParams();
  const params = new URLSearchParams({
    time: auth.time,
    token: auth.token,
    'pagination[page_size]': String(PAGE_SIZE),
  });
  if (lastId !== null) params.append('pagination[last_id]', String(lastId));

  const res = await fetch(BASE_URL + '/shipments?' + params.toString(), {
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

function buildShipmentRow(ship: any): Record<string, any> {
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
    // ship_via: dropped -- column does not exist in shipments schema (AM ship_via has no native equivalent)
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

async function getMaxNumericId(table: string, col: string): Promise<number> {
  // Primary: true numeric max via RPC. AM id columns are stored as text, so a
  // plain `.order(col, desc)` returns the LEXICOGRAPHIC max ("9999" > "10416"),
  // which seeds the cursor too low and re-scans rows we already have.
  const rpc = await supabase.rpc('max_numeric_id', { tbl: table, col });
  if (!rpc.error && rpc.data !== null && rpc.data !== undefined) {
    const n = parseInt(String(rpc.data), 10);
    if (!isNaN(n)) return n;
  }
  // Fallback if the RPC isn't installed yet -- degrades to old behavior, no crash.
  const res = await supabase.from(table).select(col).order(col, { ascending: false }).limit(1).maybeSingle();
  const v = res.data ? (res.data as any)[col] : null;
  const n = v != null ? parseInt(String(v), 10) : 0;
  return isNaN(n) ? 0 : n;
}

export async function POST(_request: Request) {
  const startTime = Date.now();

  const logInsert = await supabase
    .from('sync_log')
    .insert({ sync_type: 'shipments_recent', source: 'apparel_magic', status: 'started' })
    .select()
    .single();
  const syncLogId = logInsert.data ? logInsert.data.id : null;

  try {
    const maxIdInDb = await getMaxNumericId('shipments', 'am_shipment_id');
    const startCursor = maxIdInDb > 0 ? maxIdInDb - 1 : null;

    let scanned = 0, created = 0, updated = 0, skipped = 0, errors = 0;
    let boxes = 0, boxItems = 0, pagesFetched = 0;
    let cursor: number | null = startCursor;
    let bailReason = '';
    let firstError: string | null = null;

    while (pagesFetched < MAX_PAGES) {
      if (Date.now() - startTime > MAX_DURATION_MS) { bailReason = 'time-budget'; break; }
      const { rows, nextLastId } = await fetchShipmentsAfter(cursor);
      pagesFetched++;
      if (rows.length === 0) { bailReason = 'empty-page'; break; }

      const ids = rows.map((s: any) => s.id).filter(Boolean);
      const existingRes = await supabase
        .from('shipments')
        .select('id, am_shipment_id, am_last_modified_time')
        .in('am_shipment_id', ids);
      const existingMap: Record<string, { id: string; mod: string | null }> = {};
      (existingRes.data || []).forEach((r: any) => {
        existingMap[String(r.am_shipment_id)] = { id: r.id, mod: r.am_last_modified_time };
      });

      for (const ship of rows) {
        if (Date.now() - startTime > MAX_DURATION_MS) { bailReason = 'time-budget'; break; }
        scanned++;
        try {
          const key = String(ship.id);
          const existing = existingMap[key];
          const incomingMod = ship.last_modified_time || null;
          const existingMod = existing ? existing.mod : undefined;
          const sameMod =
            existing &&
            ((existingMod === null && incomingMod === null) ||
              (existingMod != null && incomingMod != null && Date.parse(existingMod) === Date.parse(incomingMod)));
          if (sameMod) { skipped++; continue; }

          const row = buildShipmentRow(ship);
          if (existing) {
            const { error } = await supabase.from('shipments').update(row).eq('am_shipment_id', ship.id);
            if (error) { errors++; if (!firstError) firstError = 'update shipment ' + key + ': ' + error.message; continue; }
            updated++;
          } else {
            const insRes = await supabase.from('shipments').insert(row);
            if (insRes.error) {
              if (insRes.error.code === '23505') {
                await supabase.from('shipments').update(row).eq('am_shipment_id', ship.id);
                updated++;
              } else {
                errors++; if (!firstError) firstError = 'insert shipment ' + key + ': ' + insRes.error.message; continue;
              }
            } else {
              created++;
            }
          }

          // Refresh boxes + box items
          if (Array.isArray(ship.boxes) && ship.boxes.length > 0) {
            await supabase.from('shipment_boxes').delete().eq('am_shipment_id', ship.id);
            for (const box of ship.boxes) {
              await supabase.from('shipment_box_items').delete().eq('am_box_id', box.id);
              const { error: boxErr } = await supabase.from('shipment_boxes').insert({
                am_box_id: box.id,
                am_shipment_id: ship.id,
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
              });
              if (boxErr) { if (!firstError) firstError = 'box for shipment ' + key + ': ' + boxErr.message; continue; }
              boxes++;
              if (Array.isArray(box.box_items)) {
                const biRows = box.box_items.map((bi: any) => ({
                  am_item_id: bi.id || null,
                  box_id: null,
                  am_box_id: box.id,
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
                }));
                if (biRows.length > 0) {
                  const { error: biErr } = await supabase.from('shipment_box_items').insert(biRows);
                  if (biErr && !firstError) firstError = 'box items for shipment ' + key + ': ' + biErr.message;
                  else boxItems += biRows.length;
                }
              }
            }
          }

          // Refresh pallets
          if (Array.isArray(ship.pallets) && ship.pallets.length > 0) {
            await supabase.from('shipment_pallets').delete().eq('am_shipment_id', ship.id);
            const palletRows = ship.pallets.map((pallet: any) => ({
              am_pallet_id: pallet.id || null,
              am_shipment_id: ship.id,
              pallet_number: pallet.pallet_number || null,
              weight: toNum(pallet.weight) || 0,
              tare_weight: toNum(pallet.tare_weight) || 0,
              length: toNum(pallet.length) || 0,
              width: toNum(pallet.width) || 0,
              height: toNum(pallet.height) || 0,
              tracking_number: pallet.tracking_number || null,
              last_synced_at: new Date().toISOString(),
            }));
            const { error: palErr } = await supabase.from('shipment_pallets').insert(palletRows);
            if (palErr && !firstError) firstError = 'pallets for shipment ' + key + ': ' + palErr.message;
          }
        } catch (err) {
          errors++;
          if (!firstError) firstError = 'shipment ' + ship.id + ': ' + (err instanceof Error ? err.message : String(err));
        }
      }

      if (bailReason === 'time-budget') break;
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
        error_details: firstError ? { first_error: firstError } : null,
      }).eq('id', syncLogId);
    }
    return NextResponse.json({
      success: true,
      stats: { scanned, created, updated, skipped, boxes, box_items: boxItems, errors,
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
