import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
);

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
  if (dateStr.includes('-') && dateStr.length === 10) return dateStr;
  const parts = dateStr.split('/');
  if (parts.length === 3) return `${parts[2]}-${parts[0].padStart(2, '0')}-${parts[1].padStart(2, '0')}`;
  return dateStr;
}

async function fetchAllPayments() {
  let all: any[] = [];
  let lastId: string | null = null;
  let pageCount = 0;
  const maxPages = 200;

  console.log('Fetching all payments from ApparelMagic...');

  while (pageCount < maxPages) {
    const auth = getAuthParams();
    const params = new URLSearchParams({
      time: auth.time,
      token: auth.token,
      'pagination[page_size]': '200',
    });
    if (lastId) params.append('pagination[last_id]', lastId);

    const url = `${BASE_URL}/payments?${params.toString()}`;
    const response = await fetch(url, { method: 'GET', headers: { 'User-Agent': 'AdvanceHQ/1.0' } });
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

    const data = await response.json();
    if (data.response && Array.isArray(data.response)) {
      all = all.concat(data.response);
      console.log(`  Page ${pageCount + 1}: ${data.response.length} payments (Total: ${all.length})`);
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

export async function POST() {
  const startTime = Date.now();

  const { data: syncLog } = await supabase
    .from('sync_log')
    .insert({ sync_type: 'payments', source: 'apparel_magic', status: 'started' })
    .select().single();

  try {
    console.log('🔄 Starting FULL payments sync...');

    const payments = await fetchAllPayments();
    console.log(`✅ Fetched ${payments.length} payments`);

    const { data: customers } = await supabase.from('customers').select('id, am_customer_id');
    const customerMap: Record<string, string> = {};
    customers?.forEach(c => { customerMap[c.am_customer_id] = c.id; });

    let created = 0, updated = 0, errors = 0;

    for (const p of payments) {
      try {
        const paymentData: Record<string, any> = {
          am_payment_id: p.payment_id,
          customer_id: p.customer_id ? (customerMap[p.customer_id] || null) : null,
          am_customer_id: p.customer_id || null,
          reference: p.reference || null,
          payment_type: p.payment_type || null,
          amount_received: toNum(p.amt_dr) || 0,
          amount_applied: toNum(p.amount_applied) || 0,
          amount_applied_invoice: toNum(p.amount_applied_invoice) || 0,
          amount_applied_cm: toNum(p.amount_applied_cm) || 0,
          amount_unapplied: toNum(p.amount_unapplied) || 0,
          balance: toNum(p.balance) || 0,
          comment: p.comment || p.notes || null,
          payment_date: parseDate(p.date_internal || p.date),
          void: toBool(p.void),
          deposit_id: p.deposit_id || null,
          is_gateway_payment: toBool(p.is_gateway_payment),
          is_posted: toBool(p.is_locked_financial),
          xero_id: p.xero_id || null,
          shopify_id: p.shopify_id || null,
          last_synced_at: new Date().toISOString(),
        };

        const { data: existing } = await supabase
          .from('payments')
          .select('id')
          .eq('am_payment_id', p.payment_id)
          .single();

        if (existing) {
          await supabase.from('payments').update(paymentData).eq('am_payment_id', p.payment_id);
          updated++;
        } else {
          await supabase.from('payments').insert(paymentData);
          created++;
        }

        if ((created + updated) % 500 === 0) {
          console.log(`Progress: ${created + updated}/${payments.length} payments`);
        }
      } catch (err) {
        console.error(`Error syncing payment ${p.payment_id}:`, err);
        errors++;
      }
    }

    const duration = Math.round((Date.now() - startTime) / 1000);

    if (syncLog) {
      await supabase.from('sync_log').update({
        status: 'completed',
        records_processed: payments.length,
        records_created: created,
        records_updated: updated,
        errors,
        completed_at: new Date().toISOString(),
        duration_seconds: duration
      }).eq('id', syncLog.id);
    }

    console.log(`✅ Payments sync complete! Created: ${created}, Updated: ${updated}, Errors: ${errors}, Duration: ${duration}s`);
    return NextResponse.json({ success: true, stats: { total: payments.length, created, updated, errors, duration: `${duration}s` } });

  } catch (error) {
    console.error('Payments sync error:', error);
    if (syncLog) {
      await supabase.from('sync_log').update({
        status: 'failed',
        error_details: { message: error instanceof Error ? error.message : 'Unknown' },
        completed_at: new Date().toISOString()
      }).eq('id', syncLog.id);
    }
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Unknown' }, { status: 500 });
  }
}
