import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const invoiceNumber = searchParams.get('invoice_number');

  if (!invoiceNumber) {
    return NextResponse.json({ error: 'invoice_number required' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('invoice_items')
    .select('id, style_number, description, attr_2, attr_3, size, qty, unit_price, amount, apparel_magic_invoice_id')
    .eq('apparel_magic_invoice_id', invoiceNumber)
    .order('style_number');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data: data || [] });
}
