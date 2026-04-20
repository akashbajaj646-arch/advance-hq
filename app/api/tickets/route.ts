import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status');
  const search = searchParams.get('search');
  const page = parseInt(searchParams.get('page') || '0');
  const pageSize = 20;

  let query = supabase.from('support_tickets').select('*', { count: 'exact' });
  if (status) query = query.eq('status', status);
  if (search) query = query.or(`customer_name.ilike.%${search}%,customer_email.ilike.%${search}%,ticket_number.ilike.%${search}%,invoice_number.ilike.%${search}%`);
  
  const { data, count, error } = await query
    .order('created_at', { ascending: false })
    .range(page * pageSize, (page + 1) * pageSize - 1);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data, count });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { ticket, items, comments } = body;

  // Auto-match customer by email
  if (ticket.customer_email) {
    const { data: customer } = await supabase
      .from('customers')
      .select('id, am_customer_id')
      .eq('email', ticket.customer_email.toLowerCase().trim())
      .single();
    if (customer) {
      ticket.customer_id = customer.id;
      ticket.am_customer_id = customer.am_customer_id;
    }
  }

  // Auto-populate order/pick ticket from invoice
  if (ticket.invoice_number && !ticket.order_number) {
    const { data: invoice } = await supabase
      .from('invoices')
      .select('apparel_magic_order_id')
      .eq('invoice_number', ticket.invoice_number)
      .single();
    if (invoice) ticket.order_number = invoice.apparel_magic_order_id;
  }

  const { data: newTicket, error } = await supabase
    .from('support_tickets')
    .insert({ ...ticket, ticket_number: '' })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (items?.length) {
    await supabase.from('ticket_items').insert(items.map((item: any) => ({ ...item, ticket_id: newTicket.id })));
  }

  if (comments?.length) {
    await supabase.from('ticket_comments').insert(comments.map((c: any) => ({ ...c, ticket_id: newTicket.id })));
  }

  return NextResponse.json({ data: newTicket });
}
