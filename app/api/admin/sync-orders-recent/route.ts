/**
 * POST /api/admin/sync-orders-recent
 *
 * Lightweight, frequent orders sync. Same proven strategy as
 * sync-pick-tickets-recent:
 *
 *   1. Find the highest apparel_magic_id we already have in Supabase.
 *   2. Seed AM's last_id cursor ONE BELOW that and walk forward.
 *      (AM ignores page-based pagination and desc ordering — last_id is the
 *       only cursor that actually advances. Walking forward from our
 *       high-water mark fetches only NEW orders, so each run is tiny.)
 *   3. For each order: skip if AM's time_modified is unchanged, else
 *      update-if-exists / insert-if-new, then refresh its order_items.
 *   4. Stop on empty page, no cursor progress, MAX_PAGES, or time budget.
 *
 * Runs in a few seconds in steady state. Triggered every few minutes by
 * /api/cron/sync-orders-recent and by the manual "Sync Now" button.
 *
 * NOTE: high-water-mark-forward catches all NEW orders and edits to the very
 * newest. Edits to older orders are picked up by the full nightly sync
 * (/api/admin/sync-orders), which remains the backstop.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
// CRITICAL: service role key, not anon. Anon is silently blocked by RLS.
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

async function fetchOrdersAfter(
  lastId: number | null
): Promise<{ rows: any[]; nextLastId: number | null }> {
  const auth = getAuthParams();
  const params = new URLSearchParams({
    time: auth.time,
    token: auth.token,
    'pagination[page_size]': String(PAGE_SIZE),
  });
  if (lastId !== null) params.append('pagination[last_id]', String(lastId));

  const res = await fetch(BASE_URL + '/orders?' + params.toString(), {
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

function buildOrderRow(order: any, customerMap: Record<string, string>): Record<string, any> {
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
    am_last_modified_time: order.time_modified ? new Date(order.time_modified * 1000).toISOString() : null,
    am_time_modified: order.time_modified || null,
    last_synced_at: new Date().toISOString(),
  };
}

function buildItemRow(item: any, orderUuid: string, amOrderId: string): Record<string, any> {
  return {
    apparel_magic_id: item.id,
    order_id: orderUuid,
    apparel_magic_order_id: amOrderId,
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
    .insert({ sync_type: 'orders_recent', source: 'apparel_magic', status: 'started' })
    .select()
    .single();
  const syncLogId = logInsert.data ? logInsert.data.id : null;

  try {
    // High-water mark
    const maxIdInDb = await getMaxNumericId('orders', 'apparel_magic_id');
    const startCursor = maxIdInDb > 0 ? maxIdInDb - 1 : null;

    // FK map
    const customersRes = await supabase.from('customers').select('id, am_customer_id');
    const customerMap: Record<string, string> = {};
    (customersRes.data || []).forEach((c: any) => {
      if (c.am_customer_id) customerMap[c.am_customer_id] = c.id;
    });

    let scanned = 0, created = 0, updated = 0, skipped = 0, errors = 0, pagesFetched = 0;
    let cursor: number | null = startCursor;
    let bailReason = '';
    let firstError: string | null = null;

    while (pagesFetched < MAX_PAGES) {
      if (Date.now() - startTime > MAX_DURATION_MS) { bailReason = 'time-budget'; break; }
      const { rows, nextLastId } = await fetchOrdersAfter(cursor);
      pagesFetched++;
      if (rows.length === 0) { bailReason = 'empty-page'; break; }

      const ids = rows.map((o: any) => o.order_id).filter(Boolean);
      const existingRes = await supabase
        .from('orders')
        .select('id, apparel_magic_id, am_time_modified')
        .in('apparel_magic_id', ids);
      const existingMap: Record<string, { id: string; mod: any }> = {};
      (existingRes.data || []).forEach((r: any) => {
        existingMap[String(r.apparel_magic_id)] = { id: r.id, mod: r.am_time_modified };
      });

      for (const order of rows) {
        if (Date.now() - startTime > MAX_DURATION_MS) { bailReason = 'time-budget'; break; }
        scanned++;
        try {
          const key = String(order.order_id);
          const existing = existingMap[key];
          const incomingMod = order.time_modified != null ? Number(order.time_modified) : null;
          const existingMod = existing && existing.mod != null ? Number(existing.mod) : null;
          if (existing && incomingMod !== null && existingMod !== null && incomingMod === existingMod) {
            skipped++;
            continue;
          }

          const row = buildOrderRow(order, customerMap);
          let orderUuid: string;
          if (existing) {
            const { error } = await supabase.from('orders').update(row).eq('apparel_magic_id', order.order_id);
            if (error) { errors++; if (!firstError) firstError = 'update order ' + key + ': ' + error.message; continue; }
            orderUuid = existing.id;
            updated++;
          } else {
            const ins = await supabase.from('orders').insert(row).select('id').single();
            if (ins.error) {
              if (ins.error.code === '23505') {
                // Raced a concurrent run; the row exists now -> update instead of erroring.
                await supabase.from('orders').update(row).eq('apparel_magic_id', order.order_id);
                const back = await supabase.from('orders').select('id').eq('apparel_magic_id', order.order_id).single();
                if (!back.data) { errors++; if (!firstError) firstError = 'post-dup order ' + key; continue; }
                orderUuid = back.data.id;
                updated++;
              } else {
                errors++; if (!firstError) firstError = 'insert order ' + key + ': ' + ins.error.message; continue;
              }
            } else if (!ins.data) {
              errors++; if (!firstError) firstError = 'insert order ' + key + ': no row'; continue;
            } else {
              orderUuid = ins.data.id;
              created++;
            }
          }

          if (Array.isArray(order.order_items) && order.order_items.length > 0) {
            await supabase.from('order_items').delete().eq('apparel_magic_order_id', order.order_id);
            const itemRows = order.order_items.map((it: any) => buildItemRow(it, orderUuid, order.order_id));
            const { error: itemErr } = await supabase.from('order_items').insert(itemRows);
            if (itemErr && !firstError) firstError = 'items for order ' + key + ': ' + itemErr.message;
          }
        } catch (err) {
          errors++;
          if (!firstError) firstError = 'order ' + order.order_id + ': ' + (err instanceof Error ? err.message : String(err));
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
