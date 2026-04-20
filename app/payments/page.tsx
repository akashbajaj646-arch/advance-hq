'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { db } from '@/lib/db';

const PAGE_SIZE = 20;

function fmt(val: any) {
  if (val === null || val === undefined || val === '') return '-';
  if (typeof val === 'string' && val.match(/^\d{4}-\d{2}-\d{2}/)) {
    return new Date(val).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }
  return String(val);
}

function fmtMoney(val: any) {
  const n = parseFloat(val);
  if (isNaN(n)) return '-';
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
}

export default function PaymentsPage() {
  const router = useRouter();
  const [payments, setPayments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [paymentTypes, setPaymentTypes] = useState<string[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<any>(null);

  useEffect(() => { loadFilters(); }, []);
  useEffect(() => { setPage(0); }, [search, typeFilter]);
  useEffect(() => { loadPayments(); }, [page, search, typeFilter]);

  async function loadFilters() {
    const { data } = await db.from('payments').select('payment_type').not('payment_type', 'is', null);
    if (data) {
      const unique = [...new Set(data.map((d: any) => d.payment_type).filter(Boolean))] as string[];
      unique.sort();
      setPaymentTypes(unique);
    }
  }

  async function loadPayments() {
    setLoading(true);
    let query = db.from('payments').select('*', { count: 'exact' });
    if (search) query = query.or(`am_payment_id.ilike.%${search}%,am_customer_id.ilike.%${search}%,reference.ilike.%${search}%,payment_type.ilike.%${search}%`);
    if (typeFilter) query = query.eq('payment_type', typeFilter);
    const { data, count } = await query.order('payment_date', { ascending: false }).range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    setPayments(data || []);
    setTotalCount(count || 0);
    setLoading(false);
  }

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Payments</h1>
        <p className="text-gray-500 mt-1">{totalCount.toLocaleString()} payments from ApparelMagic</p>
      </div>

      <div className="card mb-6">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" /></svg>
            <input type="text" placeholder="Search by payment #, customer, reference..." value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && setSearch(searchInput)}
              className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
          </div>
          <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500">
            <option value="">All Types</option>
            {paymentTypes.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          {(search || typeFilter) && (
            <button onClick={() => { setSearch(''); setSearchInput(''); setTypeFilter(''); }}
              className="px-3 py-2 text-sm text-gray-500 border border-gray-300 rounded-lg hover:bg-gray-50">Clear</button>
          )}
        </div>
      </div>

      <div className="card p-0 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-gray-400">
            <svg className="w-5 h-5 animate-spin mr-2" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
            Loading payments...
          </div>
        ) : payments.length === 0 ? (
          <div className="text-center py-16 text-gray-400">No payments found</div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="px-4 py-3 text-left font-medium text-gray-500">Payment #</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-500">Customer ID</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-500">Type</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-500">Reference</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-500">Date</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-500">Received</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-500">Applied</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-500">Balance</th>
                    <th className="px-4 py-3 text-center font-medium text-gray-500">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map(p => (
                    <tr key={p.id} onClick={() => setSelected(p)} className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer">
                      <td className="px-4 py-3 font-medium text-brand-600">#{p.am_payment_id}</td>
                      <td className="px-4 py-3">
                        {p.am_customer_id ? (
                          <button onClick={e => { e.stopPropagation(); router.push(`/customers/${p.am_customer_id}`); }}
                            className="text-brand-600 hover:underline">{p.am_customer_id}</button>
                        ) : '-'}
                      </td>
                      <td className="px-4 py-3 text-gray-600">{p.payment_type || '-'}</td>
                      <td className="px-4 py-3 text-gray-600">{p.reference || '-'}</td>
                      <td className="px-4 py-3 text-gray-600">{fmt(p.payment_date)}</td>
                      <td className="px-4 py-3 text-right font-medium">{fmtMoney(p.amount_received)}</td>
                      <td className="px-4 py-3 text-right text-gray-600">{fmtMoney(p.amount_applied)}</td>
                      <td className="px-4 py-3 text-right">
                        <span className={parseFloat(p.balance) > 0 ? 'text-yellow-600 font-medium' : 'text-gray-600'}>{fmtMoney(p.balance)}</span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {p.void ? <span className="px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700">Void</span> : <span className="px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">Active</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200">
              <p className="text-sm text-gray-500">Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, totalCount)} of {totalCount.toLocaleString()}</p>
              <div className="flex gap-2">
                <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} className="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50">Previous</button>
                <span className="px-3 py-1 text-sm text-gray-500">Page {page + 1} of {totalPages}</span>
                <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} className="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50">Next</button>
              </div>
            </div>
          </>
        )}
      </div>

      {selected && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-start justify-between mb-6">
                <div>
                  <h2 className="text-xl font-bold text-gray-900">Payment #{selected.am_payment_id}</h2>
                  <div className="flex items-center gap-3 mt-1">
                    <span className="text-sm text-gray-500">{selected.payment_type || 'Unknown type'}</span>
                    {selected.void && <span className="px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700">Voided</span>}
                  </div>
                </div>
                <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
              </div>
              <div className="grid grid-cols-2 gap-3 mb-6">
                {[['Payment #', selected.am_payment_id], ['Customer ID', selected.am_customer_id], ['Type', selected.payment_type], ['Reference', selected.reference], ['Date', fmt(selected.payment_date)], ['Deposit ID', selected.deposit_id]].map(([label, value]) => (
                  <div key={label} className="bg-gray-50 rounded-lg p-3">
                    <p className="text-xs text-gray-400 mb-1">{label}</p>
                    <p className="text-sm font-medium text-gray-900">{value || '-'}</p>
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-3 mb-6">
                {[['Received', fmtMoney(selected.amount_received)], ['Applied', fmtMoney(selected.amount_applied)], ['Applied to Invoices', fmtMoney(selected.amount_applied_invoice)], ['Applied to Credit Memos', fmtMoney(selected.amount_applied_cm)], ['Unapplied', fmtMoney(selected.amount_unapplied)], ['Balance', fmtMoney(selected.balance)]].map(([label, value]) => (
                  <div key={label} className="bg-gray-50 rounded-lg p-3">
                    <p className="text-xs text-gray-400 mb-1">{label}</p>
                    <p className="text-sm font-medium text-gray-900">{value}</p>
                  </div>
                ))}
              </div>
              {selected.comment && (
                <div className="bg-gray-50 rounded-lg p-3 mb-4">
                  <p className="text-xs text-gray-400 mb-1">Notes</p>
                  <p className="text-sm text-gray-700" dangerouslySetInnerHTML={{ __html: selected.comment }} />
                </div>
              )}
              <div className="flex gap-3 pt-4 border-t border-gray-100">
                {selected.am_customer_id && (
                  <button onClick={() => { setSelected(null); router.push(`/customers/${selected.am_customer_id}`); }}
                    className="px-4 py-2 text-sm bg-brand-600 text-white rounded-lg hover:bg-brand-700">View Customer</button>
                )}
                <button onClick={() => setSelected(null)} className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">Close</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
