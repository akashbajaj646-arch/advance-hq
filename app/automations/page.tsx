'use client';

import { useState, useEffect, useCallback } from 'react';

type AutoEvent = {
  id: string;
  event_type: string;
  sku_id: string;
  product_id: string | null;
  style_number: string | null;
  attr_2: string | null;
  size: string | null;
  sku_concat: string | null;
  detected_at: string;
  status: string;
  b2b_result: any;
  dtc_result: any;
  error: string | null;
};

const STATUS_TABS = [
  { key: 'pending', label: 'Pending' },
  { key: 'dry_run', label: 'Dry Run' },
  { key: 'completed', label: 'Completed' },
  { key: 'failed', label: 'Failed' },
  { key: 'dismissed', label: 'Dismissed' },
  { key: 'all', label: 'All' },
];

function storeResultSummary(label: string, r: any): string | null {
  if (!r) return null;
  if (r.skipped) return `${label}: not on store (ok)`;
  if (!r.ok) return `${label}: FAILED — ${r.error || 'error'}`;
  if (r.dry_run) return `${label}: ${r.would_set ? `would set ${r.would_set} (now ${r.current_policy})` : 'already correct'}`;
  if (r.set_to) return `${label}: set ${r.set_to} (was ${r.was})`;
  return `${label}: ${r.note || 'ok'}`;
}

export default function AutomationsPage() {
  const [events, setEvents] = useState<AutoEvent[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [statusTab, setStatusTab] = useState('pending');
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState('off');
  const [env, setEnv] = useState<{ b2b_configured: boolean; dtc_configured: boolean }>({ b2b_configured: false, dtc_configured: false });
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (tab = statusTab) => {
    setLoading(true);
    try {
      const [evRes, setRes] = await Promise.all([
        fetch(`/api/automations/events?status=${tab}`),
        fetch('/api/automations/settings'),
      ]);
      const ev = await evRes.json();
      setEvents(ev.events || []);
      setCounts(ev.counts || {});
      const st = await setRes.json();
      if (st.shopify_mode) setMode(st.shopify_mode);
      if (st.env) setEnv(st.env);
    } finally {
      setLoading(false);
    }
  }, [statusTab]);

  useEffect(() => { load(statusTab); }, [statusTab, load]);

  async function runDetection() {
    setBusy(true);
    setMsg('Scanning SKU active states...');
    try {
      const res = await fetch('/api/admin/automation-diff', { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.success) {
        setMsg(data.baseline
          ? `Baseline captured: ${data.skus_scanned} SKUs snapshotted. Future runs will detect active-state changes against this baseline.`
          : `Scan complete: ${data.skus_scanned} SKUs checked, ${data.events_created} new transition(s) detected.`);
        await load();
      } else {
        setMsg(`Detection failed: ${data.error || res.status}`);
      }
    } finally {
      setBusy(false);
    }
  }

  async function processPending() {
    setBusy(true);
    let totalProcessed = 0;
    try {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        setMsg(`Processing pending events (${totalProcessed} done)...`);
        const res = await fetch('/api/automations/run', { method: 'POST' });
        const data = await res.json();
        if (!res.ok) { setMsg(`Run failed: ${data.error || res.status}`); return; }
        totalProcessed += data.processed || 0;
        if (!data.remaining || data.processed === 0) break;
      }
      setMsg(`Processed ${totalProcessed} event(s) in ${mode === 'dry_run' ? 'dry-run' : 'LIVE'} mode.`);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function setModeRemote(next: string) {
    const res = await fetch('/api/automations/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shopify_mode: next }),
    });
    const data = await res.json();
    if (res.ok) {
      setMode(next);
      setMsg(`Mode set to ${next.replace('_', ' ')}.`);
    } else {
      setMsg(`Mode change failed: ${data.error}`);
    }
  }

  async function eventAction(id: string, action: 'dismiss' | 'requeue') {
    await fetch('/api/automations/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, action }),
    });
    await load();
  }

  return (
    <div className="p-8">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Automations</h1>
          <p className="text-gray-500 mt-1">SKU active-state changes in AM → Shopify inventory policy on both stores</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={runDetection}
            disabled={busy}
            className="bg-white border border-gray-300 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
          >
            {busy ? 'Working…' : 'Run Detection Now'}
          </button>
          {mode !== 'off' && (counts['pending'] ?? 0) > 0 && (
            <button
              onClick={processPending}
              disabled={busy}
              className={`px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50 ${mode === 'live' ? 'bg-red-600 hover:bg-red-700' : 'bg-brand-600 hover:bg-brand-700'}`}
            >
              {mode === 'live' ? `Process ${counts['pending']} Pending (LIVE)` : `Dry-Run ${counts['pending']} Pending`}
            </button>
          )}
        </div>
      </div>

      {/* Mode + env status */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <p className="text-sm font-medium text-gray-700 mb-1">Shopify automation mode</p>
            <p className="text-xs text-gray-400 max-w-xl">
              Off: detect and log only (you flip Shopify manually). Dry run: also computes what it <em>would</em> change per store, without writing. Live: sets "sell when out of stock" per variant on both stores automatically.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {['off', 'dry_run', 'live'].map(m => (
              <button
                key={m}
                onClick={() => setModeRemote(m)}
                disabled={m === 'live' && (!env.b2b_configured || !env.dtc_configured)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium border ${
                  mode === m ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                } disabled:opacity-40`}
              >
                {m === 'dry_run' ? 'Dry Run' : m.charAt(0).toUpperCase() + m.slice(1)}
              </button>
            ))}
          </div>
        </div>
        <div className="flex gap-4 mt-3 text-xs">
          <span className={env.b2b_configured ? 'text-green-600' : 'text-gray-400'}>
            {env.b2b_configured ? '● B2B store connected' : '○ B2B store not configured (SHOPIFY_B2B_DOMAIN / SHOPIFY_B2B_TOKEN)'}
          </span>
          <span className={env.dtc_configured ? 'text-green-600' : 'text-gray-400'}>
            {env.dtc_configured ? '● DTC store connected' : '○ DTC store not configured (SHOPIFY_DTC_DOMAIN / SHOPIFY_DTC_TOKEN)'}
          </span>
        </div>
      </div>

      {msg && <div className="bg-blue-50 text-blue-700 px-4 py-2 rounded-lg text-sm mb-4">{msg}</div>}

      {/* Status tabs */}
      <div className="flex gap-1 border-b border-gray-200 mb-4 overflow-x-auto">
        {STATUS_TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setStatusTab(t.key)}
            className={`px-4 py-2 text-sm font-medium whitespace-nowrap border-b-2 -mb-px ${
              statusTab === t.key ? 'border-brand-600 text-brand-600' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}{t.key !== 'all' && counts[t.key] != null ? ` (${counts[t.key]})` : ''}
          </button>
        ))}
      </div>

      {/* Events */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50">
              <th className="text-left py-2 px-3 font-medium text-gray-500">Event</th>
              <th className="text-left py-2 px-3 font-medium text-gray-500">Style / Variant</th>
              <th className="text-left py-2 px-3 font-medium text-gray-500">Shopify SKU match key</th>
              <th className="text-left py-2 px-3 font-medium text-gray-500">Detected</th>
              <th className="text-left py-2 px-3 font-medium text-gray-500">Status</th>
              <th className="text-right py-2 px-3 font-medium text-gray-500">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="py-8 text-center text-gray-400">Loading…</td></tr>
            ) : events.length === 0 ? (
              <tr><td colSpan={6} className="py-8 text-center text-gray-400">
                No events{statusTab === 'pending' ? ' — run detection after making a variant inactive in AM (and after the nightly inventory sync has picked it up)' : ''}.
              </td></tr>
            ) : events.map(e => (
              <tr key={e.id} className="border-b border-gray-100">
                <td className="py-2 px-3">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                    e.event_type === 'sku_deactivated' ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'
                  }`}>
                    {e.event_type === 'sku_deactivated' ? 'Deactivated' : 'Reactivated'}
                  </span>
                </td>
                <td className="py-2 px-3">
                  <p className="font-medium text-gray-900">{e.style_number || e.product_id}</p>
                  <p className="text-xs text-gray-400">{[e.attr_2, e.size].filter(Boolean).join(' · ')}</p>
                  {(e.b2b_result || e.dtc_result) && (
                    <p className="text-xs text-gray-500 mt-1">
                      {[storeResultSummary('B2B', e.b2b_result), storeResultSummary('DTC', e.dtc_result)].filter(Boolean).join(' · ')}
                    </p>
                  )}
                </td>
                <td className="py-2 px-3 text-xs text-gray-500 font-mono">{e.sku_concat || '—'}</td>
                <td className="py-2 px-3 text-xs text-gray-500">{new Date(e.detected_at).toLocaleString()}</td>
                <td className="py-2 px-3">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                    e.status === 'pending' ? 'bg-yellow-100 text-yellow-700' :
                    e.status === 'completed' ? 'bg-green-100 text-green-700' :
                    e.status === 'failed' ? 'bg-red-100 text-red-700' :
                    e.status === 'dry_run' ? 'bg-blue-100 text-blue-700' :
                    'bg-gray-100 text-gray-500'
                  }`} title={e.error || ''}>
                    {e.status}
                  </span>
                </td>
                <td className="py-2 px-3 text-right">
                  {e.status === 'pending' && (
                    <button onClick={() => eventAction(e.id, 'dismiss')} className="text-xs text-gray-400 hover:text-gray-600">Dismiss</button>
                  )}
                  {e.status === 'dismissed' && (
                    <button onClick={() => eventAction(e.id, 'requeue')} className="text-xs text-brand-600 hover:text-brand-700">Re-queue</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
