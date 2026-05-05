/**
 * GET /api/shipping/shipments/[id]/data
 *
 * Returns the full shipment record + boxes for use by the client-side
 * PDF generators (packing list, shipping invoice). Mirrors the shape that
 * generateShipmentPDF() expects.
 */

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: 'shipment id is required' }, { status: 400 });
  }

  const { data: shipment, error: shipErr } = await supabaseAdmin
    .from('shipments')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (shipErr) return NextResponse.json({ error: shipErr.message }, { status: 500 });
  if (!shipment) return NextResponse.json({ error: 'shipment not found' }, { status: 404 });

  const { data: boxes } = await supabaseAdmin
    .from('shipment_boxes')
    .select('*')
    .eq('shipment_id', id)
    .order('box_number');

  // Pull items from the originating PT(s) so the packing list shows what's
  // actually in this shipment.
  let items: any[] = [];
  if (Array.isArray(shipment.pick_ticket_ids) && shipment.pick_ticket_ids.length > 0) {
    const ptIds = shipment.pick_ticket_ids.map((x: any) => String(x));
    const { data: itemRows } = await supabaseAdmin
      .from('pick_ticket_items')
      .select('*')
      .in('pick_ticket_id', ptIds)
      .order('style_number');
    items = itemRows ?? [];
  }

  // If there's an invoice tied to the originating PT, pull it for the
  // "Print invoice" option.
  let invoice = null;
  let invoiceItems: any[] = [];
  if (Array.isArray(shipment.pick_ticket_ids) && shipment.pick_ticket_ids.length > 0) {
    const ptIds = shipment.pick_ticket_ids.map((x: any) => String(x));
    const { data: pts } = await supabaseAdmin
      .from('pick_tickets')
      .select('invoice_id')
      .in('pick_ticket_id', ptIds);

    const invoiceIds = (pts ?? [])
      .map((p) => p.invoice_id)
      .filter(Boolean) as string[];

    if (invoiceIds.length > 0) {
      const { data: inv } = await supabaseAdmin
        .from('invoices')
        .select('*')
        .eq('invoice_number', invoiceIds[0])
        .maybeSingle();
      invoice = inv;

      if (inv?.apparel_magic_id) {
        const { data: invItems } = await supabaseAdmin
          .from('invoice_items')
          .select('*')
          .eq('apparel_magic_invoice_id', inv.apparel_magic_id)
          .order('style_number');
        invoiceItems = invItems ?? [];
      }
    }
  }

  return NextResponse.json({
    shipment,
    boxes: boxes ?? [],
    items,
    invoice,
    invoice_items: invoiceItems,
  });
}
