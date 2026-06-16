/**
 * POST /api/admin/sync-invoices-recent
 *
 * Frequent invoices sync. Same high-water-mark + last_id-walk pattern as
 * sync-pick-tickets-recent. AM invoices carry no time_modified field, so we
 * don't skip-if-unchanged — within the small forward window we simply
 * update-if-exists / insert-if-new and refresh invoice_items.
 *
 * Backstop for edits to older invoices: the full nightly /api/admin/sync-invoices.
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
const MAX_DURATION_MS = 50_000;

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
function determinePaymentStatus(balance: number, amountPaid: number, total: number): string {
  if (balance <= 0 || amountPaid >= total) return 'paid';
  if (amountPaid > 0) return 'partial';
  return 'unpaid';
}

async function fetchInvoicesAfter(
  lastId: number | null
): Promise<{ rows: any[]; nextLastId: number | null }> {
  const auth = getAuthParams();
  const params = new URLSearchParams({
    time: auth.time,
    token: auth.token,
    'pagination[page_size]': String(PAGE_SIZE),
  });
  if (lastId !== null) params.append('pagination[last_id]', String(lastId));

  const res = await fetch(BASE_URL + '/invoices?' + params.toString(), {
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

function buildInvoiceRow(
  invoice: any,
  customerMap: Record<string, string>,
  orderMap: Record<string, string>
): Record<string, any> {
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

function buildItemRow(item: any, invoiceUuid: string, amInvoiceId: string): Record<string, any> {
  return {
    am_invoice_item_id: item.id || null,
    invoice_id: invoiceUuid,
    apparel_magic_invoice_id: amInvoiceId,
    order_id: item.order_id || null,
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
    .insert({ sync_type: 'invoices_recent', source: 'apparel_magic', status: 'started' })
    .select()
    .single();
  const syncLogId = logInsert.data ? logInsert.data.id : null;

  try {
    const maxIdInDb = await getMaxNumericId('invoices', 'apparel_magic_id');
    const startCursor = maxIdInDb > 0 ? maxIdInDb - 1 : null;

    const customersRes = await supabase.from('customers').select('id, am_customer_id');
    const ordersRes = await supabase.from('orders').select('id, apparel_magic_id');
    const customerMap: Record<string, string> = {};
    (customersRes.data || []).forEach((c: any) => { if (c.am_customer_id) customerMap[c.am_customer_id] = c.id; });
    const orderMap: Record<string, string> = {};
    (ordersRes.data || []).forEach((o: any) => { if (o.apparel_magic_id) orderMap[o.apparel_magic_id] = o.id; });

    let scanned = 0, created = 0, updated = 0, errors = 0, pagesFetched = 0;
    let cursor: number | null = startCursor;
    let bailReason = '';
    let firstError: string | null = null;

    while (pagesFetched < MAX_PAGES) {
      if (Date.now() - startTime > MAX_DURATION_MS) { bailReason = 'time-budget'; break; }
      const { rows, nextLastId } = await fetchInvoicesAfter(cursor);
      pagesFetched++;
      if (rows.length === 0) { bailReason = 'empty-page'; break; }

      const ids = rows.map((iv: any) => iv.invoice_id).filter(Boolean);
      const existingRes = await supabase.from('invoices').select('id, apparel_magic_id').in('apparel_magic_id', ids);
      const existingMap: Record<string, string> = {};
      (existingRes.data || []).forEach((r: any) => { existingMap[String(r.apparel_magic_id)] = r.id; });

      for (const invoice of rows) {
        scanned++;
        try {
          const key = String(invoice.invoice_id);
          const row = buildInvoiceRow(invoice, customerMap, orderMap);
          let invoiceUuid: string;
          if (key in existingMap) {
            const { error } = await supabase.from('invoices').update(row).eq('apparel_magic_id', invoice.invoice_id);
            if (error) { errors++; if (!firstError) firstError = 'update invoice ' + key + ': ' + error.message; continue; }
            invoiceUuid = existingMap[key];
            updated++;
          } else {
            const { data: ins, error } = await supabase.from('invoices').insert(row).select('id').single();
            if (error || !ins) { errors++; if (!firstError) firstError = 'insert invoice ' + key + ': ' + (error ? error.message : 'no row'); continue; }
            invoiceUuid = ins.id;
            created++;
          }

          if (Array.isArray(invoice.invoice_items) && invoice.invoice_items.length > 0) {
            await supabase.from('invoice_items').delete().eq('apparel_magic_invoice_id', invoice.invoice_id);
            const itemRows = invoice.invoice_items.map((it: any) => buildItemRow(it, invoiceUuid, invoice.invoice_id));
            const { error: itemErr } = await supabase.from('invoice_items').insert(itemRows);
            if (itemErr && !firstError) firstError = 'items for invoice ' + key + ': ' + itemErr.message;
          }
        } catch (err) {
          errors++;
          if (!firstError) firstError = 'invoice ' + invoice.invoice_id + ': ' + (err instanceof Error ? err.message : String(err));
        }
      }

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
      stats: { scanned, created, updated, errors, duration_seconds: duration,
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
