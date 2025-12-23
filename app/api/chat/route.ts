import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';

// Database query functions
async function searchCustomers(query: string) {
  const { data } = await supabase
    .from('customers')
    .select('*')
    .or(`customer_name.ilike.%${query}%,email.ilike.%${query}%,phone.ilike.%${query}%`)
    .limit(5);
  return data;
}

async function getCustomerByName(name: string) {
  const { data } = await supabase
    .from('customers')
    .select('*')
    .ilike('customer_name', `%${name}%`)
    .limit(1)
    .single();
  return data;
}

async function getOrderById(orderId: string) {
  const { data } = await supabase
    .from('orders')
    .select('*')
    .or(`order_number.eq.${orderId},apparel_magic_id.eq.${orderId}`)
    .limit(1)
    .single();
  return data;
}

async function getOrdersByCustomerId(customerId: string) {
  const { data } = await supabase
    .from('orders')
    .select('*')
    .eq('apparel_magic_customer_id', customerId)
    .order('order_date', { ascending: false })
    .limit(10);
  return data;
}

async function getPickTicketsByOrderId(orderId: string) {
  const { data } = await supabase
    .from('pick_tickets')
    .select('*')
    .eq('apparel_magic_order_id', orderId);
  return data;
}

async function getShipmentsByPickTicketId(pickTicketId: string) {
  // ShipStation stores pick ticket IDs with AM-PT- prefix
  const shipStationId = `AM-PT-${pickTicketId}`;
  const { data } = await supabase
    .from('shipments')
    .select('*')
    .eq('pick_ticket_id', shipStationId);
  return data;
}

async function getShipmentByTracking(trackingNumber: string) {
  const { data } = await supabase
    .from('shipments')
    .select('*')
    .eq('tracking_number', trackingNumber)
    .limit(1)
    .single();
  return data;
}

async function getUnpaidInvoices(limit: number = 10) {
  const { data } = await supabase
    .from('invoices')
    .select('*')
    .neq('payment_status', 'paid')
    .order('balance_due', { ascending: false })
    .limit(limit);
  return data;
}

async function getInvoicesByCustomerId(customerId: string) {
  const { data } = await supabase
    .from('invoices')
    .select('*')
    .eq('apparel_magic_customer_id', customerId)
    .order('invoice_date', { ascending: false })
    .limit(10);
  return data;
}

async function getRecentOrders(limit: number = 10) {
  const { data } = await supabase
    .from('orders')
    .select('*')
    .order('order_date', { ascending: false })
    .limit(limit);
  return data;
}

async function getRecentShipments(limit: number = 10) {
  const { data } = await supabase
    .from('shipments')
    .select('*')
    .order('ship_date', { ascending: false })
    .limit(limit);
  return data;
}

// Tool definitions for Claude
const tools = [
  {
    name: "search_customers",
    description: "Search for customers by name, email, or phone number",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search term (name, email, or phone)" }
      },
      required: ["query"]
    }
  },
  {
    name: "get_customer_by_name",
    description: "Get a specific customer's full details by their company name",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Customer/company name" }
      },
      required: ["name"]
    }
  },
  {
    name: "get_order",
    description: "Get details of a specific order by order number",
    input_schema: {
      type: "object",
      properties: {
        order_id: { type: "string", description: "Order number" }
      },
      required: ["order_id"]
    }
  },
  {
    name: "get_customer_orders",
    description: "Get recent orders for a customer by their ApparelMagic customer ID",
    input_schema: {
      type: "object",
      properties: {
        customer_id: { type: "string", description: "ApparelMagic customer ID (am_customer_id)" }
      },
      required: ["customer_id"]
    }
  },
  {
    name: "get_order_tracking",
    description: "Get pick tickets AND shipments for an order. This returns both pick ticket info from ApparelMagic and shipment info from ShipStation. Always use this to check if an order has been shipped.",
    input_schema: {
      type: "object",
      properties: {
        order_id: { type: "string", description: "Order number" }
      },
      required: ["order_id"]
    }
  },
  {
    name: "get_shipment_by_tracking",
    description: "Get shipment details by tracking number",
    input_schema: {
      type: "object",
      properties: {
        tracking_number: { type: "string", description: "Tracking number" }
      },
      required: ["tracking_number"]
    }
  },
  {
    name: "get_unpaid_invoices",
    description: "Get a list of unpaid invoices, optionally filtered by minimum amount",
    input_schema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Maximum number of invoices to return (default 10)" }
      }
    }
  },
  {
    name: "get_customer_invoices",
    description: "Get invoices for a specific customer by their ApparelMagic customer ID",
    input_schema: {
      type: "object",
      properties: {
        customer_id: { type: "string", description: "ApparelMagic customer ID" }
      },
      required: ["customer_id"]
    }
  },
  {
    name: "get_recent_orders",
    description: "Get the most recent orders",
    input_schema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Number of orders to return (default 10)" }
      }
    }
  },
  {
    name: "get_recent_shipments",
    description: "Get the most recent shipments",
    input_schema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Number of shipments to return (default 10)" }
      }
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
      // Get shipments for each pick ticket
      const allShipments: any[] = [];
      if (pickTickets) {
        for (const pt of pickTickets) {
          const shipments = await getShipmentsByPickTicketId(pt.pick_ticket_id);
          if (shipments) {
            allShipments.push(...shipments.map(s => ({ ...s, for_pick_ticket: pt.pick_ticket_id })));
          }
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
    default:
      return { error: "Unknown tool" };
  }
}

const SYSTEM_PROMPT = `You are an AI assistant for Advance Apparels, a wholesale apparel company. You help staff look up customer information, orders, invoices, shipments, and tracking information.

You have access to the company's database through various tools. Use them to answer questions accurately.

CRITICAL - HOW TO CHECK IF AN ORDER HAS SHIPPED:
1. Get the pick ticket(s) for the order using get_order_tracking
2. Check if any of those pick_ticket_ids appear in the shipments array WITH a tracking_number
3. If a pick_ticket_id has a row in shipments with a tracking_number = the order HAS shipped
4. If no shipments exist for the pick ticket OR tracking_number is null/empty = NOT shipped

IGNORE all status fields (order_status, shipment_status, etc.) - they are unreliable.
The ONLY way to know if something shipped is: does the pick_ticket_id have a tracking number in the shipments table?

Data flow: Order → Pick Ticket(s) → Shipments (by pick_ticket_id)

When providing tracking information, include the tracking URL:
- UPS tracking numbers start with "1Z": https://www.ups.com/track?tracknum={tracking_number}
- FedEx tracking numbers are typically 12-22 digits: https://www.fedex.com/fedextrack/?trknbr={tracking_number}
- USPS tracking numbers start with "94" or are 20-22 digits: https://tools.usps.com/go/TrackConfirmAction?tLabels={tracking_number}

Be concise and helpful. Format currency values properly. When showing dates, use a readable format.

If you need to look up a customer's orders or invoices, first search for the customer to get their ID, then use that ID to look up their orders/invoices.`;

export async function POST(request: Request) {
  try {
    const { message, history = [] } = await request.json();

    // Build messages array
    const messages = [
      ...history,
      { role: "user", content: message }
    ];

    // Initial API call
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
        tools: tools,
        messages: messages
      })
    });

    let data = await response.json();

    // Handle tool use in a loop
    while (data.stop_reason === 'tool_use') {
      const toolUseBlocks = data.content.filter((block: any) => block.type === 'tool_use');
      const toolResults = [];

      for (const toolUse of toolUseBlocks) {
        console.log(`Executing tool: ${toolUse.name}`, toolUse.input);
        const result = await executeTool(toolUse.name, toolUse.input);
        console.log(`Tool result:`, result);
        
        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: JSON.stringify(result, null, 2)
        });
      }

      // Continue conversation with tool results
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
          tools: tools,
          messages: messages
        })
      });

      data = await response.json();
    }

    // Extract text response
    const textContent = data.content?.find((block: any) => block.type === 'text');
    const assistantMessage = textContent?.text || 'I apologize, but I was unable to generate a response.';

    return NextResponse.json({
      response: assistantMessage,
      history: [
        ...history,
        { role: "user", content: message },
        { role: "assistant", content: assistantMessage }
      ]
    });

  } catch (error) {
    console.error('AI Chat error:', error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}
