import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: CORS_HEADERS });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { email, event_type, page_title, page_url, product_id, product_title, search_query, shopify_customer_id, metadata } = body;

    if (!email || !event_type) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400, headers: CORS_HEADERS });
    }

    const { data: customer } = await supabase
      .from('customers')
      .select('id, am_customer_id')
      .eq('email', email.toLowerCase().trim())
      .single();

    const { error } = await supabase.from('customer_activity').insert({
      customer_id: customer?.id || null,
      am_customer_id: customer?.am_customer_id || null,
      email: email.toLowerCase().trim(),
      event_type,
      page_title: page_title || null,
      page_url: page_url || null,
      product_id: product_id || null,
      product_title: product_title || null,
      search_query: search_query || null,
      shopify_customer_id: shopify_customer_id || null,
      metadata: metadata || null,
      occurred_at: new Date().toISOString()
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500, headers: CORS_HEADERS });
    }

    return NextResponse.json({ success: true }, { headers: CORS_HEADERS });

  } catch (err) {
    return NextResponse.json({ error: 'Internal error' }, { status: 500, headers: CORS_HEADERS });
  }
}
