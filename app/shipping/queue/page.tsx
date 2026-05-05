'use client';

/**
 * /shipping/queue — Production PT queue.
 *
 * Auto-polls /api/admin/sync-pick-tickets-recent every 5 minutes while the
 * page is open and visible. Plus a manual "Sync Now" button for the rare
 * case where you need immediate freshness.
 *
 * Polling pauses when the tab is hidden so we don't waste API calls.
 */

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

interface PickTicket {
  id: string;
  pick_ticket_id: string;
  customer_name: string | null;
  apparel_magic_customer_id: string | null;
  apparel_magic_order_id: string | null;
  invoice_id: string | null;
  ship_via: string | null;
  ship_to_name: string | null;
  ship_to_city: string | null;
  ship_to_state: string | null;
  ship_to_zip: string | null;
  pick_ticket_date: string | null;
  qty: number | null;
  qty_cartoned: number | string | null;
  total_amount: string | number | null;
  weight: number | string | null;
  wms_status: string | null;
  carton_status: string | null;
  warehouse_id: string | null;
  is_locked: boolean | null;
}

interface Warehouse {
  id: string;
  display_name: string;
}

interface SyncStats {
  scanned: number;
  created: number;
  updated: number;
  skipped: number;
  errors: number;
  duration_seconds: number;
  stopped_early: boolean;
}

const PAGE_SIZE = 50;
const AUTO_POLL_MS = 5 * 60 * 1000; // 5 minutes

export default function ShippingQueuePage() {
  const router = useRouter();
  const [pts, setPTs] = useState<PickTicket[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [warehouseFilter, setWarehouseFilter] = useState('');
  const [page, setPage] = useState(0);

  // Sync state
  const [syncing, setSyncing] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<Date | null>(null);
  const [lastSyncStats, setLastSyncStats] = useState<SyncStats | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    fetch('/api/shipping/warehouses')
      .then((r) => r.json())
      .then((d) => setWarehouses(d?.warehouses ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    setPage(0);
  }, [search, warehouseFilter]);

  useEffect(() => {
    loadPTs();
  }, [search, warehouseFilter, page]);

  // Auto-poll: fire a sync on mount, then every 5 min while tab is visible.
  useEffect(() => {
    // Initial sync on mount (don't block the UI on it)
    void runSync({ silent: true });

    function startInterval() {
      stopInterval();
      pollIntervalRef.current = setInterval(() => {
        if (document.visibilityState === 'visible') {
          void runSync({ silent: true });
        }
      }, AUTO_POLL_MS);
    }
    function stopInterval() {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    }
    function onVisibility() {
      if (document.visibilityState === 'visible') {
        startInterval();
      } else {
        stopInterval();
      }
    }

    startInterval();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stopInterval();
      document.removeEventListener('visibilitychange', onVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadPTs() {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(page * PAGE_SIZE),
      });
      if (search) params.set('search', search);
      if (warehouseFilter) params.set('warehouse', warehouseFilter);

      const res = await fetch(`/api/shipping/pick-tickets/queue?${params}`);
      const data = await res.json();
      setPTs(data?.pick_tickets ?? []);
    } catch (e) {
      console.error('queue load failed:', e);
      setPTs([]);
    } finally {
      setLoading(false);
    }
  }

  /**
   * Fire the recent-PT sync and refresh the table afterward.
   * silent: don't show "Syncing…" UI; used for the background poll.
   */
  async function runSync({ silent = false }: { silent?: boolean } = {}) {
    if (syncing) return;
    if (!silent) setSyncing(true);
    setSyncError(null);
    try {
      const res = await fetch('/api/admin/sync-pick-tickets-recent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (!res.ok || data?.success === false) {
        setSyncError(data?.error || `HTTP ${res.status}`);
      } else {
        setLastSyncAt(new Date());
        setLastSyncStats(data?.stats || null);
        // After a sync, reload the visible PTs.
        await loadPTs();
      }
    } catch (e) {
      setSyncError(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncing(false);
    }
  }

  function fmtDate(d: string | null) {
    if (!d) return '-';
    try {
      return new Date(d).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    } catch {
      return String(d);
    }
  }

  function fmtMoney(v: any) {
    const n = parseFloat(v);
    return isNaN(n)
      ? '-'
      : `$${n.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
  }

  function fmtRelative(d: Date | null) {
    if (!d) return 'never';
    const diffMs = Date.now() - d.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    if (diffSec < 5) return 'just now';
    if (diffSec < 60) return `${diffSec}s ago`;
    const min = Math.floor(diffSec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    return `${hr}h ago`;
  }

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Shipping Module</h1>
          <p className="text-gray-500 mt-1">
            {loading
              ? 'Loading…'
              : `${pts.length} pick ticket${pts.length === 1 ? '' : 's'} ready to ship`}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Sync status pill */}
          <div className="text-right">
            <div className="text-xs text-gray-500">
              Last sync: {fmtRelative(lastSyncAt)}
            </div>
            {lastSyncStats && (
              <div className="text-[11px] text-gray-400">
                {lastSyncStats.created > 0 && `${lastSyncStats.created} new · `}
                {lastSyncStats.updated > 0 && `${lastSyncStats.updated} updated · `}
                {lastSyncStats.scanned} scanned in {lastSyncStats.duration_seconds}s
              </div>
            )}
            {syncError && (
              <div className="text-[11px] text-red-600">Sync error: {syncError}</div>
            )}
          </div>
          <button
            onClick={() => runSync()}
            disabled={syncing}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
          >
            {syncing ? (
              <>
                <svg
                  className="w-4 h-4 animate-spin"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                  />
                </svg>
                Syncing…
              </>
            ) : (
              <>
                <svg
                  className="w-4 h-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99"
                  />
                </svg>
                Sync now
              </>
            )}
          </button>
          <Link
            href="/shipping/dev"
            className="text-xs text-gray-400 hover:text-gray-600"
            title="Internal dev tools"
          >
            Dev tools →
          </Link>
        </div>
      </div>

      {/* Filters */}
      <div className="card mb-6">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1">
            <input
              type="text"
              placeholder="Search by PT #, customer, order #, invoice #…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none"
            />
          </div>
          <select
            value={warehouseFilter}
            onChange={(e) => setWarehouseFilter(e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-lg outline-none bg-white"
          >
            <option value="">All Warehouses</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.display_name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="card">
        {loading ? (
          <div className="text-center py-12 text-gray-500">Loading pick tickets…</div>
        ) : pts.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            {search || warehouseFilter
              ? 'No pick tickets match your filters'
              : 'No pick tickets ready to ship'}
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="table-header pb-3 whitespace-nowrap">PT #</th>
                    <th className="table-header pb-3 whitespace-nowrap">Customer</th>
                    <th className="table-header pb-3 whitespace-nowrap">Ship To</th>
                    <th className="table-header pb-3 whitespace-nowrap">Order</th>
                    <th className="table-header pb-3 whitespace-nowrap">Date</th>
                    <th className="table-header pb-3 whitespace-nowrap">Ship Via</th>
                    <th className="table-header pb-3 whitespace-nowrap text-right">Qty</th>
                    <th className="table-header pb-3 whitespace-nowrap text-right">Cartoned</th>
                    <th className="table-header pb-3 whitespace-nowrap text-right">Total</th>
                    <th className="table-header pb-3 whitespace-nowrap">Status</th>
                    <th className="table-header pb-3 whitespace-nowrap"></th>
                  </tr>
                </thead>
                <tbody>
                  {pts.map((pt) => (
                    <tr
                      key={pt.id}
                      className="border-b border-gray-100 hover:bg-gray-50 transition-colors"
                    >
                      <td className="table-cell font-medium text-brand-600">
                        <Link
                          href={`/pick-tickets/${pt.pick_ticket_id}`}
                          className="hover:underline"
                        >
                          PT-{pt.pick_ticket_id}
                        </Link>
                      </td>
                      <td className="table-cell text-sm">
                        {pt.apparel_magic_customer_id ? (
                          <Link
                            href={`/customers/${pt.apparel_magic_customer_id}`}
                            className="text-brand-600 hover:underline"
                          >
                            {pt.customer_name ?? '-'}
                          </Link>
                        ) : (
                          pt.customer_name ?? '-'
                        )}
                      </td>
                      <td className="table-cell text-sm text-gray-600">
                        <div className="truncate max-w-[200px]">
                          {pt.ship_to_name ?? '-'}
                        </div>
                        <div className="text-xs text-gray-400">
                          {[pt.ship_to_city, pt.ship_to_state]
                            .filter(Boolean)
                            .join(', ')}{' '}
                          {pt.ship_to_zip ?? ''}
                        </div>
                      </td>
                      <td className="table-cell text-sm">
                        {pt.apparel_magic_order_id ? (
                          <Link
                            href={`/orders/${pt.apparel_magic_order_id}`}
                            className="text-brand-600 hover:underline"
                          >
                            #{pt.apparel_magic_order_id}
                          </Link>
                        ) : (
                          '-'
                        )}
                      </td>
                      <td className="table-cell text-sm text-gray-600">
                        {fmtDate(pt.pick_ticket_date)}
                      </td>
                      <td className="table-cell text-sm text-gray-600">
                        {pt.ship_via ?? '-'}
                      </td>
                      <td className="table-cell text-sm text-right">{pt.qty ?? 0}</td>
                      <td className="table-cell text-sm text-right">
                        {pt.qty_cartoned ?? '-'}
                      </td>
                      <td className="table-cell text-sm text-right">
                        {fmtMoney(pt.total_amount)}
                      </td>
                      <td className="table-cell">
                        <span
                          className={`badge ${
                            pt.wms_status === 'picked'
                              ? 'badge-blue'
                              : pt.wms_status === 'shipped' ||
                                pt.wms_status === 'completed'
                              ? 'badge-green'
                              : 'badge-yellow'
                          }`}
                        >
                          {pt.wms_status ?? 'pending'}
                        </span>
                      </td>
                      <td className="table-cell">
                        <button
                          onClick={() =>
                            router.push(`/shipping/ship/${pt.pick_ticket_id}`)
                          }
                          className="px-3 py-1.5 text-xs bg-brand-600 text-white rounded-lg hover:bg-brand-700 whitespace-nowrap"
                        >
                          Ship this PT →
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-200">
              <p className="text-sm text-gray-500">
                Page {page + 1}
                {pts.length === PAGE_SIZE ? ' (more available)' : ''}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
                >
                  Previous
                </button>
                <button
                  onClick={() => setPage((p) => p + 1)}
                  disabled={pts.length < PAGE_SIZE}
                  className="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
