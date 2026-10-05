'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { db } from '@/lib/db';
import { whLabel, fmtDate, fmtNum, errMsg } from '@/lib/rfid';

const PAGE_SIZE = 100;
type Tab = 'scanned' | 'unregistered' | 'missing';
type SortKey = 'rssi_raw' | 'external_id' | 'quantity' | 'read_at';

export default function RfidScanDetailPage({ params }: { params: { id: string } }) {
  const id = params.id;
  const [session, setSession] = useState<any>(null);
  const [tab, setTab] = useState<Tab>('scanned');
  const [rows, setRows] = useState<any[]>([]);
  const [page, setPage] = useState(0);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [days, setDays] = useState(7);
  const [sortKey, setSortKey] = useState<SortKey>('rssi_raw');
  const [sortAsc, setSortAsc] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      const r: any = await db.from('rfid_session_summary').select('*').eq('id', id).maybeSingle();
      if (r?.error) setError(errMsg(r.error));
      setSession(r?.data ?? null);
    })();
  }, [id]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError('');
      const from = page * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      let r: any;
      if (tab === 'missing') {
        let q: any = db.from('rfid_missing_tags').select('*').gte('days_since_seen', days);
        if (search) q = q.ilike('external_id', `%${search}%`);
        r = await q.order('quantity', { ascending: false }).range(from, to);
      } else {
        let q: any = db.from('rfid_session_reads').select('*')
          .eq('session_id', id)
          .eq('registered', tab === 'scanned');
        if (search) q = q.ilike(tab === 'scanned' ? 'external_id' : 'tag_id', `%${search}%`);
        const key = tab === 'unregistered' && (sortKey === 'external_id' || sortKey === 'quantity') ? 'rssi_raw' : sortKey;
        r = await q.order(key, { ascending: sortAsc }).range(from, to);
      }
      if (r?.error) setError(errMsg(r.error));
      setRows(r?.data || []);
      setLoading(false);
    })();
  }, [id, tab, page, search, days, sortKey, sortAsc]);

  function changeTab(t: Tab) {
    setTab(t);
    setPage(0);
    setSearch('');
    setSearchInput('');
  }

  function sortBy(k: SortKey) {
    if (k === sortKey) setSortAsc(!sortAsc);
    else { setSortKey(k); setSortAsc(k === 'external_id'); }
    setPage(0);
  }

  const maxRssi = Math.max(1, ...rows.map((r) => Number(r.rssi_raw) || 0));

  const Signal = ({ v }: { v: any }) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return <span className="text-gray-400">-</span>;
    const pct = Math.max(4, Math.round((n / maxRssi) * 100));
    return (
      <div className="flex items-center gap-2">
        <div className="h-2 w-20 rounded bg-gray-100">
          <div className="h-2 rounded bg-emerald-500" style={{ width: `${pct}%` }} />
        </div>
        <span className="tabular-nums text-gray-700">{n}</span>
      </div>
    );
  };

  const SortTh = ({ k, label, right }: { k: SortKey; label: string; right?: boolean }) => (
    <th
      onClick={() => sortBy(k)}
      className={`cursor-pointer select-none px-4 py-3 hover:text-gray-900 ${right ? 'text-right' : ''}`}
    >
      {label}{sortKey === k ? (sortAsc ? ' ▲' : ' ▼') : ''}
    </th>
  );

  const tabs: { key: Tab; label: string }[] = [
    { key: 'scanned', label: `Scanned${session ? ` (${fmtNum(session.registered)})` : ''}` },
    { key: 'unregistered', label: `Unregistered${session ? ` (${fmtNum(session.unregistered)})` : ''}` },
    { key: 'missing', label: 'Missing' },
  ];

  return (
    <div className="p-6 space-y-5">
      <div>
        <Link href="/rfid" className="text-sm text-blue-600 hover:underline">← All scans</Link>
        <h1 className="mt-1 text-2xl font-semibold text-gray-900">
          {session ? `${whLabel(session.warehouse)} scan` : 'Scan'}
        </h1>
        {session && (
          <p className="text-sm text-gray-500">
            {fmtDate(session.started_at)} to {fmtDate(session.ended_at)} · {fmtNum(session.tags_read)} tags read · {fmtNum(session.pieces)} pcs
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-gray-200">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => changeTab(t.key)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
              tab === t.key ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-800'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <form
          onSubmit={(e) => { e.preventDefault(); setSearch(searchInput.trim()); setPage(0); }}
          className="flex gap-2"
        >
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder={tab === 'unregistered' ? 'Search tag ID' : 'Search style'}
            className="w-56 rounded-md border border-gray-300 px-3 py-1.5 text-sm"
          />
          <button className="rounded-md bg-gray-900 px-3 py-1.5 text-sm text-white">Search</button>
        </form>
        {tab === 'missing' && (
          <label className="flex items-center gap-2 text-sm text-gray-600">
            Not seen in
            <select
              value={days}
              onChange={(e) => { setDays(Number(e.target.value)); setPage(0); }}
              className="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
            >
              <option value={7}>7 days</option>
              <option value={14}>14 days</option>
              <option value={30}>30 days</option>
              <option value={99999}>Never seen</option>
            </select>
          </label>
        )}
      </div>

      {error && <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
            {tab === 'scanned' && (
              <tr>
                <SortTh k="external_id" label="Style" />
                <th className="px-4 py-3">Size</th>
                <th className="px-4 py-3">Color</th>
                <SortTh k="quantity" label="Qty" right />
                <SortTh k="rssi_raw" label="Signal" />
                <SortTh k="read_at" label="Scanned" />
                <th className="px-4 py-3">Seen before</th>
                <th className="px-4 py-3">Tag ID</th>
              </tr>
            )}
            {tab === 'unregistered' && (
              <tr>
                <th className="px-4 py-3">Tag ID</th>
                <SortTh k="rssi_raw" label="Signal" />
                <SortTh k="read_at" label="Scanned" />
                <th className="px-4 py-3">Seen before</th>
              </tr>
            )}
            {tab === 'missing' && (
              <tr>
                <th className="px-4 py-3">Style</th>
                <th className="px-4 py-3">Size</th>
                <th className="px-4 py-3">Color</th>
                <th className="px-4 py-3 text-right">Qty</th>
                <th className="px-4 py-3">Last seen</th>
                <th className="px-4 py-3">Where</th>
                <th className="px-4 py-3">Tag ID</th>
              </tr>
            )}
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading && (
              <tr><td colSpan={8} className="px-4 py-6 text-center text-gray-400">Loading...</td></tr>
            )}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-6 text-center text-gray-400">Nothing here.</td></tr>
            )}
            {!loading && tab === 'scanned' && rows.map((r) => (
              <tr key={r.tag_id}>
                <td className="px-4 py-2 font-medium text-gray-900">{r.external_id || '-'}</td>
                <td className="px-4 py-2">{r.size || '-'}</td>
                <td className="px-4 py-2">{r.color || '-'}</td>
                <td className="px-4 py-2 text-right">{fmtNum(r.quantity)}</td>
                <td className="px-4 py-2"><Signal v={r.rssi_raw} /></td>
                <td className="px-4 py-2 text-gray-600">{fmtDate(r.read_at)}</td>
                <td className="px-4 py-2 text-gray-600">{r.previously_seen_at ? fmtDate(r.previously_seen_at) : 'First scan'}</td>
                <td className="px-4 py-2 font-mono text-xs text-gray-500">{r.tag_id}</td>
              </tr>
            ))}
            {!loading && tab === 'unregistered' && rows.map((r) => (
              <tr key={r.tag_id}>
                <td className="px-4 py-2 font-mono text-xs text-gray-900">{r.tag_id}</td>
                <td className="px-4 py-2"><Signal v={r.rssi_raw} /></td>
                <td className="px-4 py-2 text-gray-600">{fmtDate(r.read_at)}</td>
                <td className="px-4 py-2 text-gray-600">{r.previously_seen_at ? fmtDate(r.previously_seen_at) : 'First scan'}</td>
              </tr>
            ))}
            {!loading && tab === 'missing' && rows.map((r) => (
              <tr key={r.tag_id}>
                <td className="px-4 py-2 font-medium text-gray-900">{r.external_id || '-'}</td>
                <td className="px-4 py-2">{r.size || '-'}</td>
                <td className="px-4 py-2">{r.color || '-'}</td>
                <td className="px-4 py-2 text-right">{fmtNum(r.quantity)}</td>
                <td className="px-4 py-2 text-gray-600">{r.last_read_at ? fmtDate(r.last_read_at) : 'Never'}</td>
                <td className="px-4 py-2">{whLabel(r.last_warehouse)}</td>
                <td className="px-4 py-2 font-mono text-xs text-gray-500">{r.tag_id}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm text-gray-600">
        <span>Page {page + 1}</span>
        <div className="flex gap-2">
          <button
            disabled={page === 0}
            onClick={() => setPage(page - 1)}
            className="rounded-md border border-gray-300 px-3 py-1.5 disabled:opacity-40"
          >
            Previous
          </button>
          <button
            disabled={rows.length < PAGE_SIZE}
            onClick={() => setPage(page + 1)}
            className="rounded-md border border-gray-300 px-3 py-1.5 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
