'use client';
import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { db } from '@/lib/db';
import { generatePickTicketPDF } from '@/lib/pdf-generator';

export default function PickTicketDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const [pt, setPt] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [shipments, setShipments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'items' | 'shipments'>('items');

  useEffect(() => { load(); }, [id]);
  async function load() {
    setLoading(true);
    const { data } = await db.from('pick_tickets').select('*').eq('pick_ticket_id', id).single();
    if (!data) { setLoading(false); return; }
    setPt(data);
    const [itemsRes, shipsRes] = await Promise.all([
      db.from('pick_ticket_items').select('*').eq('pick_ticket_id', id).order('style_number'),
      db.from('shipments').select('am_shipment_id, shipstation_id, ship_date, tracking_number, carrier_name, shipment_status, qty, qty_boxes').eq('selected_pick_ticket_ids', id),
    ]);
    setItems(itemsRes.data || []); setShipments(shipsRes.data || []);
    setLoading(false);
  }
  const fmt = (v: any) => { const n = parseFloat(v); return isNaN(n) ? '$0.00' : `$${n.toLocaleString(undefined, { minimumFractionDigits: 2 })}`; };
  const fmtDate = (d: string) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
  if (loading) return <div className="p-8"><div className="animate-pulse"><div className="h-6 bg-gray-200 rounded w-48 mb-4"></div><div className="h-48 bg-gray-200 rounded"></div></div></div>;
  if (!pt) return <div className="p-8"><Link href="/pick-tickets" className="text-sm text-brand-600 hover:underline mb-4 inline-block">&larr; Back to Pick Tickets</Link><div className="card text-center py-12"><p className="text-gray-400 text-lg">Pick ticket not found</p></div></div>;
  const fieldRow = (label: string, value: any) => (<div className="flex justify-between py-1.5 border-b border-gray-50"><span className="text-xs text-gray-400">{label}</span><span className="text-sm text-gray-700 font-medium">{value || 'N/A'}</span></div>);
  return (
    <div className="p-8 max-w-[1400px] mx-auto">
      <div className="flex items-center gap-2 text-sm text-gray-400 mb-6"><Link href="/pick-tickets" className="hover:text-brand-600 transition-colors">Pick Tickets</Link><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" /></svg><span className="text-gray-700 font-medium">{pt.pick_ticket_id}</span></div>
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 mb-6">
        <div className="flex items-start justify-between mb-4">
          <div><h1 className="text-2xl font-bold text-gray-900">Pick Ticket {pt.pick_ticket_id}</h1><p className="text-sm text-gray-400 mt-1">Customer: <Link href={`/customers/${pt.apparel_magic_customer_id || pt.account_number}`} className="text-brand-600 hover:underline font-medium">{pt.customer_name || 'Unknown'}</Link>{pt.apparel_magic_order_id && <> | Order: <Link href={`/orders/${pt.apparel_magic_order_id}`} className="text-brand-600 hover:underline">#{pt.apparel_magic_order_id}</Link></>}{pt.invoice_id && <> | Invoice: <Link href={`/invoices/${pt.invoice_id}`} className="text-brand-600 hover:underline">#{pt.invoice_id}</Link></>}</p></div>
          <div className="flex items-center gap-2">{pt.is_void && <span className="px-3 py-1 text-xs font-medium rounded-full bg-red-100 text-red-700">VOID</span>}<button onClick={() => generatePickTicketPDF(pt, items, 'download', [])} className="px-3 py-1.5 text-xs border border-gray-300 rounded-lg hover:bg-gray-50">Download PDF</button></div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-x-8 gap-y-1">{fieldRow('Date', fmtDate(pt.pick_ticket_date))}{fieldRow('Due Date', fmtDate(pt.date_due))}{fieldRow('WMS Status', pt.wms_status)}{fieldRow('Carton Status', pt.carton_status)}{fieldRow('Total Amount', fmt(pt.total_amount))}{fieldRow('Qty', pt.qty)}{fieldRow('Ship Via', pt.ship_via)}{fieldRow('Warehouse', pt.warehouse_id)}</div>
      </div>
      <div className="flex gap-1 border-b border-gray-200 mb-6"><button onClick={() => setTab('items')} className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${tab === 'items' ? 'border-brand-600 text-brand-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>Items ({items.length})</button><button onClick={() => setTab('shipments')} className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${tab === 'shipments' ? 'border-brand-600 text-brand-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>Shipments ({shipments.length})</button></div>
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        {tab === 'items' && (<table className="w-full text-sm"><thead><tr className="bg-gray-50 border-b border-gray-200"><th className="px-4 py-3 text-left font-medium text-gray-500">Style</th><th className="px-4 py-3 text-left font-medium text-gray-500">Description</th><th className="px-4 py-3 text-left font-medium text-gray-500">Color</th><th className="px-4 py-3 text-left font-medium text-gray-500">Size</th><th className="px-4 py-3 text-left font-medium text-gray-500">Location</th><th className="px-4 py-3 text-right font-medium text-gray-500">Qty</th><th className="px-4 py-3 text-right font-medium text-gray-500">Price</th><th className="px-4 py-3 text-right font-medium text-gray-500">Amount</th></tr></thead><tbody>{items.length === 0 ? <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">No items</td></tr> : items.map((item, i) => (<tr key={i} className="border-b border-gray-100"><td className="px-4 py-2.5"><Link href={`/products/${item.style_number}`} className="text-brand-600 hover:underline font-medium">{item.style_number}</Link></td><td className="px-4 py-2.5 text-gray-600">{item.description || ''}</td><td className="px-4 py-2.5 text-gray-600">{item.attr_2 || ''}</td><td className="px-4 py-2.5 text-gray-600">{item.size || ''}</td><td className="px-4 py-2.5 text-gray-600 font-mono text-xs">{item.location || ''}</td><td className="px-4 py-2.5 text-right">{item.qty || 0}</td><td className="px-4 py-2.5 text-right">{fmt(item.unit_price)}</td><td className="px-4 py-2.5 text-right font-medium">{fmt(item.amount)}</td></tr>))}</tbody></table>)}
        {tab === 'shipments' && (<table className="w-full text-sm"><thead><tr className="bg-gray-50 border-b border-gray-200"><th className="px-4 py-3 text-left font-medium text-gray-500">Tracking #</th><th className="px-4 py-3 text-left font-medium text-gray-500">Ship Date</th><th className="px-4 py-3 text-left font-medium text-gray-500">Carrier</th><th className="px-4 py-3 text-right font-medium text-gray-500">Qty</th></tr></thead><tbody>{shipments.length === 0 ? <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-400">No shipments</td></tr> : shipments.map(s => (<tr key={s.am_shipment_id} className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer" onClick={() => window.location.href = `/shipments/${s.am_shipment_id || s.shipstation_id}`}><td className="px-4 py-2.5 font-mono text-xs text-brand-600">{s.tracking_number || 'N/A'}</td><td className="px-4 py-2.5 text-gray-600">{fmtDate(s.ship_date)}</td><td className="px-4 py-2.5 text-gray-600">{s.carrier_name || ''}</td><td className="px-4 py-2.5 text-right">{s.qty || 0}</td></tr>))}</tbody></table>)}
      </div>
    </div>
  );
}
