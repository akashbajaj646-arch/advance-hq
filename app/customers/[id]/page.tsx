'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { db } from '@/lib/db';

export default function CustomerDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [customer, setCustomer] = useState<any>(null);
  const [orders, setOrders] = useState<any[]>([]);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [shipments, setShipments] = useState<any[]>([]);
  const [pickTickets, setPickTickets] = useState<any[]>([]);
  const [activityEvents, setActivityEvents] = useState<any[]>([]);
  const [customerPayments, setCustomerPayments] = useState<any[]>([]);
  const [paymentsLoading, setPaymentsLoading] = useState(false);
  const [activityLoading, setActivityLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'orders' | 'invoices' | 'shipments' | 'activity' | 'pick-tickets' | 'payments'>('orders');

  useEffect(() => { loadCustomer(); }, [id]);

  async function loadPayments(amCustomerId: string) {
    if (!amCustomerId) return;
    setPaymentsLoading(true);
    const { data } = await db.from('payments')
      .select('*')
      .eq('am_customer_id', amCustomerId)
      .order('payment_date', { ascending: false })
      .limit(100);
    setCustomerPayments(data || []);
    setPaymentsLoading(false);
  }

  async function loadActivity(email: string) {
    if (!email) return;
    setActivityLoading(true);
    const { data } = await db.from('customer_activity')
      .select('*')
      .eq('email', email.toLowerCase().trim())
      .order('occurred_at', { ascending: false })
      .limit(100);
    setActivityEvents(data || []);
    setActivityLoading(false);
  }

  async function loadCustomer() {
    setLoading(true);
    let { data } = await db.from('customers').select('*').eq('am_customer_id', id).single();
    if (!data) { const r = await db.from('customers').select('*').eq('account_number', id).single(); data = r.data; }
    if (!data) { const r = await db.from('customers').select('*').ilike('email', id).single(); data = r.data; }
    if (!data) { setLoading(false); return; }
    setCustomer(data);

    const [ordersRes, invoicesRes, shipmentsRes, ptRes] = await Promise.all([
      db.from('orders').select('order_number, apparel_magic_id, order_date, total_amount, order_status, customer_name, qty, qty_shipped, season, po_number, apparel_magic_customer_id').eq('apparel_magic_customer_id', data.am_customer_id).order('order_date', { ascending: false }).limit(50),
      db.from('invoices').select('invoice_number, apparel_magic_id, apparel_magic_order_id, invoice_date, total_amount, balance_due, payment_status, season, apparel_magic_customer_id').eq('apparel_magic_customer_id', data.am_customer_id).order('invoice_date', { ascending: false }).limit(50),
      db.from('shipments').select('am_shipment_id, shipstation_id, ship_date, tracking_number, carrier_name, shipment_status, qty, qty_boxes, am_invoice_id, am_customer_id, ship_to_city, ship_to_state').eq('am_customer_id', data.am_customer_id).order('ship_date', { ascending: false }).limit(50),
      db.from('pick_tickets').select('pick_ticket_id, invoice_id, pick_ticket_date, qty, total_amount, wms_status, carton_status, is_void, customer_name, apparel_magic_order_id, apparel_magic_customer_id').eq('apparel_magic_customer_id', data.am_customer_id).order('pick_ticket_date', { ascending: false }).limit(50),
    ]);
    setOrders(ordersRes.data || []);
    setInvoices(invoicesRes.data || []);
    setShipments(shipmentsRes.data || []);
    setPickTickets(ptRes.data || []);
    setLoading(false);
  }

  if (loading) return <div className="p-8"><div className="animate-pulse space-y-4"><div className="h-6 bg-gray-200 rounded w-48"></div><div className="h-32 bg-gray-200 rounded"></div><div className="h-64 bg-gray-200 rounded"></div></div></div>;

  if (!customer) return (
    <div className="p-8">
      <Link href="/customers" className="text-sm text-brand-600 hover:underline mb-4 inline-block">&larr; Back to Customers</Link>
      <div className="card text-center py-12"><p className="text-gray-400 text-lg">Customer not found</p><p className="text-gray-300 text-sm mt-1">No customer matches ID: {id}</p></div>
    </div>
  );

  const totalOrderValue = orders.reduce((sum, o) => sum + (parseFloat(o.total_amount) || 0), 0);
  const totalBalanceDue = invoices.reduce((sum, i) => sum + (parseFloat(i.balance_due) || 0), 0);
  const unpaidCount = invoices.filter(i => i.payment_status !== 'paid').length;
  const fmt = (v: any) => { const n = parseFloat(v); return isNaN(n) ? '$0.00' : `$${n.toLocaleString(undefined, { minimumFractionDigits: 2 })}`; };
  const fmtDate = (d: string) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';

  const tabs = [
    { key: 'orders' as const, label: 'Orders', count: orders.length },
    { key: 'invoices' as const, label: 'Invoices', count: invoices.length },
    { key: 'shipments' as const, label: 'Shipments', count: shipments.length },
    { key: 'pick-tickets' as const, label: 'Pick Tickets', count: pickTickets.length },
    { key: 'activity' as const, label: 'Activity' },
    { key: 'payments' as const, label: 'Payments', count: customerPayments.length },
  ];

  return (
    <div className="p-8 max-w-[1400px] mx-auto">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-400 mb-6">
        <Link href="/customers" className="hover:text-brand-600 transition-colors">Customers</Link>
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" /></svg>
        <span className="text-gray-700 font-medium">{customer.customer_name}</span>
      </div>

      {/* Header Card */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 mb-6">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-1">
              <h1 className="text-2xl font-bold text-gray-900">{customer.customer_name}</h1>
              {customer.category && <span className="px-2 py-0.5 text-xs font-medium bg-brand-50 text-brand-700 rounded-full">{customer.category}</span>}
            </div>
            <p className="text-sm text-gray-400">Account #{customer.account_number || customer.am_customer_id}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mt-6">
          <div>
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Contact</p>
            {customer.email && <p className="text-sm text-gray-700">{customer.email}</p>}
            {customer.phone && <p className="text-sm text-gray-700">{customer.phone}</p>}
            {!customer.email && !customer.phone && <p className="text-sm text-gray-300">No contact info</p>}
          </div>
          <div>
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Address</p>
            {customer.address_1 ? (
              <div className="text-sm text-gray-700">
                <p>{customer.address_1}</p>
                {customer.address_2 && <p>{customer.address_2}</p>}
                <p>{[customer.city, customer.state, customer.zip].filter(Boolean).join(', ')}</p>
              </div>
            ) : <p className="text-sm text-gray-300">No address</p>}
          </div>
          <div>
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Sales Rep</p>
            <p className="text-sm text-gray-700">{customer.sales_rep || customer.salesperson || 'Unassigned'}</p>
            {customer.terms_id && <p className="text-xs text-gray-400 mt-1">Terms: {customer.terms_id}</p>}
          </div>
          <div>
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Credit Status</p>
            <p className="text-sm text-gray-700">{customer.credit_status || 'N/A'}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6 pt-6 border-t border-gray-100">
          <div className="bg-gray-50 rounded-lg px-4 py-3"><p className="text-xs text-gray-400">Total Orders</p><p className="text-xl font-bold text-gray-900">{orders.length}</p></div>
          <div className="bg-gray-50 rounded-lg px-4 py-3"><p className="text-xs text-gray-400">Total Order Value</p><p className="text-xl font-bold text-gray-900">{fmt(totalOrderValue)}</p></div>
          <div className="bg-gray-50 rounded-lg px-4 py-3"><p className="text-xs text-gray-400">Open Invoices</p><p className="text-xl font-bold text-gray-900">{unpaidCount}</p></div>
          <div className={`rounded-lg px-4 py-3 ${totalBalanceDue > 0 ? 'bg-red-50' : 'bg-gray-50'}`}><p className="text-xs text-gray-400">Balance Due</p><p className={`text-xl font-bold ${totalBalanceDue > 0 ? 'text-red-600' : 'text-gray-900'}`}>{fmt(totalBalanceDue)}</p></div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200 mb-6">
        {tabs.map(t => (
          <button key={t.key} onClick={() => { setTab(t.key); if (t.key === 'activity' && customer?.email) loadActivity(customer.email);
              if (t.key === 'payments' && customer?.am_customer_id) loadPayments(customer.am_customer_id); }} className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${tab === t.key ? 'border-brand-600 text-brand-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            {t.label}{t.count !== undefined && <span className="text-gray-300 ml-1">({t.count})</span>}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        {tab === 'orders' && (
          <table className="w-full text-sm">
            <thead><tr className="bg-gray-50 border-b border-gray-200">
              <th className="px-4 py-3 text-left font-medium text-gray-500">Order #</th><th className="px-4 py-3 text-left font-medium text-gray-500">Date</th><th className="px-4 py-3 text-left font-medium text-gray-500">PO #</th><th className="px-4 py-3 text-left font-medium text-gray-500">Season</th><th className="px-4 py-3 text-left font-medium text-gray-500">Status</th><th className="px-4 py-3 text-right font-medium text-gray-500">Qty</th><th className="px-4 py-3 text-right font-medium text-gray-500">Shipped</th><th className="px-4 py-3 text-right font-medium text-gray-500">Amount</th>
            </tr></thead>
            <tbody>
              {orders.length === 0 ? <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">No orders found</td></tr> :
              orders.map(o => (
                <tr key={o.order_number} className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer" onClick={() => router.push(`/orders/${o.order_number}`)}>
                  <td className="px-4 py-3 font-medium text-brand-600">#{o.order_number}</td>
                  <td className="px-4 py-3 text-gray-600">{fmtDate(o.order_date)}</td>
                  <td className="px-4 py-3 text-gray-600">{o.po_number || ''}</td>
                  <td className="px-4 py-3 text-gray-600">{o.season || ''}</td>
                  <td className="px-4 py-3"><span className={`inline-block px-2 py-0.5 text-xs font-medium rounded-full ${o.order_status === 'closed' ? 'bg-green-100 text-green-700' : o.order_status === 'open' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>{o.order_status || 'unknown'}</span></td>
                  <td className="px-4 py-3 text-right text-gray-600">{o.qty || 0}</td>
                  <td className="px-4 py-3 text-right text-gray-600">{o.qty_shipped || 0}</td>
                  <td className="px-4 py-3 text-right font-medium">{fmt(o.total_amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {tab === 'invoices' && (
          <table className="w-full text-sm">
            <thead><tr className="bg-gray-50 border-b border-gray-200">
              <th className="px-4 py-3 text-left font-medium text-gray-500">Invoice #</th><th className="px-4 py-3 text-left font-medium text-gray-500">Date</th><th className="px-4 py-3 text-left font-medium text-gray-500">Order #</th><th className="px-4 py-3 text-left font-medium text-gray-500">Season</th><th className="px-4 py-3 text-left font-medium text-gray-500">Status</th><th className="px-4 py-3 text-right font-medium text-gray-500">Amount</th><th className="px-4 py-3 text-right font-medium text-gray-500">Balance Due</th>
            </tr></thead>
            <tbody>
              {invoices.length === 0 ? <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">No invoices found</td></tr> :
              invoices.map(inv => (
                <tr key={inv.invoice_number} className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer" onClick={() => router.push(`/invoices/${inv.invoice_number}`)}>
                  <td className="px-4 py-3 font-medium text-brand-600">#{inv.invoice_number}</td>
                  <td className="px-4 py-3 text-gray-600">{fmtDate(inv.invoice_date)}</td>
                  <td className="px-4 py-3"><Link href={`/orders/${inv.apparel_magic_order_id}`} onClick={e => e.stopPropagation()} className="text-brand-600 hover:underline">#{inv.apparel_magic_order_id}</Link></td>
                  <td className="px-4 py-3 text-gray-600">{inv.season || ''}</td>
                  <td className="px-4 py-3"><span className={`inline-block px-2 py-0.5 text-xs font-medium rounded-full ${inv.payment_status === 'paid' ? 'bg-green-100 text-green-700' : inv.payment_status === 'partial' ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'}`}>{inv.payment_status || 'unpaid'}</span></td>
                  <td className="px-4 py-3 text-right">{fmt(inv.total_amount)}</td>
                  <td className={`px-4 py-3 text-right font-medium ${parseFloat(inv.balance_due) > 0 ? 'text-red-600' : ''}`}>{fmt(inv.balance_due)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {tab === 'shipments' && (
          <table className="w-full text-sm">
            <thead><tr className="bg-gray-50 border-b border-gray-200">
              <th className="px-4 py-3 text-left font-medium text-gray-500">Tracking #</th><th className="px-4 py-3 text-left font-medium text-gray-500">Ship Date</th><th className="px-4 py-3 text-left font-medium text-gray-500">Carrier</th><th className="px-4 py-3 text-left font-medium text-gray-500">Destination</th><th className="px-4 py-3 text-left font-medium text-gray-500">Status</th><th className="px-4 py-3 text-right font-medium text-gray-500">Qty</th><th className="px-4 py-3 text-right font-medium text-gray-500">Boxes</th>
            </tr></thead>
            <tbody>
              {shipments.length === 0 ? <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">No shipments found</td></tr> :
              shipments.map(s => (
                <tr key={s.am_shipment_id || s.shipstation_id} className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer" onClick={() => router.push(`/shipments/${s.am_shipment_id || s.shipstation_id}`)}>
                  <td className="px-4 py-3 font-mono text-xs text-brand-600">{s.tracking_number || 'N/A'}</td>
                  <td className="px-4 py-3 text-gray-600">{fmtDate(s.ship_date)}</td>
                  <td className="px-4 py-3 text-gray-600">{s.carrier_name || ''}</td>
                  <td className="px-4 py-3 text-gray-600">{[s.ship_to_city, s.ship_to_state].filter(Boolean).join(', ')}</td>
                  <td className="px-4 py-3"><span className={`inline-block px-2 py-0.5 text-xs font-medium rounded-full ${s.shipment_status === 'delivered' ? 'bg-green-100 text-green-700' : s.shipment_status === 'shipped' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>{s.shipment_status || ''}</span></td>
                  <td className="px-4 py-3 text-right text-gray-600">{s.qty || 0}</td>
                  <td className="px-4 py-3 text-right text-gray-600">{s.qty_boxes || 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {tab === 'pick-tickets' && (
          <table className="w-full text-sm">
            <thead><tr className="bg-gray-50 border-b border-gray-200">
              <th className="px-4 py-3 text-left font-medium text-gray-500">PT #</th><th className="px-4 py-3 text-left font-medium text-gray-500">Date</th><th className="px-4 py-3 text-left font-medium text-gray-500">Order #</th><th className="px-4 py-3 text-left font-medium text-gray-500">Invoice #</th><th className="px-4 py-3 text-left font-medium text-gray-500">WMS Status</th><th className="px-4 py-3 text-left font-medium text-gray-500">Carton</th><th className="px-4 py-3 text-right font-medium text-gray-500">Qty</th><th className="px-4 py-3 text-right font-medium text-gray-500">Amount</th>
            </tr></thead>
            <tbody>
              {pickTickets.length === 0 ? <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">No pick tickets found</td></tr> :
              pickTickets.map(pt => (
                <tr key={pt.pick_ticket_id} className={`border-b border-gray-100 hover:bg-gray-50 cursor-pointer ${pt.is_void ? 'opacity-40' : ''}`} onClick={() => router.push(`/pick-tickets/${pt.pick_ticket_id}`)}>
                  <td className="px-4 py-3 font-medium text-brand-600">{pt.pick_ticket_id}</td>
                  <td className="px-4 py-3 text-gray-600">{fmtDate(pt.pick_ticket_date)}</td>
                  <td className="px-4 py-3"><Link href={`/orders/${pt.apparel_magic_order_id}`} onClick={e => e.stopPropagation()} className="text-brand-600 hover:underline">#{pt.apparel_magic_order_id}</Link></td>
                  <td className="px-4 py-3">{pt.invoice_id && <Link href={`/invoices/${pt.invoice_id}`} onClick={e => e.stopPropagation()} className="text-brand-600 hover:underline">#{pt.invoice_id}</Link>}</td>
                  <td className="px-4 py-3 text-gray-600">{pt.wms_status || ''}</td>
                  <td className="px-4 py-3 text-gray-600">{pt.carton_status || ''}</td>
                  <td className="px-4 py-3 text-right text-gray-600">{pt.qty || 0}</td>
                  <td className="px-4 py-3 text-right font-medium">{fmt(pt.total_amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {tab === 'payments' && (
          <div>
            {paymentsLoading ? (
              <div className="flex items-center justify-center py-12 text-gray-400">
                <svg className="w-5 h-5 animate-spin mr-2" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
                Loading payments...
              </div>
            ) : customerPayments.length === 0 ? (
              <div className="text-center py-12"><p className="text-gray-400">No payments found for this customer.</p></div>
            ) : (
              <table className="w-full text-sm">
                <thead><tr className="bg-gray-50 border-b border-gray-200">
                  <th className="px-4 py-3 text-left font-medium text-gray-500">Payment #</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">Type</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">Reference</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">Date</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-500">Received</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-500">Applied</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-500">Balance</th>
                  <th className="px-4 py-3 text-center font-medium text-gray-500">Status</th>
                </tr></thead>
                <tbody>
                  {customerPayments.map(p => (
                    <tr key={p.id} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-brand-600">#{p.am_payment_id}</td>
                      <td className="px-4 py-3 text-gray-600">{p.payment_type || '-'}</td>
                      <td className="px-4 py-3 text-gray-600">{p.reference || '-'}</td>
                      <td className="px-4 py-3 text-gray-600">{p.payment_date ? new Date(p.payment_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '-'}</td>
                      <td className="px-4 py-3 text-right font-medium">${parseFloat(p.amount_received || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                      <td className="px-4 py-3 text-right text-gray-600">${parseFloat(p.amount_applied || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                      <td className="px-4 py-3 text-right">
                        <span className={parseFloat(p.balance) > 0 ? 'text-yellow-600 font-medium' : 'text-gray-600'}>
                          ${parseFloat(p.balance || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {p.void ? <span className="px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700">Void</span> : <span className="px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">Active</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {tab === 'activity' && (
          <div>
            {activityLoading ? (
              <div className="flex items-center justify-center py-12 text-gray-400">
                <svg className="w-5 h-5 animate-spin mr-2" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
                Loading activity...
              </div>
            ) : activityEvents.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-gray-400">No website activity recorded for this customer yet.</p>
              </div>
            ) : (
              <div className="space-y-1">
                {activityEvents.map((event: any) => {
                  const icons: Record<string,string> = { page_view:'👀', product_view:'🛍️', collection_view:'📂', search:'🔍', cart_add:'🛒', order_placed:'✅', login:'🔐', logout:'🚪' };
                  const labels: Record<string,string> = { page_view:'Page View', product_view:'Viewed Product', collection_view:'Browsed Collection', search:'Searched', cart_add:'Added to Cart', order_placed:'Placed Order', login:'Logged In', logout:'Logged Out' };
                  const d = new Date(event.occurred_at);
                  return (
                    <div key={event.id} className="flex items-start gap-3 px-3 py-2.5 rounded-lg hover:bg-gray-50 transition-colors">
                      <span className="text-base flex-shrink-0 mt-0.5">{icons[event.event_type] || '🌐'}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm text-gray-700">{labels[event.event_type] || event.event_type}</span>
                          {event.product_title && <span className="text-sm text-brand-600 font-medium">{event.product_title}</span>}
                          {event.search_query && <span className="text-sm text-purple-600 font-medium">"{event.search_query}"</span>}
                          {event.page_title && !event.product_title && event.event_type === 'page_view' && <span className="text-sm text-gray-400">{event.page_title}</span>}
                        </div>
                        {event.page_url && <p className="text-xs text-gray-300 truncate mt-0.5">{event.page_url}</p>}
                      </div>
                      <span className="text-xs text-gray-400 flex-shrink-0 whitespace-nowrap">
                        {d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} {d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}