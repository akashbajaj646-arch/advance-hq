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
  if (parts.length === 3) {
    return `${parts[2]}-${parts[0].padStart(2, '0')}-${parts[1].padStart(2, '0')}`;
  }
  return dateStr;
}

async function fetchAllPickTickets() {
  let all: any[] = [];
  let lastId: string | null = null;
  let pageCount = 0;
  const maxPages = 200;

  console.log('Fetching all pick tickets from ApparelMagic...');

  while (pageCount < maxPages) {
    const auth = getAuthParams();
    const params = new URLSearchParams({
      time: auth.time,
      token: auth.token,
      'pagination[page_size]': '200'
    });

    if (lastId) {
      params.append('pagination[last_id]', lastId);
    }

    const url = `${BASE_URL}/pick_tickets?${params.toString()}`;
    const response = await fetch(url, { method: 'GET', headers: { 'User-Agent': 'AdvanceHQ/1.0' } });

    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

    const data = await response.json();

    if (data.response && Array.isArray(data.response)) {
      all = all.concat(data.response);
      console.log(`  Page ${pageCount + 1}: ${data.response.length} pick tickets (Total: ${all.length})`);
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
    console.log('🔄 Starting FULL pick ticket sync...');

    const pickTickets = await fetchAllPickTickets();
    console.log(`✅ Fetched ${pickTickets.length} pick tickets`);

    const { data: customers } = await supabase.from('customers').select('id, am_customer_id');
    const { data: orders } = await supabase.from('orders').select('id, apparel_magic_id');

    const customerMap: Record<string, string> = {};
    customers?.forEach(c => { customerMap[c.am_customer_id] = c.id; });
    const orderMap: Record<string, string> = {};
    orders?.forEach(o => { orderMap[o.apparel_magic_id] = o.id; });

    let created = 0, updated = 0, itemsCreated = 0, errors = 0;

    for (const pt of pickTickets) {
      try {
        const ptData: Record<string, any> = {
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

          // Amounts
          qty: toNum(pt.qty) || 0,
          subtotal: toNum(pt.amount_subtotal) || toNum(pt.amount) || 0,
          total_amount: toNum(pt.amount) || 0,
          amount_subtotal: toNum(pt.amount_subtotal) || 0,
          tax_amount: toNum(pt.amount_tax_total) || 0,
          amount_tax: toNum(pt.amount_tax) || 0,
          amount_tax_2: toNum(pt.amount_tax_2) || 0,
          amount_tax_total: toNum(pt.amount_tax_total) || 0,
          amount_taxable: toNum(pt.amount_taxable) || 0,
          discount_amount: toNum(pt.amount_discount) || 0,
          amount_discount: toNum(pt.amount_discount) || 0,
          override_discount_amount: toNum(pt.override_discount_amount) || 0,
          freight_amount: toNum(pt.amount_freight) || 0,
          amount_freight: toNum(pt.amount_freight) || 0,
          freight_taxable: pt.freight_taxable || '0',
          pct_discount: toNum(pt.pct_discount) || 0,
          tax_rate: toNum(pt.tax_rate) || 0,
          tax_rate_2: toNum(pt.tax_rate_2) || 0,
          tax_first_tax_amount: pt.tax_first_tax_amount || null,
          override_tax_amount: toNum(pt.override_tax_amount) || 0,

          // Misc charges
          description_misc: pt.description_misc || null,
          qty_misc: toNum(pt.qty_misc) || 0,
          rate_misc: toNum(pt.rate_misc) || 0,
          amount_misc: toNum(pt.amount_misc) || 0,

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
          shipping_terms_id: pt.shipping_terms_id || null,
          shipping_info: pt.shipping_info || null,
          itn: pt.itn || null,
          weight: toNum(pt.weight) || 0,
          ups_batch: pt.ups_batch || '0',

          // Classification
          warehouse_id: pt.warehouse_id || null,
          item_warehouses_overridden: pt.item_warehouses_overridden || '0',
          division_id: pt.division_id || null,
          division_name: pt.division_name || null,
          ar_acct: pt.ar_acct || null,
          terms_id: pt.terms_id || null,
          salesperson: pt.salesperson || null,
          commission_rate: pt.commission_rate || null,
          commission: pt.commission || null,
          credit_status: pt.credit_status || null,
          approval_number: pt.approval_number || null,
          status: pt.status || null,
          currency_id: pt.currency_id || null,
          currency_rate: toNum(pt.currency_rate) || 1,

          // Notes
          notes: pt.notes || null,
          private_notes: pt.private_notes || null,

          // Flags
          is_void: toBool(pt.void),
          is_locked: toBool(pt.is_locked),
          is_printed: toBool(pt.is_printed),
          is_emailed: toBool(pt.is_emailed),
          is_picked: toBool(pt.is_picked),
          has_error: pt.error !== '0' && pt.error !== null,
          error: pt.error || '0',

          // ShipStation
          shipstation_id: pt.shipstation_id || null,
          shipstation_key: pt.shipstation_key || null,
          shipstation_synced: pt.shipstation_synced || '0',
          shipstation_connection_id: pt.shipstation_connection_id || null,

          // WMS / Carton
          wms_status: pt.wms_status || 'pending',
          date_shipped: pt.date_shipped || null,
          qty_cartoned: toNum(pt.qty_cartoned) || 0,
          carton_status: pt.carton_status || 'none',

          // EDI
          department_number: pt.department_number || null,
          department_name: pt.department_name || null,
          mark_for_store: pt.mark_for_store || null,
          group_number: pt.group_number || null,
          edi_reference: pt.edi_reference || null,
          event_code: pt.event_code || null,

          // Audit
          am_creation_time: pt.creation_time || null,
          am_creation_user_id: pt.creation_user_id || null,
          am_creation_user_name: pt.creation_user_name || null,
          am_last_modified_time: pt.last_modified_time || null,
          am_last_modified_command: pt.last_modified_command || null,
          am_last_modified_user_id: pt.last_modified_user_id || null,
          am_last_modified_user_name: pt.last_modified_user_name || null,

          last_synced_at: new Date().toISOString()
        };

        const { data: existing } = await supabase
          .from('pick_tickets')
          .select('id')
          .eq('pick_ticket_id', pt.pick_ticket_id)
          .single();

        if (existing) {
          await supabase.from('pick_tickets').update(ptData).eq('pick_ticket_id', pt.pick_ticket_id);
          updated++;
        } else {
          await supabase.from('pick_tickets').insert(ptData);
          created++;
        }

        // Sync pick ticket items
        if (pt.pick_ticket_items && Array.isArray(pt.pick_ticket_items) && pt.pick_ticket_items.length > 0) {
          await supabase.from('pick_ticket_items').delete().eq('pick_ticket_id', pt.pick_ticket_id);

          for (const item of pt.pick_ticket_items) {
            await supabase.from('pick_ticket_items').insert({
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
              is_taxable: item.is_taxable !== '0',
              retailer_sku: item.retailer_sku || null,
              mark_for_store: item.mark_for_store || null,
              group_number: item.group_number || null,
              edi_reference: item.edi_reference || null,
              upc: item.upc || item.upc_display || null,
              error: item.error || '0',
              notes: item.notes || null,
              location: item.location || null,
              last_synced_at: new Date().toISOString()
            });
            itemsCreated++;
          }
        }

        if ((created + updated) % 100 === 0) {
          console.log(`Progress: ${created + updated}/${pickTickets.length} pick tickets, ${itemsCreated} items`);
        }

      } catch (err) {
        console.error(`Error syncing pick ticket ${pt.pick_ticket_id}:`, err);
        errors++;
      }
    }

    const duration = Math.round((Date.now() - startTime) / 1000);

    if (syncLog) {
      await supabase.from('sync_log').update({
        status: 'completed',
        records_processed: pickTickets.length,
        records_created: created,
        records_updated: updated,
        errors,
        completed_at: new Date().toISOString(),
        duration_seconds: duration
      }).eq('id', syncLog.id);
    }

    console.log(`✅ Pick ticket sync complete! Created: ${created}, Updated: ${updated}, Items: ${itemsCreated}, Errors: ${errors}`);

    return NextResponse.json({
      success: true,
      stats: { total: pickTickets.length, created, updated, items: itemsCreated, errors, duration: `${duration}s` }
    });

  } catch (error) {
    console.error('Pick ticket sync error:', error);
    if (syncLog) {
      await supabase.from('sync_log').update({
        status: 'failed',
        error_details: { message: error instanceof Error ? error.message : 'Unknown error' },
        completed_at: new Date().toISOString()
      }).eq('id', syncLog.id);
    }
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
  }
}
