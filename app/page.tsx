import { createClient } from '@supabase/supabase-js';
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
import Link from 'next/link';

async function getStats() {
  const [customers, orders, invoices, shipments, recentOrders, recentShipments] = await Promise.all([
    supabase.from('customers').select('id', { count: 'exact', head: true }),
    supabase.from('orders').select('id', { count: 'exact', head: true }),
    supabase.from('invoices').select('id, balance_due, payment_status', { count: 'exact' }),
    supabase.from('shipments').select('id', { count: 'exact', head: true }),
    supabase.from('orders').select('*').order('created_at', { ascending: false }).limit(5),
    supabase.from('shipments').select('*').order('ship_date', { ascending: false }).limit(5),
  ]);

  const unpaidInvoices = invoices.data?.filter(i => i.payment_status !== 'paid') || [];
  const totalUnpaid = unpaidInvoices.reduce((sum, i) => sum + (parseFloat(i.balance_due) || 0), 0);

  return {
    customerCount: customers.count || 0,
    orderCount: orders.count || 0,
    invoiceCount: invoices.count || 0,
    shipmentCount: shipments.count || 0,
    unpaidInvoiceCount: unpaidInvoices.length,
    totalUnpaid,
    recentOrders: recentOrders.data || [],
    recentShipments: recentShipments.data || [],
  };
}

export default async function Dashboard() {
  const stats = await getStats();

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-gray-500 mt-1">Overview of your business</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <Link href="/customers" className="stat-card hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between">
            <div>
              <p className="stat-value">{stats.customerCount.toLocaleString()}</p>
              <p className="stat-label">Total Customers</p>
            </div>
            <div className="w-12 h-12 bg-brand-100 rounded-lg flex items-center justify-center">
              <svg className="w-6 h-6 text-brand-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
              </svg>
            </div>
          </div>
        </Link>

        <Link href="/orders" className="stat-card hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between">
            <div>
              <p className="stat-value">{stats.orderCount.toLocaleString()}</p>
              <p className="stat-label">Total Orders</p>
            </div>
            <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
              <svg className="w-6 h-6 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25z" />
              </svg>
            </div>
          </div>
        </Link>

        <Link href="/shipments" className="stat-card hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between">
            <div>
              <p className="stat-value">{stats.shipmentCount.toLocaleString()}</p>
              <p className="stat-label">Shipments</p>
            </div>
            <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
              <svg className="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 00-3.213-9.193 2.056 2.056 0 00-1.58-.86H14.25M16.5 18.75h-2.25m0-11.177v-.958c0-.568-.422-1.048-.987-1.106a48.554 48.554 0 00-10.026 0 1.106 1.106 0 00-.987 1.106v7.635m12-6.677v6.677m0 4.5v-4.5m0 0h-12" />
              </svg>
            </div>
          </div>
        </Link>

        <Link href="/invoices" className="stat-card hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between">
            <div>
              <p className="stat-value">${stats.totalUnpaid.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
              <p className="stat-label">Unpaid Invoices ({stats.unpaidInvoiceCount})</p>
            </div>
            <div className="w-12 h-12 bg-yellow-100 rounded-lg flex items-center justify-center">
              <svg className="w-6 h-6 text-yellow-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
          </div>
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">Recent Orders</h2>
            <Link href="/orders" className="text-sm text-brand-600 hover:text-brand-700">View all →</Link>
          </div>
          <div className="space-y-3">
            {stats.recentOrders.length === 0 ? (
              <p className="text-gray-500 text-sm">No orders yet</p>
            ) : (
              stats.recentOrders.map((order: any) => (
                <div key={order.id} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                  <div>
                    <p className="font-medium text-gray-900">Order #{order.order_number}</p>
                    <p className="text-sm text-gray-500">{order.ship_to_name || 'N/A'}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-medium text-gray-900">${parseFloat(order.total_amount || 0).toFixed(2)}</p>
                    <span className={`badge ${order.order_status === 'shipped' ? 'badge-green' : 'badge-yellow'}`}>
                      {order.order_status || 'open'}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">Recent Shipments</h2>
            <Link href="/shipments" className="text-sm text-brand-600 hover:text-brand-700">View all →</Link>
          </div>
          <div className="space-y-3">
            {stats.recentShipments.length === 0 ? (
              <p className="text-gray-500 text-sm">No shipments yet</p>
            ) : (
              stats.recentShipments.map((shipment: any) => (
                <div key={shipment.id} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                  <div>
                    <p className="font-medium text-gray-900">{shipment.tracking_number || 'No tracking'}</p>
                    <p className="text-sm text-gray-500">{shipment.carrier_name} • {shipment.ship_to_city}, {shipment.ship_to_state}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-gray-500">
                      {shipment.ship_date ? new Date(shipment.ship_date).toLocaleDateString() : 'N/A'}
                    </p>
                    {shipment.tracking_url && (
                      <a href={shipment.tracking_url} target="_blank" className="text-sm text-brand-600 hover:text-brand-700">
                        Track →
                      </a>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
