import { NextResponse } from 'next/server';
import { POST as syncCustomers } from '../sync-customers/route';
import { POST as syncProducts } from '../sync-products/route';
import { POST as syncInventory } from '../sync-inventory/route';
import { POST as syncOrders } from '../sync-orders/route';
import { POST as syncInvoices } from '../sync-invoices/route';
import { POST as syncShipments } from '../sync-shipments/route';
import { POST as syncPickTickets } from '../sync-pick-tickets/route';

async function safeRun(label: string, fn: () => Promise<Response>): Promise<any> {
  try {
    const res = await fn();
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      console.log(`   ⚠️ ${label} returned non-JSON:`, text.slice(0, 200));
      return { error: `Non-JSON response: ${text.slice(0, 200)}` };
    }
  } catch (err) {
    console.log(`   ❌ ${label} threw:`, err);
    return { error: err instanceof Error ? err.message : 'Failed' };
  }
}

export async function POST(request: Request) {
  const startTime = Date.now();
  const results: Record<string, any> = {};

  console.log('🚀 Starting full data sync...\n');

  console.log('1️⃣ Syncing customers...');
  results.customers = await safeRun('Customers', () => syncCustomers(new Request('http://localhost')));
  console.log(results.customers?.error ? '   ❌ Customers failed\n' : '   ✅ Customers done\n');

  console.log('2️⃣ Syncing products...');
  results.products = await safeRun('Products', () => syncProducts(new Request('http://localhost')));
  console.log(results.products?.error ? '   ❌ Products failed\n' : '   ✅ Products done\n');

  console.log('3️⃣ Syncing inventory...');
  results.inventory = await safeRun('Inventory', () => syncInventory(new Request('http://localhost')));
  console.log(results.inventory?.error ? '   ❌ Inventory failed\n' : '   ✅ Inventory done\n');

  console.log('4️⃣ Syncing orders...');
  results.orders = await safeRun('Orders', () => syncOrders(new Request('http://localhost')));
  console.log(results.orders?.error ? '   ❌ Orders failed\n' : '   ✅ Orders done\n');

  console.log('5️⃣ Syncing invoices...');
  results.invoices = await safeRun('Invoices', () => syncInvoices(new Request('http://localhost')));
  console.log(results.invoices?.error ? '   ❌ Invoices failed\n' : '   ✅ Invoices done\n');

  console.log('6️⃣ Syncing shipments from ShipStation...');
  results.shipments = await safeRun('Shipments', () => syncShipments(new Request('http://localhost')));
  console.log(results.shipments?.error ? '   ❌ Shipments failed\n' : '   ✅ Shipments done\n');

  console.log('7️⃣ Syncing pick tickets...');
  results.pick_tickets = await safeRun('Pick tickets', () => syncPickTickets(new Request('http://localhost')));
  console.log(results.pick_tickets?.error ? '   ❌ Pick tickets failed\n' : '   ✅ Pick tickets done\n');

  const totalDuration = Math.round((Date.now() - startTime) / 1000);

  console.log('═══════════════════════════════════════');
  console.log(`✅ Full sync complete in ${totalDuration} seconds`);
  console.log('═══════════════════════════════════════\n');

  return NextResponse.json({
    success: true,
    total_duration: `${totalDuration}s`,
    results
  });
}
