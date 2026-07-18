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
  // PLM module additions (see PLM.md)
  'partners', 'raw_materials',
  'samples', 'sample_versions', 'sample_timeline_events',
  'tech_pack_measurements', 'sample_bom', 'routing_steps',
  'sample_milestones',
  'raw_material_stock', 'stock_movements',
  'manufacturing_pos', 'manufacturing_po_lines', 'wip_status',
  'outsource_dispatches', 'outsource_receipts',
  // PLM read-only views
  'v_available_to_cut', 'v_outsource_open', 'v_vendor_performance',
]);

// Tables the mutation path may write to. Deliberately narrower than
// ALLOWED_TABLES: AM-synced tables stay read-only here (sync routes own
// their writes with the service client directly), and views can't be
// written at all. Currently: PLM tables only.
const MUTABLE_TABLES = new Set([
  'partners', 'raw_materials',
  'samples', 'sample_versions', 'sample_timeline_events',
  'tech_pack_measurements', 'sample_bom', 'routing_steps',
  'sample_milestones',
  'raw_material_stock', 'stock_movements',
  'manufacturing_pos', 'manufacturing_po_lines', 'wip_status',
  'outsource_dispatches', 'outsource_receipts',
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

  const { kind, action, table, rpc, fn, args, query, type, data, filters } = body;

  // RPC path
  if (kind === 'rpc') {
    if (!ALLOWED_RPCS.has(fn || rpc)) {
      return NextResponse.json({ error: `RPC not allowed: ${fn || rpc}` }, { status: 403 });
    }
    const { data: rpcData, error } = await supabaseAdmin.rpc(fn || rpc, args || {});
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ data: rpcData });
  }

  // Mutation path — handles db.ts insert/update/delete ({ action: 'mutate' }).
  // NOTE: before this handler existed, mutation requests fell through to the
  // query path below and silently performed a SELECT — writes were dropped.
  if (action === 'mutate') {
    if (!table || !MUTABLE_TABLES.has(table)) {
      return NextResponse.json({ error: `Table not writable: ${table}` }, { status: 403 });
    }
    if (type === 'insert') {
      if (!data) return NextResponse.json({ error: 'Missing data for insert' }, { status: 400 });
      const { data: out, error } = await supabaseAdmin.from(table).insert(data).select();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ data: out });
    }
    if (type === 'update' || type === 'delete') {
      // Refuse unfiltered updates/deletes — protects against wiping a table.
      if (!Array.isArray(filters) || filters.length === 0) {
        return NextResponse.json({ error: `Refusing ${type} without filters` }, { status: 400 });
      }
      let m: any = type === 'update'
        ? supabaseAdmin.from(table).update(data || {})
        : supabaseAdmin.from(table).delete();
      for (const f of filters) {
        const { op, col, val } = f;
        switch (op) {
          case 'eq': m = m.eq(col, val); break;
          case 'neq': m = m.neq(col, val); break;
          case 'in': m = m.in(col, val); break;
          case 'is': m = m.is(col, val); break;
          default:
            return NextResponse.json({ error: `Filter op not allowed in mutations: ${op}` }, { status: 400 });
        }
      }
      const { data: out, error } = await m.select();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ data: out });
    }
    return NextResponse.json({ error: `Unknown mutation type: ${type}` }, { status: 400 });
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
    const { data: qd, error, count } = await (q as any).maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ data: qd, count: count ?? null });
  }

  const { data: qd, error, count } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data: qd, count: count ?? null });
}
