import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';

// ── Existing helper functions ──
async function searchCustomers(query: string) {
  const { data } = await supabase.from('customers').select('*').or(`customer_name.ilike.%${query}%,email.ilike.%${query}%,phone.ilike.%${query}%`).limit(5);
  return data;
}
async function getCustomerByName(name: string) {
  const { data } = await supabase.from('customers').select('*').ilike('customer_name', `%${name}%`).limit(1).single();
  return data;
}
async function getOrderById(orderId: string) {
  const { data } = await supabase.from('orders').select('*').or(`order_number.eq.${orderId},apparel_magic_id.eq.${orderId}`).limit(1).single();
  return data;
}
async function getOrdersByCustomerId(customerId: string) {
  const { data } = await supabase.from('orders').select('*').eq('apparel_magic_customer_id', customerId).order('order_date', { ascending: false }).limit(10);
  return data;
}
async function getPickTicketsByOrderId(orderId: string) {
  const { data } = await supabase.from('pick_tickets').select('*').eq('apparel_magic_order_id', orderId);
  return data;
}
async function getShipmentsByPickTicketId(pickTicketId: string) {
  const shipStationId = `AM-PT-${pickTicketId}`;
  const { data } = await supabase.from('shipments').select('*').eq('pick_ticket_id', shipStationId);
  return data;
}
async function getShipmentByTracking(trackingNumber: string) {
  const { data } = await supabase.from('shipments').select('*').eq('tracking_number', trackingNumber).limit(1).single();
  return data;
}
async function getUnpaidInvoices(limit: number = 10) {
  const { data } = await supabase.from('invoices').select('*').neq('payment_status', 'paid').order('balance_due', { ascending: false }).limit(limit);
  return data;
}
async function getInvoicesByCustomerId(customerId: string) {
  const { data } = await supabase.from('invoices').select('*').eq('apparel_magic_customer_id', customerId).order('invoice_date', { ascending: false }).limit(10);
  return data;
}
async function getRecentOrders(limit: number = 10) {
  const { data } = await supabase.from('orders').select('*').order('order_date', { ascending: false }).limit(limit);
  return data;
}
async function getRecentShipments(limit: number = 10) {
  const { data } = await supabase.from('shipments').select('*').order('ship_date', { ascending: false }).limit(limit);
  return data;
}

// ── NEW: Run read-only SQL queries ──
async function runSQL(sql: string): Promise<{ data: any; error: any }> {
  // Safety: only allow SELECT and WITH...SELECT
  const trimmed = sql.trim().toUpperCase();
  if (!trimmed.startsWith('SELECT') && !trimmed.startsWith('WITH')) {
    return { data: null, error: 'Only SELECT queries are allowed. No INSERT, UPDATE, DELETE, DROP, ALTER, or TRUNCATE.' };
  }
  const forbidden = ['INSERT ', 'UPDATE ', 'DELETE ', 'DROP ', 'ALTER ', 'TRUNCATE ', 'CREATE ', 'GRANT ', 'REVOKE '];
  for (const f of forbidden) {
    if (trimmed.includes(f)) {
      return { data: null, error: `Forbidden operation: ${f.trim()}` };
    }
  }

  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/run_readonly_query`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
      },
      body: JSON.stringify({ query_text: sql }),
    });
    const result = await response.json();
    if (response.ok) {
      return { data: result, error: null };
    } else {
      return { data: null, error: result.message || result.error || 'Query failed' };
    }
  } catch (err: any) {
    return { data: null, error: err.message };
  }
}

// Tool definitions
const tools = [
  {
    name: "search_customers",
    description: "Search for customers by name, email, or phone number",
    input_schema: { type: "object", properties: { query: { type: "string", description: "Search term" } }, required: ["query"] }
  },
  {
    name: "get_customer_by_name",
    description: "Get a specific customer's full details by their company name",
    input_schema: { type: "object", properties: { name: { type: "string", description: "Customer/company name" } }, required: ["name"] }
  },
  {
    name: "get_order",
    description: "Get details of a specific order by order number",
    input_schema: { type: "object", properties: { order_id: { type: "string", description: "Order number" } }, required: ["order_id"] }
  },
  {
    name: "get_customer_orders",
    description: "Get recent orders for a customer by their ApparelMagic customer ID",
    input_schema: { type: "object", properties: { customer_id: { type: "string", description: "ApparelMagic customer ID" } }, required: ["customer_id"] }
  },
  {
    name: "get_order_tracking",
    description: "Get pick tickets AND shipments for an order to check shipping status",
    input_schema: { type: "object", properties: { order_id: { type: "string", description: "Order number" } }, required: ["order_id"] }
  },
  {
    name: "get_shipment_by_tracking",
    description: "Get shipment details by tracking number",
    input_schema: { type: "object", properties: { tracking_number: { type: "string", description: "Tracking number" } }, required: ["tracking_number"] }
  },
  {
    name: "get_unpaid_invoices",
    description: "Get unpaid invoices sorted by balance due",
    input_schema: { type: "object", properties: { limit: { type: "number", description: "Max results (default 10)" } } }
  },
  {
    name: "get_customer_invoices",
    description: "Get invoices for a customer by their ApparelMagic customer ID",
    input_schema: { type: "object", properties: { customer_id: { type: "string", description: "ApparelMagic customer ID" } }, required: ["customer_id"] }
  },
  {
    name: "get_recent_orders",
    description: "Get the most recent orders",
    input_schema: { type: "object", properties: { limit: { type: "number", description: "Number of orders (default 10)" } } }
  },
  {
    name: "get_recent_shipments",
    description: "Get the most recent shipments",
    input_schema: { type: "object", properties: { limit: { type: "number", description: "Number of shipments (default 10)" } } }
  },
  {
    name: "query_database",
    description: `Run a read-only SQL query against the Advance Apparels database. Use this for analytical questions like revenue totals, counts, aggregations, comparisons, or any question that can't be answered by the other specific tools.

DATABASE SCHEMA:
- invoices (invoice_number, apparel_magic_id, apparel_magic_customer_id, invoice_date DATE, due_date DATE, total_amount NUMERIC, balance_due NUMERIC, amount_paid NUMERIC, qty NUMERIC, payment_status TEXT, void BOOLEAN, season TEXT, salesperson TEXT, division_name TEXT, warehouse_id TEXT)
- invoice_items (apparel_magic_invoice_id, style_number, description, color_name, size, qty NUMERIC, unit_price NUMERIC, amount NUMERIC)
- orders (order_number, apparel_magic_id, apparel_magic_customer_id, order_date TEXT, ship_date TEXT, cancel_date TEXT, order_status TEXT, total_amount TEXT, qty TEXT, qty_shipped TEXT, qty_open TEXT, season TEXT, customer_name TEXT, salesperson TEXT, division_name TEXT)
- order_items (apparel_magic_order_id, style_number, description, color_name, size, qty NUMERIC, qty_shipped NUMERIC, qty_open NUMERIC, unit_price NUMERIC, amount NUMERIC)
- customers (am_customer_id, customer_name, email, phone, city, state, country, category, price_group, credit_limit NUMERIC, is_active BOOLEAN)
- products (style_number, description, division, season, category, brand, wholesale_price TEXT, retail_price TEXT, cost TEXT, is_active BOOLEAN, apparel_magic_id TEXT)
- inventory (sku_id, product_id, style_number, description, attr_2 TEXT [color], size, qty_inventory NUMERIC, qty_avail_sell NUMERIC, qty_alloc NUMERIC, qty_open_sales NUMERIC, qty_open_po NUMERIC, price NUMERIC, cost NUMERIC, active BOOLEAN)
- shipments (am_shipment_id, shipstation_id, am_invoice_id, customer_name, ship_date TEXT, tracking_number, carrier_name, ship_via, weight, qty, qty_boxes, shipment_status)
- pick_tickets (pick_ticket_id, apparel_magic_order_id, invoice_id, customer_name, pick_ticket_date TEXT, qty, total_amount, wms_status, carton_status, is_void BOOLEAN)

IMPORTANT NOTES:
- invoices.total_amount is NUMERIC, orders.total_amount is TEXT (cast with ::numeric)
- invoices.invoice_date and due_date are DATE type
- orders.order_date and ship_date are TEXT type (cast with ::date if needed)
- Always use (void IS NULL OR void = false) when filtering invoices
- Use invoices for revenue calculations (not orders) as invoices represent actual billed amounts
- For product sales data, JOIN invoice_items with invoices on invoices.apparel_magic_id = invoice_items.apparel_magic_invoice_id
- Limit results to 50 rows max for readability
- Always include ORDER BY for sorted results`,
    input_schema: {
      type: "object",
      properties: {
        sql: {
          type: "string",
          description: "A read-only SELECT SQL query. Must start with SELECT or WITH. No INSERT/UPDATE/DELETE/DROP."
        },
        explanation: {
          type: "string",
          description: "Brief explanation of what this query does, shown to the user"
        }
      },
      required: ["sql", "explanation"]
    }
  }
];

// Execute tool calls
async function executeTool(name: string, input: any) {
  switch (name) {
    case "search_customers":
      return await searchCustomers(input.query);
    case "get_customer_by_name":
      return await getCustomerByName(input.name);
    case "get_order":
      return await getOrderById(input.order_id);
    case "get_customer_orders":
      return await getOrdersByCustomerId(input.customer_id);
    case "get_order_tracking":
      const pickTickets = await getPickTicketsByOrderId(input.order_id);
      const allShipments: any[] = [];
      if (pickTickets) {
        for (const pt of pickTickets) {
          const shipments = await getShipmentsByPickTicketId(pt.pick_ticket_id);
          if (shipments) allShipments.push(...shipments.map(s => ({ ...s, for_pick_ticket: pt.pick_ticket_id })));
        }
      }
      return { pick_tickets: pickTickets, shipments: allShipments };
    case "get_shipment_by_tracking":
      return await getShipmentByTracking(input.tracking_number);
    case "get_unpaid_invoices":
      return await getUnpaidInvoices(input.limit || 10);
    case "get_customer_invoices":
      return await getInvoicesByCustomerId(input.customer_id);
    case "get_recent_orders":
      return await getRecentOrders(input.limit || 10);
    case "get_recent_shipments":
      return await getRecentShipments(input.limit || 10);
    case "query_database":
      console.log(`AI SQL Query: ${input.sql}`);
      console.log(`Explanation: ${input.explanation}`);
      const result = await runSQL(input.sql);
      if (result.error) {
        return { error: result.error, sql: input.sql };
      }
      return { data: result.data, row_count: Array.isArray(result.data) ? result.data.length : 0, sql: input.sql };
    default:
      return { error: "Unknown tool" };
  }
}

const SYSTEM_PROMPT = `You are an AI assistant for Advance Apparels, a wholesale apparel company. You help staff look up customer information, orders, invoices, shipments, tracking, and answer analytical business questions.

You have access to the company's database through various tools. Use the specific tools (search_customers, get_order, etc.) for lookups. Use query_database for analytical questions like totals, aggregations, comparisons, trends, and any question the other tools can't answer.

CRITICAL - HOW TO CHECK IF AN ORDER HAS SHIPPED:
1. Get the pick ticket(s) for the order using get_order_tracking
2. Check if any of those pick_ticket_ids appear in the shipments array WITH a tracking_number
3. If a pick_ticket_id has a row in shipments with a tracking_number = the order HAS shipped
4. If no shipments exist for the pick ticket OR tracking_number is null/empty = NOT shipped
IGNORE all status fields (order_status, shipment_status, etc.) - they are unreliable.

USING query_database:
- Use this for ANY analytical or aggregate question: revenue, counts, averages, comparisons, rankings, etc.
- Use invoices (not orders) for revenue calculations since invoices = actual billed amounts
- Always filter invoices with (void IS NULL OR void = false)
- Cast orders.total_amount::numeric when needed (it's TEXT in orders, NUMERIC in invoices)
- Join invoice_items to invoices on invoices.apparel_magic_id = invoice_items.apparel_magic_invoice_id
- Limit results to 50 rows for readability
- If a query fails, try to fix it and retry

TRACKING URLs:
- UPS (starts with "1Z"): https://www.ups.com/track?tracknum={tracking_number}
- FedEx (12-22 digits): https://www.fedex.com/fedextrack/?trknbr={tracking_number}
- USPS (starts with "94"): https://tools.usps.com/go/TrackConfirmAction?tLabels={tracking_number}

Be concise and helpful. Format currency with $ and commas. Use readable date formats. When showing query results, present them in a clean, easy-to-read format.`;

export async function POST(request: Request) {
  try {
    const { message, history = [] } = await request.json();
    const messages = [...history, { role: "user", content: message }];

    let response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        tools,
        messages
      })
    });

    let data = await response.json();
    let iterations = 0;
    const MAX_ITERATIONS = 8;

    while (data.stop_reason === 'tool_use' && iterations < MAX_ITERATIONS) {
      iterations++;
      const toolUseBlocks = data.content.filter((block: any) => block.type === 'tool_use');
      const toolResults = [];

      for (const toolUse of toolUseBlocks) {
        console.log(`[AI] Tool: ${toolUse.name}`, toolUse.name === 'query_database' ? toolUse.input.sql : toolUse.input);
        const result = await executeTool(toolUse.name, toolUse.input);
        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: JSON.stringify(result, null, 2)
        });
      }

      messages.push({ role: "assistant", content: data.content });
      messages.push({ role: "user", content: toolResults });

      response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 4096,
          system: SYSTEM_PROMPT,
          tools,
          messages
        })
      });

      data = await response.json();
    }

    const textContent = data.content?.find((block: any) => block.type === 'text');
    const assistantMessage = textContent?.text || 'I apologize, but I was unable to generate a response.';

    return NextResponse.json({
      response: assistantMessage,
      history: [...history, { role: "user", content: message }, { role: "assistant", content: assistantMessage }]
    });

  } catch (error) {
    console.error('AI Chat error:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
  }
}
