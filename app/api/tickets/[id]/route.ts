import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const [ticket, items, photos, comments] = await Promise.all([
    supabase.from('support_tickets').select('*').eq('id', params.id).single(),
    supabase.from('ticket_items').select('*').eq('ticket_id', params.id).order('created_at'),
    supabase.from('ticket_photos').select('*').eq('ticket_id', params.id).order('created_at'),
    supabase.from('ticket_comments').select('*').eq('ticket_id', params.id).order('created_at'),
  ]);

  return NextResponse.json({
    ticket: ticket.data,
    items: items.data || [],
    photos: photos.data || [],
    comments: comments.data || [],
  });
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const body = await request.json();
  const { data, error } = await supabase
    .from('support_tickets')
    .update(body)
    .eq('id', params.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}
