/**
 * POST /api/admin/sync-pick-tickets-recent
 * Lightweight pick-ticket sync. Runs in 5-15 seconds.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

const APPARELMAGIC_API_TOKEN = process.env.APPARELMAGIC_TOKEN || '';
const BASE_URL = process.env.NEXT_PUBLIC_APPARELMAGIC_URL || 'https://advanceapparels.app.apparelmagic.com/api/json';

const PAGE_SIZE = 200;
const MAX_PAGES = 3;

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

async function fetchPickTicketCount(): Promise<number | null> {
  const auth = getAuthParams();
  const params = new URLSearchParams({
    time: auth.time, token: auth.token,
    'pagination[page_size]': '1', 'pagination[page]': '1',
  });
  const res = await fetch(`${BASE_URL}/pick_tickets?${params.toString()}`, {
    method: 'GET', headers: { 'User-Agent': 'AdvanceHQ/1.0' },
  });
  if (!res.ok) throw new Error(`AM count check HTTP ${res.status}`);
  const data = await res.json();
  const total = data?.meta?.pagination?.total;
  if (typeof total === 'number') return total;
  if (typeof total === 'string') return parseInt(total, 10) || null;
  return null;
}

async function fetchPickTicketsPage(pageNum: number, pageSize: number = PAGE_SIZE): Promise<any[]> {
  const auth = getAuthParams();
  const params = new URLSearchParams({
    time: auth.time, token: auth.token,
    'pagination[page_size]': String(pageSize),
    'pagination[page]': String(pageNum),
  });
  const res = await fetch(`${BASE_URL}/pick_tickets?${params.toString()}`, {
    method: 'GET', headers: { 'User-Agent': 'AdvanceHQ/1.0' },
  });
  if (!res.ok) throw new Error(`AM page ${pageNum} HTTP ${res.status}`);
  const data = await res.json();
  return Array.isArray(data?.response) ? data.response : [];
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
  const { data: syncLog } = await supabase
    .from('sync_log')
    .insert({ sync_type: 'pick_tickets_recent', source: 'apparel_magic', status: 'started' })
    .select().single();

  try {
    const total = await fetchPickTicketCount();
    if (total === null) throw new Error('AM did not return a total count');
    const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

    const [{ data: customers }, { data: orders }] = await Promise.all([
      supabase.from('customers').select('id, am_customer_id'),
      supabase.from('orders').select('id, apparel_magic_id'),
    ]);
    const customerMap: Record<string, string> = {};
    customers?.forEach((c) => { if (c.am_customer_id) customerMap[c.am_customer_id] = c.id; });
    const orderMap: Record<string, string> = {};
    orders?.forEach((o) => { if (o.apparel_magic_id) orderMap[o.apparel_magic_id] = o.id; });

    let scanned = 0, created = 0, updated = 0, skipped = 0, errors = 0;
    let stoppedEarly = false;

    for (let i = 0; i < MAX_PAGES; i++) {
      const pageNum = lastPage - i;
      if (pageNum < 1) break;
      const pagePts = await fetchPickTicketsPage(pageNum);
      if (pagePts.length === 0) break;
      const newestFirst = [...pagePts].reverse();
      const ptIds = newestFirst.map((p) => p.pick_ticket_id).filter(Boolean);
      const { data: existingRows } = await supabase
        .from('pick_tickets')
        .select('pick_ticket_id, am_last_modified_time')
        .in('pick_ticket_id', ptIds);
      const existingMap: Record<string, string | null> = {};
      (existingRows || []).forEach((r: any) => { existingMap[String(r.pick_ticket_id)] = r.am_last_modified_time; });

      let consecutiveUnchanged = 0;
      for (const pt of newestFirst) {
        scanned++;
        try {
          const ptId = String(pt.pick_ticket_id);
          const existingMod = existingMap[ptId];
          const incomingMod = pt.last_modified_time || null;
          if (existingMod !== undefined && existingMod === incomingMod) {
            skipped++;
            consecutiveUnchanged++;
            if (consecutiveUnchanged >= 20) { stoppedEarly = true; break; }
            continue;
          }
          consecutiveUnchanged = 0;
          const row = buildPtRow(pt, customerMap, orderMap);
          if (existingMod !== undefined) {
            await supabase.from('pick_tickets').update(row).eq('pick_ticket_id', pt.pick_ticket_id);
            updated++;
          } else {
            await supabase.from('pick_tickets').insert(row);
            created++;
          }
          if (Array.isArray(pt.pick_ticket_items) && pt.pick_ticket_items.length > 0) {
            await supabase.from('pick_ticket_items').delete().eq('pick_ticket_id', pt.pick_ticket_id);
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
          console.error(`[recent-sync] error on PT ${pt.pick_ticket_id}:`, err instanceof Error ? err.message : err);
          errors++;
        }
      }
      if (stoppedEarly) break;
    }

    const duration = Math.round((Date.now() - startTime) / 1000);
    if (syncLog) {
      await supabase.from('sync_log').update({
        status: 'completed', records_processed: scanned, records_created: created,
        records_updated: updated, errors, completed_at: new Date().toISOString(),
        duration_seconds: duration,
      }).eq('id', syncLog.id);
    }
    return NextResponse.json({
      success: true,
      stats: { scanned, created, updated, skipped, errors, duration_seconds: duration, stopped_early: stoppedEarly },
    });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : 'Unknown error';
    if (syncLog) {
      await supabase.from('sync_log').update({
        status: 'failed', error_details: { message: errMsg }, completed_at: new Date().toISOString(),
      }).eq('id', syncLog.id);
    }
    return NextResponse.json({ success: false, error: errMsg }, { status: 500 });
  }
}
