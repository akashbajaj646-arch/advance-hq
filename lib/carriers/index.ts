/**
 * Carrier routing — picks the right client given a `ship_via` value or a
 * carrier key directly.
 *
 * The shipping_service_map table is the source of truth: each ship_via
 * string maps to one carrier and one service code.
 */

import { supabaseAdmin } from '@/lib/supabase-admin';
import { CarrierClient, CarrierKey } from './types';
import { upsClient } from './ups/client';
import { easypostClient } from './easypost/client';

export { upsClient, easypostClient };
export * from './types';

const REGISTRY: Record<CarrierKey, CarrierClient> = {
  ups: upsClient,
  easypost_usps: easypostClient,
};

export function carrierFor(key: CarrierKey): CarrierClient {
  const client = REGISTRY[key];
  if (!client) throw new Error(`Unknown carrier: ${key}`);
  return client;
}

export interface ShipViaResolution {
  carrier: CarrierKey;
  serviceCode: string;
  serviceName: string;
  client: CarrierClient;
}

/**
 * Resolve a ship_via value (e.g. "UPS Ground", "USPS Priority Mail") into
 * the carrier + service code + client. Throws if the ship_via string isn't
 * mapped — admin needs to add a row to shipping_service_map.
 */
export async function resolveShipVia(shipVia: string): Promise<ShipViaResolution> {
  const { data, error } = await supabaseAdmin
    .from('shipping_service_map')
    .select('carrier, service_code, service_name')
    .eq('ship_via_value', shipVia)
    .eq('is_active', true)
    .maybeSingle();

  if (error) throw new Error(`shipping_service_map lookup failed: ${error.message}`);
  if (!data) throw new Error(`No active shipping_service_map row for ship_via='${shipVia}'`);

  return {
    carrier: data.carrier as CarrierKey,
    serviceCode: data.service_code,
    serviceName: data.service_name,
    client: carrierFor(data.carrier as CarrierKey),
  };
}
