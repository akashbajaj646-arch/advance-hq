/**
 * GET /api/shipping/warehouses
 *
 * Lists active warehouses for dropdowns. Does NOT include the CIE test
 * address fields — those are server-side concerns only.
 */

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';
export const maxDuration = 10;

export async function GET() {
  const { data, error } = await supabaseAdmin
    .from('warehouses')
    .select('id, display_name, company_name, street1, street2, city, state, zip, phone')
    .eq('is_active', true)
    .order('display_name');

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ warehouses: data ?? [] });
}
