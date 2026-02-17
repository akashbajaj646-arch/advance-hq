'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useDrawer } from '@/context/DrawerContext';

const PAGE_SIZE = 20;

const COLUMN_GROUPS: Record<string, { label: string; columns: { key: string; label: string }[] }> = {
  core: { label: 'Core', columns: [
    { key: 'am_shipment_id', label: 'Shipment ID' }, { key: 'shipstation_id', label: 'ShipStation ID' }, { key: 'am_invoice_id', label: 'Invoice #' },
    { key: 'ship_date', label: 'Ship Date' }, { key: 'shipment_status', label: 'Status' }, { key: 'qty', label: 'Qty' },
    { key: 'qty_boxes', label: 'Boxes' }, { key: 'carrier_name', label: 'Carrier' }, { key: 'tracking_number', label: 'Tracking' },
  ]},
  details: { label: 'Details', columns: [
    { key: 'service_code', label: 'Service' }, { key: 'weight_value', label: 'Weight' }, { key: 'weight_units', label: 'Weight Unit' },
    { key: 'shipment_cost', label: 'Cost' }, { key: 'insurance_cost', label: 'Insurance' }, { key: 'void_date', label: 'Void Date' },
    { key: 'is_return', label: 'Return' }, { key: 'label_data', label: 'Label' },
  ]},
  shipping: { label: 'Ship To', columns: [
    { key: 'ship_to_name', label: 'Ship To' }, { key: 'ship_to_city', label: 'City' }, { key: 'ship_to_state', label: 'State' },
    { key: 'ship_to_country', label: 'Country' }, { key: 'ship_to_zip', label: 'Zip' },
  ]},
  audit: { label: 'Audit', columns: [
    { key: 'last_synced_at', label: 'Last Synced' }, { key: 'create_date', label: 'Created' },
  ]},
};

const DEFAULT_COLUMNS = ['am_shipment_id', 'am_invoice_id', 'ship_date', 'shipment_status', 'qty', 'qty_boxes', 'carrier_name', 'tracking_number', 'ship_to_name'];
const STORAGE_KEY = 'advancehq-shipments-columns';

function getStoredColumns(): string[] {
  if (typeof window === 'undefined') return DEFAULT_COLUMNS;
  try { const s = localStorage.getItem(STORAGE_KEY); if (s) return JSON.parse(s); } catch {}
  return DEFAULT_COLUMNS;
}

function fmt(key: string, value: any): string {
  if (value === null || value === undefined || value === '') return '-';
  if (key === 'shipment_cost' || key === 'insurance_cost') return `$${parseFloat(value).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
  if (key.includes('synced_at') || key === 'create_date' || key === 'void_date') { try { return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch { return value; } }
  if (typeof value === 'boolean' || key === 'is_return') return (value === true || value === 'true') ? 'Yes' : 'No';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function getColumnLabel(key: string): string {
  for (const g of Object.values(COLUMN_GROUPS)) { const c = g.columns.find(c => c.key === key); if (c) return c.label; }
  return key.replace(/_/g, ' ');
}

export default function ShipmentsPage() {
  const { open: openDrawer } = useDrawer();
  const [shipments, setShipments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [selected, setSelected] = useState<any | null>(null);
  const [shipmentItems, setShipmentItems] = useState<any[]>([]);
  const [visibleColumns, setVisibleColumns] = useState<string[]>(DEFAULT_COLUMNS);
  const [showColumnPicker, setShowColumnPicker] = useState(false);
  const [detailTab, setDetailTab] = useState('overview');

  useEffect(() => { setVisibleColumns(getStoredColumns()); }, []);
  useEffect(() => { setPage(0); }, [search, statusFilter]);
  useEffect(() => { loadShipments(); }, [page, search, statusFilter]);

  function saveColumns(cols: string[]) { setVisibleColumns(cols); localStorage.setItem(STORAGE_KEY, JSON.stringify(cols)); }
  function toggleColumn(key: string) { const next = visibleColumns.includes(key) ? visibleColumns.filter(c => c !== key) : [...visibleColumns, key]; saveColumns(next); }

  async function loadShipments() {
    setLoading(true);
    let query = supabase.from('shipments').select('*', { count: 'exact' });
    if (search) query = query.or(`am_shipment_id.ilike.%${search}%,am_invoice_id.ilike.%${search}%,tracking_number.ilike.%${search}%,carrier_name.ilike.%${search}%,ship_to_name.ilike.%${search}%`);
    if (statusFilter) query = query.eq('shipment_status', statusFilter);
    const { data, count } = await query.order('ship_date', { ascending: false }).range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    if (data) { setShipments(data); setTotalCount(count || 0); }
    setLoading(false);
  }

  async function openDetail(shipment: any) {
    setSelected(shipment); setDetailTab('overview');
    const { data } = await supabase.from('shipment_items').select('*').eq('shipment_id', shipment.id);
    setShipmentItems(data || []);
  }

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);
  const DETAIL_SECTIONS: Record<string, { label: string; fields: string[] }> = {
    overview: { label: 'Overview', fields: ['am_shipment_id', 'shipstation_id', 'am_invoice_id', 'ship_date', 'shipment_status', 'qty', 'qty_boxes', 'carrier_name', 'service_code', 'tracking_number', 'is_return'] },
    costs: { label: 'Costs & Weight', fields: ['shipment_cost', 'insurance_cost', 'weight_value', 'weight_units', 'void_date'] },
    shipping: { label: 'Ship To', fields: ['ship_to_name', 'ship_to_company', 'ship_to_street_1', 'ship_to_street_2', 'ship_to_city', 'ship_to_state', 'ship_to_zip', 'ship_to_country', 'ship_to_phone'] },
    ship_from: { label: 'Ship From', fields: ['ship_from_name', 'ship_from_company', 'ship_from_city', 'ship_from_state', 'ship_from_zip', 'ship_from_country'] },
    audit: { label: 'Audit', fields: ['create_date', 'last_synced_at', 'created_at'] },
  };

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div><h1 className="text-2xl font-bold text-gray-900">Shipments</h1><p className="text-gray-500 mt-1">{totalCount.toLocaleString()} shipments synced</p></div>
        <button onClick={() => setShowColumnPicker(!showColumnPicker)} className="flex items-center gap-2 px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75" /></svg>
          Columns ({visibleColumns.length})
        </button>
      </div>

      {showColumnPicker && (<div className="card mb-6"><div className="flex items-center justify-between mb-4"><h3 className="font-semibold text-gray-900">Customize Table Columns</h3><div className="flex gap-2"><button onClick={() => saveColumns(DEFAULT_COLUMNS)} className="text-xs px-3 py-1 border border-gray-300 rounded hover:bg-gray-50">Reset</button><button onClick={() => setShowColumnPicker(false)} className="text-xs px-3 py-1 bg-brand-600 text-white rounded hover:bg-brand-700">Done</button></div></div><div className="grid grid-cols-2 md:grid-cols-4 gap-4">{Object.entries(COLUMN_GROUPS).map(([gk, g]) => (<div key={gk}><p className="text-xs font-medium text-gray-400 uppercase mb-2">{g.label}</p><div className="space-y-1">{g.columns.map(col => (<label key={col.key} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-gray-50 rounded px-1 py-0.5"><input type="checkbox" checked={visibleColumns.includes(col.key)} onChange={() => toggleColumn(col.key)} className="rounded border-gray-300 text-brand-600 focus:ring-brand-500" />{col.label}</label>))}</div></div>))}</div></div>)}

      <div className="card mb-6"><div className="flex flex-col md:flex-row gap-4"><div className="flex-1"><input type="text" placeholder="Search by shipment ID, invoice, tracking, carrier..." value={search} onChange={(e) => setSearch(e.target.value)} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none" /></div><select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="px-4 py-2 border border-gray-300 rounded-lg outline-none bg-white"><option value="">All Statuses</option><option value="shipped">Shipped</option><option value="delivered">Delivered</option><option value="voided">Voided</option></select></div></div>

      <div className="card">
        {loading ? <div className="text-center py-8 text-gray-500">Loading...</div> : shipments.length === 0 ? <div className="text-center py-8 text-gray-500">No shipments found</div> : (
          <>
            <div className="overflow-x-auto"><table className="w-full"><thead><tr className="border-b border-gray-200">{visibleColumns.map(col => <th key={col} className="table-header pb-3 whitespace-nowrap">{getColumnLabel(col)}</th>)}</tr></thead><tbody>
              {shipments.map(s => (<tr key={s.id} className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer transition-colors" onClick={() => openDetail(s)}>{visibleColumns.map(col => (<td key={col} className="table-cell text-sm max-w-[200px] truncate">
                {col === 'am_shipment_id' ? <span className="font-medium text-brand-600">{s[col] || s.shipstation_id || '-'}</span>
                  : col === 'am_invoice_id' && s[col] ? <button onClick={(e) => { e.stopPropagation(); openDrawer('invoice', s[col]); }} className="text-brand-600 hover:underline">{s[col]}</button>
                  : col === 'shipment_status' ? <span className={`px-2 py-0.5 rounded text-xs font-medium ${s[col] === 'shipped' || s[col] === 'delivered' ? 'bg-green-100 text-green-700' : s[col] === 'voided' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'}`}>{s[col] || '-'}</span>
                  : col === 'tracking_number' && s[col] ? <span className="text-xs text-blue-600">{s[col]}</span>
                  : fmt(col, s[col])}
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
                <h2 className="text-xl font-bold text-gray-900">Shipment {selected.am_shipment_id || selected.shipstation_id}</h2>
                <p className="text-gray-500">
                  {selected.am_invoice_id ? <>Invoice <button onClick={() => openDrawer('invoice', selected.am_invoice_id)} className="text-brand-600 hover:underline">#{selected.am_invoice_id}</button></> : 'No invoice linked'}
                  {selected.carrier_name ? ` · ${selected.carrier_name}` : ''}
                </p>
                <div className="flex gap-3 mt-2">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${selected.shipment_status === 'shipped' || selected.shipment_status === 'delivered' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>{selected.shipment_status || 'unknown'}</span>
                  <span className="text-sm text-gray-500">{selected.ship_date}</span>
                  {selected.tracking_number && <span className="text-sm text-blue-600">{selected.tracking_number}</span>}
                </div>
              </div>
              <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
            </div>

            <div className="flex gap-1 border-b border-gray-200 mb-6 overflow-x-auto">
              {Object.entries(DETAIL_SECTIONS).map(([key, section]) => (<button key={key} onClick={() => setDetailTab(key)} className={`px-4 py-2 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${detailTab === key ? 'border-brand-600 text-brand-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>{section.label}</button>))}
              <button onClick={() => setDetailTab('items')} className={`px-4 py-2 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${detailTab === 'items' ? 'border-brand-600 text-brand-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>Items ({shipmentItems.length})</button>
            </div>

            {detailTab !== 'items' && DETAIL_SECTIONS[detailTab] && (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {DETAIL_SECTIONS[detailTab].fields.map(field => {
                  const value = selected[field]; const hasValue = value !== null && value !== undefined && value !== '' && value !== 0 && value !== '0';
                  const isInvoice = field === 'am_invoice_id';
                  return (<div key={field} className={`rounded-lg p-3 ${hasValue ? 'bg-gray-50' : 'bg-gray-50/50'}`}><p className="text-xs text-gray-400 mb-1">{getColumnLabel(field)}</p>
                    {isInvoice && hasValue ? <button onClick={() => openDrawer('invoice', String(value))} className="text-sm font-medium text-brand-600 hover:underline">{String(value)}</button>
                    : <p className={`text-sm font-medium ${hasValue ? 'text-gray-900' : 'text-gray-300'}`}>{fmt(field, value)}</p>}
                  </div>);
                })}
              </div>
            )}

            {detailTab === 'items' && (<div className="overflow-x-auto">{shipmentItems.length === 0 ? <p className="text-gray-400 text-center py-8">No items</p> : (<table className="w-full text-sm"><thead><tr className="bg-gray-50 border-b border-gray-200"><th className="px-3 py-2 text-left font-medium text-gray-500">Name</th><th className="px-3 py-2 text-left font-medium text-gray-500">SKU</th><th className="px-3 py-2 text-right font-medium text-gray-500">Qty</th><th className="px-3 py-2 text-right font-medium text-gray-500">Price</th></tr></thead><tbody>{shipmentItems.map((item, i) => (<tr key={i} className="border-b border-gray-100"><td className="px-3 py-2 font-medium">{item.name || item.product_name || '-'}</td><td className="px-3 py-2">{item.sku || '-'}</td><td className="px-3 py-2 text-right">{item.quantity || 0}</td><td className="px-3 py-2 text-right">${(item.unit_price || 0).toFixed(2)}</td></tr>))}</tbody></table>)}</div>)}
          </div></div>
        </div>
      )}
    </div>
  );
}
