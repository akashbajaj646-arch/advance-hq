import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

// POST /api/admin/automation-diff
// Diffs current per-SKU `active` state (from the nightly-synced `inventory` table)
// against sku_active_snapshot, records active-state transitions as automation_events,
// then updates the snapshot. First run seeds the snapshot as a baseline (no events).
//
// Lives under /api/admin (public path, like the other cron routes) so the nightly
// cron can call it after sync-inventory. Also triggered by "Run Detection Now" in the UI.

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const PAGE = 1000;

type SkuRow = {
  sku_id: string;
  product_id: string | null;
  style_number: string | null;
  attr_2: string | null;
  size: string | null;
  sku_concat: string | null;
  active: boolean | null;
};

async function readAll(table: string, columns: string): Promise<SkuRow[]> {
  const out: SkuRow[] = [];
  let from = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data, error } = await supabaseAdmin.from(table).select(columns).range(from, from + PAGE - 1);
    if (error) throw new Error(`${table} read failed: ${error.message}`);
    if (!data || data.length === 0) break;
    out.push(...(data as any[]));
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

export async function POST() {
  try {
    const startedAt = Date.now();

    const current = await readAll('inventory', 'sku_id,product_id,style_number,attr_2,size,sku_concat,active');
    const snapshot = await readAll('sku_active_snapshot', 'sku_id,product_id,style_number,attr_2,size,sku_concat,active');

    const snapMap = new Map(snapshot.map(r => [String(r.sku_id), r]));
    const isBaseline = snapshot.length === 0;

    const events: any[] = [];
    if (!isBaseline) {
      for (const cur of current) {
        const prev = snapMap.get(String(cur.sku_id));
        if (!prev) continue; // brand-new SKU: enters the snapshot, no transition event
        const was = prev.active === true;
        const is = cur.active === true;
        if (was === is) continue;
        events.push({
          event_type: is ? 'sku_reactivated' : 'sku_deactivated',
          sku_id: String(cur.sku_id),
          product_id: cur.product_id,
          style_number: cur.style_number,
          attr_2: cur.attr_2,
          size: cur.size,
          sku_concat: cur.sku_concat,
          status: 'pending',
        });
      }
    }

    // Dedupe: skip transitions that already have a pending event of the same type
    let inserted = 0;
    if (events.length) {
      const skuIds = events.map(e => e.sku_id);
      const { data: existing } = await supabaseAdmin
        .from('automation_events')
        .select('sku_id,event_type')
        .eq('status', 'pending')
        .in('sku_id', skuIds);
      const existingKeys = new Set((existing || []).map((e: any) => `${e.sku_id}|${e.event_type}`));
      const fresh = events.filter(e => !existingKeys.has(`${e.sku_id}|${e.event_type}`));

      for (let i = 0; i < fresh.length; i += 200) {
        const { error } = await supabaseAdmin.from('automation_events').insert(fresh.slice(i, i + 200));
        if (error) throw new Error(`event insert failed: ${error.message}`);
      }
      inserted = fresh.length;
    }

    // Refresh snapshot to current state
    const now = new Date().toISOString();
    const snapRows = current.map(c => ({
      sku_id: String(c.sku_id),
      product_id: c.product_id,
      style_number: c.style_number,
      attr_2: c.attr_2,
      size: c.size,
      sku_concat: c.sku_concat,
      active: c.active === true,
      captured_at: now,
    }));
    for (let i = 0; i < snapRows.length; i += 500) {
      const { error } = await supabaseAdmin.from('sku_active_snapshot').upsert(snapRows.slice(i, i + 500), { onConflict: 'sku_id' });
      if (error) throw new Error(`snapshot upsert failed: ${error.message}`);
    }

    return NextResponse.json({
      success: true,
      baseline: isBaseline,
      skus_scanned: current.length,
      transitions_detected: events.length,
      events_created: inserted,
      duration_ms: Date.now() - startedAt,
    });
  } catch (error: any) {
    console.error('Automation diff error:', error);
    return NextResponse.json({ success: false, error: String(error?.message || error) }, { status: 500 });
  }
}
