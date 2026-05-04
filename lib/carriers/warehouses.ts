/**
 * Warehouse helper. Returns the appropriate ship-from address for a
 * warehouse based on the carrier being used.
 *
 * UPS Customer Integration Environment (CIE) only validates NY/CA addresses,
 * so for UPS we use the CIE test address (a fake CA address) when in sandbox.
 *
 * EasyPost has no equivalent sandbox restriction — it ALWAYS validates
 * against real USPS data even in test mode. So for EasyPost we always
 * use the real NJ warehouse address, even in dev/test.
 *
 * This is the only place in the codebase that should know about the
 * CIE vs production address split. Everything else just calls
 * getShipFromAddress(warehouseId, carrier).
 */

import { supabaseAdmin } from '@/lib/supabase-admin';
import { Address, CarrierKey } from './types';

export interface WarehouseRow {
  id: string;
  display_name: string;
  company_name: string;
  contact_name: string | null;
  phone: string;
  email: string | null;
  street1: string;
  street2: string | null;
  city: string;
  state: string;
  zip: string;
  country: string;
  cie_company_name: string | null;
  cie_contact_name: string | null;
  cie_phone: string | null;
  cie_street1: string | null;
  cie_street2: string | null;
  cie_city: string | null;
  cie_state: string | null;
  cie_zip: string | null;
  cie_country: string | null;
}

export async function getWarehouse(id: string): Promise<WarehouseRow> {
  const { data, error } = await supabaseAdmin
    .from('warehouses')
    .select('*')
    .eq('id', id)
    .eq('is_active', true)
    .maybeSingle();

  if (error) throw new Error(`warehouse lookup failed: ${error.message}`);
  if (!data) throw new Error(`warehouse not found: ${id}`);
  return data as WarehouseRow;
}

export async function listWarehouses(): Promise<WarehouseRow[]> {
  const { data, error } = await supabaseAdmin
    .from('warehouses')
    .select('*')
    .eq('is_active', true)
    .order('display_name');
  if (error) throw new Error(`warehouse list failed: ${error.message}`);
  return (data ?? []) as WarehouseRow[];
}

function realAddress(w: WarehouseRow): Address {
  return {
    name: w.contact_name || w.company_name,
    company: w.company_name,
    phone: w.phone,
    email: w.email || undefined,
    street1: w.street1,
    street2: w.street2 || undefined,
    city: w.city,
    state: w.state,
    zip: w.zip,
    country: w.country,
  };
}

function cieTestAddress(w: WarehouseRow): Address | null {
  if (!w.cie_street1 || !w.cie_city || !w.cie_state || !w.cie_zip) return null;
  return {
    name: w.cie_contact_name || w.cie_company_name || 'Test',
    company: w.cie_company_name || 'Test',
    phone: w.cie_phone || '5555555555',
    street1: w.cie_street1,
    street2: w.cie_street2 || undefined,
    city: w.cie_city,
    state: w.cie_state,
    zip: w.cie_zip,
    country: w.cie_country || 'US',
  };
}

/**
 * Returns the ship-from Address for a warehouse, picking based on carrier.
 *
 * - UPS in sandbox (UPS_ENV != 'production'): uses the CIE test address
 *   because UPS CIE only accepts NY/CA addresses.
 * - UPS in production OR EasyPost (any env): uses the real warehouse
 *   address. EasyPost validates against real USPS data even in test mode,
 *   so fake addresses won't work there.
 *
 * If carrier is omitted, defaults to behavior optimized for whichever
 * carrier sandbox is most restrictive (UPS), to be safe.
 */
export async function getShipFromAddress(
  warehouseId: string,
  carrier?: CarrierKey
): Promise<Address> {
  const w = await getWarehouse(warehouseId);

  // EasyPost: always use real address. EasyPost validates against real USPS
  // data even in test mode and rejects fake addresses with E.ADDRESS.NOT_FOUND.
  if (carrier === 'easypost_usps') {
    return realAddress(w);
  }

  // UPS (or unspecified): swap to CIE test address in non-prod when available.
  const isProd = process.env.UPS_ENV === 'production';
  if (!isProd) {
    const test = cieTestAddress(w);
    if (test) return test;
    console.warn(
      `[warehouses] UPS_ENV=cie but no CIE test address for warehouse=${w.id}. ` +
        `Falling back to real address; UPS may reject if state is not NY/CA.`
    );
  }

  return realAddress(w);
}
