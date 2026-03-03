'use client';

import { useState, useEffect } from 'react';
import PrintButton from '@/components/PrintButton';
import { generateInvoicePDF } from '@/lib/pdf-generator';
import { db } from '@/lib/db';
import { useDrawer } from '@/context/DrawerContext';

const PAGE_SIZE = 20;

const COLUMN_GROUPS: Record<string, { label: string; columns: { key: string; label: string }[] }> = {
  core: { label: 'Core', columns: [
    { key: 'invoice_number', label: 'Invoice #' }, { key: 'customer_name', label: 'Customer' }, { key: 'apparel_magic_order_id', label: 'Order #' },
    { key: 'invoice_date', label: 'Invoice Date' }, { key: 'due_date', label: 'Due Date' }, { key: 'total_amount', label: 'Total' },
    { key: 'balance_due', label: 'Balance' }, { key: 'payment_status', label: 'Payment' }, { key: 'season', label: 'Season' },
  ]},
  amounts: { label: 'Amounts', columns: [
    { key: 'subtotal', label: 'Subtotal' }, { key: 'discount_amount', label: 'Discount' }, { key: 'shipping_amount', label: 'Shipping' },
    { key: 'tax_amount', label: 'Tax' }, { key: 'amount_paid', label: 'Paid' }, { key: 'amount_applied', label: 'Applied' },
  ]},
  quantities: { label: 'Quantities', columns: [
    { key: 'qty', label: 'Qty' }, { key: 'qty_shipped', label: 'Shipped' }, { key: 'qty_open', label: 'Open' }, { key: 'qty_cxl', label: 'Cancelled' },
  ]},
  shipping: { label: 'Shipping', columns: [
    { key: 'ship_to_name', label: 'Ship To' }, { key: 'ship_to_city', label: 'City' }, { key: 'ship_to_state', label: 'State' },
    { key: 'ship_via', label: 'Ship Via' }, { key: 'tracking_number', label: 'Tracking' },
  ]},
  classification: { label: 'Classification', columns: [
    { key: 'warehouse_id', label: 'Warehouse' }, { key: 'division_id', label: 'Division' }, { key: 'terms_id', label: 'Terms' },
    { key: 'sales_rep', label: 'Sales Rep' }, { key: 'is_void', label: 'Void' },
  ]},
  audit: { label: 'Audit', columns: [
    { key: 'last_synced_at', label: 'Last Synced' }, { key: 'am_last_modified_time', label: 'AM Modified' },
  ]},
};

const DEFAULT_COLUMNS = ['invoice_number', 'customer_name', 'apparel_magic_order_id', 'invoice_date', 'due_date', 'total_amount', 'balance_due', 'payment_status', 'season'];
const STORAGE_KEY = 'advancehq-invoices-columns';

function getStoredColumns(): string[] {
  if (typeof window === 'undefined') return DEFAULT_COLUMNS;
  try { const s = localStorage.getItem(STORAGE_KEY); if (s) return JSON.parse(s); } catch {}
  return DEFAULT_COLUMNS;
}

function fmt(key: string, value: any): string {
  if (value === null || value === undefined || value === '') return '-';
  if (key === 'total_amount' || key === 'subtotal' || key === 'discount_amount' || key === 'shipping_amount' || key === 'tax_amount' || key === 'balance_due' || key === 'amount_paid' || key === 'amount_applied') {
    return `$${parseFloat(value).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
  }
  if (key.includes('synced_at') || key.includes('modified_time')) {
    try { return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch { return value; }
  }
  if (typeof value === 'boolean' || key === 'is_void') return (value === true || value === 'true') ? 'Yes' : 'No';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function getColumnLabel(key: string): string {
  for (const g of Object.values(COLUMN_GROUPS)) { const c = g.columns.find(c => c.key === key); if (c) return c.label; }
  return key.replace(/_/g, ' ');
}

export default function InvoicesPage() {
  const { open: openDrawer } = useDrawer();
  const [invoices, setInvoices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [paymentFilter, setPaymentFilter] = useState('');
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [selected, setSelected] = useState<any | null>(null);
  const [invoiceItems, setInvoiceItems] = useState<any[]>([]);
  const [relPTs, setRelPTs] = useState<any[]>([]);
  const [relShipments, setRelShipments] = useState<any[]>([]);
  const [visibleColumns, setVisibleColumns] = useState<string[]>(DEFAULT_COLUMNS);
  const [showColumnPicker, setShowColumnPicker] = useState(false);
  const [detailTab, setDetailTab] = useState('overview');

  useEffect(() => { setVisibleColumns(getStoredColumns()); }, []);
  useEffect(() => { setPage(0); }, [search, paymentFilter]);
  useEffect(() => { loadInvoices(); }, [page, search, paymentFilter]);

  function saveColumns(cols: string[]) { setVisibleColumns(cols); localStorage.setItem(STORAGE_KEY, JSON.stringify(cols)); }
  function toggleColumn(key: string) { const next = visibleColumns.includes(key) ? visibleColumns.filter(c => c !== key) : [...visibleColumns, key]; saveColumns(next); }

  async function loadInvoices() {
    setLoading(true);
    let query = db.from('invoices').select('*', { count: 'exact' });
    if (search) query = query.or(`invoice_number.ilike.%${search}%,customer_name.ilike.%${search}%,apparel_magic_order_id.ilike.%${search}%,po_number.ilike.%${search}%`);
    if (paymentFilter) query = query.eq('payment_status', paymentFilter);
    const { data, count } = await query.order('invoice_date', { ascending: false }).range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    if (data) { setInvoices(data); setTotalCount(count || 0); }
    setLoading(false);
  }

  async function openDetail(invoice: any) {
    setSelected(invoice); setDetailTab('overview');
    const { data } = await db.from('invoice_items').select('*').eq('apparel_magic_invoice_id', invoice.apparel_magic_id);
    setInvoiceItems(data || []);
    const { data: pts } = await db.from('pick_tickets').select('pick_ticket_id, invoice_id, pick_ticket_date, qty, total_amount, wms_status, carton_status, is_void').eq('invoice_id', invoice.invoice_number);
    setRelPTs(pts || []);
    const { data: ships } = await db.from('shipments').select('am_shipment_id, shipstation_id, ship_date, tracking_number, carrier_name, shipment_status, qty, qty_boxes, am_invoice_id').eq('am_invoice_id', invoice.invoice_number);
    setRelShipments(ships || []);
  }

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);
  const DETAIL_SECTIONS: Record<string, { label: string; fields: string[] }> = {
    overview: { label: 'Overview', fields: ['invoice_number', 'customer_name', 'apparel_magic_customer_id', 'apparel_magic_order_id', 'po_number', 'customer_po', 'invoice_date', 'due_date', 'payment_status', 'season', 'sales_rep', 'credit_status', 'is_void'] },
    amounts: { label: 'Amounts', fields: ['total_amount', 'subtotal', 'discount_amount', 'shipping_amount', 'tax_amount', 'balance_due', 'amount_paid', 'amount_applied', 'pct_discount', 'tax_rate'] },
    quantities: { label: 'Quantities', fields: ['qty', 'qty_shipped', 'qty_open', 'qty_cxl', 'qty_alloc', 'qty_picked'] },
    shipping: { label: 'Ship To', fields: ['ship_to_name', 'ship_to_address_1', 'ship_to_address_2', 'ship_to_city', 'ship_to_state', 'ship_to_zip', 'ship_to_country', 'ship_to_phone', 'ship_via', 'tracking_number', 'weight'] },
    classification: { label: 'Classification', fields: ['warehouse_id', 'division_id', 'terms_id', 'ar_acct', 'currency_id'] },
    notes: { label: 'Notes', fields: ['notes', 'private_notes'] },
    audit: { label: 'Audit', fields: ['am_last_modified_time', 'last_synced_at', 'created_at'] },
  };

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div><h1 className="text-2xl font-bold text-gray-900">Invoices</h1><p className="text-gray-500 mt-1">{totalCount.toLocaleString()} invoices synced from ApparelMagic</p></div>
        <button onClick={() => setShowColumnPicker(!showColumnPicker)} className="flex items-center gap-2 px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75" /></svg>
          Columns ({visibleColumns.length})
        </button>
      </div>

      {showColumnPicker && (<div className="card mb-6"><div className="flex items-center justify-between mb-4"><h3 className="font-semibold text-gray-900">Customize Table Columns</h3><div className="flex gap-2"><button onClick={() => saveColumns(DEFAULT_COLUMNS)} className="text-xs px-3 py-1 border border-gray-300 rounded hover:bg-gray-50">Reset</button><button onClick={() => setShowColumnPicker(false)} className="text-xs px-3 py-1 bg-brand-600 text-white rounded hover:bg-brand-700">Done</button></div></div><div className="grid grid-cols-2 md:grid-cols-4 gap-4">{Object.entries(COLUMN_GROUPS).map(([gk, g]) => (<div key={gk}><p className="text-xs font-medium text-gray-400 uppercase mb-2">{g.label}</p><div className="space-y-1">{g.columns.map(col => (<label key={col.key} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-gray-50 rounded px-1 py-0.5"><input type="checkbox" checked={visibleColumns.includes(col.key)} onChange={() => toggleColumn(col.key)} className="rounded border-gray-300 text-brand-600 focus:ring-brand-500" />{col.label}</label>))}</div></div>))}</div></div>)}

      <div className="card mb-6"><div className="flex flex-col md:flex-row gap-4"><div className="flex-1"><input type="text" placeholder="Search by invoice #, customer, order #, PO..." value={search} onChange={(e) => setSearch(e.target.value)} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none" /></div><select value={paymentFilter} onChange={(e) => setPaymentFilter(e.target.value)} className="px-4 py-2 border border-gray-300 rounded-lg outline-none bg-white"><option value="">All Payments</option><option value="paid">Paid</option><option value="partial">Partial</option><option value="unpaid">Unpaid</option><option value="open">Open</option></select></div></div>

      <div className="card">
        {loading ? <div className="text-center py-8 text-gray-500">Loading...</div> : invoices.length === 0 ? <div className="text-center py-8 text-gray-500">No invoices found</div> : (
          <>
            <div className="overflow-x-auto"><table className="w-full"><thead><tr className="border-b border-gray-200">{visibleColumns.map(col => <th key={col} className="table-header pb-3 whitespace-nowrap">{getColumnLabel(col)}</th>)}</tr></thead><tbody>
              {invoices.map(inv => (<tr key={inv.id} className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer transition-colors" onClick={() => openDetail(inv)}>{visibleColumns.map(col => (<td key={col} className="table-cell text-sm max-w-[200px] truncate">
                {col === 'invoice_number' ? <span className="font-medium text-brand-600">{inv[col]}</span>
                  : col === 'customer_name' ? <button onClick={(e) => { e.stopPropagation(); openDrawer('customer', inv.apparel_magic_customer_id); }} className="text-brand-600 hover:underline">{inv[col]}</button>
                  : col === 'apparel_magic_order_id' && inv[col] ? <button onClick={(e) => { e.stopPropagation(); openDrawer('order', inv[col]); }} className="text-brand-600 hover:underline">{inv[col]}</button>
                  : col === 'payment_status' ? <span className={`px-2 py-0.5 rounded text-xs font-medium ${inv[col] === 'paid' ? 'bg-green-100 text-green-700' : inv[col] === 'partial' ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'}`}>{inv[col] || '-'}</span>
                  : fmt(col, inv[col])}
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
                <h2 className="text-xl font-bold text-gray-900">Invoice #{selected.invoice_number}</h2>
                <p className="text-gray-500">
                  <button onClick={() => openDrawer('customer', selected.apparel_magic_customer_id)} className="text-brand-600 hover:underline">{selected.customer_name || 'Unknown'}</button>
                  {selected.apparel_magic_order_id ? <> · Order <button onClick={() => openDrawer('order', selected.apparel_magic_order_id)} className="text-brand-600 hover:underline">#{selected.apparel_magic_order_id}</button></> : ''}
                </p>
                <div className="flex gap-3 mt-2">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${selected.payment_status === 'paid' ? 'bg-green-100 text-green-700' : selected.payment_status === 'partial' ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'}`}>{selected.payment_status || 'unknown'}</span>
                  <span className="text-sm text-gray-500">{selected.invoice_date}</span>
                  <span className="text-sm font-medium">${parseFloat(selected.total_amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                  {parseFloat(selected.balance_due || 0) > 0 && <span className="text-sm text-red-600">Bal: ${parseFloat(selected.balance_due).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>}
                </div>
              </div>
              <div className="flex items-center gap-2"><PrintButton onDownload={() => generateInvoicePDF(selected, invoiceItems, 'download', [])} onPrint={() => generateInvoicePDF(selected, invoiceItems, 'print', [])} /><button onClick={() => setSelected(null)} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button></div>
            </div>

            <div className="flex gap-1 border-b border-gray-200 mb-6 overflow-x-auto">
              {Object.entries(DETAIL_SECTIONS).map(([key, section]) => (<button key={key} onClick={() => setDetailTab(key)} className={`px-4 py-2 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${detailTab === key ? 'border-brand-600 text-brand-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>{section.label}</button>))}
              <button onClick={() => setDetailTab('items')} className={`px-4 py-2 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${detailTab === 'items' ? 'border-brand-600 text-brand-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>Items ({invoiceItems.length})</button>
              <button onClick={() => setDetailTab('pts')} className={`px-4 py-2 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${detailTab === 'pts' ? 'border-brand-600 text-brand-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>Pick Tickets ({relPTs.length})</button>
              <button onClick={() => setDetailTab('ships')} className={`px-4 py-2 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${detailTab === 'ships' ? 'border-brand-600 text-brand-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>Shipments ({relShipments.length})</button>
            </div>

            {!['items','pts','ships'].includes(detailTab) && DETAIL_SECTIONS[detailTab] && (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {DETAIL_SECTIONS[detailTab].fields.map(field => {
                  const value = selected[field]; const hasValue = value !== null && value !== undefined && value !== '' && value !== 0 && value !== '0';
                  const isCustomer = field === 'customer_name' || field === 'apparel_magic_customer_id';
                  const isOrder = field === 'apparel_magic_order_id';
                  return (<div key={field} className={`rounded-lg p-3 ${hasValue ? 'bg-gray-50' : 'bg-gray-50/50'}`}><p className="text-xs text-gray-400 mb-1">{getColumnLabel(field)}</p>
                    {isCustomer && hasValue ? <button onClick={() => openDrawer('customer', field === 'customer_name' ? selected.apparel_magic_customer_id : String(value))} className="text-sm font-medium text-brand-600 hover:underline">{String(value)}</button>
                    : isOrder && hasValue ? <button onClick={() => openDrawer('order', String(value))} className="text-sm font-medium text-brand-600 hover:underline">{String(value)}</button>
                    : <p className={`text-sm font-medium ${hasValue ? 'text-gray-900' : 'text-gray-300'}`}>{fmt(field, value)}</p>}
                  </div>);
                })}
              </div>
            )}

            {detailTab === 'items' && (<div className="overflow-x-auto">{invoiceItems.length === 0 ? <p className="text-gray-400 text-center py-8">No items</p> : (<table className="w-full text-sm"><thead><tr className="bg-gray-50 border-b border-gray-200"><th className="px-3 py-2 text-left font-medium text-gray-500">Style</th><th className="px-3 py-2 text-left font-medium text-gray-500">Color</th><th className="px-3 py-2 text-left font-medium text-gray-500">Size</th><th className="px-3 py-2 text-right font-medium text-gray-500">Qty</th><th className="px-3 py-2 text-right font-medium text-gray-500">Price</th><th className="px-3 py-2 text-right font-medium text-gray-500">Amount</th></tr></thead><tbody>{invoiceItems.map((item, i) => (<tr key={i} className="border-b border-gray-100"><td className="px-3 py-2 font-medium">{item.style_number || '-'}</td><td className="px-3 py-2">{item.color || item.attr_2 || '-'}</td><td className="px-3 py-2">{item.size || '-'}</td><td className="px-3 py-2 text-right">{item.quantity || item.qty || 0}</td><td className="px-3 py-2 text-right">${(item.unit_price || 0).toFixed(2)}</td><td className="px-3 py-2 text-right">${(item.line_total || item.amount || 0).toFixed(2)}</td></tr>))}</tbody></table>)}</div>)}

            {detailTab === 'pts' && (<div className="overflow-x-auto">{relPTs.length === 0 ? <p className="text-gray-400 text-center py-8">No pick tickets</p> : (<table className="w-full text-sm"><thead><tr className="bg-gray-50 border-b border-gray-200"><th className="px-3 py-2 text-left font-medium text-gray-500">PT #</th><th className="px-3 py-2 text-left font-medium text-gray-500">Date</th><th className="px-3 py-2 text-right font-medium text-gray-500">Qty</th><th className="px-3 py-2 text-right font-medium text-gray-500">Total</th><th className="px-3 py-2 text-left font-medium text-gray-500">WMS</th><th className="px-3 py-2 text-left font-medium text-gray-500">Carton</th></tr></thead><tbody>{relPTs.map((pt, i) => (<tr key={i} className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer" onClick={() => openDrawer('pick_ticket', pt.pick_ticket_id)}><td className="px-3 py-2 font-medium text-brand-600 hover:underline">PT-{pt.pick_ticket_id}</td><td className="px-3 py-2">{pt.pick_ticket_date || '-'}</td><td className="px-3 py-2 text-right">{pt.qty || 0}</td><td className="px-3 py-2 text-right">${parseFloat(pt.total_amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td><td className="px-3 py-2"><span className={`px-2 py-0.5 rounded text-xs font-medium ${pt.wms_status === 'shipped' || pt.wms_status === 'completed' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>{pt.wms_status || 'pending'}</span></td><td className="px-3 py-2 text-gray-500">{pt.carton_status || '-'}</td></tr>))}</tbody></table>)}</div>)}

            {detailTab === 'ships' && (<div className="overflow-x-auto">{relShipments.length === 0 ? <p className="text-gray-400 text-center py-8">No shipments</p> : (<table className="w-full text-sm"><thead><tr className="bg-gray-50 border-b border-gray-200"><th className="px-3 py-2 text-left font-medium text-gray-500">Shipment</th><th className="px-3 py-2 text-left font-medium text-gray-500">Date</th><th className="px-3 py-2 text-right font-medium text-gray-500">Qty</th><th className="px-3 py-2 text-left font-medium text-gray-500">Carrier</th><th className="px-3 py-2 text-left font-medium text-gray-500">Tracking</th></tr></thead><tbody>{relShipments.map((s, i) => (<tr key={i} className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer" onClick={() => openDrawer('shipment', s.am_shipment_id || s.shipstation_id)}><td className="px-3 py-2 font-medium text-brand-600 hover:underline">{s.am_shipment_id || s.shipstation_id || '-'}</td><td className="px-3 py-2">{s.ship_date || '-'}</td><td className="px-3 py-2 text-right">{s.qty || 0}</td><td className="px-3 py-2 text-gray-500">{s.carrier_name || '-'}</td><td className="px-3 py-2 text-xs text-blue-600">{s.tracking_number || '-'}</td></tr>))}</tbody></table>)}</div>)}
          </div></div>
        </div>
      )}
    </div>
  );
}
