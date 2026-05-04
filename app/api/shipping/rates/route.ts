/**
 * POST /api/shipping/rates
 *
 * Body: {
 *   warehouse_id: string,
 *   ship_to: Address,
 *   boxes: Box[],
 *   ship_via?: string,
 * }
 *
 * Returns RateQuote[]. Routes to UPS or EasyPost based on ship_via.
 */

import { NextResponse } from 'next/server';
import { carrierFor, resolveShipVia } from '@/lib/carriers';
import { getShipFromAddress } from '@/lib/carriers/warehouses';
import { Box, Address, RateRequest } from '@/lib/carriers/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

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
  const shipTo: Address | undefined = body?.ship_to;
  const shipVia: string | undefined = body?.ship_via;

  if (!warehouseId) return NextResponse.json({ error: 'warehouse_id is required' }, { status: 400 });
  if (!shipTo?.street1 || !shipTo?.city || !shipTo?.state || !shipTo?.zip)
    return NextResponse.json({ error: 'ship_to address is incomplete' }, { status: 400 });
  if (!shipVia) return NextResponse.json({ error: 'ship_via is required' }, { status: 400 });

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

  const rateReq: RateRequest = {
    shipFrom,
    shipTo,
    boxes,
    serviceCode: resolved.serviceCode,
  };

  try {
    const client = carrierFor(resolved.carrier);
    const quotes = await client.getRates(rateReq);
    return NextResponse.json({ quotes });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'rating failed' },
      { status: 502 }
    );
  }
}
