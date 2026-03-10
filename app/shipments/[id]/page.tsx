'use client';
import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { db } from '@/lib/db';
import { generateShipmentPDF } from '@/lib/pdf-generator';

export default function ShipmentDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const [shipment, setShipment] = useState<any>(null);
  const [boxes, setBoxes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { load(); }, [id]);
  async function load() {
    setLoading(true);
    let { data } = await db.from('shipments').select('*').eq('am_shipment_id', id).single();
    if (!data) { const r = await db.from('shipments').select('*').eq('shipstation_id', id).single(); data = r.data; }
    if (!data) { setLoading(false); return; }
    setShipment(data);
    const { data: b } = await db.from('shipment_boxes').select('*').eq('am_shipment_id', data.am_shipment_id).order('box_number');
    setBoxes(b || []);
    setLoading(false);
  }
  const fmtDate = (d: string) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
  if (loading) return <div className="p-8"><div className="animate-pulse"><div className="h-6 bg-gray-200 rounded w-48 mb-4"></div><div className="h-48 bg-gray-200 rounded"></div></div></div>;
  if (!shipment) return <div className="p-8"><Link href="/shipments" className="text-sm text-brand-600 hover:underline mb-4 inline-block">&larr; Back to Shipments</Link><div className="card text-center py-12"><p className="text-gray-400 text-lg">Shipment not found</p></div></div>;
  const fieldRow = (label: string, value: any) => (<div className="flex justify-between py-1.5 border-b border-gray-50"><span className="text-xs text-gray-400">{label}</span><span className="text-sm text-gray-700 font-medium">{value || 'N/A'}</span></div>);
  return (
    <div className="p-8 max-w-[1400px] mx-auto">
      <div className="flex items-center gap-2 text-sm text-gray-400 mb-6"><Link href="/shipments" className="hover:text-brand-600 transition-colors">Shipments</Link><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" /></svg><span className="text-gray-700 font-medium">{shipment.tracking_number || shipment.am_shipment_id}</span></div>
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 mb-6">
        <div className="flex items-start justify-between mb-4">
          <div><h1 className="text-2xl font-bold text-gray-900">Shipment {shipment.am_shipment_id}</h1><p className="text-sm text-gray-400 mt-1">{shipment.customer_name && <>Customer: <Link href={`/customers/${shipment.am_customer_id}`} className="text-brand-600 hover:underline font-medium">{shipment.customer_name}</Link></>}{shipment.am_invoice_id && <> | Invoice: <Link href={`/invoices/${shipment.am_invoice_id}`} className="text-brand-600 hover:underline">#{shipment.am_invoice_id}</Link></>}</p></div>
          <div className="flex items-center gap-2"><span className={`px-3 py-1 text-xs font-medium rounded-full ${shipment.shipment_status === 'delivered' ? 'bg-green-100 text-green-700' : shipment.shipment_status === 'shipped' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>{shipment.shipment_status || ''}</span><button onClick={() => generateShipmentPDF(shipment, boxes, 'download', [])} className="px-3 py-1.5 text-xs border border-gray-300 rounded-lg hover:bg-gray-50">Download PDF</button></div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-x-8 gap-y-1">{fieldRow('Ship Date', fmtDate(shipment.ship_date))}{fieldRow('Carrier', shipment.carrier_name)}{fieldRow('Service', shipment.service_name)}{fieldRow('Tracking #', shipment.tracking_number)}{fieldRow('Ship To', [shipment.ship_to_name, shipment.ship_to_city, shipment.ship_to_state].filter(Boolean).join(', '))}{fieldRow('Qty', shipment.qty)}{fieldRow('Boxes', shipment.qty_boxes)}{fieldRow('Weight', shipment.weight ? `${shipment.weight} lbs` : 'N/A')}</div>
        {shipment.tracking_number && <div className="mt-4 pt-4 border-t border-gray-100"><a href={shipment.tracking_url || `https://www.google.com/search?q=${shipment.tracking_number}`} target="_blank" rel="noopener noreferrer" className="text-sm text-brand-600 hover:underline">Track Package &rarr;</a></div>}
      </div>
      <h2 className="text-sm font-semibold text-gray-500 mb-3">Boxes ({boxes.length})</h2>
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <table className="w-full text-sm"><thead><tr className="bg-gray-50 border-b border-gray-200"><th className="px-4 py-3 text-left font-medium text-gray-500">Box #</th><th className="px-4 py-3 text-left font-medium text-gray-500">Tracking</th><th className="px-4 py-3 text-right font-medium text-gray-500">Qty</th><th className="px-4 py-3 text-right font-medium text-gray-500">Weight</th></tr></thead><tbody>{boxes.length === 0 ? <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-400">No box data</td></tr> : boxes.map((box, i) => (<tr key={i} className="border-b border-gray-100"><td className="px-4 py-2.5">{box.box_number || i + 1}</td><td className="px-4 py-2.5 font-mono text-xs">{box.tracking_number || ''}</td><td className="px-4 py-2.5 text-right">{box.qty || 0}</td><td className="px-4 py-2.5 text-right">{box.weight || ''}</td></tr>))}</tbody></table>
      </div>
    </div>
  );
}
