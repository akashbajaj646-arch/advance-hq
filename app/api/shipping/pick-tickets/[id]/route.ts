/**
 * GET /api/shipping/pick-tickets/[id]
 *
 * Returns full pick ticket detail for the shipping/ship page:
 *   - PT header (ship_to, ship_via, customer info)
 *   - Customer location (for email/phone notifications)
 *   - Line items
 */

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: ptId } = await params;
  if (!ptId) {
    return NextResponse.json({ error: 'pick ticket id is required' }, { status: 400 });
  }

  // PT header
  const { data: pt, error: ptErr } = await supabaseAdmin
    .from('pick_tickets')
    .select('*')
    .eq('pick_ticket_id', ptId)
    .maybeSingle();

  if (ptErr) return NextResponse.json({ error: ptErr.message }, { status: 500 });
  if (!pt) return NextResponse.json({ error: 'pick ticket not found' }, { status: 404 });

  // Line items
  const { data: items, error: itemsErr } = await supabaseAdmin
    .from('pick_ticket_items')
    .select('*')
    .eq('pick_ticket_id', ptId)
    .order('style_number');

  if (itemsErr) {
    console.error('[pick-tickets/[id]] items lookup failed:', itemsErr);
  }

  // Customer location for notifications (email/phone)
  let customerLocation = null;
  if (pt.ship_to_id) {
    const { data: loc } = await supabaseAdmin
      .from('customer_locations')
      .select('email, phone, contact_name')
      .eq('am_ship_to_id', pt.ship_to_id)
      .maybeSingle();
    customerLocation = loc;
  }

  // Customer fallback email/phone if no location-specific one
  let customerFallback = null;
  if (pt.apparel_magic_customer_id) {
    const { data: cust } = await supabaseAdmin
      .from('customers')
      .select('email, phone')
      .eq('am_customer_id', pt.apparel_magic_customer_id)
      .maybeSingle();
    customerFallback = cust;
  }

  // Check if a shipment already exists for this PT (in any state)
  const { data: existingShipments } = await supabaseAdmin
    .from('shipments')
    .select('id, hq_status, tracking_number, voided_at, created_at')
    .contains('pick_ticket_ids', [ptId])
    .order('created_at', { ascending: false });

  return NextResponse.json({
    pick_ticket: pt,
    items: items ?? [],
    customer_location: customerLocation,
    customer_fallback: customerFallback,
    existing_shipments: existingShipments ?? [],
  });
}
