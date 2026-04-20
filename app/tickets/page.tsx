'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

const STATUSES = ['open', 'in_review', 'pending_customer', 'resolved', 'closed'];
const STATUS_LABELS: Record<string, string> = {
  open: 'Open', in_review: 'In Review', pending_customer: 'Pending Customer',
  resolved: 'Resolved', closed: 'Closed'
};
const STATUS_COLORS: Record<string, string> = {
  open: 'bg-red-100 text-red-700', in_review: 'bg-yellow-100 text-yellow-700',
  pending_customer: 'bg-blue-100 text-blue-700', resolved: 'bg-green-100 text-green-700',
  closed: 'bg-gray-100 text-gray-600',
};
const ISSUE_LABELS: Record<string, string> = {
  damaged: 'Damaged', missing_items: 'Missing Items', wrong_item: 'Wrong Item',
  return_request: 'Return Request', late_delivery: 'Late Delivery',
  wrong_address: 'Wrong Address', pricing_dispute: 'Pricing Dispute', other: 'Other',
};

export default function TicketsPage() {
  const router = useRouter();
  const [tickets, setTickets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 20;

  useEffect(() => { setPage(0); }, [search, statusFilter]);
  useEffect(() => { loadTickets(); }, [page, search, statusFilter]);

  async function loadTickets() {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page) });
    if (search) params.set('search', search);
    if (statusFilter) params.set('status', statusFilter);
    const res = await fetch(`/api/tickets?${params}`);
    const { data, count } = await res.json();
    setTickets(data || []);
    setTotalCount(count || 0);
    setLoading(false);
  }

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Support Tickets</h1>
          <p className="text-gray-500 mt-1">{totalCount.toLocaleString()} tickets</p>
        </div>
        <button onClick={() => router.push('/tickets/new')}
          className="px-4 py-2 bg-brand-600 text-white rounded-lg hover:bg-brand-700 text-sm font-medium flex items-center gap-2">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
          New Ticket
        </button>
      </div>

      <div className="card mb-6">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" /></svg>
            <input type="text" placeholder="Search by ticket #, customer, invoice..." value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && setSearch(searchInput)}
              className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
          </div>
          <div className="flex gap-2 flex-wrap">
            {['', ...STATUSES].map(s => (
              <button key={s} onClick={() => setStatusFilter(s)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${statusFilter === s ? 'bg-brand-600 text-white border-brand-600' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}>
                {s ? STATUS_LABELS[s] : 'All'}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="card p-0 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-gray-400">
            <svg className="w-5 h-5 animate-spin mr-2" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
            Loading tickets...
          </div>
        ) : tickets.length === 0 ? (
          <div className="text-center py-16">
            <div className="text-4xl mb-3">🎫</div>
            <p className="text-gray-500 font-medium">No tickets found</p>
            <p className="text-sm text-gray-400 mt-1">Create a new ticket or adjust your filters</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="px-4 py-3 text-left font-medium text-gray-500">Ticket #</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-500">Customer</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-500">Issues</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-500">Invoice #</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-500">Status</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-500">Source</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-500">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {tickets.map(t => (
                    <tr key={t.id} onClick={() => router.push(`/tickets/${t.id}`)}
                      className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer">
                      <td className="px-4 py-3 font-medium text-brand-600">{t.ticket_number}</td>
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-900">{t.customer_name}</p>
                        <p className="text-xs text-gray-400">{t.customer_email}</p>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {(t.issue_types || []).slice(0, 2).map((issue: string) => (
                            <span key={issue} className="px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded text-xs">{ISSUE_LABELS[issue] || issue}</span>
                          ))}
                          {(t.issue_types || []).length > 2 && <span className="px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded text-xs">+{t.issue_types.length - 2}</span>}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-600">{t.invoice_number || '-'}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[t.status] || 'bg-gray-100 text-gray-600'}`}>
                          {STATUS_LABELS[t.status] || t.status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {t.is_customer_submitted
                          ? <span className="px-2 py-0.5 bg-purple-100 text-purple-700 rounded text-xs font-medium">Customer</span>
                          : <span className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded text-xs font-medium">Staff</span>}
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs">
                        {new Date(t.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
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
    </div>
  );
}
