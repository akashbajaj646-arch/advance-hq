import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

const APPARELMAGIC_API_TOKEN = process.env.APPARELMAGIC_TOKEN || '';
const BASE_URL = process.env.NEXT_PUBLIC_APPARELMAGIC_URL || 'https://advanceapparels.app.apparelmagic.com/api/json';

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
  if (parts.length === 3) return `${parts[2]}-${parts[0].padStart(2, '0')}-${parts[1].padStart(2, '0')}`;
  return dateStr;
}

async function fetchRecentPickTickets(sinceTimestamp: number) {
  let all: any[] = [];
  let lastId: string | null = null;
  let pageCount = 0;
  const maxPages = 20;

  console.log(`Fetching pick tickets modified since ${new Date(sinceTimestamp * 1000).toISOString()}...`);

  while (pageCount < maxPages) {
    const auth = getAuthParams();
    const params = new URLSearchParams({
      time: auth.time,
      token: auth.token,
      'pagination[page_size]': '200',
      'filter[time_modified][gt]': String(sinceTimestamp),
    });
    if (lastId) params.append('pagination[last_id]', lastId);

    const url = `${BASE_URL}/pick_tickets?${params.toString()}`;
    const response = await fetch(url, { method: 'GET', headers: { 'User-Agent': 'AdvanceHQ/1.0' } });
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

    const data = await response.json();
    if (data.response && Array.isArray(data.response)) {
      all = all.concat(data.response);
      console.log(`  Page ${pageCount + 1}: ${data.response.length} pick tickets (Total: ${all.length})`);
      if (data.response.length === 0) break;
    }
    if (data.meta?.pagination?.last_id) {
      lastId = String(data.meta.pagination.last_id);
      pageCount++;
    } else {
      break;
    }
  }
  return all;
}

export async function POST(request: Request) {
  const startTime = Date.now();

  const { data: syncLog } = await supabase
    .from('sync_log')
    .insert({ sync_type: 'pick_tickets', source: 'apparel_magic', status: 'started' })
    .select().single();

  try {
    const { data: lastSync } = await supabase
      .from('sync_log')
      .select('completed_at')
      .eq('sync_type', 'pick_tickets')
      .eq('status', 'completed')
      .order('completed_at', { ascending: false })
      .limit(1)
      .single();

    const sinceTimestamp = lastSync?.completed_at
      ? Math.floor(new Date(lastSync.completed_at).getTime() / 1000) - 3600
      : Math.floor(Date.now() / 1000) - 7 * 24 * 3600;

    console.log('🔄 Starting INCREMENTAL pick ticket sync...');
    const pickTickets = await fetchRecentPickTickets(sinceTimestamp);
    console.log(`✅ Fetched ${pickTickets.length} recently modified pick tickets`);

    const { data: customers } = await supabase.from('customers').select('id, am_customer_id');
    const { data: orders } = await supabase.from('orders').select('id, apparel_magic_id');
    const customerMap: Record<string, string> = {};
    customers?.forEach(c => { customerMap[c.am_customer_id] = c.id; });
    const orderMap: Record<string, string> = {};
    orders?.forEach(o => { orderMap[o.apparel_magic_id] = o.id; });

    let created = 0, updated = 0, errors = 0;

    for (const pt of pickTickets) {
      try {
        const ptData: Record<string, any> = {
          pick_ticket_id: pt.pick_ticket_id,
          order_id: orderMap[pt.order_id] || null,
          apparel_magic_order_id: pt.order_id,
          customer_id: customerMap[pt.customer_id] || null,
          apparel_magic_customer_id: pt.customer_id,
          customer_name: pt.customer_name || null,
          account_number: pt.account_number || null,
          customer_po: pt.customer_po || null,
          status: pt.status || null,
          warehouse_id: pt.warehouse_id || null,
          pick_ticket_date: parseDate(pt.date),
          ship_date: parseDate(pt.date_ship),
          cancel_date: parseDate(pt.date_cancel),
          notes: pt.notes || null,
          last_synced_at: new Date().toISOString()
        };

        const { data: existing } = await supabase.from('pick_tickets').select('id').eq('pick_ticket_id', pt.pick_ticket_id).single();

        if (existing) {
          await supabase.from('pick_tickets').update(ptData).eq('pick_ticket_id', pt.pick_ticket_id);
          updated++;
        } else {
          await supabase.from('pick_tickets').insert(ptData);
          created++;
        }
      } catch (err) {
        console.error(`Error syncing pick ticket ${pt.pick_ticket_id}:`, err);
        errors++;
      }
    }

    const duration = Math.round((Date.now() - startTime) / 1000);
    if (syncLog) {
      await supabase.from('sync_log').update({
        status: 'completed', records_processed: pickTickets.length,
        records_created: created, records_updated: updated,
        errors, completed_at: new Date().toISOString(), duration_seconds: duration
      }).eq('id', syncLog.id);
    }

    console.log(`✅ Pick ticket sync complete! Created: ${created}, Updated: ${updated}, Duration: ${duration}s`);
    return NextResponse.json({ success: true, stats: { total: pickTickets.length, created, updated, errors, duration: `${duration}s` } });

  } catch (error) {
    console.error('Pick ticket sync error:', error);
    if (syncLog) {
      await supabase.from('sync_log').update({
        status: 'failed', error_details: { message: error instanceof Error ? error.message : 'Unknown' },
        completed_at: new Date().toISOString()
      }).eq('id', syncLog.id);
    }
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Unknown' }, { status: 500 });
  }
}
