/**
 * POST /api/admin/sync-purchase-orders-recent
 *
 * Frequent purchase-orders sync, same proven pattern as the other recent routes:
 * numeric high-water-mark on apparel_magic_id -> AM last_id walk -> skip-if-unchanged
 * via last_modified_time -> update-or-insert (dup-key handled) -> refresh nested
 * purchase_order_items -> bail on empty/no-progress/max-pages/time-budget.
 *
 * Line items come nested in the AM response (`purchase_order_items`), so no
 * per-PO sub-call is needed. For the initial bulk load use
 * scripts/deep-sync-purchase-orders.js (no Vercel timeout). The full nightly path
 * (this route via cron) is the steady-state maintainer + the backstop for edits
 * to the newest POs.
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

async function getMaxNumericId(table: string, col: string): Promise<number> {
  const rpc = await supabase.rpc('max_numeric_id', { tbl: table, col });
  if (!rpc.error && rpc.data !== null && rpc.data !== undefined) {
    const n = parseInt(String(rpc.data), 10);
    if (!isNaN(n)) return n;
  }
  const res = await supabase.from(table).select(col).order(col, { ascending: false }).limit(1).maybeSingle();
  const v = res.data ? (res.data as any)[col] : null;
  const n = v != null ? parseInt(String(v), 10) : 0;
  return isNaN(n) ? 0 : n;
}

async function fetchPosAfter(
  lastId: number | null
): Promise<{ rows: any[]; nextLastId: number | null }> {
  const auth = getAuthParams();
  const params = new URLSearchParams({
    time: auth.time,
    token: auth.token,
    'pagination[page_size]': String(PAGE_SIZE),
  });
  if (lastId !== null) params.append('pagination[last_id]', String(lastId));

  const res = await fetch(BASE_URL + '/purchase_orders?' + params.toString(), {
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

function buildPoRow(po: any): Record<string, any> {
  return {
    apparel_magic_id: po.purchase_order_id,
    vendor_id: po.vendor_id || null,
    vendor_name: po.vendor_name || null,
    vendor_po: po.vendor_po || null,
    warehouse_id: po.warehouse_id || null,
    issue_from_warehouse_id: po.issue_from_warehouse_id || null,
    location_id: po.location_id || null,
    division_id: po.division_id || null,
    project_id: po.project_id || null,
    project_number: po.project_number || null,
    process_id: po.process_id || null,
    process_name: po.process_name || null,
    process_description: po.process_description || null,
    step_number: po.step_number || null,
    receiving_status: po.receiving_status || null,
    wms_status: po.wms_status || null,
    order_date: po.date_internal || null,
    date_start: po.date_start_internal || null,
    date_due: po.date_due_internal || null,
    date_ex_factory: po.date_ex_factory_internal || null,
    name: po.name || null,
    address_1: po.address_1 || null,
    address_2: po.address_2 || null,
    city: po.city || null,
    state: po.state || null,
    postal_code: po.postal_code || null,
    country: po.country || null,
    phone: po.phone || null,
    shipping_name: po.shipping_name || null,
    shipping_address_1: po.shipping_address_1 || null,
    shipping_address_2: po.shipping_address_2 || null,
    shipping_city: po.shipping_city || null,
    shipping_state: po.shipping_state || null,
    shipping_postal_code: po.shipping_postal_code || null,
    shipping_country: po.shipping_country || null,
    shipping_phone: po.shipping_phone || null,
    shipping_address_override: po.shipping_address_override || null,
    ship_via: po.ship_via || null,
    shipping_terms_id: po.shipping_terms_id || null,
    shipping_info: po.shipping_info || null,
    tracking_number: po.tracking_number || null,
    terms_id: po.terms_id || null,
    notes: po.notes || null,
    private_notes: po.private_notes || null,
    qty: toNum(po.qty) || 0,
    qty_open: toNum(po.qty_open) || 0,
    qty_received: toNum(po.qty_received) || 0,
    qty_cxl: toNum(po.qty_cxl) || 0,
    qty_in_transit: toNum(po.qty_in_transit) || 0,
    amount: toNum(po.amount) || 0,
    amount_open: toNum(po.amount_open) || 0,
    amount_cxl: toNum(po.amount_cxl) || 0,
    amount_subtotal: toNum(po.amount_subtotal) || 0,
    amount_taxable: toNum(po.amount_taxable) || 0,
    amount_tax: toNum(po.amount_tax) || 0,
    amount_tax_2: toNum(po.amount_tax_2) || 0,
    amount_tax_total: toNum(po.amount_tax_total) || 0,
    amount_freight: toNum(po.amount_freight) || 0,
    amount_duty: toNum(po.amount_duty) || 0,
    amount_other: toNum(po.amount_other) || 0,
    amount_landed_cost_est: toNum(po.amount_landed_cost_est) || 0,
    override_tax_amount: toNum(po.override_tax_amount) || 0,
    tax_rate: toNum(po.tax_rate) || 0,
    tax_rate_2: toNum(po.tax_rate_2) || 0,
    tax_first_tax_amount: po.tax_first_tax_amount || null,
    freight_taxable: po.freight_taxable || null,
    currency_id: po.currency_id || null,
    currency_name: po.currency_name || null,
    currency_rate: toNum(po.currency_rate) || 1,
    foreign_amount: toNum(po.foreign_amount) || 0,
    foreign_amount_open: toNum(po.foreign_amount_open) || 0,
    foreign_amount_subtotal: toNum(po.foreign_amount_subtotal) || 0,
    is_locked: toBool(po.is_locked),
    is_actualized: toBool(po.is_actualized),
    is_printed: toBool(po.is_printed),
    is_emailed: toBool(po.is_emailed),
    print_url: po.print_url || null,
    am_creation_time: po.creation_time || null,
    am_creation_user_name: po.creation_user_name || null,
    am_last_modified_time: po.last_modified_time || null,
    am_last_modified_command: po.last_modified_command || null,
    am_last_modified_user_id: po.last_modified_user_id || null,
    last_synced_at: new Date().toISOString(),
  };
}

function buildItemRow(item: any, poUuid: string, amPoId: string): Record<string, any> {
  return {
    am_item_id: item.id || null,
    purchase_order_id: poUuid,
    apparel_magic_po_id: amPoId,
    row_id: item.row_id || null,
    warehouse_id: item.warehouse_id || null,
    product_id: item.product_id || null,
    sku_id: item.sku_id || null,
    style_number: item.style_number || null,
    description: item.description || null,
    attr_2: item.attr_2 || null,
    attr_3: item.attr_3 || null,
    size: item.size || null,
    upc: item.upc_display || item.upc || null,
    sku_alt: item.sku_alt || null,
    location: item.location || null,
    qty: toNum(item.qty) || 0,
    qty_open: toNum(item.qty_open) || 0,
    qty_received: toNum(item.qty_received) || 0,
    qty_cxl: toNum(item.qty_cxl) || 0,
    qty_in_transit: toNum(item.qty_in_transit) || 0,
    unit_cost: toNum(item.unit_cost) || 0,
    amount: toNum(item.amount) || 0,
    unit_cost_landed_est: toNum(item.unit_cost_landed_est) || 0,
    amount_landed_est: toNum(item.amount_landed_est) || 0,
    foreign_amount: toNum(item.foreign_amount) || 0,
    foreign_amount_landed_est: toNum(item.foreign_amount_landed_est) || 0,
    is_taxable: item.is_taxable !== '0',
    order_item_id: item.order_item_id || null,
    prepack_id: item.prepack_id || null,
    date_start: item.date_start_internal || null,
    date_due: item.date_due_internal || null,
    date_ex_factory: item.date_ex_factory_internal || null,
    weight: toNum(item.weight) || 0,
    notes: item.notes || null,
    last_synced_at: new Date().toISOString(),
  };
}

export async function POST(_request: Request) {
  const startTime = Date.now();

  const logInsert = await supabase
    .from('sync_log')
    .insert({ sync_type: 'purchase_orders_recent', source: 'apparel_magic', status: 'started' })
    .select()
    .single();
  const syncLogId = logInsert.data ? logInsert.data.id : null;

  try {
    const maxIdInDb = await getMaxNumericId('purchase_orders', 'apparel_magic_id');
    const startCursor = maxIdInDb > 0 ? maxIdInDb - 1 : null;

    let scanned = 0, created = 0, updated = 0, skipped = 0, errors = 0, pagesFetched = 0;
    let cursor: number | null = startCursor;
    let bailReason = '';
    let firstError: string | null = null;

    while (pagesFetched < MAX_PAGES) {
      if (Date.now() - startTime > MAX_DURATION_MS) { bailReason = 'time-budget'; break; }
      const { rows, nextLastId } = await fetchPosAfter(cursor);
      pagesFetched++;
      if (rows.length === 0) { bailReason = 'empty-page'; break; }

      const ids = rows.map((p: any) => p.purchase_order_id).filter(Boolean);
      const existingRes = await supabase
        .from('purchase_orders')
        .select('id, apparel_magic_id, am_last_modified_time')
        .in('apparel_magic_id', ids);
      const existingMap: Record<string, { id: string; mod: string | null }> = {};
      (existingRes.data || []).forEach((r: any) => {
        existingMap[String(r.apparel_magic_id)] = { id: r.id, mod: r.am_last_modified_time };
      });

      for (const po of rows) {
        if (Date.now() - startTime > MAX_DURATION_MS) { bailReason = 'time-budget'; break; }
        scanned++;
        try {
          const key = String(po.purchase_order_id);
          const existing = existingMap[key];
          const incomingMod = po.last_modified_time || null;
          const existingMod = existing ? existing.mod : undefined;
          const sameMod =
            existing &&
            ((existingMod === null && incomingMod === null) ||
              (existingMod != null && incomingMod != null && Date.parse(existingMod) === Date.parse(incomingMod)));
          if (sameMod) { skipped++; continue; }

          const row = buildPoRow(po);
          let poUuid: string;
          if (existing) {
            const { error } = await supabase.from('purchase_orders').update(row).eq('apparel_magic_id', po.purchase_order_id);
            if (error) { errors++; if (!firstError) firstError = 'update po ' + key + ': ' + error.message; continue; }
            poUuid = existing.id;
            updated++;
          } else {
            const ins = await supabase.from('purchase_orders').insert(row).select('id').single();
            if (ins.error) {
              if (ins.error.code === '23505') {
                await supabase.from('purchase_orders').update(row).eq('apparel_magic_id', po.purchase_order_id);
                const back = await supabase.from('purchase_orders').select('id').eq('apparel_magic_id', po.purchase_order_id).single();
                if (!back.data) { errors++; if (!firstError) firstError = 'post-dup po ' + key; continue; }
                poUuid = back.data.id;
                updated++;
              } else {
                errors++; if (!firstError) firstError = 'insert po ' + key + ': ' + ins.error.message; continue;
              }
            } else if (!ins.data) {
              errors++; if (!firstError) firstError = 'insert po ' + key + ': no row'; continue;
            } else {
              poUuid = ins.data.id;
              created++;
            }
          }

          if (Array.isArray(po.purchase_order_items) && po.purchase_order_items.length > 0) {
            await supabase.from('purchase_order_items').delete().eq('apparel_magic_po_id', po.purchase_order_id);
            const itemRows = po.purchase_order_items.map((it: any) => buildItemRow(it, poUuid, po.purchase_order_id));
            const { error: itemErr } = await supabase.from('purchase_order_items').insert(itemRows);
            if (itemErr && !firstError) firstError = 'items for po ' + key + ': ' + itemErr.message;
          }
        } catch (err) {
          errors++;
          if (!firstError) firstError = 'po ' + po.purchase_order_id + ': ' + (err instanceof Error ? err.message : String(err));
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
      stats: { scanned, created, updated, skipped, errors, duration_seconds: duration,
        pages_fetched: pagesFetched, start_cursor: startCursor, end_cursor: cursor,
        bail_reason: bailReason, first_error: firstError },
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
