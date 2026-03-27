import { NextResponse } from 'next/server';

export const maxDuration = 300;
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

function determinePaymentStatus(balance: number, amountPaid: number, total: number): string {
  if (balance <= 0 || amountPaid >= total) return 'paid';
  if (amountPaid > 0) return 'partial';
  return 'unpaid';
}

async function fetchAllInvoices() {
  let allInvoices: any[] = [];
  let lastId: string | null = null;
  let pageCount = 0;
  const maxPages = 200;

  console.log('Fetching all invoices from ApparelMagic...');

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

    const url = `${BASE_URL}/invoices?${params.toString()}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: { 'User-Agent': 'AdvanceHQ/1.0' }
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();

    if (data.response && Array.isArray(data.response)) {
      allInvoices = allInvoices.concat(data.response);
      console.log(`  Page ${pageCount + 1}: Fetched ${data.response.length} invoices (Total: ${allInvoices.length})`);
    }

    if (data.meta?.pagination?.last_id) {
      lastId = String(data.meta.pagination.last_id);
      pageCount++;
    } else {
      break;
    }
  }

  return allInvoices;
}

export async function POST(request: Request) {
  const startTime = Date.now();

  const { data: syncLog } = await supabase
    .from('sync_log')
    .insert({
      sync_type: 'invoices',
      source: 'apparel_magic',
      status: 'started'
    })
    .select()
    .single();

  try {
    console.log('🔄 Starting FULL invoice sync...');

    const invoices = await fetchAllInvoices();
    console.log(`✅ Fetched ${invoices.length} invoices`);

    const { data: customers } = await supabase
      .from('customers')
      .select('id, am_customer_id');

    const { data: orders } = await supabase
      .from('orders')
      .select('id, apparel_magic_id');

    const customerMap: Record<string, string> = {};
    customers?.forEach(c => { customerMap[c.am_customer_id] = c.id; });

    const orderMap: Record<string, string> = {};
    orders?.forEach(o => { orderMap[o.apparel_magic_id] = o.id; });

    let created = 0;
    let updated = 0;
    let itemsCreated = 0;
    let errors = 0;

    for (const invoice of invoices) {
      try {
        const total = toNum(invoice.amount) || 0;
        const amountPaid = toNum(invoice.amount_paid) || 0;
        const balance = toNum(invoice.balance) || 0;

        const invoiceData: Record<string, any> = {
          apparel_magic_id: invoice.invoice_id,
          order_id: orderMap[invoice.order_id] || null,
          customer_id: customerMap[invoice.customer_id] || null,
          apparel_magic_order_id: invoice.order_id,
          apparel_magic_customer_id: invoice.customer_id,
          invoice_number: invoice.invoice_id,
          invoice_date: parseDate(invoice.date),
          due_date: parseDate(invoice.date_due),
          date_start: invoice.date_start || null,

          // Amounts
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

          // Quantities
          qty: toNum(invoice.qty) || 0,
          qty_open_to_return: toNum(invoice.qty_open_to_return) || 0,

          // Tax
          tax_code: invoice.tax_code || null,
          tax_rate: toNum(invoice.tax_rate) || 0,
          tax_rate_2: toNum(invoice.tax_rate_2) || 0,

          // Ship-to
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

          // Classification
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

          // Notes
          notes: invoice.notes || null,
          private_notes: invoice.private_notes || null,
          shipping_info: invoice.shipping_info || null,

          // Misc charges
          description_misc: invoice.description_misc || null,
          qty_misc: toNum(invoice.qty_misc) || 0,
          rate_misc: toNum(invoice.rate_misc) || 0,
          amount_misc: toNum(invoice.amount_misc) || 0,

          // Flags
          void: toBool(invoice.void),
          is_posted: toBool(invoice.is_posted),
          error: invoice.error || '0',

          // Integration
          magento_order: invoice.magento_order || null,
          shopify_id: invoice.shopify_id || null,
          xero_id: invoice.xero_id || null,
          xero_synced: invoice.xero_synced || '0',
          provider: invoice.provider || null,
          commissions: invoice.commissions || null,

          last_synced_at: new Date().toISOString()
        };

        const { data: existing } = await supabase
          .from('invoices')
          .select('id')
          .eq('apparel_magic_id', invoice.invoice_id)
          .single();

        let invoiceUuid: string;

        if (existing) {
          await supabase
            .from('invoices')
            .update(invoiceData)
            .eq('apparel_magic_id', invoice.invoice_id);
          invoiceUuid = existing.id;
          updated++;
        } else {
          const { data: newInvoice } = await supabase
            .from('invoices')
            .insert(invoiceData)
            .select('id')
            .single();
          invoiceUuid = newInvoice!.id;
          created++;
        }

        // Sync invoice items if present
        if (invoice.invoice_items && Array.isArray(invoice.invoice_items) && invoice.invoice_items.length > 0) {
          await supabase
            .from('invoice_items')
            .delete()
            .eq('apparel_magic_invoice_id', invoice.invoice_id);

          for (const item of invoice.invoice_items) {
            const itemData: Record<string, any> = {
              am_invoice_item_id: item.id || null,
              invoice_id: invoiceUuid,
              apparel_magic_invoice_id: invoice.invoice_id,
              order_id: item.order_id || invoice.order_id || null,
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
              last_synced_at: new Date().toISOString()
            };

            await supabase.from('invoice_items').insert(itemData);
            itemsCreated++;
          }
        }

        if ((created + updated) % 100 === 0) {
          console.log(`Progress: ${created + updated}/${invoices.length} invoices, ${itemsCreated} items`);
        }

      } catch (err) {
        console.error(`Error syncing invoice ${invoice.invoice_id}:`, err);
        errors++;
      }
    }

    const duration = Math.round((Date.now() - startTime) / 1000);

    if (syncLog) {
      await supabase
        .from('sync_log')
        .update({
          status: 'completed',
          records_processed: invoices.length,
          records_created: created,
          records_updated: updated,
          errors: errors,
          completed_at: new Date().toISOString(),
          duration_seconds: duration
        })
        .eq('id', syncLog.id);
    }

    console.log(`✅ Invoice sync complete! Created: ${created}, Updated: ${updated}, Items: ${itemsCreated}, Errors: ${errors}`);

    return NextResponse.json({
      success: true,
      stats: {
        total: invoices.length,
        created,
        updated,
        items: itemsCreated,
        errors,
        duration: `${duration}s`
      }
    });

  } catch (error) {
    console.error('Invoice sync error:', error);

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
