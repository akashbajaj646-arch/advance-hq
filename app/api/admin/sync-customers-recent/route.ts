/**
 * POST /api/admin/sync-customers-recent
 *
 * Frequent customers sync. High-water-mark on am_customer_id + last_id walk.
 * AM customers carry no time_modified field, so no skip-if-unchanged — within
 * the small forward window we update-if-exists / insert-if-new and upsert any
 * customer_locations. Full nightly /api/admin/sync-customers remains the
 * backstop for edits to older customers.
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

async function fetchCustomersAfter(
  lastId: number | null
): Promise<{ rows: any[]; nextLastId: number | null }> {
  const auth = getAuthParams();
  const params = new URLSearchParams({
    time: auth.time,
    token: auth.token,
    'pagination[page_size]': String(PAGE_SIZE),
  });
  if (lastId !== null) params.append('pagination[last_id]', String(lastId));

  const res = await fetch(BASE_URL + '/customers?' + params.toString(), {
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

function buildCustomerRow(customer: any): Record<string, any> {
  return {
    am_customer_id: customer.customer_id,
    customer_name: customer.customer_name || 'Unknown',
    account_number: customer.account_number || null,
    email: customer.email || null,
    phone: customer.phone || null,
    address_1: customer.address_1 || null,
    address_2: customer.address_2 || null,
    city: customer.city || null,
    state: customer.state || null,
    postal_code: customer.postal_code || null,
    country: customer.country || null,
    credit_limit: toNum(customer.credit_limit),
    status: customer.status || null,
    category: customer.category || null,
    terms_id: customer.terms_id || null,
    division_id: customer.division_id || null,
    price_group: customer.price_group || null,
    notes: customer.notes || null,
    is_active: customer.is_active === '1' || customer.is_active === true,
    date_created: customer.date_created || null,
    first_name: customer.first_name || null,
    last_name: customer.last_name || null,
    website: customer.website || null,
    shipping_info: customer.shipping_info || null,
    pct_discount: toNum(customer.pct_discount) || 0,
    royalty_rate: customer.royalty_rate || null,
    buyer_filter: customer.buyer_filter || null,
    edi_department: customer.edi_department || null,
    anet_id: customer.anet_id || null,
    currency_id: customer.currency_id || null,
    ar_acct: customer.ar_acct || null,
    shopify_id: customer.shopify_id || null,
    xero_id: customer.xero_id || null,
    xero_synced: customer.xero_synced || '0',
    quickbooks_id: customer.quickbooks_id || null,
    salespeople: customer.salespeople || null,
    last_synced_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

export async function POST(_request: Request) {
  const startTime = Date.now();

  const logInsert = await supabase
    .from('sync_log')
    .insert({ sync_type: 'customers_recent', source: 'apparel_magic', status: 'started' })
    .select()
    .single();
  const syncLogId = logInsert.data ? logInsert.data.id : null;

  try {
    const maxIdRes = await supabase
      .from('customers')
      .select('am_customer_id')
      .order('am_customer_id', { ascending: false })
      .limit(1)
      .maybeSingle();
    const maxIdInDb = maxIdRes.data ? parseInt(String(maxIdRes.data.am_customer_id), 10) : 0;
    const startCursor = maxIdInDb > 0 ? maxIdInDb - 1 : null;

    let scanned = 0, created = 0, updated = 0, errors = 0, pagesFetched = 0;
    let cursor: number | null = startCursor;
    let bailReason = '';
    let firstError: string | null = null;

    while (pagesFetched < MAX_PAGES) {
      if (Date.now() - startTime > MAX_DURATION_MS) { bailReason = 'time-budget'; break; }
      const { rows, nextLastId } = await fetchCustomersAfter(cursor);
      pagesFetched++;
      if (rows.length === 0) { bailReason = 'empty-page'; break; }

      const ids = rows.map((c: any) => c.customer_id).filter(Boolean);
      const existingRes = await supabase.from('customers').select('id, am_customer_id').in('am_customer_id', ids);
      const existingMap: Record<string, string> = {};
      (existingRes.data || []).forEach((r: any) => { existingMap[String(r.am_customer_id)] = r.id; });

      for (const customer of rows) {
        scanned++;
        try {
          const key = String(customer.customer_id);
          const row = buildCustomerRow(customer);
          let customerUuid: string;
          if (key in existingMap) {
            const { error } = await supabase.from('customers').update(row).eq('am_customer_id', customer.customer_id);
            if (error) { errors++; if (!firstError) firstError = 'update customer ' + key + ': ' + error.message; continue; }
            customerUuid = existingMap[key];
            updated++;
          } else {
            const { data: ins, error } = await supabase.from('customers').insert(row).select('id').single();
            if (error || !ins) { errors++; if (!firstError) firstError = 'insert customer ' + key + ': ' + (error ? error.message : 'no row'); continue; }
            customerUuid = ins.id;
            created++;
          }

          if (Array.isArray(customer.locations) && customer.locations.length > 0) {
            for (const loc of customer.locations) {
              const locData: Record<string, any> = {
                am_ship_to_id: loc.ship_to_id || customer.customer_id + '-' + (loc.name || 'main'),
                am_customer_id: customer.customer_id,
                customer_id: customerUuid,
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
              const { error: locErr } = await supabase
                .from('customer_locations')
                .upsert(locData, { onConflict: 'am_ship_to_id' });
              if (locErr && !firstError) firstError = 'location for customer ' + key + ': ' + locErr.message;
            }
          }
        } catch (err) {
          errors++;
          if (!firstError) firstError = 'customer ' + customer.customer_id + ': ' + (err instanceof Error ? err.message : String(err));
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
