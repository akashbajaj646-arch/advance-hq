'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { db } from '@/lib/db';
import { whLabel, fmtDate, fmtNum, errMsg } from '@/lib/rfid';

type Session = {
  id: string;
  warehouse: string | null;
  started_at: string;
  ended_at: string | null;
  notes: string | null;
  tags_read: number;
  registered: number;
  unregistered: number;
  pieces: number | string;
};

type Presence = { warehouse: string; tags: number; styles: number; pieces: number | string };

export default function RfidDashboardPage() {
  const router = useRouter();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [presence, setPresence] = useState<Presence[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      setLoading(true);
      const s: any = await db.from('rfid_session_summary').select('*').order('started_at', { ascending: false }).limit(100);
      const p: any = await db.from('rfid_presence_summary').select('*');
      if (s?.error || p?.error) setError(errMsg(s?.error || p?.error));
      setSessions((s?.data as Session[]) || []);
      setPresence((p?.data as Presence[]) || []);
      setLoading(false);
    })();
  }, []);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">RFID Scans</h1>
        <p className="text-sm text-gray-500">Warehouse sweeps uploaded from the CS108 scanner app.</p>
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
            {loading && (
              <tr><td colSpan={6} className="px-4 py-6 text-center text-gray-400">Loading...</td></tr>
            )}
            {!loading && sessions.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-6 text-center text-gray-400">No scans yet.</td></tr>
            )}
            {sessions.map((s) => (
              <tr
                key={s.id}
                onClick={() => router.push(`/rfid/scans/${s.id}`)}
                className="cursor-pointer hover:bg-gray-50"
              >
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
    </div>
  );
}
