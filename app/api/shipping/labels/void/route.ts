/**
 * POST /api/shipping/labels/void
 *
 * Body: {
 *   shipment_id: string,
 *   tracking_numbers?: string[],
 *   voided_by_user_id?: string,
 * }
 *
 * Voids the label at the carrier and updates Supabase. Idempotent. Routes
 * to UPS or EasyPost based on which carrier identifier the shipment has.
 */

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { upsClient, easypostClient } from '@/lib/carriers';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const shipmentId: string | undefined = body?.shipment_id;
  const trackingNumbers: string[] | undefined = body?.tracking_numbers;
  const voidedByUserId: string | undefined = body?.voided_by_user_id;

  if (!shipmentId) {
    return NextResponse.json({ error: 'shipment_id is required' }, { status: 400 });
  }

  const { data: shipment, error: fetchErr } = await supabaseAdmin
    .from('shipments')
    .select(
      'id, hq_status, source, ups_shipment_digest, easypost_shipment_id, voided_at, tracking_number'
    )
    .eq('id', shipmentId)
    .maybeSingle();

  if (fetchErr) {
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }
  if (!shipment) {
    return NextResponse.json({ error: 'shipment not found' }, { status: 404 });
  }

  if (shipment.voided_at || shipment.hq_status === 'voided') {
    return NextResponse.json({
      success: true,
      already_voided: true,
      voided_at: shipment.voided_at,
    });
  }

  const upsVoidKey = shipment.ups_shipment_digest || shipment.tracking_number;
  const easypostId = shipment.easypost_shipment_id;

  if (!upsVoidKey && !easypostId) {
    return NextResponse.json(
      { error: 'shipment has no carrier identifier; cannot void' },
      { status: 422 }
    );
  }

  // Route to the right carrier. If both are set (shouldn't happen), prefer
  // EasyPost since that's what the shipment was actually purchased through.
  const isEasypost = !!easypostId;

  if (isEasypost) {
    let result;
    try {
      result = await easypostClient.voidLabel({ carrierShipmentId: easypostId });
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : 'void failed' },
        { status: 502 }
      );
    }

    if (!result.success) {
      return NextResponse.json(
        { error: result.message || 'EasyPost rejected the refund request' },
        { status: 502 }
      );
    }

    const { error: updErr } = await supabaseAdmin
      .from('shipments')
      .update({
        hq_status: 'voided',
        voided_at: new Date().toISOString(),
        voided_by_user_id: voidedByUserId || null,
      })
      .eq('id', shipmentId);
    if (updErr) {
      console.error('[labels/void] EasyPost DB update failed:', updErr);
      return NextResponse.json({
        success: true,
        warning: `refunded at EasyPost but DB update failed: ${updErr.message}`,
      });
    }

    return NextResponse.json({
      success: true,
      message: result.message,
    });
  }

  // UPS path
  const isCieFake = upsVoidKey?.includes('XXXXXXXX');
  if (isCieFake) {
    const { error: updErr } = await supabaseAdmin
      .from('shipments')
      .update({
        hq_status: 'voided',
        voided_at: new Date().toISOString(),
        voided_by_user_id: voidedByUserId || null,
      })
      .eq('id', shipmentId);
    if (updErr) console.error('[labels/void] CIE void DB update failed:', updErr);
    return NextResponse.json({
      success: true,
      message:
        'Marked voided in DB. UPS CIE does not support voiding fake tracking numbers; production voids will call UPS normally.',
      cie_simulated: true,
    });
  }

  let result;
  try {
    result = await upsClient.voidLabel({
      upsShipmentDigest: upsVoidKey!,
      trackingNumbers,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'void failed' },
      { status: 502 }
    );
  }

  if (!result.success) {
    return NextResponse.json(
      { error: result.message || 'UPS rejected the void request' },
      { status: 502 }
    );
  }

  const { error: updErr } = await supabaseAdmin
    .from('shipments')
    .update({
      hq_status: 'voided',
      voided_at: new Date().toISOString(),
      voided_by_user_id: voidedByUserId || null,
    })
    .eq('id', shipmentId);

  if (updErr) {
    console.error('[labels/void] DB update failed:', updErr);
    return NextResponse.json({
      success: true,
      warning: `voided at UPS but DB update failed: ${updErr.message}`,
    });
  }

  return NextResponse.json({ success: true, message: result.message });
}
