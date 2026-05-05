/**
 * POST /api/admin/sync-pick-tickets-recent
 *
 * Lightweight pick-ticket sync that catches new PTs created in AM since our
 * last sync. Designed to run in <30 seconds and stay under Vercel's 60s
 * cron limit.
 *
 * Strategy:
 *   1. Find the highest pick_ticket_id we already have in Supabase.
 *   2. Use AM's last_id-based pagination to walk forward from that ID.
 *      AM IGNORES page-based pagination silently — last_id is the only
 *      working cursor.
 *   3. Stop when AM returns 0 records, or after MAX_PAGES iterations.
 *   4. For each PT, upsert if missing or modified.
 *
 * Why this works where the prior version didn't:
 *   - Prior version used page-based pagination ('pagination[page]=N').
 *     AM accepts the param but always returns page 1 regardless. That meant
 *     we were scanning the SAME 600 oldest PTs every run, never finding
 *     anything new (everything was already in the DB so 'stopped_early'
 *     fired after 20 unchanged in a row).
 *
 * Trigger sources:
 *   - Cron: every 5 minutes via /api/cron/sync-pick-tickets-recent
 *   - Manual: "Sync Now" button on /shipping/queue
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
// CRITICAL: use service role key, not anon key. Anon key is silently blocked
// by RLS policies on sync_log and pick_tickets, causing writes to vanish.
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  '';
const supabase = createClient(supabaseUrl, supabaseKey);

const APPARELMAGIC_API_TOKEN = process.env.APPARELMAGIC_TOKEN || '';
const BASE_URL =
  process.env.NEXT_PUBLIC_APPARELMAGIC_URL ||
  'https://advanceapparels.app.apparelmagic.com/api/json';

// AM's max page_size is 1000. We use a smaller page so each call is fast.
const PAGE_SIZE = 200;
// Hard cap to avoid runaway loops. 5 pages × 200 = 1000 PTs — way more than
// will accumulate in 5 minutes during normal operation.
const MAX_PAGES = 5;
// Time budget — bail if we exceed this even mid-page.
const MAX_DURATION_MS = 45_000;

function getAuthParams() {
  const time = Math.floor(Date.now() / 1000).toString();
  return { time, token: APPARELMAGIC_API_TOKEN };
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

/**
 * Fetch a page of PTs from AM, walking forward from a cursor.
 * Returns { rows, nextLastId } where nextLastId is the cursor for the next call.
 */
async function fetchPickTicketsAfter(
  lastId: number | null,
  pageSize: number = PAGE_SIZE
): Promise<{ rows: any[]; nextLastId: number | null }> {
  const auth = getAuthParams();
  const params = new URLSearchParams({
    time: auth.time,
    token: auth.token,
    'pagination[page_size]': String(pageSize),
  });
  if (lastId !== null) {
    params.append('pagination[last_id]', String(lastId));
  }
  const url = BASE_URL + '/pick_tickets?' + params.toString();
  const res = await fetch(url, {
    method: 'GET',
    headers: { 'User-Agent': 'AdvanceHQ/1.0' },
  });
  if (!res.ok) throw new Error('AM HTTP ' + res.status);
  const data = await res.json();
  if (data?.meta?.errors && data.meta.errors.length > 0) {
    throw new Error('AM error: ' + JSON.stringify(data.meta.errors));
  }
  const rows = Array.isArray(data?.response) ? data.response : [];
  const nextLastIdRaw = data?.meta?.pagination?.last_id;
  const nextLastId = nextLastIdRaw !== undefined ? parseInt(String(nextLastIdRaw), 10) : null;
  return {
    rows,
    nextLastId: isNaN(nextLastId as any) ? null : nextLastId,
  };
}

function buildPtRow(pt: any, customerMap: Record<string, string>, orderMap: Record<string, string>): Record<string, any> {
  return {
    pick_ticket_id: pt.pick_ticket_id,
    order_id: orderMap[pt.order_id] || null,
    apparel_magic_order_id: pt.order_id,
    customer_id: customerMap[pt.customer_id] || null,
    apparel_magic_customer_id: pt.customer_id,
    invoice_id: pt.invoice_id || null,
    customer_name: pt.customer_name || null,
    account_number: pt.account_number || null,
    customer_po: pt.customer_po || null,
    pick_ticket_date: parseDate(pt.date) || pt.date_internal || null,
    date_start: pt.date_start || null,
    date_due: parseDate(pt.date_due) || pt.date_due_internal || null,
    qty: toNum(pt.qty) || 0,
    subtotal: toNum(pt.amount_subtotal) || toNum(pt.amount) || 0,
    total_amount: toNum(pt.amount) || 0,
    discount_amount: toNum(pt.amount_discount) || 0,
    tax_amount: toNum(pt.amount_tax_total) || 0,
    freight_amount: toNum(pt.amount_freight) || 0,
    ship_to_id: pt.ship_to_id || null,
    ship_to_name: pt.ship_to_name || pt.name || null,
    ship_to_address_1: pt.address_1 || null,
    ship_to_address_2: pt.address_2 || null,
    ship_to_city: pt.city || null,
    ship_to_state: pt.state || null,
    ship_to_zip: pt.postal_code || null,
    ship_to_country: pt.country || null,
    ship_to_phone: pt.phone || null,
    ship_via: pt.ship_via || null,
    tracking_number: pt.tracking_number || null,
    weight: toNum(pt.weight) || 0,
    warehouse_id: pt.warehouse_id || null,
    division_id: pt.division_id || null,
    division_name: pt.division_name || null,
    salesperson: pt.salesperson || null,
    status: pt.status || null,
    notes: pt.notes || null,
    private_notes: pt.private_notes || null,
    is_void: toBool(pt.void),
    is_locked: toBool(pt.is_locked),
    is_printed: toBool(pt.is_printed),
    is_picked: toBool(pt.is_picked),
    wms_status: pt.wms_status || 'pending',
    qty_cartoned: toNum(pt.qty_cartoned) || 0,
    carton_status: pt.carton_status || 'none',
    num_cartons: pt.num_cartons || null,
    am_creation_time: pt.creation_time || null,
    am_last_modified_time: pt.last_modified_time || null,
    last_synced_at: new Date().toISOString(),
  };
}

export async function POST(_request: Request) {
  const startTime = Date.now();

  const logInsert = await supabase
    .from('sync_log')
    .insert({ sync_type: 'pick_tickets_recent', source: 'apparel_magic', status: 'started' })
    .select().single();
  const syncLog = logInsert.data;
  const syncLogId = syncLog ? syncLog.id : null;

  try {
    // Step 1: find our high-water mark — highest pick_ticket_id we already have.
    // We start the AM cursor ONE BELOW that so we re-fetch the highest one
    // (and any modifications to it), plus everything newer.
    const maxIdRes = await supabase
      .from('pick_tickets')
      .select('pick_ticket_id')
      .order('pick_ticket_id', { ascending: false })
      .limit(1)
      .maybeSingle();

    const maxIdInDb = maxIdRes.data
      ? parseInt(String(maxIdRes.data.pick_ticket_id), 10)
      : 0;
    const startCursor = maxIdInDb > 0 ? maxIdInDb - 1 : null;

    // Step 2: pull FK lookup maps
    const customersRes = await supabase.from('customers').select('id, am_customer_id');
    const ordersRes = await supabase.from('orders').select('id, apparel_magic_id');
    const customerMap: Record<string, string> = {};
    (customersRes.data || []).forEach((c: any) => {
      if (c.am_customer_id) customerMap[c.am_customer_id] = c.id;
    });
    const orderMap: Record<string, string> = {};
    (ordersRes.data || []).forEach((o: any) => {
      if (o.apparel_magic_id) orderMap[o.apparel_magic_id] = o.id;
    });

    // Step 3: walk forward from the cursor
    let scanned = 0;
    let created = 0;
    let updated = 0;
    let skipped = 0;
    let errors = 0;
    let pagesFetched = 0;
    let cursor: number | null = startCursor;
    let bailReason = '';

    while (pagesFetched < MAX_PAGES) {
      if (Date.now() - startTime > MAX_DURATION_MS) {
        bailReason = 'time-budget';
        break;
      }
      const { rows, nextLastId } = await fetchPickTicketsAfter(cursor);
      pagesFetched++;
      if (rows.length === 0) {
        bailReason = 'empty-page';
        break;
      }

      // Look up which of these we already have
      const ptIds = rows.map((p: any) => p.pick_ticket_id).filter(Boolean);
      const existingRowsRes = await supabase
        .from('pick_tickets')
        .select('pick_ticket_id, am_last_modified_time')
        .in('pick_ticket_id', ptIds);
      const existingMap: Record<string, string | null> = {};
      (existingRowsRes.data || []).forEach((r: any) => {
        existingMap[String(r.pick_ticket_id)] = r.am_last_modified_time;
      });

      for (const pt of rows) {
        scanned++;
        try {
          const ptId = String(pt.pick_ticket_id);
          const ptExistsInDb = ptId in existingMap;
          const existingMod = existingMap[ptId];
          const incomingMod = pt.last_modified_time || null;
          const sameMod =
            ptExistsInDb &&
            ((existingMod === null && incomingMod === null) ||
              (existingMod !== null &&
                incomingMod !== null &&
                Date.parse(existingMod) === Date.parse(incomingMod)));

          if (sameMod) {
            skipped++;
            continue;
          }

          const row = buildPtRow(pt, customerMap, orderMap);
          if (ptExistsInDb) {
            await supabase
              .from('pick_tickets')
              .update(row)
              .eq('pick_ticket_id', pt.pick_ticket_id);
            updated++;
          } else {
            await supabase.from('pick_tickets').insert(row);
            created++;
          }

          // Item refresh
          if (Array.isArray(pt.pick_ticket_items) && pt.pick_ticket_items.length > 0) {
            await supabase
              .from('pick_ticket_items')
              .delete()
              .eq('pick_ticket_id', pt.pick_ticket_id);
            const itemRows = pt.pick_ticket_items.map((item: any) => ({
              am_item_id: item.id || null,
              pick_ticket_id: pt.pick_ticket_id,
              order_id: item.order_id || pt.order_id || null,
              order_item_id: item.order_item_id || null,
              product_id: item.product_id || null,
              sku_id: item.sku_id || null,
              style_number: item.style_number || null,
              description: item.description || null,
              attr_2: item.attr_2 || null,
              attr_3: item.attr_3 || null,
              size: item.size || null,
              qty: toNum(item.qty) || 0,
              qty_cartoned: toNum(item.qty_cartoned) || 0,
              unit_price: toNum(item.unit_price) || 0,
              amount: toNum(item.amount) || 0,
              warehouse_id: item.warehouse_id || null,
              row_id: item.row_id || null,
              location: item.location || null,
              last_synced_at: new Date().toISOString(),
            }));
            if (itemRows.length > 0) await supabase.from('pick_ticket_items').insert(itemRows);
          }
        } catch (err) {
          console.error(
            '[recent-sync] error on PT',
            pt.pick_ticket_id,
            err instanceof Error ? err.message : err
          );
          errors++;
        }
      }

      // Advance cursor. If AM didn't return a usable next cursor, stop.
      if (nextLastId === null || nextLastId === cursor) {
        bailReason = 'no-cursor-progress';
        break;
      }
      cursor = nextLastId;
    }

    if (!bailReason) bailReason = 'max-pages';

    const duration = Math.round((Date.now() - startTime) / 1000);
    if (syncLogId) {
      await supabase.from('sync_log').update({
        status: 'completed',
        records_processed: scanned,
        records_created: created,
        records_updated: updated,
        errors,
        completed_at: new Date().toISOString(),
        duration_seconds: duration,
      }).eq('id', syncLogId);
    }
    return NextResponse.json({
      success: true,
      stats: {
        scanned, created, updated, skipped, errors,
        duration_seconds: duration,
        pages_fetched: pagesFetched,
        start_cursor: startCursor,
        end_cursor: cursor,
        bail_reason: bailReason,
      },
    });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : 'Unknown error';
    if (syncLogId) {
      await supabase.from('sync_log').update({
        status: 'failed',
        error_details: { message: errMsg },
        completed_at: new Date().toISOString(),
      }).eq('id', syncLogId);
    }
    return NextResponse.json({ success: false, error: errMsg }, { status: 500 });
  }
}
