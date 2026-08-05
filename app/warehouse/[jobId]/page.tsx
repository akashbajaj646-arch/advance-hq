'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import PickerScreen from '@/components/warehouse/PickerScreen';
import CheckerScreen from '@/components/warehouse/CheckerScreen';
import PackerScreen from '@/components/warehouse/PackerScreen';
import { whApi } from '@/components/warehouse/api';

const STAGES = [
  { key: 'picking', label: 'Pick' },
  { key: 'checking', label: 'Check' },
  { key: 'packing', label: 'Pack' },
  { key: 'complete', label: 'Done' },
];

export default function WarehouseJobPage() {
  const params = useParams();
  const router = useRouter();
  const jobId = params.jobId as string;

  const [job, setJob] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const data = await whApi({ action: 'get_job', job_id: jobId });
    if (data.job) {
      setJob(data.job);
      setItems(data.items || []);
    }
    setLoading(false);
  }, [jobId]);

  useEffect(() => { reload(); }, [reload]);

  async function advance(status: string) {
    const res = await whApi({ action: 'set_status', job_id: jobId, status });
    if (res.error) { alert(res.error); return false; }
    await reload();
    return true;
  }

  if (loading) return <div className="p-10 text-center text-gray-400 text-xl">Loading…</div>;
  if (!job) return (
    <div className="p-10 text-center">
      <p className="text-gray-500 text-xl mb-4">Job not found</p>
      <Link href="/warehouse" className="text-brand-600 font-semibold text-lg">← Back to Warehouse</Link>
    </div>
  );

  const stageIdx = STAGES.findIndex(s => s.key === job.status);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-white border-b border-gray-200 px-5 py-3">
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-4">
          <div className="min-w-0">
            <Link href="/warehouse" className="text-sm text-brand-600 font-medium">← Warehouse</Link>
            <p className="text-lg font-bold text-gray-900 truncate">
              PT #{job.pick_ticket_id} · {job.customer_name || ''}
            </p>
          </div>
          <div className="flex items-center gap-1">
            {STAGES.map((s, i) => (
              <div key={s.key} className="flex items-center">
                <div className={`px-3 py-1.5 rounded-full text-sm font-bold ${
                  i < stageIdx ? 'bg-green-100 text-green-700'
                  : i === stageIdx ? 'bg-brand-600 text-white'
                  : 'bg-gray-100 text-gray-400'
                }`}>
                  {i < stageIdx ? '✓ ' : ''}{s.label}
                </div>
                {i < STAGES.length - 1 && <div className="w-3 h-0.5 bg-gray-200" />}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto">
        {job.status === 'picking' && (
          <PickerScreen job={job} items={items} api={whApi} onDone={() => advance('checking')} onRefresh={reload} />
        )}
        {job.status === 'checking' && (
          <CheckerScreen job={job} api={whApi} onDone={() => advance('packing')} />
        )}
        {job.status === 'packing' && (
          <PackerScreen job={job} api={whApi} onDone={reload} />
        )}
        {job.status === 'complete' && (
          <div className="p-10 text-center">
            <div className="text-6xl mb-4">✅</div>
            <p className="text-2xl font-bold text-gray-900 mb-2">Order Complete · Pedido Listo</p>
            <p className="text-gray-500 text-lg mb-8">PT #{job.pick_ticket_id} is picked, verified, and packed.</p>
            <button
              onClick={() => router.push('/warehouse')}
              className="px-8 py-4 rounded-xl text-xl font-bold bg-gray-900 text-white hover:bg-gray-700"
            >
              Next Order →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
