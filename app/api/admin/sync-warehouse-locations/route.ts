import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const AM_URL = process.env.NEXT_PUBLIC_APPARELMAGIC_URL || '';
const AM_TOKEN = process.env.APPARELMAGIC_TOKEN || '';

function authParams() {
  return { time: Math.floor(Date.now() / 1000).toString(), token: AM_TOKEN };
}

function toNum(val: any): number {
  if (val === null || val === undefined || val === '') return 0;
  const n = parseFloat(val);
  return isNaN(n) ? 0 : n;
}

async function fetchWarehouseNames(): Promise<Record<string, string>> {
  const auth = authParams();
  // AM warehouse records use `id` and `name` (NOT warehouse_id / warehouse_name)
  const url = `${AM_URL}/warehouses?time=${auth.time}&token=${auth.token}&pagination[page_size]=50`;
  const map: Record<string, string> = {};
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'AdvanceHQ/1.0' } });
    if (!res.ok) return map;
    const data = await res.json();
    for (const w of data.response || []) {
      if (w.id) map[String(w.id)] = w.name || `Warehouse ${w.id}`;
    }
  } catch (e) {
    console.error('Failed to fetch warehouse names:', e);
  }
  return map;
}

async function fetchSkuWarehousePage(lastId?: string): Promise<{ records: any[]; nextLastId: string | null }> {
  const auth = authParams();
  let url = `${AM_URL}/sku_warehouse?time=${auth.time}&token=${auth.token}&pagination[page_size]=500`;
  if (lastId) url += `&pagination[last_id]=${lastId}`;

  const res = await fetch(url, { headers: { 'User-Agent': 'AdvanceHQ/1.0' } });
  if (!res.ok) throw new Error(`ApparelMagic API error: ${res.status}`);

  const data = await res.json();
  return {
    records: data.response || [],
    nextLastId: data.meta?.pagination?.last_id ? String(data.meta.pagination.last_id) : null,
  };
}

// GET = read-only probe for humans; Vercel cron also invokes via GET, so a
// request from the cron agent runs the real sync instead.
export async function GET(request: Request) {
  const isCron = (request.headers.get('user-agent') || '').includes('vercel-cron');
  if (isCron) return runSync();
  try {
    const warehouseNames = await fetchWarehouseNames();
    const { records } = await fetchSkuWarehousePage();
    const sample = records.slice(0, 5).map(r => ({
      sku_id: r.sku_id,
      warehouse_id: r.warehouse_id,
      location: r.location || null,
      qty: toNum(r.qty_inventory ?? r.qty ?? r.qty_on_hand),
    }));

    const { count } = await supabase
      .from('sku_warehouse_locations')
      .select('*', { count: 'exact', head: true });

    return NextResponse.json({
      probe: true,
      am_first_page_records: records.length,
      warehouses: warehouseNames,
      sample,
      rows_currently_in_supabase: count ?? 0,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Probe failed' }, { status: 500 });
  }
}

// POST = full sync of per-warehouse bin locations
export async function POST() {
  return runSync();
}

async function runSync() {
  const startTime = Date.now();

  const { data: syncLog } = await supabase
    .from('sync_log')
    .insert({ sync_type: 'warehouse_locations', source: 'apparel_magic', status: 'started' })
    .select().single();

  try {
    const warehouseNames = await fetchWarehouseNames();

    let totalFetched = 0;
    let totalUpserted = 0;
    let errors = 0;
    let firstError: string | null = null;
    let lastId: string | undefined = undefined;
    let pageNum = 0;

    while (true) {
      pageNum++;
      const { records, nextLastId } = await fetchSkuWarehousePage(lastId);
      if (records.length === 0) break;
      totalFetched += records.length;

      const rows = records
        .filter(r => r.sku_id && r.warehouse_id)
        .map(r => ({
          sku_id: String(r.sku_id),
          warehouse_id: String(r.warehouse_id),
          warehouse_name: warehouseNames[String(r.warehouse_id)] || `Warehouse ${r.warehouse_id}`,
          bin_location: (r.location || '').trim() || null,
          qty: toNum(r.qty_inventory ?? r.qty ?? r.qty_on_hand),
          last_synced_at: new Date().toISOString(),
        }));

      const { error } = await supabase
        .from('sku_warehouse_locations')
        .upsert(rows, { onConflict: 'sku_id,warehouse_id' });

      if (error) {
        errors += rows.length;
        if (!firstError) firstError = error.message;
        console.error(`Upsert error page ${pageNum}:`, error.message);
      } else {
        totalUpserted += rows.length;
      }

      console.log(`Page ${pageNum}: fetched ${records.length}, upserted total: ${totalUpserted}`);

      if (!nextLastId || records.length < 500) break;
      lastId = nextLastId;
    }

    const duration = Math.round((Date.now() - startTime) / 1000);

    if (syncLog) {
      await supabase.from('sync_log').update({
        status: 'completed',
        records_processed: totalFetched,
        records_updated: totalUpserted,
        errors,
        error_details: firstError ? { first_error: firstError } : null,
        completed_at: new Date().toISOString(),
        duration_seconds: duration,
      }).eq('id', syncLog.id);
    }

    return NextResponse.json({
      success: true,
      total_fetched: totalFetched,
      total_upserted: totalUpserted,
      errors,
      first_error: firstError,
      duration: `${duration}s`,
    });
  } catch (error: any) {
    console.error('Warehouse location sync error:', error);
    if (syncLog) {
      await supabase.from('sync_log').update({
        status: 'failed',
        error_details: { message: error.message || 'Unknown error' },
        completed_at: new Date().toISOString(),
      }).eq('id', syncLog.id);
    }
    return NextResponse.json({ error: error.message || 'Sync failed' }, { status: 500 });
  }
}
