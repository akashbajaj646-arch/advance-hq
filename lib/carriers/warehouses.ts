/**
 * Warehouse helper. Returns the appropriate ship-from address for a
 * warehouse, honoring the Option A pattern: in CIE mode, use the test
 * address; in production, use the real address.
 *
 * This is the only place in the codebase that should know about the
 * CIE/production address split. Everything else just calls
 * getShipFromAddress(warehouseId).
 */

import { supabaseAdmin } from '@/lib/supabase-admin';
import { Address } from './types';

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

/**
 * Returns the ship-from Address for a warehouse, picking the CIE test
 * address when UPS_ENV is not 'production'.
 *
 * If a CIE test address isn't configured but UPS_ENV is 'cie', falls back
 * to the real address with a warning logged.
 */
export async function getShipFromAddress(warehouseId: string): Promise<Address> {
  const w = await getWarehouse(warehouseId);
  const isProd = process.env.UPS_ENV === 'production';

  if (!isProd && w.cie_street1 && w.cie_city && w.cie_state && w.cie_zip) {
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

  if (!isProd) {
    console.warn(
      `[warehouses] UPS_ENV=cie but no CIE test address for warehouse=${w.id}. ` +
        `Falling back to real address; UPS may reject if state is not NY/CA.`
    );
  }

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
