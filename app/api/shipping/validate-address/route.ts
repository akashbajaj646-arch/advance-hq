/**
 * POST /api/shipping/validate-address
 *
 * Body: {
 *   address: Address,
 *   carrier?: 'ups' | 'easypost_usps'   // defaults to 'ups'
 * }
 *
 * Returns AddressValidationResult. Caches successful validations in
 * `address_validations` keyed by a SHA-256 hash of the input address —
 * subsequent identical lookups skip the carrier call.
 */

import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { carrierFor, CarrierKey, Address } from '@/lib/carriers';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

function hashAddress(addr: Address, carrier: CarrierKey): string {
  const norm = [
    carrier,
    (addr.street1 || '').trim().toUpperCase(),
    (addr.street2 || '').trim().toUpperCase(),
    (addr.city || '').trim().toUpperCase(),
    (addr.state || '').trim().toUpperCase(),
    (addr.zip || '').trim().split('-')[0],
    (addr.country || 'US').toUpperCase(),
  ].join('|');
  return crypto.createHash('sha256').update(norm).digest('hex');
}

export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const address: Address | undefined = body?.address;
  const carrier: CarrierKey = body?.carrier === 'easypost_usps' ? 'easypost_usps' : 'ups';

  if (!address?.street1 || !address?.city || !address?.state || !address?.zip) {
    return NextResponse.json(
      { error: 'address.street1, address.city, address.state, address.zip are required' },
      { status: 400 }
    );
  }

  const hash = hashAddress(address, carrier);

  // Cache lookup
  const { data: cached } = await supabaseAdmin
    .from('address_validations')
    .select('status, is_residential, validated_json, raw_address')
    .eq('raw_address_hash', hash)
    .maybeSingle();

  if (cached) {
    return NextResponse.json({
      cached: true,
      status: cached.status,
      isResidential: cached.is_residential,
      validatedAddress: cached.validated_json,
    });
  }

  // Carrier call
  const client = carrierFor(carrier);
  let result;
  try {
    result = await client.validateAddress(address);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Validation failed' },
      { status: 502 }
    );
  }

  // Cache write — best effort, don't block response if it fails.
  void supabaseAdmin
    .from('address_validations')
    .insert({
      raw_address_hash: hash,
      carrier,
      status: result.status,
      is_residential: result.isResidential,
      validated_json: result.validatedAddress ?? null,
      raw_address: address,
    })
    .then(({ error }) => {
      if (error) console.warn('[validate-address] cache write failed:', error.message);
    });

  return NextResponse.json({
    cached: false,
    status: result.status,
    isResidential: result.isResidential,
    validatedAddress: result.validatedAddress,
    messages: result.messages,
  });
}
