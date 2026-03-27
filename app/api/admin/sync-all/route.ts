import { NextResponse } from 'next/server';
import { POST as syncCustomers } from '../sync-customers/route';
import { POST as syncProducts } from '../sync-products/route';
import { POST as syncInventory } from '../sync-inventory/route';
import { POST as syncOrders } from '../sync-orders/route';
import { POST as syncInvoices } from '../sync-invoices/route';
import { POST as syncShipments } from '../sync-shipments/route';
import { POST as syncPickTickets } from '../sync-pick-tickets/route';

export const maxDuration = 300;

async function safeRun(label: string, fn: () => Promise<Response>): Promise<any> {
  try {
    const res = await fn();
    const text = await res.text();
    try {
      return { label, ...(JSON.parse(text)) };
    } catch {
      return { label, error: `Non-JSON: ${text.slice(0, 200)}` };
    }
  } catch (err) {
    return { label, error: err instanceof Error ? err.message : 'Failed' };
  }
}

export async function POST(request: Request) {
  const startTime = Date.now();

  console.log('🚀 Starting full parallel data sync...\n');

  // Run all syncs in parallel
  const [customers, products, inventory, orders, invoices, shipments, pickTickets] =
    await Promise.all([
      safeRun('Customers',    () => syncCustomers(new Request('http://localhost'))),
      safeRun('Products',     () => syncProducts(new Request('http://localhost'))),
      safeRun('Inventory',    () => syncInventory(new Request('http://localhost'))),
      safeRun('Orders',       () => syncOrders(new Request('http://localhost'))),
      safeRun('Invoices',     () => syncInvoices(new Request('http://localhost'))),
      safeRun('Shipments',    () => syncShipments(new Request('http://localhost'))),
      safeRun('Pick Tickets', () => syncPickTickets(new Request('http://localhost'))),
    ]);

  const results = { customers, products, inventory, orders, invoices, shipments, pick_tickets: pickTickets };

  Object.entries(results).forEach(([key, val]: any) => {
    console.log(val?.error ? `❌ ${key} failed: ${val.error}` : `✅ ${key} done`);
  });

  const totalDuration = Math.round((Date.now() - startTime) / 1000);
  console.log(`\n✅ Full sync complete in ${totalDuration} seconds`);

  return NextResponse.json({ success: true, total_duration: `${totalDuration}s`, results });
}
