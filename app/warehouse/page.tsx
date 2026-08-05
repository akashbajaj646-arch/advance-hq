'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';

const STATUS_STYLES: Record<string, string> = {
  picking: 'bg-blue-100 text-blue-700',
  checking: 'bg-amber-100 text-amber-700',
  packing: 'bg-purple-100 text-purple-700',
  complete: 'bg-green-100 text-green-700',
};

const STATUS_LABELS: Record<string, string> = {
  picking: 'Picking · Recogiendo',
  checking: 'Checking · Inventario',
  packing: 'Packing · Empacando',
  complete: 'Done · Listo',
};

async function api(payload: any) {
  const res = await fetch('/api/warehouse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return res.json();
}

export default function WarehousePage() {
  const router = useRouter();
  const [tickets, setTickets] = useState<any[]>([]);
  const [jobs, setJobs] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState<string | null>(null);

  const load = useCallback(async (s: string) => {
    setLoading(true);
    const data = await api({ action: 'get_queue', search: s });
    setTickets(data.tickets || []);
    setJobs(data.jobs || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => load(search), search ? 350 : 0);
    return () => clearTimeout(t);
  }, [search, load]);

  const jobByTicket: Record<string, any> = {};
  jobs.forEach(j => {
    if (!jobByTicket[j.pick_ticket_id] || j.status !== 'complete') {
      if (!jobByTicket[j.pick_ticket_id] || jobByTicket[j.pick_ticket_id].status === 'complete') {
        jobByTicket[j.pick_ticket_id] = j;
      }
    }
  });

  async function start(pickTicketId: string) {
    setStarting(pickTicketId);
    const data = await api({ action: 'create_job', pick_ticket_id: pickTicketId });
    setStarting(null);
    if (data.job_id) router.push(`/warehouse/${data.job_id}`);
    else alert(data.error || 'Could not start job');
  }

  const activeJobs = jobs.filter(j => j.status !== 'complete' && j.status !== 'cancelled');

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Warehouse</h1>
        <p className="text-gray-500 mt-1 text-lg">Pick · Check · Pack</p>
      </div>

      {activeJobs.length > 0 && (
        <div className="mb-8">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">In Progress · En Curso</h2>
          <div className="grid gap-3">
            {activeJobs.map(j => {
              const t = tickets.find(x => x.pick_ticket_id === j.pick_ticket_id);
              return (
                <button
                  key={j.id}
                  onClick={() => router.push(`/warehouse/${j.id}`)}
                  className="flex items-center justify-between bg-white border-2 border-brand-200 rounded-xl px-5 py-4 text-left hover:border-brand-400 transition-colors"
                >
                  <div>
                    <p className="text-xl font-bold text-gray-900">PT #{j.pick_ticket_id}</p>
                    <p className="text-gray-500">{t?.customer_name || ''}</p>
                  </div>
                  <span className={`px-4 py-2 rounded-full text-base font-semibold ${STATUS_STYLES[j.status] || 'bg-gray-100 text-gray-600'}`}>
                    {STATUS_LABELS[j.status] || j.status}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="mb-4">
        <input
          type="text"
          inputMode="search"
          placeholder="🔍  Pick ticket #, customer, PO..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full px-5 py-4 text-lg border-2 border-gray-300 rounded-xl focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none"
        />
      </div>

      {loading ? (
        <div className="text-center py-16 text-gray-400 text-lg">Loading…</div>
      ) : (
        <div className="grid gap-3">
          {tickets.map(t => {
            const job = jobByTicket[t.pick_ticket_id];
            const done = job?.status === 'complete';
            return (
              <div key={t.pick_ticket_id} className="flex items-center justify-between bg-white border border-gray-200 rounded-xl px-5 py-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-3">
                    <p className="text-xl font-bold text-gray-900">PT #{t.pick_ticket_id}</p>
                    {done && <span className="px-3 py-1 rounded-full text-sm font-semibold bg-green-100 text-green-700">✓ Done</span>}
                  </div>
                  <p className="text-gray-600 truncate">{t.customer_name || '—'}</p>
                  <p className="text-sm text-gray-400">
                    {t.pick_ticket_date ? new Date(t.pick_ticket_date).toLocaleDateString() : ''}
                    {t.customer_po ? ` · PO ${t.customer_po}` : ''}
                    {t.qty ? ` · ${Number(t.qty)} pcs` : ''}
                  </p>
                </div>
                {job && !done ? (
                  <button
                    onClick={() => (window.location.href = `/warehouse/${job.id}`)}
                    className="shrink-0 px-6 py-3 rounded-xl text-lg font-bold bg-brand-600 text-white hover:bg-brand-700"
                  >
                    Resume →
                  </button>
                ) : (
                  <button
                    onClick={() => start(t.pick_ticket_id)}
                    disabled={starting === t.pick_ticket_id}
                    className="shrink-0 px-6 py-3 rounded-xl text-lg font-bold bg-gray-900 text-white hover:bg-gray-700 disabled:opacity-50"
                  >
                    {starting === t.pick_ticket_id ? '…' : done ? 'Re-run' : 'Start · Empezar'}
                  </button>
                )}
              </div>
            );
          })}
          {tickets.length === 0 && (
            <div className="text-center py-16 text-gray-400 text-lg">No pick tickets found</div>
          )}
        </div>
      )}
    </div>
  );
}
