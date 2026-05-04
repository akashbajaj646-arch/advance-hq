/**
 * GET /api/shipping/pick-tickets/queue
 *
 * Returns pick tickets ready to ship from a warehouse. Joins to
 * customer_locations on ship_to_id to pull email + phone for the eventual
 * shipping notification (Week 6).
 *
 * Query params:
 *   warehouse_id  optional — filter by warehouse
 *   q             optional — search by PT number, customer name, ship_to_name
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

  // Pick tickets with the actual column names from your schema.
  let ptQuery = supabaseAdmin
    .from('pick_tickets')
    .select(
      'id, pick_ticket_id, customer_id, customer_name, ship_via, warehouse_id, ' +
        'weight, qty_cartoned, ship_to_id, ship_to_name, ' +
        'ship_to_address_1, ship_to_address_2, ship_to_city, ship_to_state, ship_to_zip, ' +
        'ship_to_country, ship_to_phone, status, is_void, tracking_number, ' +
        'pick_ticket_date, created_at'
    )
    .eq('is_void', false)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (warehouseId) ptQuery = ptQuery.eq('warehouse_id', warehouseId);
  if (q) {
    ptQuery = ptQuery.or(
      `pick_ticket_id.ilike.%${q}%,customer_name.ilike.%${q}%,ship_to_name.ilike.%${q}%`
    );
  }

  const { data: ptsData, error } = await ptQuery;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const pts = (ptsData ?? []) as any[];

  // For PTs that have a ship_to_id, look up customer_locations for email/phone.
  const shipToIds = Array.from(
    new Set(pts.map((p) => p.ship_to_id).filter(Boolean))
  ) as string[];

  const locationsById: Record<string, { email?: string; phone?: string }> = {};
  if (shipToIds.length > 0) {
    const { data: locations } = await supabaseAdmin
      .from('customer_locations')
      .select('am_ship_to_id, email, phone')
      .in('am_ship_to_id', shipToIds);
    for (const l of (locations ?? []) as any[]) {
      locationsById[l.am_ship_to_id] = {
        email: l.email || undefined,
        phone: l.phone || undefined,
      };
    }
  }

  const enriched = pts.map((p) => ({
    ...p,
    notification_email: p.ship_to_id ? locationsById[p.ship_to_id]?.email ?? null : null,
    notification_phone:
      (p.ship_to_id ? locationsById[p.ship_to_id]?.phone : null) ||
      p.ship_to_phone ||
      null,
  }));

  return NextResponse.json({
    count: enriched.length,
    pick_tickets: enriched,
  });
}
