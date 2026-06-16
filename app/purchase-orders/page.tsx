'use client';

import { useState, useEffect } from 'react';
import { db } from '@/lib/db';

const PAGE_SIZE = 20;

const COLUMN_GROUPS: Record<string, { label: string; columns: { key: string; label: string }[] }> = {
  core: { label: 'Core', columns: [
    { key: 'apparel_magic_id', label: 'PO #' }, { key: 'vendor_name', label: 'Vendor' }, { key: 'order_date', label: 'PO Date' },
    { key: 'date_due', label: 'Due Date' }, { key: 'date_ex_factory', label: 'Ex-Factory' }, { key: 'receiving_status', label: 'Status' },
    { key: 'amount', label: 'Total' }, { key: 'vendor_po', label: 'Vendor PO' },
  ]},
  quantities: { label: 'Quantities', columns: [
    { key: 'qty', label: 'Qty Total' }, { key: 'qty_open', label: 'Qty Open' }, { key: 'qty_received', label: 'Qty Received' },
    { key: 'qty_in_transit', label: 'Qty In Transit' }, { key: 'qty_cxl', label: 'Qty Cancelled' },
  ]},
  amounts: { label: 'Amounts', columns: [
    { key: 'amount_subtotal', label: 'Subtotal' }, { key: 'amount_open', label: 'Open' }, { key: 'amount_taxable', label: 'Taxable' },
    { key: 'amount_tax_total', label: 'Tax' }, { key: 'amount_freight', label: 'Freight' }, { key: 'amount_duty', label: 'Duty' },
    { key: 'amount_landed_cost_est', label: 'Landed Est' },
  ]},
  classification: { label: 'Classification', columns: [
    { key: 'warehouse_id', label: 'Warehouse' }, { key: 'division_id', label: 'Division' }, { key: 'vendor_id', label: 'Vendor ID' },
    { key: 'terms_id', label: 'Terms' }, { key: 'currency_id', label: 'Currency' }, { key: 'wms_status', label: 'WMS' },
  ]},
  audit: { label: 'Audit', columns: [
    { key: 'last_synced_at', label: 'Last Synced' }, { key: 'am_last_modified_time', label: 'AM Modified' },
  ]},
};

const DEFAULT_COLUMNS = ['apparel_magic_id', 'vendor_name', 'order_date', 'date_due', 'receiving_status', 'amount', 'qty', 'qty_received'];
const STORAGE_KEY = 'advancehq-purchase-orders-columns';

const CURRENCY_KEYS = new Set([
  'amount', 'amount_open', 'amount_cxl', 'amount_subtotal', 'amount_taxable', 'amount_tax', 'amount_tax_2',
  'amount_tax_total', 'amount_freight', 'amount_duty', 'amount_other', 'amount_landed_cost_est', 'override_tax_amount',
  'unit_cost', 'amount_landed_est', 'unit_cost_landed_est', 'foreign_amount',
]);

function getStoredColumns(): string[] {
  if (typeof window === 'undefined') return DEFAULT_COLUMNS;
  try { const s = localStorage.getItem(STORAGE_KEY); if (s) return JSON.parse(s); } catch {}
  return DEFAULT_COLUMNS;
}

function fmt(key: string, value: any): string {
  if (value === null || value === undefined || value === '') return '-';
  if (CURRENCY_KEYS.has(key)) {
    return `$${parseFloat(value).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
  }
  if (key.includes('synced_at') || key.includes('modified_time') || key.includes('creation_time')) {
    try { return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch { return value; }
  }
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function getColumnLabel(key: string): string {
  for (const g of Object.values(COLUMN_GROUPS)) { const c = g.columns.find(c => c.key === key); if (c) return c.label; }
  return key.replace(/_/g, ' ');
}

function statusClass(status: string): string {
  const s = (status || '').toLowerCase();
  if (s === 'closed' || s === 'received' || s === 'complete') return 'bg-green-100 text-green-700';
  if (s === 'open') return 'bg-blue-100 text-blue-700';
  if (s === 'partial') return 'bg-yellow-100 text-yellow-700';
  if (s === 'cancelled' || s === 'void') return 'bg-red-100 text-red-700';
  return 'bg-gray-100 text-gray-600';
}

export default function PurchaseOrdersPage() {
  const [pos, setPos] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [selected, setSelected] = useState<any | null>(null);
  const [poItems, setPoItems] = useState<any[]>([]);
  const [visibleColumns, setVisibleColumns] = useState<string[]>(DEFAULT_COLUMNS);
  const [showColumnPicker, setShowColumnPicker] = useState(false);
  const [detailTab, setDetailTab] = useState('overview');

  useEffect(() => { setVisibleColumns(getStoredColumns()); }, []);
  useEffect(() => { setPage(0); }, [search, statusFilter]);
  useEffect(() => { loadPos(); }, [page, search, statusFilter]);

  function saveColumns(cols: string[]) { setVisibleColumns(cols); localStorage.setItem(STORAGE_KEY, JSON.stringify(cols)); }
  function toggleColumn(key: string) { const next = visibleColumns.includes(key) ? visibleColumns.filter(c => c !== key) : [...visibleColumns, key]; saveColumns(next); }

  async function loadPos() {
    setLoading(true);
    let query = db.from('purchase_orders').select('*', { count: 'exact' });
    if (search) query = query.or(`apparel_magic_id.ilike.%${search}%,vendor_name.ilike.%${search}%,vendor_po.ilike.%${search}%`);
    if (statusFilter) query = query.eq('receiving_status', statusFilter);
    const { data, count } = await query.order('order_date', { ascending: false }).range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    if (data) { setPos(data); setTotalCount(count || 0); }
    setLoading(false);
  }

  async function openDetail(po: any) {
    setSelected(po); setDetailTab('overview');
    const { data } = await db.from('purchase_order_items').select('*').eq('apparel_magic_po_id', po.apparel_magic_id).order('row_id');
    setPoItems(data || []);
  }

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);
  const DETAIL_SECTIONS: Record<string, { label: string; fields: string[] }> = {
    overview: { label: 'Overview', fields: ['apparel_magic_id', 'vendor_name', 'vendor_id', 'vendor_po', 'order_date', 'date_due', 'receiving_status', 'wms_status', 'warehouse_id', 'division_id'] },
    amounts: { label: 'Amounts', fields: ['amount', 'amount_subtotal', 'amount_open', 'amount_cxl', 'amount_taxable', 'amount_tax_total', 'amount_freight', 'amount_duty', 'amount_other', 'amount_landed_cost_est', 'currency_id', 'currency_rate'] },
    quantities: { label: 'Quantities', fields: ['qty', 'qty_open', 'qty_received', 'qty_in_transit', 'qty_cxl'] },
    dates: { label: 'Dates', fields: ['order_date', 'date_start', 'date_due', 'date_ex_factory'] },
    classification: { label: 'Classification', fields: ['warehouse_id', 'issue_from_warehouse_id', 'division_id', 'terms_id', 'shipping_terms_id', 'project_number', 'process_name'] },
    notes: { label: 'Notes', fields: ['notes', 'private_notes', 'shipping_info'] },
    audit: { label: 'Audit', fields: ['am_last_modified_time', 'am_creation_time', 'last_synced_at', 'created_at'] },
  };

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div><h1 className="text-2xl font-bold text-gray-900">Purchase Orders</h1><p className="text-gray-500 mt-1">{totalCount.toLocaleString()} purchase orders synced from ApparelMagic</p></div>
        <button onClick={() => setShowColumnPicker(!showColumnPicker)} className="flex items-center gap-2 px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75" /></svg>
          Columns ({visibleColumns.length})
        </button>
      </div>

      {showColumnPicker && (<div className="card mb-6"><div className="flex items-center justify-between mb-4"><h3 className="font-semibold text-gray-900">Customize Table Columns</h3><div className="flex gap-2"><button onClick={() => saveColumns(DEFAULT_COLUMNS)} className="text-xs px-3 py-1 border border-gray-300 rounded hover:bg-gray-50">Reset</button><button onClick={() => setShowColumnPicker(false)} className="text-xs px-3 py-1 bg-brand-600 text-white rounded hover:bg-brand-700">Done</button></div></div><div className="grid grid-cols-2 md:grid-cols-4 gap-4">{Object.entries(COLUMN_GROUPS).map(([gk, g]) => (<div key={gk}><p className="text-xs font-medium text-gray-400 uppercase mb-2">{g.label}</p><div className="space-y-1">{g.columns.map(col => (<label key={col.key} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-gray-50 rounded px-1 py-0.5"><input type="checkbox" checked={visibleColumns.includes(col.key)} onChange={() => toggleColumn(col.key)} className="rounded border-gray-300 text-brand-600 focus:ring-brand-500" />{col.label}</label>))}</div></div>))}</div></div>)}

      <div className="card mb-6"><div className="flex flex-col md:flex-row gap-4"><div className="flex-1"><input type="text" placeholder="Search by PO #, vendor, vendor PO..." value={search} onChange={(e) => setSearch(e.target.value)} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none" /></div><select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="px-4 py-2 border border-gray-300 rounded-lg outline-none bg-white"><option value="">All Statuses</option><option value="Open">Open</option><option value="Partial">Partial</option><option value="Closed">Closed</option></select></div></div>

      <div className="card">
        {loading ? <div className="text-center py-8 text-gray-500">Loading...</div> : pos.length === 0 ? <div className="text-center py-8 text-gray-500">No purchase orders found</div> : (
          <>
            <div className="overflow-x-auto"><table className="w-full"><thead><tr className="border-b border-gray-200">{visibleColumns.map(col => <th key={col} className="table-header pb-3 whitespace-nowrap">{getColumnLabel(col)}</th>)}</tr></thead><tbody>
              {pos.map(p => (<tr key={p.id} className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer transition-colors" onClick={() => openDetail(p)}>{visibleColumns.map(col => (<td key={col} className="table-cell text-sm max-w-[200px] truncate">{col === 'apparel_magic_id' ? <span className="font-medium text-brand-600">PO-{p[col]}</span> : col === 'receiving_status' ? <span className={`px-2 py-0.5 rounded text-xs font-medium ${statusClass(p[col])}`}>{p[col] || '-'}</span> : fmt(col, p[col])}</td>))}</tr>))}
            </tbody></table></div>
            <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-200"><p className="text-sm text-gray-500">Showing {page * PAGE_SIZE + 1}-{Math.min((page + 1) * PAGE_SIZE, totalCount)} of {totalCount.toLocaleString()}</p><div className="flex gap-2"><button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} className="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed">Previous</button><span className="px-3 py-1 text-sm text-gray-500">Page {page + 1} of {totalPages}</span><button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} className="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed">Next</button></div></div>
          </>
        )}
      </div>

      {selected && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl max-w-5xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h2 className="text-xl font-bold text-gray-900">PO #{selected.apparel_magic_id}</h2>
                  <p className="text-gray-500">{selected.vendor_name || 'Unknown vendor'}{selected.vendor_po ? ` · Vendor PO: ${selected.vendor_po}` : ''}</p>
                  <div className="flex gap-3 mt-2">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${statusClass(selected.receiving_status)}`}>{selected.receiving_status || 'unknown'}</span>
                    <span className="text-sm text-gray-500">{selected.order_date || '-'}</span>
                    <span className="text-sm font-medium">${parseFloat(selected.amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                  </div>
                </div>
                <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
              </div>

              <div className="flex gap-1 border-b border-gray-200 mb-6 overflow-x-auto">
                {Object.entries(DETAIL_SECTIONS).map(([key, section]) => (<button key={key} onClick={() => setDetailTab(key)} className={`px-4 py-2 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${detailTab === key ? 'border-brand-600 text-brand-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>{section.label}</button>))}
                <button onClick={() => setDetailTab('items')} className={`px-4 py-2 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${detailTab === 'items' ? 'border-brand-600 text-brand-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>Items ({poItems.length})</button>
              </div>

              {detailTab !== 'items' && DETAIL_SECTIONS[detailTab] && (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {DETAIL_SECTIONS[detailTab].fields.map(field => {
                    const value = selected[field]; const hasValue = value !== null && value !== undefined && value !== '' && value !== 0 && value !== '0';
                    return (<div key={field} className={`rounded-lg p-3 ${hasValue ? 'bg-gray-50' : 'bg-gray-50/50'}`}><p className="text-xs text-gray-400 mb-1">{getColumnLabel(field)}</p>
                      <p className={`text-sm font-medium ${hasValue ? 'text-gray-900' : 'text-gray-300'}`}>{fmt(field, value)}</p>
                    </div>);
                  })}
                </div>
              )}

              {detailTab === 'items' && (<div className="overflow-x-auto">{poItems.length === 0 ? <p className="text-gray-400 text-center py-8">No items</p> : (<table className="w-full text-sm"><thead><tr className="bg-gray-50 border-b border-gray-200"><th className="px-3 py-2 text-left font-medium text-gray-500">Style</th><th className="px-3 py-2 text-left font-medium text-gray-500">Color</th><th className="px-3 py-2 text-left font-medium text-gray-500">Size</th><th className="px-3 py-2 text-right font-medium text-gray-500">Qty</th><th className="px-3 py-2 text-right font-medium text-gray-500">Received</th><th className="px-3 py-2 text-right font-medium text-gray-500">Open</th><th className="px-3 py-2 text-right font-medium text-gray-500">Unit Cost</th><th className="px-3 py-2 text-right font-medium text-gray-500">Amount</th></tr></thead><tbody>{poItems.map((item, i) => (<tr key={i} className="border-b border-gray-100"><td className="px-3 py-2 font-medium">{item.style_number || '-'}</td><td className="px-3 py-2">{item.attr_2 || '-'}</td><td className="px-3 py-2">{item.size || '-'}</td><td className="px-3 py-2 text-right">{item.qty || 0}</td><td className="px-3 py-2 text-right">{item.qty_received || 0}</td><td className="px-3 py-2 text-right">{item.qty_open || 0}</td><td className="px-3 py-2 text-right">${parseFloat(item.unit_cost || 0).toFixed(2)}</td><td className="px-3 py-2 text-right">${parseFloat(item.amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td></tr>))}</tbody></table>)}</div>)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
