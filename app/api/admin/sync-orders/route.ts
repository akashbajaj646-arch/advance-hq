import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
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

async function fetchRecentOrders(sinceTimestamp: number) {
  let all: any[] = [];
  let lastId: string | null = null;
  let pageCount = 0;
  const maxPages = 3; // fetch ~1000 most recent orders

  console.log(`Fetching orders modified since ${new Date(sinceTimestamp * 1000).toISOString()}...`);

  while (pageCount < maxPages) {
    const auth = getAuthParams();
    const params = new URLSearchParams({
      time: auth.time,
      token: auth.token,
      'pagination[page_size]': '200',
      
    });
    if (lastId) params.append('pagination[last_id]', lastId);

    const url = `${BASE_URL}/orders?${params.toString()}`;
    const response = await fetch(url, { method: 'GET', headers: { 'User-Agent': 'AdvanceHQ/1.0' } });
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

    const data = await response.json();
    if (data.response && Array.isArray(data.response)) {
      all = all.concat(data.response);
      console.log(`  Page ${pageCount + 1}: ${data.response.length} orders (Total: ${all.length})`);
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
    .insert({ sync_type: 'orders', source: 'apparel_magic', status: 'started' })
    .select().single();

  try {
    // Find last successful sync time, default to 7 days ago
    const { data: lastSync } = await supabase
      .from('sync_log')
      .select('completed_at')
      .eq('sync_type', 'orders')
      .eq('status', 'completed')
      .order('completed_at', { ascending: false })
      .limit(1)
      .single();

    const sinceTimestamp = lastSync?.completed_at
      ? Math.floor(new Date(lastSync.completed_at).getTime() / 1000) - 3600 // 1hr overlap
      : Math.floor(Date.now() / 1000) - 7 * 24 * 3600; // default: 7 days

    console.log('🔄 Starting INCREMENTAL order sync...');
    const orders = await fetchRecentOrders(sinceTimestamp);
    console.log(`✅ Fetched ${orders.length} recently modified orders`);

    const { data: customers } = await supabase.from('customers').select('id, am_customer_id');
    const customerMap: Record<string, string> = {};
    customers?.forEach(c => { customerMap[c.am_customer_id] = c.id; });

    let ordersCreated = 0, ordersUpdated = 0, errors = 0;

    // Batch upsert in chunks of 50
    const batchSize = 50;
    const orderRows = orders.map((order: any) => ({
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
      total_amount: toNum(order.amount) || 0,
      amount_open: toNum(order.amount_open) || 0,
      amount_shipped: toNum(order.amount_shipped) || 0,
      qty: toNum(order.qty) || 0,
      qty_open: toNum(order.qty_open) || 0,
      qty_shipped: toNum(order.qty_shipped) || 0,
      ship_to_name: order.name || order.customer_name || null,
      ship_to_address_1: order.address_1 || null,
      ship_to_city: order.city || null,
      ship_to_state: order.state || null,
      ship_to_zip: order.postal_code || null,
      ship_to_country: order.country || null,
      ship_via: order.ship_via || null,
      warehouse_id: order.warehouse_id || null,
      terms_id: order.terms_id || null,
      notes: order.notes || null,
      sales_rep: order.salesperson || order.sales_rep || null,
      shopify_id: order.shopify_id || null,
      am_last_modified_time: order.time_modified ? new Date(order.time_modified * 1000).toISOString() : null,
      last_synced_at: new Date().toISOString()
    }));

    for (let i = 0; i < orderRows.length; i += batchSize) {
      const batch = orderRows.slice(i, i + batchSize);
      const { error } = await supabase
        .from('orders')
        .upsert(batch, { onConflict: 'apparel_magic_id' });
      if (error) {
        console.error('Batch upsert error:', error.message);
        errors++;
      } else {
        ordersCreated += batch.length;
      }
      console.log(`Upserted ${Math.min(i + batchSize, orderRows.length)}/${orderRows.length} orders`);
    }

    const duration = Math.round((Date.now() - startTime) / 1000);
    if (syncLog) {
      await supabase.from('sync_log').update({
        status: 'completed', records_processed: orders.length,
        records_created: ordersCreated, records_updated: ordersUpdated,
        errors, completed_at: new Date().toISOString(), duration_seconds: duration
      }).eq('id', syncLog.id);
    }

    console.log(`✅ Order sync complete! Created: ${ordersCreated}, Updated: ${ordersUpdated}, Items: ${itemsCreated}, Duration: ${duration}s`);
    return NextResponse.json({ success: true, stats: { total: orders.length, created: ordersCreated, updated: ordersUpdated, items: itemsCreated, errors, duration: `${duration}s` } });

  } catch (error) {
    console.error('Order sync error:', error);
    if (syncLog) {
      await supabase.from('sync_log').update({
        status: 'failed', error_details: { message: error instanceof Error ? error.message : 'Unknown' },
        completed_at: new Date().toISOString()
      }).eq('id', syncLog.id);
    }
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Unknown' }, { status: 500 });
  }
}
