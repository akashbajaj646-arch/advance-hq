/**
 * POST /api/shipping/labels/create
 *
 * Creates labels via the resolved carrier (UPS or EasyPost USPS) and persists
 * the shipment + boxes to Supabase.
 */

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { carrierFor, resolveShipVia } from '@/lib/carriers';
import { getShipFromAddress } from '@/lib/carriers/warehouses';
import { Address, Box, LabelRequest } from '@/lib/carriers/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function validateBoxes(boxes: any): Box[] | string {
  if (!Array.isArray(boxes) || boxes.length === 0) return 'boxes must be a non-empty array';
  for (const [i, b] of boxes.entries()) {
    if (typeof b?.weightOz !== 'number' || b.weightOz <= 0)
      return `boxes[${i}].weightOz must be a positive number`;
    if (typeof b?.length !== 'number' || typeof b?.width !== 'number' || typeof b?.height !== 'number')
      return `boxes[${i}] must include numeric length/width/height`;
  }
  return boxes as Box[];
}

export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const warehouseId: string | undefined = body?.warehouse_id;
  const shipVia: string | undefined = body?.ship_via;
  const shipTo: Address | undefined = body?.ship_to;
  const pickTicketIds: string[] = Array.isArray(body?.pick_ticket_ids) ? body.pick_ticket_ids : [];
  const reference: string | undefined = body?.reference;
  const packingStationId: string | undefined = body?.packing_station_id;
  const createdByUserId: string | undefined = body?.created_by_user_id;

  if (!warehouseId) return NextResponse.json({ error: 'warehouse_id is required' }, { status: 400 });
  if (!shipVia) return NextResponse.json({ error: 'ship_via is required' }, { status: 400 });
  if (!shipTo?.street1 || !shipTo?.city || !shipTo?.state || !shipTo?.zip)
    return NextResponse.json({ error: 'ship_to address is incomplete' }, { status: 400 });

  const boxes = validateBoxes(body?.boxes);
  if (typeof boxes === 'string') return NextResponse.json({ error: boxes }, { status: 400 });

  let resolved;
  try {
    resolved = await resolveShipVia(shipVia);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'unknown ship_via' },
      { status: 400 }
    );
  }

  let shipFrom: Address;
  try {
    shipFrom = await getShipFromAddress(warehouseId, resolved.carrier);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'warehouse lookup failed' },
      { status: 400 }
    );
  }

  const labelReq: LabelRequest = {
    shipFrom,
    shipTo,
    boxes,
    serviceCode: resolved.serviceCode,
    reference,
  };

  let result;
  try {
    const client = carrierFor(resolved.carrier);
    result = await client.createLabel(labelReq);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'label creation failed' },
      { status: 502 }
    );
  }

  const firstTracking = result.boxes[0]?.trackingNumber || null;

  const upsVoidKey =
    resolved.carrier === 'ups'
      ? result.upsShipmentDigest || firstTracking
      : null;
  const easypostId =
    resolved.carrier === 'easypost_usps'
      ? result.carrierShipmentId || null
      : null;

  const { data: shipmentRow, error: insertErr } = await supabaseAdmin
    .from('shipments')
    .insert({
      source: 'advance_hq',
      hq_status: 'labeled',
      pick_ticket_ids: pickTicketIds,
      tracking_number: firstTracking,
      packing_station_id: packingStationId || null,
      created_by_user_id: createdByUserId || null,
      ups_shipment_digest: upsVoidKey,
      easypost_shipment_id: easypostId,
      total_cost: result.totalCostUsd,
      rate_quote: {
        ship_via: shipVia,
        carrier: result.carrier,
        service_code: result.serviceCode,
        service_name: result.serviceName,
        total_cost_usd: result.totalCostUsd,
      },
      ship_to_name: shipTo.name || shipTo.company || null,
      ship_to_address_1: shipTo.street1,
      ship_to_address_2: shipTo.street2 || null,
      ship_to_city: shipTo.city,
      ship_to_state: shipTo.state,
      ship_to_zip: shipTo.zip,
      ship_to_country: shipTo.country || 'US',
    })
    .select('id')
    .single();

  if (insertErr || !shipmentRow) {
    return NextResponse.json(
      {
        error: `label created at carrier but DB insert failed: ${insertErr?.message ?? 'unknown'}. ` +
          `Carrier: ${resolved.carrier}. UPS digest: ${upsVoidKey}. EasyPost id: ${easypostId}. Track: ${firstTracking}.`,
      },
      { status: 500 }
    );
  }

  const boxRows = result.boxes.map((b, i) => ({
    shipment_id: shipmentRow.id,
    box_number: i + 1,
    tracking_number: b.trackingNumber,
    weight: boxes[i].weightOz / 16,
    dim_length: boxes[i].length,
    dim_width: boxes[i].width,
    dim_height: boxes[i].height,
    label_zpl: b.zpl || null,
    label_pdf_url: b.pdfUrl || null,
    cost: b.costUsd ?? null,
  }));
  const { error: boxErr } = await supabaseAdmin.from('shipment_boxes').insert(boxRows);
  if (boxErr) {
    console.error('[labels/create] shipment_boxes insert failed:', boxErr);
  }

  return NextResponse.json({
    shipment_id: shipmentRow.id,
    carrier: result.carrier,
    service_code: result.serviceCode,
    service_name: result.serviceName,
    total_cost_usd: result.totalCostUsd,
    ups_shipment_digest: upsVoidKey,
    easypost_shipment_id: easypostId,
    boxes: result.boxes.map((b) => ({
      tracking_number: b.trackingNumber,
      cost_usd: b.costUsd,
      zpl: b.zpl,
      pdf_url: b.pdfUrl,
    })),
  });
}
