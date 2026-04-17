'use client';

import { useState, useEffect, useCallback } from 'react';
import { db } from '@/lib/db';

const EVENT_ICONS: Record<string, string> = {
  page_view: '👀', product_view: '🛍️', collection_view: '📂',
  search: '🔍', cart_add: '🛒', order_placed: '✅', login: '🔐', logout: '🚪',
};
const EVENT_LABELS: Record<string, string> = {
  page_view: 'Page View', product_view: 'Viewed Product', collection_view: 'Browsed Collection',
  search: 'Searched', cart_add: 'Added to Cart', order_placed: 'Placed Order',
  login: 'Logged In', logout: 'Logged Out',
};
function formatTime(dateStr: string) {
  const d = new Date(dateStr), now = new Date();
  const diff = now.getTime() - d.getTime();
  const mins = Math.floor(diff / 60000), hours = Math.floor(diff / 3600000), days = Math.floor(diff / 86400000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
const PAGE_SIZE = 50;
export default function ActivityPage() {
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<any>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(0);

  useEffect(() => { loadActivity(); }, [selectedCustomer, page]);

  async function loadActivity() {
    setLoading(true);
    let query = db.from('customer_activity').select('*', { count: 'exact' });
    if (selectedCustomer) query = query.eq('email', selectedCustomer.email || '');
    const { data, count } = await query.order('occurred_at', { ascending: false }).range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    setEvents(data || []); setTotalCount(count || 0); setLoading(false);
  }

  const searchCustomers = useCallback(async (q: string) => {
    if (q.length < 2) { setSuggestions([]); return; }
    const { data } = await db.from('customers').select('id, customer_name, email, am_customer_id').or(`customer_name.ilike.%${q}%,email.ilike.%${q}%`).limit(8);
    setSuggestions(data || []); setShowSuggestions(true);
  }, []);

  useEffect(() => { const t = setTimeout(() => searchCustomers(search), 300); return () => clearTimeout(t); }, [search, searchCustomers]);

  function selectCustomer(c: any) { setSelectedCustomer(c); setSearch(c.customer_name); setShowSuggestions(false); setPage(0); }
  function clearFilter() { setSelectedCustomer(null); setSearch(''); setSuggestions([]); setPage(0); }

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);
  const grouped: Record<string, any[]> = {};
  events.forEach(e => {
    const day = new Date(e.occurred_at).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    if (!grouped[day]) grouped[day] = [];
    grouped[day].push(e);
  });

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Activity</h1>
        <p className="text-gray-500 mt-1">Wholesale website activity from logged-in customers</p>
      </div>
      <div className="card mb-6">
        <div className="flex items-center gap-4">
          <div className="relative flex-1 max-w-md">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" /></svg>
            <input type="text" placeholder="Search by customer name or email..." value={search}
              onChange={e => { setSearch(e.target.value); if (!e.target.value) clearFilter(); }}
              onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
              className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
            {showSuggestions && suggestions.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-20 overflow-hidden">
                {suggestions.map(c => (
                  <button key={c.id} onClick={() => selectCustomer(c)} className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-gray-50">
                    <div className="w-7 h-7 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center text-xs font-semibold flex-shrink-0">{c.customer_name.charAt(0).toUpperCase()}</div>
                    <div className="min-w-0"><p className="text-sm font-medium text-gray-900 truncate">{c.customer_name}</p><p className="text-xs text-gray-400 truncate">{c.email || 'No email'}</p></div>
                  </button>
                ))}
              </div>
            )}
          </div>
          {selectedCustomer && (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-brand-50 border border-brand-200 rounded-lg">
              <span className="text-sm text-brand-700 font-medium">{selectedCustomer.customer_name}</span>
              <button onClick={clearFilter} className="text-brand-400 hover:text-brand-600 ml-1">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
          )}
          <div className="ml-auto text-sm text-gray-400">{totalCount.toLocaleString()} events</div>
        </div>
      </div>
      <div className="card">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-gray-400">
            <svg className="w-5 h-5 animate-spin mr-2" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
            Loading activity...
          </div>
        ) : events.length === 0 ? (
          <div className="text-center py-16">
            <div className="text-4xl mb-3">📊</div>
            <p className="text-gray-500 font-medium">No activity yet</p>
            <p className="text-sm text-gray-400 mt-1">Activity will appear here once customers visit the wholesale site</p>
          </div>
        ) : (
          <div className="space-y-6">
            {Object.entries(grouped).map(([day, dayEvents]) => (
              <div key={day}>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">{day}</p>
                <div className="space-y-1">
                  {(dayEvents as any[]).map((event: any) => (
                    <div key={event.id} className="flex items-start gap-3 px-3 py-2.5 rounded-lg hover:bg-gray-50 transition-colors">
                      <span className="text-lg flex-shrink-0 mt-0.5">{EVENT_ICONS[event.event_type] || '🌐'}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium text-gray-900">{event.email}</span>
                          <span className="text-xs text-gray-400">·</span>
                          <span className="text-xs text-gray-500">{EVENT_LABELS[event.event_type] || event.event_type}</span>
                          {event.product_title && <span className="text-xs text-brand-600 font-medium truncate max-w-xs">{event.product_title}</span>}
                          {event.search_query && <span className="text-xs text-purple-600 font-medium">"{event.search_query}"</span>}
                          {event.page_title && !event.product_title && event.event_type === 'page_view' && <span className="text-xs text-gray-400 truncate max-w-xs">{event.page_title}</span>}
                        </div>
                        {event.page_url && <p className="text-xs text-gray-300 truncate max-w-lg mt-0.5">{event.page_url}</p>}
                      </div>
                      <span className="text-xs text-gray-400 flex-shrink-0 mt-0.5">{formatTime(event.occurred_at)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-6 pt-6 border-t border-gray-100">
            <p className="text-sm text-gray-500">Page {page + 1} of {totalPages}</p>
            <div className="flex gap-2">
              <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-40">Previous</button>
              <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-40">Next</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
