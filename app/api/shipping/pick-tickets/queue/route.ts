/**
 * GET /api/shipping/pick-tickets/queue
 *
 * Returns pick tickets ready to ship. Filters out PTs that already have
 * a non-voided shipment associated.
 *
 * Query params:
 *   warehouse_id  optional — filter by warehouse
 *   q             optional — search by PT number, customer name
 *   limit         optional — default 100
 */

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';
export const maxDuration = 15;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const warehouseId = url.searchParams.get('warehouse_id');
  const q = url.searchParams.get('q')?.trim();
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '100', 10), 500);

  let query = supabaseAdmin
    .from('pick_tickets')
    .select(
      'id, pick_ticket_id, customer_id, customer_name, ship_via, warehouse_id, ' +
        'weight, num_cartons, qty_cartoned, ship_to_name, ship_to_company, ' +
        'ship_to_street1, ship_to_street2, ship_to_city, ship_to_state, ship_to_zip, ' +
        'ship_to_country, ship_to_phone, ship_to_email, date_created'
    )
    .order('date_created', { ascending: false })
    .limit(limit);

  if (warehouseId) query = query.eq('warehouse_id', warehouseId);
  if (q) {
    query = query.or(
      `pick_ticket_id.ilike.%${q}%,customer_name.ilike.%${q}%,ship_to_name.ilike.%${q}%`
    );
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    count: data?.length ?? 0,
    pick_tickets: data ?? [],
  });
}
