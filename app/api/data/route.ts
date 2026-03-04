import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Server-side only — uses service role key, never exposed to browser
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Allowed tables — whitelist to prevent arbitrary table access
const ALLOWED_TABLES = new Set([
  'customers', 'customer_locations', 'hq_contacts',
  'orders', 'order_items', 'invoices', 'invoice_items',
  'pick_tickets', 'pick_ticket_items', 'shipments', 'shipment_boxes',
  'shipment_box_items', 'shipment_pallets', 'shipment_items',
  'products', 'product_skus', 'product_images', 'product_price_groups',
  'product_specs', 'product_bill_of_materials', 'product_prepacks',
  'product_tags', 'product_processes', 'product_royalties',
  'product_emblem_placements', 'product_buyer_filters',
  'custom_products', 'custom_product_images',
  'inventory', 'print_templates', 'sync_log',
  'divisions', 'vendors', 'size_ranges',
  'portals', 'portal_items', 'portal_attachments',
  'change_requests', 'credit_memos', 'payments',
]);

// Allowed RPC functions
const ALLOWED_RPCS = new Set([
  'get_sales_report', 'get_product_report', 'get_inventory_ar_report', 'get_customer_report',
]);

export async function POST(request: NextRequest) {
  // Verify session cookie
  const sessionToken = request.cookies.get('ahq_session')?.value;
  if (!sessionToken) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Validate session exists in database
  const { data: session } = await supabaseAdmin
    .from('app_sessions')
    .select('user_id, expires_at')
    .eq('token', sessionToken)
    .gt('expires_at', new Date().toISOString())
    .limit(1)
    .maybeSingle();

  if (!session) {
    return NextResponse.json({ error: 'Session expired' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { action } = body;

    if (action === 'query') {
      return handleQuery(body);
    } else if (action === 'rpc') {
      return handleRpc(body);
    } else if (action === 'mutate') {
      return handleMutate(body);
    } else {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }
  } catch (err: any) {
    console.error('Data API error:', err);
    return NextResponse.json({ error: err.message || 'Server error' }, { status: 500 });
  }
}

// SELECT queries
async function handleQuery(body: any) {
  const { table, select, filters, order, limit, rangeFrom, rangeTo, count, head } = body;

  if (!table || !ALLOWED_TABLES.has(table)) {
    return NextResponse.json({ error: `Table not allowed: ${table}` }, { status: 403 });
  }

  let query: any = supabaseAdmin.from(table).select(select || '*', {
    count: count || undefined,
    head: head || false,
  });

  // Apply filters
  if (filters && Array.isArray(filters)) {
    for (const f of filters) {
      switch (f.op) {
        case 'eq': query = query.eq(f.col, f.val); break;
        case 'neq': query = query.neq(f.col, f.val); break;
        case 'gt': query = query.gt(f.col, f.val); break;
        case 'gte': query = query.gte(f.col, f.val); break;
        case 'lt': query = query.lt(f.col, f.val); break;
        case 'lte': query = query.lte(f.col, f.val); break;
        case 'like': query = query.like(f.col, f.val); break;
        case 'ilike': query = query.ilike(f.col, f.val); break;
        case 'is': query = query.is(f.col, f.val); break;
        case 'in': query = query.in(f.col, f.val); break;
        case 'not_is': query = query.not(f.col, 'is', f.val); break;
        case 'not_eq': query = query.not(f.col, 'eq', f.val); break;
        case 'or': query = query.or(f.val); break;
        default: break;
      }
    }
  }

  // Apply ordering
  if (order && Array.isArray(order)) {
    for (const o of order) {
      query = query.order(o.col, { ascending: o.asc !== false });
    }
  }

  if (limit) query = query.limit(limit);

  // Apply range (pagination)
  if (rangeFrom !== undefined && rangeTo !== undefined) {
    query = query.range(rangeFrom, rangeTo);
  }

  // For maybeSingle
  if (body.single) {
    const result = await query.maybeSingle();
    return NextResponse.json({ data: result.data, count: null, error: result.error?.message });
  }

  const { data, count: cnt, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data, count: cnt });
}

// RPC calls
async function handleRpc(body: any) {
  const { fn, params } = body;

  if (!fn || !ALLOWED_RPCS.has(fn)) {
    return NextResponse.json({ error: `RPC not allowed: ${fn}` }, { status: 403 });
  }

  const { data, error } = await supabaseAdmin.rpc(fn, params || {});
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

// INSERT/UPDATE/DELETE for print_templates (and future writes)
const WRITABLE_TABLES = new Set(['print_templates']);

async function handleMutate(body: any) {
  const { table, type, data: payload, filters } = body;

  if (!table || !WRITABLE_TABLES.has(table)) {
    return NextResponse.json({ error: `Write not allowed: ${table}` }, { status: 403 });
  }

  if (type === 'insert') {
    const { data, error } = await supabaseAdmin.from(table).insert(payload).select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ data });
  }

  if (type === 'update' && filters) {
    let query: any = supabaseAdmin.from(table).update(payload);
    for (const f of filters) {
      if (f.op === 'eq') query = query.eq(f.col, f.val);
    }
    const { data, error } = await query.select();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ data });
  }

  if (type === 'delete' && filters) {
    let query: any = supabaseAdmin.from(table).delete();
    for (const f of filters) {
      if (f.op === 'eq') query = query.eq(f.col, f.val);
    }
    const { error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ data: null });
  }

  return NextResponse.json({ error: 'Invalid mutation type' }, { status: 400 });
}
