'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

interface SyncLog {
  id: string;
  sync_type: string;
  source: string;
  status: string;
  records_processed: number;
  records_created: number;
  records_updated: number;
  errors: number;
  started_at: string;
  completed_at: string | null;
  duration_seconds: number | null;
}

export default function SyncPage() {
  const [syncLogs, setSyncLogs] = useState<SyncLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState<string | null>(null);

  useEffect(() => {
    loadSyncLogs();
  }, []);

  async function loadSyncLogs() {
    setLoading(true);
    const { data } = await supabase
      .from('sync_log')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(50);

    setSyncLogs(data || []);
    setLoading(false);
  }

  async function triggerSync(syncType: string) {
    setSyncing(syncType);
    // Fire-and-forget: don't await, sync runs in background
    fetch(`/api/admin/sync-${syncType}`, { method: 'POST' }).catch(() => {});

    // Poll sync_log every 3s for up to 90s to show live progress
    const started = Date.now();
    const poll = async () => {
      await loadSyncLogs();
      if (Date.now() - started < 90000) {
        setTimeout(poll, 3000);
      } else {
        setSyncing(null);
      }
    };
    setTimeout(poll, 2000);
  }

  const syncButtons = [
    { type: 'all', label: 'Sync All', source: 'All Sources', color: 'bg-red-600 hover:bg-red-700' },
    { type: 'customers', label: 'Customers', source: 'ApparelMagic', color: 'bg-brand-600 hover:bg-brand-700' },
    { type: 'products', label: 'Products', source: 'ApparelMagic', color: 'bg-blue-600 hover:bg-blue-700' },
    { type: 'inventory', label: 'Inventory', source: 'ApparelMagic', color: 'bg-purple-600 hover:bg-purple-700' },
    { type: 'orders', label: 'Orders', source: 'ApparelMagic', color: 'bg-green-600 hover:bg-green-700' },
    { type: 'invoices', label: 'Invoices', source: 'ApparelMagic', color: 'bg-yellow-600 hover:bg-yellow-700' },
    { type: 'shipments', label: 'Shipments', source: 'ShipStation', color: 'bg-orange-600 hover:bg-orange-700' },
    { type: 'pick-tickets', label: 'Pick Tickets', source: 'ApparelMagic', color: 'bg-teal-600 hover:bg-teal-700' },
  ];

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Sync Center</h1>
        <p className="text-gray-500 mt-1">Sync data from ApparelMagic and ShipStation</p>
      </div>

      <div className="card mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Trigger Sync</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {syncButtons.map((btn) => (
            <button
              key={btn.type}
              onClick={() => triggerSync(btn.type)}
              disabled={syncing !== null}
              className={`${btn.color} text-white px-4 py-3 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              {syncing === btn.type ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Syncing...
                </span>
              ) : (
                <>
                  <p>{btn.label}</p>
                  <p className="text-xs opacity-75">{btn.source}</p>
                </>
              )}
            </button>
          ))}
        </div>
        <p className="text-sm text-gray-500 mt-4">
          Syncs run directly from Advance HQ. Watch the terminal for progress.
        </p>
      </div>

      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Sync History</h2>
          <button onClick={loadSyncLogs} className="btn-secondary text-sm">
            Refresh
          </button>
        </div>

        {loading ? (
          <div className="text-center py-8 text-gray-500">Loading...</div>
        ) : syncLogs.length === 0 ? (
          <div className="text-center py-8 text-gray-500">No sync history</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="table-header pb-3">Type</th>
                  <th className="table-header pb-3">Source</th>
                  <th className="table-header pb-3">Status</th>
                  <th className="table-header pb-3">Records</th>
                  <th className="table-header pb-3">Duration</th>
                  <th className="table-header pb-3">Started</th>
                </tr>
              </thead>
              <tbody>
                {syncLogs.map((log) => (
                  <tr key={log.id} className="border-b border-gray-100">
                    <td className="table-cell font-medium capitalize">{log.sync_type}</td>
                    <td className="table-cell">
                      <span className={`badge ${log.source === 'shipstation' ? 'badge-blue' : 'badge-gray'}`}>
                        {log.source}
                      </span>
                    </td>
                    <td className="table-cell">
                      <span className={`badge ${
                        log.status === 'completed' ? 'badge-green' :
                        log.status === 'failed' ? 'badge-red' :
                        log.status === 'started' ? 'badge-yellow' : 'badge-gray'
                      }`}>
                        {log.status}
                      </span>
                    </td>
                    <td className="table-cell">
                      <p>{log.records_processed?.toLocaleString() || 0} processed</p>
                      <p className="text-xs text-gray-500">
                        {log.records_created || 0} new, {log.records_updated || 0} updated
                        {log.errors > 0 && <span className="text-red-600">, {log.errors} errors</span>}
                      </p>
                    </td>
                    <td className="table-cell">
                      {log.duration_seconds 
                        ? log.duration_seconds >= 60 
                          ? `${Math.round(log.duration_seconds / 60)}m` 
                          : `${log.duration_seconds}s`
                        : '-'}
                    </td>
                    <td className="table-cell text-sm text-gray-500">
                      {new Date(log.started_at).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
