'use client';
import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { db } from '@/lib/db';
import { generateInvoicePDF } from '@/lib/pdf-generator';

export default function InvoiceDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const [invoice, setInvoice] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [pickTickets, setPickTickets] = useState<any[]>([]);
  const [shipments, setShipments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'items' | 'pick-tickets' | 'shipments'>('items');

  useEffect(() => { load(); }, [id]);
  async function load() {
    setLoading(true);
    let { data } = await db.from('invoices').select('*').eq('invoice_number', id).single();
    if (!data) { const r = await db.from('invoices').select('*').eq('apparel_magic_id', id).single(); data = r.data; }
    if (!data) { setLoading(false); return; }
    setInvoice(data);
    const [itemsRes, ptsRes, shipsRes] = await Promise.all([
      db.from('invoice_items').select('*').eq('apparel_magic_invoice_id', data.apparel_magic_id).order('style_number'),
      db.from('pick_tickets').select('pick_ticket_id, invoice_id, pick_ticket_date, qty, total_amount, wms_status, carton_status, is_void').eq('invoice_id', data.invoice_number).order('pick_ticket_date', { ascending: false }),
      db.from('shipments').select('am_shipment_id, shipstation_id, ship_date, tracking_number, carrier_name, shipment_status, qty, qty_boxes').eq('am_invoice_id', data.invoice_number),
    ]);
    setItems(itemsRes.data || []); setPickTickets(ptsRes.data || []); setShipments(shipsRes.data || []);
    setLoading(false);
  }
  const fmt = (v: any) => { const n = parseFloat(v); return isNaN(n) ? '$0.00' : `$${n.toLocaleString(undefined, { minimumFractionDigits: 2 })}`; };
  const fmtDate = (d: string) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
  if (loading) return <div className="p-8"><div className="animate-pulse"><div className="h-6 bg-gray-200 rounded w-48 mb-4"></div><div className="h-48 bg-gray-200 rounded"></div></div></div>;
  if (!invoice) return <div className="p-8"><Link href="/invoices" className="text-sm text-brand-600 hover:underline mb-4 inline-block">&larr; Back to Invoices</Link><div className="card text-center py-12"><p className="text-gray-400 text-lg">Invoice not found</p></div></div>;
  const fieldRow = (label: string, value: any) => (<div className="flex justify-between py-1.5 border-b border-gray-50"><span className="text-xs text-gray-400">{label}</span><span className="text-sm text-gray-700 font-medium">{value || 'N/A'}</span></div>);
  const tabs = [{ key: 'items' as const, label: 'Items', count: items.length }, { key: 'pick-tickets' as const, label: 'Pick Tickets', count: pickTickets.length }, { key: 'shipments' as const, label: 'Shipments', count: shipments.length }];
  return (
    <div className="p-8 max-w-[1400px] mx-auto">
      <div className="flex items-center gap-2 text-sm text-gray-400 mb-6"><Link href="/invoices" className="hover:text-brand-600 transition-colors">Invoices</Link><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" /></svg><span className="text-gray-700 font-medium">#{invoice.invoice_number}</span></div>
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 mb-6">
        <div className="flex items-start justify-between mb-4">
          <div><h1 className="text-2xl font-bold text-gray-900">Invoice #{invoice.invoice_number}</h1><p className="text-sm text-gray-400 mt-1">Customer: <Link href={`/customers/${invoice.apparel_magic_customer_id}`} className="text-brand-600 hover:underline font-medium">{invoice.customer_name || invoice.ship_to_name || 'Unknown'}</Link>{invoice.apparel_magic_order_id && <> | Order: <Link href={`/orders/${invoice.apparel_magic_order_id}`} className="text-brand-600 hover:underline">#{invoice.apparel_magic_order_id}</Link></>}</p></div>
          <div className="flex items-center gap-2"><span className={`px-3 py-1 text-xs font-medium rounded-full ${invoice.payment_status === 'paid' ? 'bg-green-100 text-green-700' : invoice.payment_status === 'partial' ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'}`}>{invoice.payment_status || 'unpaid'}</span><button onClick={() => generateInvoicePDF(invoice, items, 'download', [])} className="px-3 py-1.5 text-xs border border-gray-300 rounded-lg hover:bg-gray-50">Download PDF</button></div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-x-8 gap-y-1">{fieldRow('Invoice Date', fmtDate(invoice.invoice_date))}{fieldRow('Due Date', fmtDate(invoice.due_date))}{fieldRow('Season', invoice.season)}{fieldRow('Terms', invoice.terms_id)}{fieldRow('Total Amount', fmt(invoice.total_amount))}{fieldRow('Amount Paid', fmt(invoice.amount_paid))}{fieldRow('Balance Due', fmt(invoice.balance_due))}{fieldRow('Qty', invoice.qty)}</div>
      </div>
      <div className="flex gap-1 border-b border-gray-200 mb-6">{tabs.map(t => (<button key={t.key} onClick={() => setTab(t.key)} className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${tab === t.key ? 'border-brand-600 text-brand-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>{t.label} ({t.count})</button>))}</div>
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        {tab === 'items' && (<table className="w-full text-sm"><thead><tr className="bg-gray-50 border-b border-gray-200"><th className="px-4 py-3 text-left font-medium text-gray-500">Style</th><th className="px-4 py-3 text-left font-medium text-gray-500">Description</th><th className="px-4 py-3 text-left font-medium text-gray-500">Color</th><th className="px-4 py-3 text-left font-medium text-gray-500">Size</th><th className="px-4 py-3 text-right font-medium text-gray-500">Qty</th><th className="px-4 py-3 text-right font-medium text-gray-500">Price</th><th className="px-4 py-3 text-right font-medium text-gray-500">Amount</th></tr></thead><tbody>{items.length === 0 ? <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">No items</td></tr> : items.map((item, i) => (<tr key={i} className="border-b border-gray-100"><td className="px-4 py-2.5"><Link href={`/products/${item.style_number}`} className="text-brand-600 hover:underline font-medium">{item.style_number}</Link></td><td className="px-4 py-2.5 text-gray-600">{item.description || ''}</td><td className="px-4 py-2.5 text-gray-600">{item.attr_2 || ''}</td><td className="px-4 py-2.5 text-gray-600">{item.size || ''}</td><td className="px-4 py-2.5 text-right">{item.qty || 0}</td><td className="px-4 py-2.5 text-right">{fmt(item.unit_price)}</td><td className="px-4 py-2.5 text-right font-medium">{fmt(item.amount)}</td></tr>))}</tbody></table>)}
        {tab === 'pick-tickets' && (<table className="w-full text-sm"><thead><tr className="bg-gray-50 border-b border-gray-200"><th className="px-4 py-3 text-left font-medium text-gray-500">PT #</th><th className="px-4 py-3 text-left font-medium text-gray-500">Date</th><th className="px-4 py-3 text-left font-medium text-gray-500">Status</th><th className="px-4 py-3 text-right font-medium text-gray-500">Qty</th></tr></thead><tbody>{pickTickets.length === 0 ? <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-400">No pick tickets</td></tr> : pickTickets.map(pt => (<tr key={pt.pick_ticket_id} className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer" onClick={() => window.location.href = `/pick-tickets/${pt.pick_ticket_id}`}><td className="px-4 py-2.5 font-medium text-brand-600">{pt.pick_ticket_id}</td><td className="px-4 py-2.5 text-gray-600">{fmtDate(pt.pick_ticket_date)}</td><td className="px-4 py-2.5 text-gray-600">{pt.wms_status || ''}</td><td className="px-4 py-2.5 text-right">{pt.qty || 0}</td></tr>))}</tbody></table>)}
        {tab === 'shipments' && (<table className="w-full text-sm"><thead><tr className="bg-gray-50 border-b border-gray-200"><th className="px-4 py-3 text-left font-medium text-gray-500">Tracking #</th><th className="px-4 py-3 text-left font-medium text-gray-500">Ship Date</th><th className="px-4 py-3 text-left font-medium text-gray-500">Carrier</th><th className="px-4 py-3 text-right font-medium text-gray-500">Qty</th></tr></thead><tbody>{shipments.length === 0 ? <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-400">No shipments</td></tr> : shipments.map(s => (<tr key={s.am_shipment_id} className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer" onClick={() => window.location.href = `/shipments/${s.am_shipment_id || s.shipstation_id}`}><td className="px-4 py-2.5 font-mono text-xs text-brand-600">{s.tracking_number || 'N/A'}</td><td className="px-4 py-2.5 text-gray-600">{fmtDate(s.ship_date)}</td><td className="px-4 py-2.5 text-gray-600">{s.carrier_name || ''}</td><td className="px-4 py-2.5 text-right">{s.qty || 0}</td></tr>))}</tbody></table>)}
      </div>
    </div>
  );
}
