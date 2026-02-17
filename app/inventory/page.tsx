'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

const PAGE_SIZE = 20;

const COLUMN_GROUPS: Record<string, { label: string; columns: { key: string; label: string }[] }> = {
  core: {
    label: 'Core',
    columns: [
      { key: 'style_number', label: 'Style #' },
      { key: 'description', label: 'Description' },
      { key: 'attr_2', label: 'Color' },
      { key: 'size', label: 'Size' },
      { key: 'sku_id', label: 'SKU ID' },
      { key: 'product_id', label: 'Product ID' },
      { key: 'upc_display', label: 'UPC' },
      { key: 'active', label: 'Active' },
    ]
  },
  quantities: {
    label: 'Quantities',
    columns: [
      { key: 'qty_inventory', label: 'On Hand' },
      { key: 'qty_avail_sell', label: 'Avail to Sell' },
      { key: 'qty_alloc', label: 'Allocated' },
      { key: 'qty_avail_alloc', label: 'Avail to Alloc' },
      { key: 'qty_open_sales', label: 'Open Sales' },
      { key: 'qty_picked', label: 'Picked' },
      { key: 'qty_open_po', label: 'Open PO' },
      { key: 'qty_in_transit', label: 'In Transit' },
      { key: 'qty_otr', label: 'OTR' },
    ]
  },
  history: {
    label: 'History',
    columns: [
      { key: 'qty_invoiced', label: 'Invoiced' },
      { key: 'qty_received', label: 'Received' },
      { key: 'qty_returned', label: 'Returned' },
      { key: 'qty_credited', label: 'Credited' },
      { key: 'qty_issued', label: 'Issued' },
      { key: 'qty_authorized_to_return', label: 'Auth Return' },
    ]
  },
  pricing: {
    label: 'Pricing',
    columns: [
      { key: 'price', label: 'Price' },
      { key: 'retail_price', label: 'Retail' },
      { key: 'cost', label: 'Cost' },
      { key: 'cost_base', label: 'Base Cost' },
      { key: 'cost_mfg', label: 'Mfg Cost' },
      { key: 'cost_historical_wa', label: 'Hist WA Cost' },
      { key: 'vendor_cost_base', label: 'Vendor Cost' },
    ]
  },
  details: {
    label: 'Details',
    columns: [
      { key: 'sku_concat', label: 'SKU Concat' },
      { key: 'sku_alt', label: 'Alt SKU' },
      { key: 'analysis_code', label: 'Analysis Code' },
      { key: 'location', label: 'Location' },
      { key: 'weight', label: 'Weight' },
      { key: 'nrf_size', label: 'NRF Size' },
      { key: 'web_title', label: 'Web Title' },
    ]
  },
  flags: {
    label: 'Flags',
    columns: [
      { key: 'is_inventory_tracked', label: 'Tracked' },
      { key: 'is_product', label: 'Is Product' },
      { key: 'is_component', label: 'Is Component' },
      { key: 'is_bundle', label: 'Is Bundle' },
    ]
  },
  reorder: {
    label: 'Reorder',
    columns: [
      { key: 'qty_min_reorder', label: 'Min Reorder' },
      { key: 'qty_min_inventory', label: 'Min Inventory' },
      { key: 'qty_required_comp', label: 'Req Components' },
      { key: 'qty_required_bundles', label: 'Req Bundles' },
      { key: 'qty_open_wip', label: 'Open WIP' },
    ]
  },
  audit: {
    label: 'Audit',
    columns: [
      { key: 'am_creation_user_name', label: 'Created By' },
      { key: 'am_last_modified_time', label: 'Modified At' },
      { key: 'last_synced_at', label: 'Last Synced' },
    ]
  },
};

const DEFAULT_COLUMNS = ['style_number', 'description', 'attr_2', 'size', 'qty_inventory', 'qty_avail_sell', 'qty_alloc', 'qty_open_sales', 'qty_open_po', 'cost', 'active'];
const STORAGE_KEY = 'advancehq-inventory-columns';

function getStoredColumns(): string[] {
  if (typeof window === 'undefined') return DEFAULT_COLUMNS;
  try { const s = localStorage.getItem(STORAGE_KEY); if (s) return JSON.parse(s); } catch {}
  return DEFAULT_COLUMNS;
}

function fmt(key: string, value: any): string {
  if (value === null || value === undefined || value === '') return '-';
  if (key === 'price' || key === 'retail_price' || key === 'cost' || key === 'cost_base' || key === 'cost_mfg' || key === 'cost_historical_wa' || key === 'cost_historical_wa_old' || key === 'vendor_cost_base') {
    const n = parseFloat(value);
    return isNaN(n) ? String(value) : `$${n.toFixed(4)}`;
  }
  if (key.includes('synced_at') || key.includes('modified_time')) {
    try { return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch { return value; }
  }
  if (typeof value === 'boolean' || key === 'active' || key === 'is_inventory_tracked' || key === 'is_product' || key === 'is_component' || key === 'is_bundle') {
    return (value === true || value === 'true') ? 'Yes' : 'No';
  }
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function getColumnLabel(key: string): string {
  for (const g of Object.values(COLUMN_GROUPS)) { const c = g.columns.find(c => c.key === key); if (c) return c.label; }
  return key.replace(/_/g, ' ');
}

export default function InventoryPage() {
  const [inventory, setInventory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState('active');
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [selected, setSelected] = useState<any | null>(null);
  const [visibleColumns, setVisibleColumns] = useState<string[]>(DEFAULT_COLUMNS);
  const [showColumnPicker, setShowColumnPicker] = useState(false);
  const [detailTab, setDetailTab] = useState('quantities');

  useEffect(() => { setVisibleColumns(getStoredColumns()); }, []);
  useEffect(() => { setPage(0); }, [search, activeFilter]);
  useEffect(() => { loadInventory(); }, [page, search, activeFilter]);

  function saveColumns(cols: string[]) { setVisibleColumns(cols); localStorage.setItem(STORAGE_KEY, JSON.stringify(cols)); }
  function toggleColumn(key: string) { const next = visibleColumns.includes(key) ? visibleColumns.filter(c => c !== key) : [...visibleColumns, key]; saveColumns(next); }

  async function loadInventory() {
    setLoading(true);
    let query = supabase.from('inventory').select('*', { count: 'exact' });
    if (search) query = query.or(`style_number.ilike.%${search}%,description.ilike.%${search}%,attr_2.ilike.%${search}%,upc_display.ilike.%${search}%,sku_concat.ilike.%${search}%,sku_alt.ilike.%${search}%`);
    if (activeFilter === 'active') query = query.eq('active', true);
    else if (activeFilter === 'inactive') query = query.eq('active', false);
    const { data, count } = await query.order('style_number').range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    if (data) { setInventory(data); setTotalCount(count || 0); }
    setLoading(false);
  }

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  const DETAIL_SECTIONS: Record<string, { label: string; fields: string[] }> = {
    quantities: { label: 'Quantities', fields: ['qty_inventory', 'qty_avail_sell', 'qty_alloc', 'qty_avail_alloc', 'qty_open_sales', 'qty_picked', 'qty_open_po', 'qty_open_po_no_proj', 'qty_in_transit', 'qty_otr', 'qty_open_wip', 'qty_per_inner_pack'] },
    history: { label: 'History', fields: ['qty_invoiced', 'qty_received', 'qty_returned', 'qty_credited', 'qty_issued', 'qty_authorized_to_return', 'qty_required_comp', 'qty_required_bundles'] },
    pricing: { label: 'Pricing', fields: ['price', 'retail_price', 'cost', 'cost_base', 'cost_mfg', 'cost_historical_wa', 'cost_historical_wa_old', 'vendor_cost_base', 'price_offset', 'retail_price_offset', 'cost_offset', 'vendor_cost_offset'] },
    identity: { label: 'Identity', fields: ['sku_id', 'product_id', 'style_number', 'description', 'attr_2', 'attr_3', 'size', 'size_position', 'sku_concat', 'attr_2_name', 'attr_3_name', 'product_attribute_id'] },
    codes: { label: 'Codes & IDs', fields: ['upc_display', 'upc_11', 'sku', 'sku_alt', 'nrf_size', 'attr_2_nrf_id', 'analysis_code', 'location', 'web_title', 'weight', 'weight_offset'] },
    flags: { label: 'Flags', fields: ['active', 'is_inventory_tracked', 'is_product', 'is_component', 'is_bundle', 'joor_sync'] },
    reorder: { label: 'Reorder', fields: ['qty_min_reorder', 'qty_min_inventory'] },
    shopify: { label: 'Shopify', fields: ['shopify_compare_at_price_wholesale', 'shopify_retail_compare_at_price'] },
    audit: { label: 'Audit', fields: ['am_creation_time', 'am_creation_user_name', 'am_last_modified_time', 'am_last_modified_user_name', 'am_last_modified_command', 'ref_table', 'last_synced_at'] },
  };

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Inventory</h1>
          <p className="text-gray-500 mt-1">{totalCount.toLocaleString()} SKU records synced from ApparelMagic</p>
        </div>
        <button onClick={() => setShowColumnPicker(!showColumnPicker)} className="flex items-center gap-2 px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75" /></svg>
          Columns ({visibleColumns.length})
        </button>
      </div>

      {showColumnPicker && (
        <div className="card mb-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-900">Customize Table Columns</h3>
            <div className="flex gap-2">
              <button onClick={() => saveColumns(DEFAULT_COLUMNS)} className="text-xs px-3 py-1 border border-gray-300 rounded hover:bg-gray-50">Reset</button>
              <button onClick={() => setShowColumnPicker(false)} className="text-xs px-3 py-1 bg-brand-600 text-white rounded hover:bg-brand-700">Done</button>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {Object.entries(COLUMN_GROUPS).map(([gk, g]) => (
              <div key={gk}>
                <p className="text-xs font-medium text-gray-400 uppercase mb-2">{g.label}</p>
                <div className="space-y-1">{g.columns.map(col => (
                  <label key={col.key} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-gray-50 rounded px-1 py-0.5">
                    <input type="checkbox" checked={visibleColumns.includes(col.key)} onChange={() => toggleColumn(col.key)} className="rounded border-gray-300 text-brand-600 focus:ring-brand-500" />{col.label}
                  </label>
                ))}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card mb-6">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1">
            <input type="text" placeholder="Search by style #, description, color, UPC, SKU..." value={search} onChange={(e) => setSearch(e.target.value)} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none" />
          </div>
          <select value={activeFilter} onChange={(e) => setActiveFilter(e.target.value)} className="px-4 py-2 border border-gray-300 rounded-lg outline-none bg-white">
            <option value="all">All SKUs</option>
            <option value="active">Active Only</option>
            <option value="inactive">Inactive Only</option>
          </select>
        </div>
      </div>

      <div className="card">
        {loading ? <div className="text-center py-8 text-gray-500">Loading...</div> : inventory.length === 0 ? <div className="text-center py-8 text-gray-500">No inventory found</div> : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead><tr className="border-b border-gray-200">
                  {visibleColumns.map(col => <th key={col} className="table-header pb-3 whitespace-nowrap">{getColumnLabel(col)}</th>)}
                </tr></thead>
                <tbody>
                  {inventory.map(inv => (
                    <tr key={inv.id} className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer transition-colors" onClick={() => { setSelected(inv); setDetailTab('quantities'); }}>
                      {visibleColumns.map(col => (
                        <td key={col} className="table-cell text-sm max-w-[200px] truncate">
                          {col === 'style_number' ? <span className="font-medium text-brand-600">{inv[col]}</span>
                            : col === 'active' ? <span className={`inline-block w-2 h-2 rounded-full ${inv[col] ? 'bg-green-500' : 'bg-gray-300'}`} />
                            : col === 'qty_avail_sell' ? <span className={`font-medium ${parseFloat(inv[col] || 0) > 0 ? 'text-green-700' : parseFloat(inv[col] || 0) < 0 ? 'text-red-600' : 'text-gray-400'}`}>{inv[col] || 0}</span>
                            : col === 'qty_inventory' ? <span className="font-medium">{inv[col] || 0}</span>
                            : fmt(col, inv[col])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-200">
              <p className="text-sm text-gray-500">Showing {page * PAGE_SIZE + 1}-{Math.min((page + 1) * PAGE_SIZE, totalCount)} of {totalCount.toLocaleString()}</p>
              <div className="flex gap-2">
                <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} className="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed">Previous</button>
                <span className="px-3 py-1 text-sm text-gray-500">Page {page + 1} of {totalPages}</span>
                <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} className="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed">Next</button>
              </div>
            </div>
          </>
        )}
      </div>

      {selected && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl max-w-5xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h2 className="text-xl font-bold text-gray-900">{selected.style_number} {selected.attr_2 ? `/ ${selected.attr_2}` : ''} {selected.size ? `/ ${selected.size}` : ''}</h2>
                  <p className="text-gray-500">{selected.description || 'No description'}</p>
                  <div className="flex gap-4 mt-2">
                    <span className="text-sm"><span className="text-gray-400">On Hand:</span> <span className="font-medium">{selected.qty_inventory || 0}</span></span>
                    <span className="text-sm"><span className="text-gray-400">Avail:</span> <span className={`font-medium ${parseFloat(selected.qty_avail_sell || 0) > 0 ? 'text-green-700' : 'text-red-600'}`}>{selected.qty_avail_sell || 0}</span></span>
                    <span className="text-sm"><span className="text-gray-400">Cost:</span> <span className="font-medium">${parseFloat(selected.cost || 0).toFixed(2)}</span></span>
                    {selected.upc_display && <span className="text-sm text-gray-400">UPC: {selected.upc_display}</span>}
                  </div>
                </div>
                <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
              </div>

              <div className="flex gap-1 border-b border-gray-200 mb-6 overflow-x-auto">
                {Object.entries(DETAIL_SECTIONS).map(([key, section]) => (
                  <button key={key} onClick={() => setDetailTab(key)} className={`px-3 py-2 text-xs font-medium whitespace-nowrap border-b-2 transition-colors ${detailTab === key ? 'border-brand-600 text-brand-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>{section.label}</button>
                ))}
              </div>

              {DETAIL_SECTIONS[detailTab] && (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {DETAIL_SECTIONS[detailTab].fields.map(field => {
                    const value = selected[field];
                    const hasValue = value !== null && value !== undefined && value !== '' && value !== 0 && value !== '0' && value !== '0.00' && value !== '0.0000' && value !== false;
                    return (
                      <div key={field} className={`rounded-lg p-3 ${hasValue ? 'bg-gray-50' : 'bg-gray-50/50'}`}>
                        <p className="text-xs text-gray-400 mb-1">{getColumnLabel(field)}</p>
                        <p className={`text-sm font-medium ${hasValue ? 'text-gray-900' : 'text-gray-300'}`}>{fmt(field, value)}</p>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
