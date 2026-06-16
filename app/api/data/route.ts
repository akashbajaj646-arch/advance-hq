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
  'purchase_orders', 'purchase_order_items',
  // Shipping module additions
  'warehouses', 'package_presets', 'address_validations',
  'notification_templates', 'notification_queue', 'tracking_events',
  'shipping_service_map',
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
    return NextResponse.json({ error: 'Invalid or expired session' }, { status: 401 });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { kind, table, rpc, fn, args, query } = body;

  // RPC path
  if (kind === 'rpc') {
    if (!ALLOWED_RPCS.has(fn || rpc)) {
      return NextResponse.json({ error: `RPC not allowed: ${fn || rpc}` }, { status: 403 });
    }
    const { data, error } = await supabaseAdmin.rpc(fn || rpc, args || {});
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ data });
  }

  // Table query path
  if (!table || !ALLOWED_TABLES.has(table)) {
    return NextResponse.json({ error: `Table not allowed: ${table}` }, { status: 403 });
  }

  let q: any = supabaseAdmin.from(table).select(query?.select || '*', {
    count: query?.count,
    head: query?.head,
  });

  if (Array.isArray(query?.filters)) {
    for (const f of query.filters) {
      const { op, col, val } = f;
      switch (op) {
        case 'eq': q = q.eq(col, val); break;
        case 'neq': q = q.neq(col, val); break;
        case 'gt': q = q.gt(col, val); break;
        case 'gte': q = q.gte(col, val); break;
        case 'lt': q = q.lt(col, val); break;
        case 'lte': q = q.lte(col, val); break;
        case 'like': q = q.like(col, val); break;
        case 'ilike': q = q.ilike(col, val); break;
        case 'is': q = q.is(col, val); break;
        case 'in': q = q.in(col, val); break;
        case 'not_is': q = q.not(col, 'is', val); break;
        case 'not_eq': q = q.not(col, 'eq', val); break;
        case 'or': q = q.or(val); break;
      }
    }
  }

  if (Array.isArray(query?.order)) {
    for (const o of query.order) {
      q = q.order(o.col, { ascending: !!o.asc });
    }
  }

  if (typeof query?.limit === 'number') q = q.limit(query.limit);

  if (typeof query?.rangeFrom === 'number' && typeof query?.rangeTo === 'number') {
    q = q.range(query.rangeFrom, query.rangeTo);
  }

  if (query?.single) {
    const { data, error, count } = await (q as any).maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ data, count: count ?? null });
  }

  const { data, error, count } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data, count: count ?? null });
}
