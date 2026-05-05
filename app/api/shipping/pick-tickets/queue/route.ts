/**
 * GET /api/shipping/pick-tickets/queue
 *
 * Lists PTs that are eligible to be shipped:
 *   - is_void = false
 *   - no AHQ-created shipment exists for them yet
 *
 * Important: We only exclude PTs that have been shipped through AHQ
 * (source = 'advance_hq'). Historical shipments from ApparelMagic or
 * ShipStation sync (representing past shipping events) don't disqualify a PT.
 */

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const warehouse = searchParams.get('warehouse')?.trim();
  const search = searchParams.get('search')?.trim();
  const limit = Math.min(MAX_LIMIT, parseInt(searchParams.get('limit') || String(DEFAULT_LIMIT), 10));
  const offset = parseInt(searchParams.get('offset') || '0', 10);

  const { data: shippedRows, error: shippedErr } = await supabaseAdmin
    .from('shipments')
    .select('pick_ticket_ids, hq_status, voided_at, source')
    .eq('source', 'advance_hq')
    .in('hq_status', ['labeled', 'shipped'])
    .is('voided_at', null);

  if (shippedErr) {
    return NextResponse.json({ error: shippedErr.message }, { status: 500 });
  }

  const alreadyShippedPtIds = new Set<string>();
  for (const row of shippedRows || []) {
    if (Array.isArray(row.pick_ticket_ids)) {
      for (const id of row.pick_ticket_ids) {
        if (id) alreadyShippedPtIds.add(String(id));
      }
    }
  }

  let warehouseAmId: string | null = null;
  if (warehouse) {
    if (/^\d+$/.test(warehouse)) {
      warehouseAmId = warehouse;
    } else {
      const { data: w } = await supabaseAdmin
        .from('warehouses')
        .select('am_warehouse_id')
        .eq('id', warehouse)
        .maybeSingle();
      warehouseAmId = w?.am_warehouse_id ?? null;
      if (!warehouseAmId) warehouseAmId = warehouse;
    }
  }

  // NOTE: Removed num_cartons from the SELECT — it doesn't exist as a column
  // on pick_tickets. We use qty_cartoned (the actual column from the AM sync)
  // for the carton count display instead.
  let query: any = supabaseAdmin
    .from('pick_tickets')
    .select(
      'id, pick_ticket_id, customer_name, apparel_magic_customer_id, apparel_magic_order_id, ' +
        'invoice_id, ship_via, ship_to_name, ship_to_address_1, ship_to_address_2, ' +
        'ship_to_city, ship_to_state, ship_to_zip, ship_to_country, ship_to_phone, ' +
        'pick_ticket_date, qty, qty_cartoned, total_amount, weight, ' +
        'wms_status, carton_status, warehouse_id, is_void, is_locked',
      { count: 'exact' }
    )
    .eq('is_void', false)
    .order('pick_ticket_date', { ascending: false, nullsFirst: false })
    .range(offset, offset + limit - 1);

  if (warehouseAmId) query = query.eq('warehouse_id', warehouseAmId);
  if (search) {
    const safe = search.replace(/[%_]/g, '');
    query = query.or(
      `pick_ticket_id.ilike.%${safe}%,customer_name.ilike.%${safe}%,` +
        `apparel_magic_order_id.ilike.%${safe}%,invoice_id.ilike.%${safe}%`
    );
  }

  const { data, error, count } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const eligible = ((data ?? []) as any[]).filter(
    (pt) => !alreadyShippedPtIds.has(String(pt.pick_ticket_id))
  );

  return NextResponse.json({
    pick_tickets: eligible,
    total_in_db: count ?? eligible.length,
    eligible_count: eligible.length,
    limit,
    offset,
  });
}
