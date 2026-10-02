import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Full AM /inventory → Supabase inventory sync.
// Runs every 15 min via /api/cron/sync-inventory (see vercel.json).
// - Pages AM with pagination[last_id] (1000/page), upserts 500 rows per batch
// - Stops cleanly at TIME_BUDGET_MS and reports complete:false rather than
//   being killed by Vercel mid-write
// - product_skus quantities + is_active are refreshed by ONE SQL call
//   (sync_product_skus_qty) instead of a per-row update loop

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

const TIME_BUDGET_MS = 270_000;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const APPARELMAGIC_API_TOKEN = process.env.APPARELMAGIC_TOKEN || '';
const BASE_URL = process.env.NEXT_PUBLIC_APPARELMAGIC_URL || 'https://advanceapparels.app.apparelmagic.com/api/json';

function getAuthParams() {
  return { time: Math.floor(Date.now() / 1000).toString(), token: APPARELMAGIC_API_TOKEN };
}

function toNum(val: any): number | null {
  if (val === null || val === undefined || val === '') return null;
  const n = parseFloat(val);
  return isNaN(n) ? null : n;
}

function toBool(val: any): boolean {
  return val === '1' || val === 1 || val === true;
}

function buildRow(inv: any, now: string) {
  return {
    sku_id: inv.sku_id,
    product_id: inv.product_id,
    style_number: inv.style_number || null,
    description: inv.description || null,
    attr_2: inv.attr_2 || null,
    attr_3: inv.attr_3 || null,
    size: inv.size || null,
    size_position: inv.size_position || null,
    sku_concat: inv.sku_concat || null,
    attr_2_name: inv.attr_2_name || null,
    attr_3_name: inv.attr_3_name || null,
    attr_2_nrf_id: inv.attr_2_nrf_id || null,
    product_attribute_id: inv.product_attribute_id || null,

    qty_inventory: toNum(inv.qty_inventory) || 0,
    qty_avail_sell: toNum(inv.qty_avail_sell) || 0,
    qty_alloc: toNum(inv.qty_alloc) || 0,
    qty_avail_alloc: toNum(inv.qty_avail_alloc) || 0,
    qty_open_wip: toNum(inv.qty_open_wip) || 0,
    qty_open_po: toNum(inv.qty_open_po) || 0,
    qty_open_po_no_proj: toNum(inv.qty_open_po_no_proj) || 0,
    qty_otr: toNum(inv.qty_otr) || 0,
    qty_in_transit: toNum(inv.qty_in_transit) || 0,
    qty_open_sales: toNum(inv.qty_open_sales) || 0,
    qty_picked: toNum(inv.qty_picked) || 0,
    qty_invoiced: toNum(inv.qty_invoiced) || 0,
    qty_authorized_to_return: toNum(inv.qty_authorized_to_return) || 0,
    qty_credited: toNum(inv.qty_credited) || 0,
    qty_received: toNum(inv.qty_received) || 0,
    qty_issued: toNum(inv.qty_issued) || 0,
    qty_returned: toNum(inv.qty_returned) || 0,
    qty_required_comp: toNum(inv.qty_required_comp) || 0,
    qty_required_bundles: toNum(inv.qty_required_bundles) || 0,
    qty_min_reorder: toNum(inv.qty_min_reorder) || 0,
    qty_min_inventory: toNum(inv.qty_min_inventory) || 0,
    qty_per_inner_pack: toNum(inv.qty_per_inner_pack),

    price: toNum(inv.price) || 0,
    retail_price: toNum(inv.retail_price) || 0,
    cost: toNum(inv.cost) || 0,
    cost_base: toNum(inv.cost_base) || 0,
    cost_mfg: toNum(inv.cost_mfg) || 0,
    cost_historical_wa: toNum(inv.cost_historical_wa) || 0,
    cost_historical_wa_old: toNum(inv.cost_historical_wa_old) || 0,
    vendor_cost_base: toNum(inv.vendor_cost_base) || 0,
    price_offset: toNum(inv.price_offset) || 0,
    retail_price_offset: toNum(inv.retail_price_offset) || 0,
    cost_offset: toNum(inv.cost_offset) || 0,
    vendor_cost_offset: toNum(inv.vendor_cost_offset) || 0,

    upc_display: inv.upc_display || null,
    upc_11: inv.upc_11 || null,
    sku_alt: inv.sku_alt || null,
    sku: inv.sku || null,
    nrf_size: inv.nrf_size || null,
    analysis_code: inv.analysis_code || null,
    location: inv.location || null,
    web_title: inv.web_title || null,
    weight: toNum(inv.weight) || 0,
    weight_offset: toNum(inv.weight_offset) || 0,

    active: toBool(inv.active),
    is_inventory_tracked: toBool(inv.is_inventory_tracked),
    is_product: toBool(inv.is_product),
    is_component: toBool(inv.is_component),
    is_bundle: toBool(inv.is_bundle),
    joor_sync: inv.joor_sync || '0',

    shopify_compare_at_price_wholesale: inv.shopify_compare_at_price_wholesale || null,
    shopify_retail_compare_at_price: inv.shopify_retail_compare_at_price || null,

    am_creation_time: inv.creation_time || null,
    am_creation_user_id: inv.creation_user_id || null,
    am_creation_user_name: inv.creation_user_name || null,
    am_last_modified_time: inv.last_modified_time || null,
    am_last_modified_command: inv.last_modified_command || null,
    am_last_modified_user_id: inv.last_modified_user_id || null,
    am_last_modified_user_name: inv.last_modified_user_name || null,
    ref_table: inv.ref_table || null,

    last_synced_at: now,
  };
}

export async function POST(_request: Request) {
  const startTime = Date.now();
  const overBudget = () => Date.now() - startTime > TIME_BUDGET_MS;

  const { data: syncLog } = await supabase
    .from('sync_log')
    .insert({ sync_type: 'inventory', source: 'apparel_magic', status: 'started' })
    .select().single();

  let fetched = 0, upserted = 0, errors = 0, pages = 0;
  let firstError: string | null = null;
  let complete = false;
  let lastId: string | null = null;

  try {
    while (pages < 200) {
      if (overBudget()) break;

      const params = new URLSearchParams({ ...getAuthParams(), 'pagination[page_size]': '1000' });
      if (lastId) params.append('pagination[last_id]', lastId);
      const res = await fetch(`${BASE_URL}/inventory?${params.toString()}`, {
        method: 'GET',
        headers: { 'User-Agent': 'AdvanceHQ/1.0' },
        cache: 'no-store',
      });
      if (!res.ok) throw new Error(`AM HTTP ${res.status} on page ${pages + 1}`);
      const data = await res.json();
      const records: any[] = Array.isArray(data.response) ? data.response : [];
      pages++;
      fetched += records.length;

      const now = new Date().toISOString();
      for (let i = 0; i < records.length; i += 500) {
        const rows = records.slice(i, i + 500).filter(r => r?.sku_id).map(r => buildRow(r, now));
        const { error } = await supabase.from('inventory').upsert(rows, { onConflict: 'sku_id' });
        if (error) {
          errors += rows.length;
          if (!firstError) firstError = `page ${pages} batch ${i}: ${error.message}`;
        } else {
          upserted += rows.length;
        }
      }

      const next = data.meta?.pagination?.last_id ? String(data.meta.pagination.last_id) : null;
      if (!next || records.length === 0 || next === lastId) { complete = true; break; }
      lastId = next;
    }

    // One set-based refresh of product_skus from inventory
    let skuUpdates: number | null = null;
    let skuError: string | null = null;
    if (!overBudget() || complete) {
      const { data: n, error } = await supabase.rpc('sync_product_skus_qty');
      if (error) skuError = error.message;
      else skuUpdates = typeof n === 'number' ? n : null;
    }

    const duration = Math.round((Date.now() - startTime) / 1000);
    if (syncLog) {
      await supabase.from('sync_log').update({
        status: complete && errors === 0 ? 'completed' : 'partial',
        records_processed: fetched,
        records_created: upserted,
        records_updated: 0,
        errors,
        error_details: firstError || skuError ? { first_error: firstError, product_skus_error: skuError, complete } : null,
        completed_at: new Date().toISOString(),
        duration_seconds: duration,
      }).eq('id', syncLog.id);
    }

    return NextResponse.json({
      success: complete && errors === 0 && !skuError,
      complete,
      stats: { pages, fetched, upserted, errors, product_skus_updated: skuUpdates, duration: `${duration}s` },
      first_error: firstError,
      product_skus_error: skuError,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('Inventory sync error:', msg);
    if (syncLog) {
      await supabase.from('sync_log').update({
        status: 'failed',
        error_details: { message: msg, pages, fetched, upserted },
        completed_at: new Date().toISOString(),
      }).eq('id', syncLog.id);
    }
    return NextResponse.json({ success: false, error: msg, stats: { pages, fetched, upserted } }, { status: 500 });
  }
}
