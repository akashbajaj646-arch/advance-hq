'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useDrawer } from '@/context/DrawerContext';

const PAGE_SIZE = 20;

const COLUMN_GROUPS: Record<string, { label: string; columns: { key: string; label: string }[] }> = {
  core: {
    label: 'Core',
    columns: [
      { key: 'customer_name', label: 'Name' },
      { key: 'account_number', label: 'Account #' },
      { key: 'email', label: 'Email' },
      { key: 'phone', label: 'Phone' },
      { key: 'city', label: 'City' },
      { key: 'state', label: 'State' },
      { key: 'country', label: 'Country' },
      { key: 'category', label: 'Category' },
      { key: 'price_group', label: 'Price Group' },
      { key: 'is_active', label: 'Active' },
    ]
  },
  financial: {
    label: 'Financial',
    columns: [
      { key: 'credit_limit', label: 'Credit Limit' },
      { key: 'pct_discount', label: 'Discount %' },
      { key: 'terms_id', label: 'Terms' },
      { key: 'ar_acct', label: 'AR Account' },
      { key: 'currency_id', label: 'Currency' },
    ]
  },
  details: {
    label: 'Details',
    columns: [
      { key: 'first_name', label: 'First Name' },
      { key: 'last_name', label: 'Last Name' },
      { key: 'website', label: 'Website' },
      { key: 'division_id', label: 'Division' },
      { key: 'buyer_filter', label: 'Buyer Filter' },
      { key: 'royalty_rate', label: 'Royalty Rate' },
    ]
  },
  integration: {
    label: 'Integration',
    columns: [
      { key: 'shopify_id', label: 'Shopify ID' },
      { key: 'xero_id', label: 'Xero ID' },
      { key: 'quickbooks_id', label: 'QuickBooks ID' },
    ]
  },
  audit: {
    label: 'Audit',
    columns: [
      { key: 'date_created', label: 'Date Created' },
      { key: 'last_synced_at', label: 'Last Synced' },
    ]
  },
};

const DEFAULT_COLUMNS = ['customer_name', 'account_number', 'email', 'phone', 'city', 'state', 'category', 'price_group', 'is_active'];
const STORAGE_KEY = 'advancehq-customers-columns';

function getStoredColumns(): string[] {
  if (typeof window === 'undefined') return DEFAULT_COLUMNS;
  try { const s = localStorage.getItem(STORAGE_KEY); if (s) return JSON.parse(s); } catch {}
  return DEFAULT_COLUMNS;
}

function formatValue(key: string, value: any): string {
  if (value === null || value === undefined || value === '') return '-';
  if (typeof value === 'boolean' || key === 'is_active') return (value === true || value === 'true') ? 'Yes' : 'No';
  if (key === 'credit_limit' || key === 'pct_discount') {
    const n = parseFloat(value);
    return isNaN(n) ? String(value) : key === 'pct_discount' ? `${n.toFixed(2)}%` : `$${n.toLocaleString()}`;
  }
  if (key.includes('synced_at') || key.includes('created_at') || key.includes('updated_at')) {
    try { return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch { return value; }
  }
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function getColumnLabel(key: string): string {
  for (const g of Object.values(COLUMN_GROUPS)) { const c = g.columns.find(c => c.key === key); if (c) return c.label; }
  return key;
}

export default function CustomersPage() {
  const { open: openDrawer } = useDrawer();
  const [customers, setCustomers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [stateFilter, setStateFilter] = useState('');
  const [categories, setCategories] = useState<string[]>([]);
  const [states, setStates] = useState<string[]>([]);
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [selected, setSelected] = useState<any | null>(null);
  const [orderCount, setOrderCount] = useState(0);
  const [invoiceCount, setInvoiceCount] = useState(0);
  const [recentOrders, setRecentOrders] = useState<any[]>([]);
  const [recentInvoices, setRecentInvoices] = useState<any[]>([]);
  const [visibleColumns, setVisibleColumns] = useState<string[]>(DEFAULT_COLUMNS);
  const [showColumnPicker, setShowColumnPicker] = useState(false);
  const [detailTab, setDetailTab] = useState('overview');

  useEffect(() => { setVisibleColumns(getStoredColumns()); loadFilters(); }, []);
  useEffect(() => { setPage(0); }, [search, categoryFilter, stateFilter]);
  useEffect(() => { loadCustomers(); }, [page, search, categoryFilter, stateFilter]);

  function saveColumns(cols: string[]) { setVisibleColumns(cols); localStorage.setItem(STORAGE_KEY, JSON.stringify(cols)); }
  function toggleColumn(key: string) { const next = visibleColumns.includes(key) ? visibleColumns.filter(c => c !== key) : [...visibleColumns, key]; saveColumns(next); }

  async function loadFilters() {
    const { data: cats } = await supabase.from('customers').select('category').not('category', 'is', null).not('category', 'eq', '');
    if (cats) { const u = [...new Set(cats.map(d => d.category).filter(Boolean))] as string[]; u.sort(); setCategories(u); }
    const { data: sts } = await supabase.from('customers').select('state').not('state', 'is', null).not('state', 'eq', '');
    if (sts) { const u = [...new Set(sts.map(d => d.state).filter(Boolean))] as string[]; u.sort(); setStates(u); }
  }

  async function loadCustomers() {
    setLoading(true);
    let query = supabase.from('customers').select('*', { count: 'exact' });
    if (search) query = query.or(`customer_name.ilike.%${search}%,email.ilike.%${search}%,account_number.ilike.%${search}%,phone.ilike.%${search}%,city.ilike.%${search}%`);
    if (categoryFilter) query = query.eq('category', categoryFilter);
    if (stateFilter) query = query.eq('state', stateFilter);
    const { data, count } = await query.order('customer_name', { ascending: true }).range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    if (data) { setCustomers(data); setTotalCount(count || 0); }
    setLoading(false);
  }

  async function openDetail(customer: any) {
    setSelected(customer);
    setDetailTab('overview');
    const { count: oc } = await supabase.from('orders').select('*', { count: 'exact', head: true }).eq('apparel_magic_customer_id', customer.am_customer_id);
    setOrderCount(oc || 0);
    const { count: ic } = await supabase.from('invoices').select('*', { count: 'exact', head: true }).eq('apparel_magic_customer_id', customer.am_customer_id);
    setInvoiceCount(ic || 0);
    const { data: ro } = await supabase.from('orders').select('order_number, apparel_magic_id, order_date, total_amount, order_status, customer_name, qty, qty_shipped, season').eq('apparel_magic_customer_id', customer.am_customer_id).order('order_date', { ascending: false }).limit(20);
    setRecentOrders(ro || []);
    const { data: ri } = await supabase.from('invoices').select('invoice_number, apparel_magic_id, apparel_magic_order_id, invoice_date, total_amount, balance_due, payment_status, season').eq('apparel_magic_customer_id', customer.am_customer_id).order('invoice_date', { ascending: false }).limit(20);
    setRecentInvoices(ri || []);
  }

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  const DETAIL_SECTIONS: Record<string, { label: string; fields: string[] }> = {
    overview: { label: 'Overview', fields: ['customer_name', 'first_name', 'last_name', 'account_number', 'email', 'phone', 'website', 'category', 'price_group', 'division_id', 'is_active', 'date_created'] },
    address: { label: 'Address', fields: ['address_1', 'address_2', 'city', 'state', 'postal_code', 'country'] },
    financial: { label: 'Financial', fields: ['credit_limit', 'pct_discount', 'terms_id', 'ar_acct', 'currency_id', 'royalty_rate'] },
    shipping: { label: 'Shipping & EDI', fields: ['shipping_info', 'buyer_filter', 'edi_department'] },
    integration: { label: 'Integration', fields: ['shopify_id', 'xero_id', 'xero_synced', 'quickbooks_id', 'anet_id'] },
    notes: { label: 'Notes', fields: ['notes'] },
    audit: { label: 'Audit', fields: ['created_at', 'updated_at', 'last_synced_at'] },
  };

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Customers</h1>
          <p className="text-gray-500 mt-1">{totalCount.toLocaleString()} customers synced from ApparelMagic</p>
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
                <div className="space-y-1">
                  {g.columns.map(col => (
                    <label key={col.key} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-gray-50 rounded px-1 py-0.5">
                      <input type="checkbox" checked={visibleColumns.includes(col.key)} onChange={() => toggleColumn(col.key)} className="rounded border-gray-300 text-brand-600 focus:ring-brand-500" />
                      {col.label}
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card mb-6">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1">
            <input type="text" placeholder="Search by name, email, account #, phone, city..." value={search} onChange={(e) => setSearch(e.target.value)} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none" />
          </div>
          <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="px-4 py-2 border border-gray-300 rounded-lg outline-none bg-white">
            <option value="">All Categories</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={stateFilter} onChange={(e) => setStateFilter(e.target.value)} className="px-4 py-2 border border-gray-300 rounded-lg outline-none bg-white">
            <option value="">All States</option>
            {states.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      <div className="card">
        {loading ? <div className="text-center py-8 text-gray-500">Loading...</div> : customers.length === 0 ? <div className="text-center py-8 text-gray-500">No customers found</div> : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200">
                    {visibleColumns.map(col => <th key={col} className="table-header pb-3 whitespace-nowrap">{getColumnLabel(col)}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {customers.map(c => (
                    <tr key={c.id} className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer transition-colors" onClick={() => openDetail(c)}>
                      {visibleColumns.map(col => (
                        <td key={col} className="table-cell text-sm max-w-[200px] truncate">
                          {col === 'customer_name' ? <span className="font-medium text-brand-600">{c[col]}</span>
                            : col === 'is_active' ? <span className={`inline-block w-2 h-2 rounded-full ${c[col] === true || c[col] === 'true' ? 'bg-green-500' : 'bg-gray-300'}`} />
                            : col === 'category' && c[col] ? <span className="badge badge-gray">{c[col]}</span>
                            : formatValue(col, c[col])}
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
                  <h2 className="text-xl font-bold text-gray-900">{selected.customer_name}</h2>
                  <p className="text-gray-500">{selected.email || 'No email'} {selected.phone ? `· ${selected.phone}` : ''}</p>
                  <div className="flex gap-4 mt-2 text-sm">
                    <span className="text-gray-500">{orderCount} orders</span>
                    <span className="text-gray-500">{invoiceCount} invoices</span>
                    {selected.account_number && <span className="text-gray-400">Acct: {selected.account_number}</span>}
                  </div>
                </div>
                <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
              </div>

              <div className="flex gap-1 border-b border-gray-200 mb-6 overflow-x-auto">
                {Object.entries(DETAIL_SECTIONS).map(([key, section]) => (
                  <button key={key} onClick={() => setDetailTab(key)} className={`px-4 py-2 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${detailTab === key ? 'border-brand-600 text-brand-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>{section.label}</button>
                ))}
                <button onClick={() => setDetailTab('orders')} className={`px-4 py-2 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${detailTab === 'orders' ? 'border-brand-600 text-brand-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>Orders ({orderCount})</button>
                <button onClick={() => setDetailTab('invoices')} className={`px-4 py-2 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${detailTab === 'invoices' ? 'border-brand-600 text-brand-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>Invoices ({invoiceCount})</button>
              </div>

              {detailTab !== 'orders' && detailTab !== 'invoices' && DETAIL_SECTIONS[detailTab] && (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {DETAIL_SECTIONS[detailTab].fields.map(field => {
                    const value = selected[field];
                    const hasValue = value !== null && value !== undefined && value !== '';
                    return (
                      <div key={field} className={`rounded-lg p-3 ${hasValue ? 'bg-gray-50' : 'bg-gray-50/50'}`}>
                        <p className="text-xs text-gray-400 mb-1">{getColumnLabel(field) || field.replace(/_/g, ' ')}</p>
                        <p className={`text-sm font-medium ${hasValue ? 'text-gray-900' : 'text-gray-300'}`}>{formatValue(field, value)}</p>
                      </div>
                    );
                  })}
                </div>
              )}

              {detailTab === 'orders' && (
                <div className="overflow-x-auto">
                  {recentOrders.length === 0 ? <p className="text-gray-400 text-center py-8">No orders found</p> : (
                    <table className="w-full text-sm">
                      <thead><tr className="bg-gray-50 border-b border-gray-200">
                        <th className="px-3 py-2 text-left font-medium text-gray-500">Order #</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-500">Date</th>
                        <th className="px-3 py-2 text-right font-medium text-gray-500">Total</th>
                        <th className="px-3 py-2 text-right font-medium text-gray-500">Qty</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-500">Status</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-500">Season</th>
                      </tr></thead>
                      <tbody>
                        {recentOrders.map((o, i) => (
                          <tr key={i} className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer" onClick={() => openDrawer('order', o.order_number)}>
                            <td className="px-3 py-2 font-medium text-brand-600 hover:underline">{o.order_number}</td>
                            <td className="px-3 py-2">{o.order_date || '-'}</td>
                            <td className="px-3 py-2 text-right">${parseFloat(o.total_amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                            <td className="px-3 py-2 text-right">{o.qty || 0}</td>
                            <td className="px-3 py-2"><span className={`px-2 py-0.5 rounded text-xs font-medium ${o.order_status === 'shipped' ? 'bg-green-100 text-green-700' : o.order_status === 'open' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>{o.order_status || 'unknown'}</span></td>
                            <td className="px-3 py-2 text-gray-500">{o.season || '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}

              {detailTab === 'invoices' && (
                <div className="overflow-x-auto">
                  {recentInvoices.length === 0 ? <p className="text-gray-400 text-center py-8">No invoices found</p> : (
                    <table className="w-full text-sm">
                      <thead><tr className="bg-gray-50 border-b border-gray-200">
                        <th className="px-3 py-2 text-left font-medium text-gray-500">Invoice #</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-500">Order #</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-500">Date</th>
                        <th className="px-3 py-2 text-right font-medium text-gray-500">Total</th>
                        <th className="px-3 py-2 text-right font-medium text-gray-500">Balance</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-500">Payment</th>
                      </tr></thead>
                      <tbody>
                        {recentInvoices.map((inv, i) => (
                          <tr key={i} className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer" onClick={() => openDrawer('invoice', inv.invoice_number)}>
                            <td className="px-3 py-2 font-medium text-brand-600 hover:underline">{inv.invoice_number}</td>
                            <td className="px-3 py-2">
                              {inv.apparel_magic_order_id ? (
                                <button onClick={(e) => { e.stopPropagation(); openDrawer('order', inv.apparel_magic_order_id); }} className="text-brand-600 hover:underline">{inv.apparel_magic_order_id}</button>
                              ) : '-'}
                            </td>
                            <td className="px-3 py-2">{inv.invoice_date || '-'}</td>
                            <td className="px-3 py-2 text-right">${parseFloat(inv.total_amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                            <td className="px-3 py-2 text-right">${parseFloat(inv.balance_due || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                            <td className="px-3 py-2"><span className={`px-2 py-0.5 rounded text-xs font-medium ${inv.payment_status === 'paid' ? 'bg-green-100 text-green-700' : inv.payment_status === 'partial' ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'}`}>{inv.payment_status || '-'}</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
