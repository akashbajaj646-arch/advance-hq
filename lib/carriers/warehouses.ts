/**
 * Warehouse helper. Returns the appropriate ship-from address for a
 * warehouse based on the carrier being used.
 *
 * The warehouse can be looked up by either:
 *   - Our slug ('leuning', 'state') — used by dev tools and admin UIs
 *   - ApparelMagic's numeric warehouse_id ('1', '2') — what comes from PT data
 *
 * Both resolve to the same warehouse row.
 */

import { supabaseAdmin } from '@/lib/supabase-admin';
import { Address, CarrierKey } from './types';

export interface WarehouseRow {
  id: string;
  am_warehouse_id: string | null;
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

export async function getWarehouse(idOrAmId: string): Promise<WarehouseRow> {
  const lookup = String(idOrAmId).trim();
  if (!lookup) throw new Error('warehouse id is required');

  let { data, error } = await supabaseAdmin
    .from('warehouses')
    .select('*')
    .eq('id', lookup)
    .eq('is_active', true)
    .maybeSingle();

  if (error) throw new Error(`warehouse lookup failed: ${error.message}`);

  if (!data) {
    const r = await supabaseAdmin
      .from('warehouses')
      .select('*')
      .eq('am_warehouse_id', lookup)
      .eq('is_active', true)
      .maybeSingle();
    if (r.error) throw new Error(`warehouse lookup failed: ${r.error.message}`);
    data = r.data;
  }

  if (!data) {
    throw new Error(
      `warehouse not found: ${lookup}. Tried both slug ID and ApparelMagic ID. ` +
        `If this is a new AM warehouse, insert a row in the warehouses table with am_warehouse_id='${lookup}'.`
    );
  }
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

export async function getShipFromAddress(
  warehouseIdOrAmId: string,
  carrier?: CarrierKey
): Promise<Address> {
  const w = await getWarehouse(warehouseIdOrAmId);

  if (carrier === 'easypost_usps') {
    return realAddress(w);
  }

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
