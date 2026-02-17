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

async function fetchAllOrders() {
  let allOrders: any[] = [];
  let lastId: string | null = null;
  let pageCount = 0;
  const maxPages = 200;

  console.log('Fetching all orders from ApparelMagic...');

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

    const url = `${BASE_URL}/orders?${params.toString()}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: { 'User-Agent': 'AdvanceHQ/1.0' }
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();

    if (data.response && Array.isArray(data.response)) {
      allOrders = allOrders.concat(data.response);
      console.log(`  Page ${pageCount + 1}: Fetched ${data.response.length} orders (Total: ${allOrders.length})`);
    }

    if (data.meta?.pagination?.last_id) {
      lastId = String(data.meta.pagination.last_id);
      pageCount++;
    } else {
      break;
    }
  }

  return allOrders;
}

export async function POST(request: Request) {
  const startTime = Date.now();

  const { data: syncLog } = await supabase
    .from('sync_log')
    .insert({
      sync_type: 'orders',
      source: 'apparel_magic',
      status: 'started'
    })
    .select()
    .single();

  try {
    console.log('🔄 Starting FULL order sync...');

    const orders = await fetchAllOrders();
    console.log(`✅ Fetched ${orders.length} orders`);

    const { data: customers } = await supabase
      .from('customers')
      .select('id, am_customer_id');

    const customerMap: Record<string, string> = {};
    customers?.forEach(c => {
      customerMap[c.am_customer_id] = c.id;
    });

    let ordersCreated = 0;
    let ordersUpdated = 0;
    let itemsCreated = 0;
    let errors = 0;

    for (const order of orders) {
      try {
        const orderData: Record<string, any> = {
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

          // Amounts
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

          // Quantities
          qty: toNum(order.qty) || 0,
          qty_open: toNum(order.qty_open) || 0,
          qty_cxl: toNum(order.qty_cxl) || 0,
          qty_alloc: toNum(order.qty_alloc) || 0,
          qty_picked: toNum(order.qty_picked) || 0,
          qty_shipped: toNum(order.qty_shipped) || 0,
          qty_approved: toNum(order.qty_approved) || 0,

          // Tax
          pct_discount: toNum(order.pct_discount) || 0,
          tax_rate: toNum(order.tax_rate) || 0,
          tax_rate_2: toNum(order.tax_rate_2) || 0,
          tax_first_tax_amount: order.tax_first_tax_amount || null,
          override_tax_amount: order.override_tax_amount || '0',

          // Ship-to
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

          // Classification
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

          // Notes
          notes: order.notes || null,
          private_notes: order.private_notes || null,

          // Misc charges
          description_misc: order.description_misc || null,
          qty_misc: toNum(order.qty_misc) || 0,
          rate_misc: toNum(order.rate_misc) || 0,
          amount_misc: toNum(order.amount_misc) || 0,

          // Flags
          error: order.error || '0',
          is_locked: toBool(order.is_locked),

          // EDI / Integration
          edi_reference: order.edi_reference || null,
          department_number: order.department_number || null,
          mark_for_store: order.mark_for_store || null,
          mic_code: order.mic_code || null,
          shopify_id: order.shopify_id || null,
          shopify_store_id: order.shopify_store_id || null,

          // Print & misc
          print_url: order.print_url || null,
          sales_rep: order.salesperson || order.sales_rep || null,
          commissions: order.commissions || null,
          order_udf: order.udf || null,
          order_group: order.order_group || null,

          // AM timestamps
          am_last_modified_time: order.time_modified ? new Date(order.time_modified * 1000).toISOString() : null,
          am_time_modified: order.time_modified || null,

          last_synced_at: new Date().toISOString()
        };

        const { data: existing } = await supabase
          .from('orders')
          .select('id')
          .eq('apparel_magic_id', order.order_id)
          .single();

        let orderId: string;

        if (existing) {
          await supabase
            .from('orders')
            .update(orderData)
            .eq('apparel_magic_id', order.order_id);
          orderId = existing.id;
          ordersUpdated++;
        } else {
          const { data: newOrder } = await supabase
            .from('orders')
            .insert(orderData)
            .select('id')
            .single();
          orderId = newOrder!.id;
          ordersCreated++;
        }

        // Sync order items
        if (order.order_items && Array.isArray(order.order_items)) {
          await supabase
            .from('order_items')
            .delete()
            .eq('apparel_magic_order_id', order.order_id);

          for (const item of order.order_items) {
            const itemData: Record<string, any> = {
              apparel_magic_id: item.id,
              order_id: orderId,
              apparel_magic_order_id: order.order_id,
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

              // Quantities
              quantity_ordered: parseInt(item.qty) || 0,
              qty: toNum(item.qty) || 0,
              qty_alloc: toNum(item.qty_alloc) || 0,
              qty_picked: toNum(item.qty_picked) || 0,
              qty_open: toNum(item.qty_open) || 0,
              quantity_shipped: parseInt(item.qty_shipped) || 0,
              qty_shipped_am: toNum(item.qty_shipped) || 0,
              quantity_cancelled: parseInt(item.qty_cxl) || 0,
              qty_cxl: toNum(item.qty_cxl) || 0,

              // Amounts
              unit_price: toNum(item.unit_price) || 0,
              line_total: toNum(item.amount) || 0,
              amount: toNum(item.amount) || 0,
              amount_alloc: toNum(item.amount_alloc) || 0,
              amount_open: toNum(item.amount_open) || 0,
              amount_shipped: toNum(item.amount_shipped) || 0,
              amount_cxl: toNum(item.amount_cxl) || 0,
              discount_percent: toNum(item.pct_discount),

              // Flags & refs
              is_taxable: item.is_taxable !== '0',
              line_status: parseInt(item.qty_shipped) > 0 ? 'shipped' : (parseInt(item.qty_cxl) >= parseInt(item.qty) ? 'cancelled' : 'open'),
              purchase_order_id: item.purchase_order_id || null,
              purchase_order_item_id: item.purchase_order_item_id || null,
              project_id: item.project_id || null,
              error: item.error || '0',
              notes: item.notes || null,
              mark_for_store: item.mark_for_store || null,
              retailer_sku: item.retailer_sku || null,
              ticketing: item.ticketing || null,

              last_synced_at: new Date().toISOString()
            };

            await supabase.from('order_items').insert(itemData);
            itemsCreated++;
          }
        }

        if ((ordersCreated + ordersUpdated) % 100 === 0) {
          console.log(`Progress: ${ordersCreated + ordersUpdated}/${orders.length} orders, ${itemsCreated} items`);
        }

      } catch (err) {
        console.error(`Error syncing order ${order.order_id}:`, err);
        errors++;
      }
    }

    const duration = Math.round((Date.now() - startTime) / 1000);

    if (syncLog) {
      await supabase
        .from('sync_log')
        .update({
          status: 'completed',
          records_processed: orders.length,
          records_created: ordersCreated,
          records_updated: ordersUpdated,
          errors: errors,
          completed_at: new Date().toISOString(),
          duration_seconds: duration
        })
        .eq('id', syncLog.id);
    }

    console.log(`✅ Order sync complete! Orders: ${ordersCreated} created, ${ordersUpdated} updated. Items: ${itemsCreated}. Errors: ${errors}`);

    return NextResponse.json({
      success: true,
      stats: {
        orders: { total: orders.length, created: ordersCreated, updated: ordersUpdated },
        items: { created: itemsCreated },
        errors,
        duration: `${duration}s`
      }
    });

  } catch (error) {
    console.error('Order sync error:', error);

    if (syncLog) {
      await supabase
        .from('sync_log')
        .update({
          status: 'failed',
          error_details: { message: error instanceof Error ? error.message : 'Unknown error' },
          completed_at: new Date().toISOString()
        })
        .eq('id', syncLog.id);
    }

    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}
