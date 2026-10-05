'use client';

import { Fragment, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { db } from '@/lib/db';
import { whLabel, fmtDate, fmtNum, errMsg } from '@/lib/rfid';

const PAGE_SIZE = 50;
type Tab = 'styles' | 'scans';

type StyleRow = {
  external_id: string;
  tags: number;
  seen_7d: number;
  never_seen: number;
  last_read_at: string | null;
  pieces: number | string | null;
  warehouses: string | null;
};

type TagRow = {
  tag_id: string;
  external_id: string;
  size: string | null;
  color: string | null;
  quantity: number | null;
  last_read_at: string | null;
  last_warehouse: string | null;
  sessions_seen: number;
};

type Session = {
  id: string;
  warehouse: string | null;
  started_at: string;
  tags_read: number;
  registered: number;
  unregistered: number;
  pieces: number | string;
};

type Presence = { warehouse: string; tags: number; styles: number; pieces: number | string };

function whList(v: string | null): string {
  if (!v) return 'Never seen';
  return v.split(',').map((w) => whLabel(w)).join(', ');
}

export default function RfidDashboardPage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('styles');
  const [presence, setPresence] = useState<Presence[]>([]);
  const [error, setError] = useState('');

  // Styles tab
  const [styles, setStyles] = useState<StyleRow[]>([]);
  const [stylePage, setStylePage] = useState(0);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [stylesLoading, setStylesLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [tagCache, setTagCache] = useState<Record<string, TagRow[]>>({});
  const [tagsLoading, setTagsLoading] = useState(false);

  // Scans tab
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);

  useEffect(() => {
    (async () => {
      const p: any = await db.from('rfid_presence_summary').select('*');
      if (p?.error) setError(errMsg(p.error));
      setPresence((p?.data as Presence[]) || []);
    })();
  }, []);

  useEffect(() => {
    if (tab !== 'styles') return;
    (async () => {
      setStylesLoading(true);
      const from = stylePage * PAGE_SIZE;
      let q: any = db.from('rfid_style_presence').select('*');
      if (search) q = q.ilike('external_id', `%${search}%`);
      const r: any = await q.order('sort_last_read', { ascending: false }).range(from, from + PAGE_SIZE - 1);
      if (r?.error) setError(errMsg(r.error));
      setStyles((r?.data as StyleRow[]) || []);
      setStylesLoading(false);
    })();
  }, [tab, search, stylePage]);

  useEffect(() => {
    if (tab !== 'scans' || sessions.length > 0) return;
    (async () => {
      setSessionsLoading(true);
      const r: any = await db.from('rfid_session_summary').select('*').order('started_at', { ascending: false }).limit(100);
      if (r?.error) setError(errMsg(r.error));
      setSessions((r?.data as Session[]) || []);
      setSessionsLoading(false);
    })();
  }, [tab, sessions.length]);

  async function toggleStyle(style: string) {
    if (expanded === style) { setExpanded(null); return; }
    setExpanded(style);
    if (tagCache[style]) return;
    setTagsLoading(true);
    const r: any = await db.from('rfid_tag_presence').select('*').eq('external_id', style).order('tag_id', { ascending: true }).limit(1000);
    if (r?.error) setError(errMsg(r.error));
    setTagCache((c) => ({ ...c, [style]: (r?.data as TagRow[]) || [] }));
    setTagsLoading(false);
  }

  const tabBtn = (t: Tab, label: string) => (
    <button
      onClick={() => setTab(t)}
      className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
        tab === t ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-800'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">RFID</h1>
        <p className="text-sm text-gray-500">Carton tags by style, and warehouse sweeps from the CS108 scanner.</p>
      </div>

      {error && <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {presence.map((p) => (
          <div key={p.warehouse} className="rounded-lg border border-gray-200 bg-white p-4">
            <div className="text-xs font-medium uppercase tracking-wide text-gray-500">
              {p.warehouse === 'NOT FOUND' ? 'Not found in any scan' : `Last seen at ${whLabel(p.warehouse)}`}
            </div>
            <div className="mt-1 text-2xl font-semibold text-gray-900">{fmtNum(p.tags)} cartons</div>
            <div className="text-sm text-gray-500">{fmtNum(p.styles)} styles, {fmtNum(p.pieces)} pcs</div>
          </div>
        ))}
      </div>

      <div className="flex gap-2 border-b border-gray-200">
        {tabBtn('styles', 'Styles')}
        {tabBtn('scans', 'Scans')}
      </div>

      {tab === 'styles' && (
        <>
          <form
            onSubmit={(e) => { e.preventDefault(); setSearch(searchInput.trim()); setStylePage(0); setExpanded(null); }}
            className="flex gap-2"
          >
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search style (e.g. 16117)"
              className="w-72 rounded-md border border-gray-300 px-3 py-1.5 text-sm"
            />
            <button className="rounded-md bg-gray-900 px-3 py-1.5 text-sm text-white">Search</button>
            {search && (
              <button
                type="button"
                onClick={() => { setSearch(''); setSearchInput(''); setStylePage(0); setExpanded(null); }}
                className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-600"
              >
                Clear
              </button>
            )}
          </form>

          <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-3">Style</th>
                  <th className="px-4 py-3 text-right">Tags</th>
                  <th className="px-4 py-3 text-right">Seen last 7 days</th>
                  <th className="px-4 py-3 text-right">Never seen</th>
                  <th className="px-4 py-3 text-right">Pieces</th>
                  <th className="px-4 py-3">Last scanned</th>
                  <th className="px-4 py-3">Where</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {stylesLoading && (
                  <tr><td colSpan={7} className="px-4 py-6 text-center text-gray-400">Loading...</td></tr>
                )}
                {!stylesLoading && styles.length === 0 && (
                  <tr><td colSpan={7} className="px-4 py-6 text-center text-gray-400">No styles found.</td></tr>
                )}
                {!stylesLoading && styles.map((s) => (
                  <Fragment key={s.external_id}>
                    <tr onClick={() => toggleStyle(s.external_id)} className="cursor-pointer hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-900">
                        <span className="mr-2 inline-block w-3 text-gray-400">{expanded === s.external_id ? '▾' : '▸'}</span>
                        {s.external_id}
                      </td>
                      <td className="px-4 py-3 text-right">{fmtNum(s.tags)}</td>
                      <td className="px-4 py-3 text-right">
                        <span className={Number(s.seen_7d) > 0 ? 'text-emerald-600' : 'text-gray-400'}>{fmtNum(s.seen_7d)}</span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className={Number(s.never_seen) > 0 ? 'text-amber-600' : 'text-gray-400'}>{fmtNum(s.never_seen)}</span>
                      </td>
                      <td className="px-4 py-3 text-right">{fmtNum(s.pieces)}</td>
                      <td className="px-4 py-3 text-gray-600">{s.last_read_at ? fmtDate(s.last_read_at) : 'Never'}</td>
                      <td className="px-4 py-3">{whList(s.warehouses)}</td>
                    </tr>
                    {expanded === s.external_id && (
                      <tr>
                        <td colSpan={7} className="bg-gray-50 px-4 py-3">
                          {tagsLoading && !tagCache[s.external_id] ? (
                            <div className="py-2 text-center text-gray-400">Loading tags...</div>
                          ) : (
                            <table className="min-w-full text-sm">
                              <thead className="text-left text-xs uppercase tracking-wide text-gray-500">
                                <tr>
                                  <th className="px-3 py-2">RFID tag</th>
                                  <th className="px-3 py-2">Size</th>
                                  <th className="px-3 py-2">Color</th>
                                  <th className="px-3 py-2 text-right">Qty</th>
                                  <th className="px-3 py-2">Last scanned</th>
                                  <th className="px-3 py-2">Where</th>
                                  <th className="px-3 py-2 text-right">Times seen</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-200">
                                {(tagCache[s.external_id] || []).map((t) => (
                                  <tr key={t.tag_id}>
                                    <td className="px-3 py-2 font-mono text-xs text-gray-700">{t.tag_id}</td>
                                    <td className="px-3 py-2">{t.size || '-'}</td>
                                    <td className="px-3 py-2">{t.color || '-'}</td>
                                    <td className="px-3 py-2 text-right">{fmtNum(t.quantity)}</td>
                                    <td className={`px-3 py-2 ${t.last_read_at ? 'text-gray-700' : 'text-amber-600'}`}>
                                      {t.last_read_at ? fmtDate(t.last_read_at) : 'Never'}
                                    </td>
                                    <td className="px-3 py-2">{whLabel(t.last_warehouse)}</td>
                                    <td className="px-3 py-2 text-right">{fmtNum(t.sessions_seen)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between text-sm text-gray-600">
            <span>Page {stylePage + 1}</span>
            <div className="flex gap-2">
              <button
                disabled={stylePage === 0}
                onClick={() => { setStylePage(stylePage - 1); setExpanded(null); }}
                className="rounded-md border border-gray-300 px-3 py-1.5 disabled:opacity-40"
              >
                Previous
              </button>
              <button
                disabled={styles.length < PAGE_SIZE}
                onClick={() => { setStylePage(stylePage + 1); setExpanded(null); }}
                className="rounded-md border border-gray-300 px-3 py-1.5 disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}

      {tab === 'scans' && (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3">Scanned</th>
                <th className="px-4 py-3">Warehouse</th>
                <th className="px-4 py-3 text-right">Tags read</th>
                <th className="px-4 py-3 text-right">Registered</th>
                <th className="px-4 py-3 text-right">Unregistered</th>
                <th className="px-4 py-3 text-right">Pieces</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sessionsLoading && (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-gray-400">Loading...</td></tr>
              )}
              {!sessionsLoading && sessions.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-gray-400">No scans yet.</td></tr>
              )}
              {sessions.map((s) => (
                <tr key={s.id} onClick={() => router.push(`/rfid/scans/${s.id}`)} className="cursor-pointer hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-900">{fmtDate(s.started_at)}</td>
                  <td className="px-4 py-3">{whLabel(s.warehouse)}</td>
                  <td className="px-4 py-3 text-right">{fmtNum(s.tags_read)}</td>
                  <td className="px-4 py-3 text-right">{fmtNum(s.registered)}</td>
                  <td className="px-4 py-3 text-right">
                    {Number(s.unregistered) > 0 ? <span className="text-amber-600">{fmtNum(s.unregistered)}</span> : '0'}
                  </td>
                  <td className="px-4 py-3 text-right">{fmtNum(s.pieces)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
