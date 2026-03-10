'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import PrintButton from '@/components/PrintButton';
import { generatePickTicketPDF } from '@/lib/pdf-generator';
import { db } from '@/lib/db';
import { useDrawer } from '@/context/DrawerContext';

const PAGE_SIZE = 20;

const COLUMN_GROUPS: Record<string, { label: string; columns: { key: string; label: string }[] }> = {
  core: { label: 'Core', columns: [
    { key: 'pick_ticket_id', label: 'PT #' }, { key: 'customer_name', label: 'Customer' }, { key: 'apparel_magic_order_id', label: 'Order #' },
    { key: 'invoice_id', label: 'Invoice #' }, { key: 'pick_ticket_date', label: 'Date' }, { key: 'total_amount', label: 'Total' },
    { key: 'qty', label: 'Qty' }, { key: 'wms_status', label: 'WMS Status' }, { key: 'carton_status', label: 'Carton' },
  ]},
  quantities: { label: 'Quantities', columns: [
    { key: 'qty_shipped', label: 'Shipped' }, { key: 'qty_open', label: 'Open' }, { key: 'qty_cxl', label: 'Cancelled' },
    { key: 'qty_alloc', label: 'Allocated' }, { key: 'qty_picked', label: 'Picked' }, { key: 'num_cartons', label: 'Cartons' },
  ]},
  shipping: { label: 'Shipping', columns: [
    { key: 'ship_to_name', label: 'Ship To' }, { key: 'ship_to_city', label: 'City' }, { key: 'ship_to_state', label: 'State' },
    { key: 'ship_via', label: 'Ship Via' }, { key: 'weight', label: 'Weight' },
  ]},
  classification: { label: 'Classification', columns: [
    { key: 'warehouse_id', label: 'Warehouse' }, { key: 'division_id', label: 'Division' }, { key: 'season', label: 'Season' },
    { key: 'is_void', label: 'Void' }, { key: 'is_locked', label: 'Locked' },
  ]},
  audit: { label: 'Audit', columns: [
    { key: 'last_synced_at', label: 'Last Synced' }, { key: 'am_last_modified_time', label: 'AM Modified' },
  ]},
};

const DEFAULT_COLUMNS = ['pick_ticket_id', 'customer_name', 'apparel_magic_order_id', 'invoice_id', 'pick_ticket_date', 'total_amount', 'qty', 'wms_status', 'carton_status'];
const STORAGE_KEY = 'advancehq-picktickets-columns';

function getStoredColumns(): string[] {
  if (typeof window === 'undefined') return DEFAULT_COLUMNS;
  try { const s = localStorage.getItem(STORAGE_KEY); if (s) return JSON.parse(s); } catch {}
  return DEFAULT_COLUMNS;
}

function fmt(key: string, value: any): string {
  if (value === null || value === undefined || value === '') return '-';
  if (key === 'total_amount' || key === 'subtotal') return `$${parseFloat(value).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
  if (key.includes('synced_at') || key.includes('modified_time')) { try { return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch { return value; } }
  if (typeof value === 'boolean' || key === 'is_void' || key === 'is_locked') return (value === true || value === 'true') ? 'Yes' : 'No';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function getColumnLabel(key: string): string {
  for (const g of Object.values(COLUMN_GROUPS)) { const c = g.columns.find(c => c.key === key); if (c) return c.label; }
  return key.replace(/_/g, ' ');
}

export default function PickTicketsPage() {
  const { open: openDrawer } = useDrawer();
  const [pts, setPTs] = useState<any[]>([]);
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [wmsFilter, setWmsFilter] = useState('');
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [selected, setSelected] = useState<any | null>(null);
  const [ptItems, setPtItems] = useState<any[]>([]);
  const [relShipments, setRelShipments] = useState<any[]>([]);
  const [visibleColumns, setVisibleColumns] = useState<string[]>(DEFAULT_COLUMNS);
  const [showColumnPicker, setShowColumnPicker] = useState(false);
  const [detailTab, setDetailTab] = useState('overview');

  useEffect(() => { setVisibleColumns(getStoredColumns()); }, []);
  useEffect(() => { setPage(0); }, [search, wmsFilter]);
  useEffect(() => { loadPTs(); }, [page, search, wmsFilter]);

  function saveColumns(cols: string[]) { setVisibleColumns(cols); localStorage.setItem(STORAGE_KEY, JSON.stringify(cols)); }
  function toggleColumn(key: string) { const next = visibleColumns.includes(key) ? visibleColumns.filter(c => c !== key) : [...visibleColumns, key]; saveColumns(next); }

  async function loadPTs() {
    setLoading(true);
    let query = db.from('pick_tickets').select('*', { count: 'exact' });
    if (search) query = query.or(`pick_ticket_id.ilike.%${search}%,customer_name.ilike.%${search}%,apparel_magic_order_id.ilike.%${search}%,invoice_id.ilike.%${search}%`);
    if (wmsFilter) query = query.eq('wms_status', wmsFilter);
    const { data, count } = await query.order('pick_ticket_date', { ascending: false }).range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    if (data) { setPTs(data); setTotalCount(count || 0); }
    setLoading(false);
  }

  async function openDetail(pt: any) {
    setSelected(pt); setDetailTab('overview');
    const { data } = await db.from('pick_ticket_items').select('*').eq('pick_ticket_id', pt.pick_ticket_id);
    setPtItems(data || []);
    if (pt.invoice_id) {
      const { data: ships } = await db.from('shipments').select('am_shipment_id, shipstation_id, ship_date, tracking_number, carrier_name, shipment_status, qty, qty_boxes, am_invoice_id').eq('am_invoice_id', pt.invoice_id);
      setRelShipments(ships || []);
    } else { setRelShipments([]); }
  }

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);
  const DETAIL_SECTIONS: Record<string, { label: string; fields: string[] }> = {
    overview: { label: 'Overview', fields: ['pick_ticket_id', 'customer_name', 'apparel_magic_customer_id', 'apparel_magic_order_id', 'invoice_id', 'po_number', 'pick_ticket_date', 'wms_status', 'carton_status', 'season', 'is_void', 'is_locked'] },
    amounts: { label: 'Amounts', fields: ['total_amount', 'subtotal', 'discount_amount', 'shipping_amount', 'tax_amount'] },
    quantities: { label: 'Quantities', fields: ['qty', 'qty_shipped', 'qty_open', 'qty_cxl', 'qty_alloc', 'qty_picked', 'num_cartons'] },
    shipping: { label: 'Ship To', fields: ['ship_to_name', 'ship_to_address_1', 'ship_to_address_2', 'ship_to_city', 'ship_to_state', 'ship_to_zip', 'ship_to_country', 'ship_to_phone', 'ship_via', 'weight'] },
    classification: { label: 'Classification', fields: ['warehouse_id', 'division_id', 'terms_id'] },
    notes: { label: 'Notes', fields: ['notes', 'private_notes'] },
    audit: { label: 'Audit', fields: ['am_last_modified_time', 'last_synced_at', 'created_at'] },
  };

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div><h1 className="text-2xl font-bold text-gray-900">Pick Tickets</h1><p className="text-gray-500 mt-1">{totalCount.toLocaleString()} pick tickets synced from ApparelMagic</p></div>
        <button onClick={() => setShowColumnPicker(!showColumnPicker)} className="flex items-center gap-2 px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75" /></svg>
          Columns ({visibleColumns.length})
        </button>
      </div>

      {showColumnPicker && (<div className="card mb-6"><div className="flex items-center justify-between mb-4"><h3 className="font-semibold text-gray-900">Customize Table Columns</h3><div className="flex gap-2"><button onClick={() => saveColumns(DEFAULT_COLUMNS)} className="text-xs px-3 py-1 border border-gray-300 rounded hover:bg-gray-50">Reset</button><button onClick={() => setShowColumnPicker(false)} className="text-xs px-3 py-1 bg-brand-600 text-white rounded hover:bg-brand-700">Done</button></div></div><div className="grid grid-cols-2 md:grid-cols-4 gap-4">{Object.entries(COLUMN_GROUPS).map(([gk, g]) => (<div key={gk}><p className="text-xs font-medium text-gray-400 uppercase mb-2">{g.label}</p><div className="space-y-1">{g.columns.map(col => (<label key={col.key} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-gray-50 rounded px-1 py-0.5"><input type="checkbox" checked={visibleColumns.includes(col.key)} onChange={() => toggleColumn(col.key)} className="rounded border-gray-300 text-brand-600 focus:ring-brand-500" />{col.label}</label>))}</div></div>))}</div></div>)}

      <div className="card mb-6"><div className="flex flex-col md:flex-row gap-4"><div className="flex-1"><input type="text" placeholder="Search by PT #, customer, order #, invoice #..." value={search} onChange={(e) => setSearch(e.target.value)} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none" /></div><select value={wmsFilter} onChange={(e) => setWmsFilter(e.target.value)} className="px-4 py-2 border border-gray-300 rounded-lg outline-none bg-white"><option value="">All WMS Status</option><option value="pending">Pending</option><option value="picked">Picked</option><option value="shipped">Shipped</option><option value="completed">Completed</option></select></div></div>

      <div className="card">
        {loading ? <div className="text-center py-8 text-gray-500">Loading...</div> : pts.length === 0 ? <div className="text-center py-8 text-gray-500">No pick tickets found</div> : (
          <>
            <div className="overflow-x-auto"><table className="w-full"><thead><tr className="border-b border-gray-200">{visibleColumns.map(col => <th key={col} className="table-header pb-3 whitespace-nowrap">{getColumnLabel(col)}</th>)}</tr></thead><tbody>
              {pts.map(pt => (<tr key={pt.id} className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer transition-colors" onClick={() => router.push(`/pick-tickets/${pt.pick_ticket_id}`)}>{visibleColumns.map(col => (<td key={col} className="table-cell text-sm max-w-[200px] truncate">
                {col === 'pick_ticket_id' ? <span className="font-medium text-brand-600">PT-{pt[col]}</span>
                  : col === 'customer_name' ? <button onClick={(e) => { e.stopPropagation(); router.push(`/customers/${pt.apparel_magic_customer_id}`); }} className="text-brand-600 hover:underline">{pt[col]}</button>
                  : col === 'apparel_magic_order_id' && pt[col] ? <button onClick={(e) => { e.stopPropagation(); router.push(`/orders/${pt[col]}`); }} className="text-brand-600 hover:underline">{pt[col]}</button>
                  : col === 'invoice_id' && pt[col] ? <button onClick={(e) => { e.stopPropagation(); router.push(`/invoices/${pt[col]}`); }} className="text-brand-600 hover:underline">{pt[col]}</button>
                  : col === 'wms_status' ? <span className={`px-2 py-0.5 rounded text-xs font-medium ${pt[col] === 'shipped' || pt[col] === 'completed' ? 'bg-green-100 text-green-700' : pt[col] === 'picked' ? 'bg-blue-100 text-blue-700' : 'bg-yellow-100 text-yellow-700'}`}>{pt[col] || 'pending'}</span>
                  : fmt(col, pt[col])}
              </td>))}</tr>))}
            </tbody></table></div>
            <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-200"><p className="text-sm text-gray-500">Showing {page * PAGE_SIZE + 1}-{Math.min((page + 1) * PAGE_SIZE, totalCount)} of {totalCount.toLocaleString()}</p><div className="flex gap-2"><button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} className="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed">Previous</button><span className="px-3 py-1 text-sm text-gray-500">Page {page + 1} of {totalPages}</span><button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} className="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed">Next</button></div></div>
          </>
        )}
      </div>

      {selected && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl max-w-5xl w-full max-h-[90vh] overflow-y-auto"><div className="p-6">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h2 className="text-xl font-bold text-gray-900">Pick Ticket #{selected.pick_ticket_id}</h2>
                <p className="text-gray-500">
                  <button onClick={() => router.push(`/customers/${selected.apparel_magic_customer_id}`)} className="text-brand-600 hover:underline">{selected.customer_name || 'Unknown'}</button>
                  {selected.apparel_magic_order_id ? <> · Order <button onClick={() => router.push(`/orders/${selected.apparel_magic_order_id}`)} className="text-brand-600 hover:underline">#{selected.apparel_magic_order_id}</button></> : ''}
                  {selected.invoice_id ? <> · Invoice <button onClick={() => router.push(`/invoices/${selected.invoice_id}`)} className="text-brand-600 hover:underline">#{selected.invoice_id}</button></> : ''}
                </p>
                <div className="flex gap-3 mt-2">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${selected.wms_status === 'shipped' || selected.wms_status === 'completed' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>{selected.wms_status || 'pending'}</span>
                  <span className="text-sm text-gray-500">{selected.pick_ticket_date}</span>
                  <span className="text-sm font-medium">${parseFloat(selected.total_amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                </div>
              </div>
              <div className="flex items-center gap-2"><PrintButton entityType="pick_ticket" onDownload={() => generatePickTicketPDF(selected, ptItems, 'download', [])} onPrint={() => generatePickTicketPDF(selected, ptItems, 'print', [])} /><button onClick={() => setSelected(null)} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button></div>
            </div>

            <div className="flex gap-1 border-b border-gray-200 mb-6 overflow-x-auto">
              {Object.entries(DETAIL_SECTIONS).map(([key, section]) => (<button key={key} onClick={() => setDetailTab(key)} className={`px-4 py-2 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${detailTab === key ? 'border-brand-600 text-brand-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>{section.label}</button>))}
              <button onClick={() => setDetailTab('items')} className={`px-4 py-2 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${detailTab === 'items' ? 'border-brand-600 text-brand-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>Items ({ptItems.length})</button>
              <button onClick={() => setDetailTab('ships')} className={`px-4 py-2 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${detailTab === 'ships' ? 'border-brand-600 text-brand-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>Shipments ({relShipments.length})</button>
            </div>

            {!['items','ships'].includes(detailTab) && DETAIL_SECTIONS[detailTab] && (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {DETAIL_SECTIONS[detailTab].fields.map(field => {
                  const value = selected[field]; const hasValue = value !== null && value !== undefined && value !== '' && value !== 0 && value !== '0';
                  const isCustomer = field === 'customer_name' || field === 'apparel_magic_customer_id';
                  const isOrder = field === 'apparel_magic_order_id';
                  const isInvoice = field === 'invoice_id';
                  return (<div key={field} className={`rounded-lg p-3 ${hasValue ? 'bg-gray-50' : 'bg-gray-50/50'}`}><p className="text-xs text-gray-400 mb-1">{getColumnLabel(field)}</p>
                    {isCustomer && hasValue ? <button onClick={() => router.push(`/customers/${field === 'customer_name' ? selected.apparel_magic_customer_id : String(value)}`)} className="text-sm font-medium text-brand-600 hover:underline">{String(value)}</button>
                    : isOrder && hasValue ? <button onClick={() => router.push(`/orders/${String(value)}`)} className="text-sm font-medium text-brand-600 hover:underline">{String(value)}</button>
                    : isInvoice && hasValue ? <button onClick={() => router.push(`/invoices/${String(value)}`)} className="text-sm font-medium text-brand-600 hover:underline">{String(value)}</button>
                    : <p className={`text-sm font-medium ${hasValue ? 'text-gray-900' : 'text-gray-300'}`}>{fmt(field, value)}</p>}
                  </div>);
                })}
              </div>
            )}

            {detailTab === 'items' && (<div className="overflow-x-auto">{ptItems.length === 0 ? <p className="text-gray-400 text-center py-8">No items</p> : (<table className="w-full text-sm"><thead><tr className="bg-gray-50 border-b border-gray-200"><th className="px-3 py-2 text-left font-medium text-gray-500">Style</th><th className="px-3 py-2 text-left font-medium text-gray-500">Color</th><th className="px-3 py-2 text-left font-medium text-gray-500">Size</th><th className="px-3 py-2 text-right font-medium text-gray-500">Qty</th><th className="px-3 py-2 text-right font-medium text-gray-500">Price</th><th className="px-3 py-2 text-left font-medium text-gray-500">Location</th><th className="px-3 py-2 text-left font-medium text-gray-500">Bin Location</th><th className="px-3 py-2 text-right font-medium text-gray-500">Amount</th></tr></thead><tbody>{ptItems.map((item, i) => (<tr key={i} className="border-b border-gray-100"><td className="px-3 py-2 font-medium">{item.style_number || '-'}</td><td className="px-3 py-2">{item.color || item.attr_2 || '-'}</td><td className="px-3 py-2">{item.size || '-'}</td><td className="px-3 py-2 text-right">{item.quantity || item.qty || 0}</td><td className="px-3 py-2 text-right">${(item.unit_price || 0).toFixed(2)}</td><td className="px-3 py-2 font-medium text-gray-700">{item.location || '-'}</td><td className="px-3 py-2 text-gray-600">{item.bin_location || '-'}</td><td className="px-3 py-2 text-right">${(item.line_total || item.amount || 0).toFixed(2)}</td></tr>))}</tbody></table>)}</div>)}

            {detailTab === 'ships' && (<div className="overflow-x-auto">{relShipments.length === 0 ? <p className="text-gray-400 text-center py-8">No shipments</p> : (<table className="w-full text-sm"><thead><tr className="bg-gray-50 border-b border-gray-200"><th className="px-3 py-2 text-left font-medium text-gray-500">Shipment</th><th className="px-3 py-2 text-left font-medium text-gray-500">Date</th><th className="px-3 py-2 text-right font-medium text-gray-500">Qty</th><th className="px-3 py-2 text-left font-medium text-gray-500">Carrier</th><th className="px-3 py-2 text-left font-medium text-gray-500">Tracking</th></tr></thead><tbody>{relShipments.map((s, i) => (<tr key={i} className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer" onClick={() => router.push(`/shipments/${s.am_shipment_id || s.shipstation_id}`)}><td className="px-3 py-2 font-medium text-brand-600 hover:underline">{s.am_shipment_id || s.shipstation_id || '-'}</td><td className="px-3 py-2">{s.ship_date || '-'}</td><td className="px-3 py-2 text-right">{s.qty || 0}</td><td className="px-3 py-2 text-gray-500">{s.carrier_name || '-'}</td><td className="px-3 py-2 text-xs text-blue-600">{s.tracking_number || '-'}</td></tr>))}</tbody></table>)}</div>)}
          </div></div>
        </div>
      )}
    </div>
  );
}
