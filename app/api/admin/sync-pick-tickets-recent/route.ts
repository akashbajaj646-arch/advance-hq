/**
 * POST /api/admin/sync-pick-tickets-recent
 *
 * Lightweight pick-ticket sync for keeping the shipping queue fresh during
 * the workday. Unlike sync-pick-tickets (full sync, ~14 hours, 90k+ records),
 * this one:
 *
 *   - Fetches at most a few hundred recent PTs from ApparelMagic
 *   - Stops as soon as it finds a PT that's already in our DB AND is
 *     unchanged (same am_last_modified_time)
 *   - Designed to run in 5–15 seconds, well under any function timeout
 *
 * Trigger sources:
 *   - Cron: every 5 minutes via /api/cron/sync-pick-tickets-recent
 *   - Manual: "Sync Now" button on /shipping/queue
 *
 * Notes on AM API constraints:
 *   - ApparelMagic does NOT support filter[time_modified][gt] for incremental
 *     sync. We can't ask "what changed since 5 minutes ago."
 *   - AM pagination is oldest-first by default. To get newest-first, we set
 *     pagination[offset] far enough into the list to skip to the end and
 *     work backwards. Total PT count is unknown ahead of time, so we do a
 *     small first request to find total, then page from the end.
 *
 * What "recent" means here:
 *   - We pull the last MAX_PAGES × PAGE_SIZE PTs from AM (newest-first
 *     order, achieved via reverse pagination).
 *   - Default: 3 pages × 200 = up to 600 PTs.
 *   - Stops early as soon as we find a PT we already have with the same
 *     am_last_modified_time, because everything below is older and unchanged.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

const APPARELMAGIC_API_TOKEN = process.env.APPARELMAGIC_TOKEN || '';
const BASE_URL =
  process.env.NEXT_PUBLIC_APPARELMAGIC_URL ||
  'https://advanceapparels.app.apparelmagic.com/api/json';

const PAGE_SIZE = 200;
const MAX_PAGES = 3; // up to 600 PTs per run

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
    return `${parts[2]}-${parts[0].padStart(2, '0')}-${parts[1].padStart(2, '0')}`;
  }
  return dateStr;
}

/**
 * Fetch the count of PTs in AM. Returns null if the response shape doesn't
 * include a total — we'll fall back to a smaller approach in that case.
 */
async function fetchLastPageNumber(): Promise<number> {
  // We probe with the smallest valid page_size (10, AM minimum) to get
  // pagination metadata without pulling extra data. AM returns total_pages
  // directly, so no division needed.
  const auth = getAuthParams();
  const params = new URLSearchParams({
    time: auth.time,
    token: auth.token,
    'pagination[page_size]': String(PAGE_SIZE),
    'pagination[page]': '1',
  });
  const url = `${BASE_URL}/pick_tickets?${params.toString()}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: { 'User-Agent': 'AdvanceHQ/1.0' },
  });
  if (!res.ok) throw new Error(`AM probe HTTP ${res.status}`);
  const data = await res.json();
  const totalPages = data?.meta?.pagination?.total_pages;
  if (typeof totalPages === 'number' && totalPages > 0) return totalPages;
  if (typeof totalPages === 'string') {
    const n = parseInt(totalPages, 10);
    if (n > 0) return n;
  }
  // Fallback: try total_records / PAGE_SIZE
  const totalRecords = data?.meta?.pagination?.total_records;
  if (typeof totalRecords === 'number' && totalRecords > 0) {
    return Math.max(1, Math.ceil(totalRecords / PAGE_SIZE));
  }
  if (typeof totalRecords === 'string') {
    const n = parseInt(totalRecords, 10);
    if (n > 0) return Math.max(1, Math.ceil(n / PAGE_SIZE));
  }
  throw new Error('AM did not return total_pages or total_records');
}

/**
 * Fetch a specific page (1-indexed) of PTs from AM. Uses page-based
 * pagination so we can jump directly to the last page (newest records).
 */
async function fetchPickTicketsPage(
  pageNum: number,
  pageSize: number = PAGE_SIZE
): Promise<any[]> {
  const auth = getAuthParams();
  const params = new URLSearchParams({
    time: auth.time,
    token: auth.token,
    'pagination[page_size]': String(pageSize),
    'pagination[page]': String(pageNum),
  });
  const url = `${BASE_URL}/pick_tickets?${params.toString()}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: { 'User-Agent': 'AdvanceHQ/1.0' },
  });
  if (!res.ok) throw new Error(`AM page ${pageNum} HTTP ${res.status}`);
  const data = await res.json();
  return Array.isArray(data?.response) ? data.response : [];
}

/**
 * Build the row that gets upserted to pick_tickets. Mirrors the field set
 * used by the full sync (sync-pick-tickets/route.ts) so the data shapes
 * stay consistent.
 */
function buildPtRow(
  pt: any,
  customerMap: Record<string, string>,
  orderMap: Record<string, string>
): Record<string, any> {
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

    // Shipping
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

    // Classification
    warehouse_id: pt.warehouse_id || null,
    division_id: pt.division_id || null,
    division_name: pt.division_name || null,
    salesperson: pt.salesperson || null,
    status: pt.status || null,

    // Notes
    notes: pt.notes || null,
    private_notes: pt.private_notes || null,

    // Flags
    is_void: toBool(pt.void),
    is_locked: toBool(pt.is_locked),
    is_printed: toBool(pt.is_printed),
    is_picked: toBool(pt.is_picked),

    // WMS
    wms_status: pt.wms_status || 'pending',
    qty_cartoned: toNum(pt.qty_cartoned) || 0,
    carton_status: pt.carton_status || 'none',
    num_cartons: pt.num_cartons || null,

    // AM timestamps (used to detect "no change")
    am_creation_time: pt.creation_time || null,
    am_last_modified_time: pt.last_modified_time || null,

    last_synced_at: new Date().toISOString(),
  };
}

export async function POST(_request: Request) {
  const startTime = Date.now();

  const { data: syncLog } = await supabase
    .from('sync_log')
    .insert({
      sync_type: 'pick_tickets_recent',
      source: 'apparel_magic',
      status: 'started',
    })
    .select()
    .single();

  try {
    // Step 1: figure out the last page (newest records)
    const lastPage = await fetchLastPageNumber();

    // Step 2: pull the maps for FK lookups (small tables, fast)
    const [{ data: customers }, { data: orders }] = await Promise.all([
      supabase.from('customers').select('id, am_customer_id'),
      supabase.from('orders').select('id, apparel_magic_id'),
    ]);
    const customerMap: Record<string, string> = {};
    customers?.forEach((c) => {
      if (c.am_customer_id) customerMap[c.am_customer_id] = c.id;
    });
    const orderMap: Record<string, string> = {};
    orders?.forEach((o) => {
      if (o.apparel_magic_id) orderMap[o.apparel_magic_id] = o.id;
    });

    // Step 3: walk pages from the last (newest) backwards
    let scanned = 0;
    let created = 0;
    let updated = 0;
    let skipped = 0;
    let errors = 0;
    let stoppedEarly = false;

    for (let i = 0; i < MAX_PAGES; i++) {
      const pageNum = lastPage - i;
      if (pageNum < 1) break;

      const pagePts = await fetchPickTicketsPage(pageNum);
      if (pagePts.length === 0) break;

      // Iterate newest-first within the page (AM returns oldest-first per
      // page, so we reverse).
      const newestFirst = [...pagePts].reverse();

      // Look up which of these PTs we already have, with their last-modified
      // times, in a single query.
      const ptIds = newestFirst.map((p) => p.pick_ticket_id).filter(Boolean);
      const { data: existingRows } = await supabase
        .from('pick_tickets')
        .select('pick_ticket_id, am_last_modified_time')
        .in('pick_ticket_id', ptIds);

      const existingMap: Record<string, string | null> = {};
      (existingRows || []).forEach((r: any) => {
        existingMap[String(r.pick_ticket_id)] = r.am_last_modified_time;
      });

      let consecutiveUnchanged = 0;
      const STOP_THRESHOLD = 20; // 20 unchanged in a row → assume the rest are too

      for (const pt of newestFirst) {
        scanned++;
        try {
          const ptId = String(pt.pick_ticket_id);
          const existingMod = existingMap[ptId];
          const incomingMod = pt.last_modified_time || null;

          if (existingMod !== undefined && existingMod === incomingMod) {
            // Already have it AND nothing changed — skip without writing
            skipped++;
            consecutiveUnchanged++;
            if (consecutiveUnchanged >= STOP_THRESHOLD) {
              stoppedEarly = true;
              break;
            }
            continue;
          }
          consecutiveUnchanged = 0;

          const row = buildPtRow(pt, customerMap, orderMap);

          if (existingMod !== undefined) {
            await supabase
              .from('pick_tickets')
              .update(row)
              .eq('pick_ticket_id', pt.pick_ticket_id);
            updated++;
          } else {
            await supabase.from('pick_tickets').insert(row);
            created++;
          }

          // Items: refresh on insert/update only
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
            if (itemRows.length > 0) {
              await supabase.from('pick_ticket_items').insert(itemRows);
            }
          }
        } catch (err) {
          console.error(
            `[recent-sync] error on PT ${pt.pick_ticket_id}:`,
            err instanceof Error ? err.message : err
          );
          errors++;
        }
      }

      if (stoppedEarly) break;
    }

    const duration = Math.round((Date.now() - startTime) / 1000);

    if (syncLog) {
      await supabase
        .from('sync_log')
        .update({
          status: 'completed',
          records_processed: scanned,
          records_created: created,
          records_updated: updated,
          errors,
          completed_at: new Date().toISOString(),
          duration_seconds: duration,
        })
        .eq('id', syncLog.id);
    }

    return NextResponse.json({
      success: true,
      stats: {
        scanned,
        created,
        updated,
        skipped,
        errors,
        duration_seconds: duration,
        stopped_early: stoppedEarly,
      },
    });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : 'Unknown error';
    if (syncLog) {
      await supabase
        .from('sync_log')
        .update({
          status: 'failed',
          error_details: { message: errMsg },
          completed_at: new Date().toISOString(),
        })
        .eq('id', syncLog.id);
    }
    return NextResponse.json({ success: false, error: errMsg }, { status: 500 });
  }
}
