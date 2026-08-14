'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

interface BackorderRow {
  sku_id: string;
  style_number: string | null;
  sku_concat: string | null;
  description: string | null;
  attr_2: string | null;
  size: string | null;
  category: string | null;
  qty_backordered: number;
  order_count: number;
  oldest_order_date: string | null;
  newest_order_date: string | null;
  qty_inventory: number | null;
  qty_avail_sell: number | null;
  active: boolean | null;
  warehouse: string | null;
  bin_location: string | null;
}

const SORTS = [
  { value: 'recent', label: 'Most recent order' },
  { value: 'oldest', label: 'Oldest order' },
  { value: 'qty_desc', label: 'Highest backorder qty' },
  { value: 'qty_asc', label: 'Lowest backorder qty' },
  { value: 'bin', label: 'Bin location (walk order)' },
];

const INV_OPS = [
  { value: '', label: 'Inventory: any' },
  { value: 'gt', label: 'Inventory >' },
  { value: 'gte', label: 'Inventory ≥' },
  { value: 'lt', label: 'Inventory <' },
  { value: 'lte', label: 'Inventory ≤' },
  { value: 'eq', label: 'Inventory =' },
];

async function api(payload: any) {
  const res = await fetch('/api/adjustments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return res.json();
}

function fmtDate(d: string | null): string {
  if (!d) return '—';
  try { return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); } catch { return d; }
}

export default function BackordersPage() {
  const [rows, setRows] = useState<BackorderRow[]>([]);
  const [totals, setTotals] = useState<{ skus: number; units: number }>({ skus: 0, units: 0 });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [sort, setSort] = useState('recent');
  const [category, setCategory] = useState('');
  const [categories, setCategories] = useState<string[]>([]);
  const [invOp, setInvOp] = useState('');
  const [invVal, setInvVal] = useState('');
  const [q, setQ] = useState('');

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    setLoadError(null);
    const data = await api({ action: 'backorders', sort, category, inv_op: invOp, inv_val: invVal, q });
    if (data.error) {
      setLoadError(String(data.error));
      setRows([]);
    } else {
      setRows(data.results || []);
      setTotals(data.totals || { skus: 0, units: 0 });
    }
    setLoading(false);
  }, [sort, category, invOp, invVal, q]);

  useEffect(() => {
    api({ action: 'categories' }).then(d => setCategories(d.categories || []));
  }, []);

  // Reload when filters change (debounced for text/number inputs)
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => load(), 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [load]);

  function openSku(row: BackorderRow) {
    window.location.href = `/adjustments/adjust?sku_id=${encodeURIComponent(row.sku_id)}`;
  }

  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto pb-24">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Backorder Verification</h1>
          <p className="text-gray-500 mt-1 text-sm">
            {loading ? 'Loading…' : `${totals.skus} SKUs · ${totals.units.toLocaleString()} units on backorder`}
          </p>
        </div>
        <a
          href="/adjustments/adjust"
          className="shrink-0 px-3 py-2 text-sm font-medium border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-700"
        >
          Manual adjust
        </a>
      </div>

      {/* Filters */}
      <div className="card mb-4 space-y-3">
        <input
          type="text"
          inputMode="search"
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Search style, SKU, description, or bin…"
          className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
        />
        <div className="grid grid-cols-2 gap-2">
          <select value={sort} onChange={e => setSort(e.target.value)} className="px-3 py-2.5 border border-gray-300 rounded-lg bg-white text-sm">
            {SORTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <select value={category} onChange={e => setCategory(e.target.value)} className="px-3 py-2.5 border border-gray-300 rounded-lg bg-white text-sm">
            <option value="">All categories</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={invOp} onChange={e => setInvOp(e.target.value)} className="px-3 py-2.5 border border-gray-300 rounded-lg bg-white text-sm">
            {INV_OPS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <input
            type="number"
            inputMode="numeric"
            value={invVal}
            onChange={e => setInvVal(e.target.value)}
            placeholder="qty"
            disabled={!invOp}
            className="px-3 py-2.5 border border-gray-300 rounded-lg text-sm disabled:bg-gray-100 disabled:text-gray-400"
          />
        </div>
      </div>

      {loadError && (
        <div className="card mb-4 bg-red-50 border-red-200 text-red-800 text-sm">
          Couldn&apos;t load backorders: {loadError}
          {loadError.includes('backorder_items') && (
            <div className="mt-1 text-red-600">The backorder_items view may not be created yet — run the SQL from sql/backorders_view.sql in the Supabase SQL Editor.</div>
          )}
        </div>
      )}

      {loading && (
        <div className="card text-center py-10 text-gray-400 animate-pulse">Loading backorders…</div>
      )}

      {!loading && !loadError && rows.length === 0 && (
        <div className="card text-center py-10 text-gray-500">
          No backordered items match these filters.
        </div>
      )}

      {/* Rows */}
      <div className="space-y-2">
        {rows.map(r => (
          <button
            key={r.sku_id}
            onClick={() => openSku(r)}
            className="w-full text-left card hover:border-brand-300 active:bg-gray-50 transition-colors !p-0 overflow-hidden"
          >
            <div className="flex items-stretch">
              {/* Bin location — the walking anchor */}
              <div className="shrink-0 w-24 md:w-28 bg-brand-50 border-r border-brand-100 flex flex-col items-center justify-center px-2 py-3">
                <div className="font-mono font-bold text-brand-700 text-lg leading-tight text-center break-all">
                  {r.bin_location || '—'}
                </div>
                <div className="text-[10px] text-brand-500 mt-1 text-center leading-tight">
                  {r.warehouse || 'no bin set'}
                </div>
              </div>

              {/* Item */}
              <div className="flex-1 min-w-0 px-3 py-2.5">
                <div className="font-semibold text-gray-900 truncate">
                  {r.sku_concat || r.style_number || r.sku_id}
                  {r.active === false && <span className="ml-2 text-[10px] font-medium px-1.5 py-0.5 rounded bg-gray-200 text-gray-600 align-middle">INACTIVE</span>}
                </div>
                <div className="text-xs text-gray-500 truncate">
                  {r.description}{r.attr_2 ? ` · ${r.attr_2}` : ''}{r.size ? ` · ${r.size}` : ''}
                </div>
                <div className="text-[11px] text-gray-400 mt-1">
                  {r.category ? `${r.category} · ` : ''}{r.order_count} order{r.order_count === 1 ? '' : 's'} · oldest {fmtDate(r.oldest_order_date)} · latest {fmtDate(r.newest_order_date)}
                </div>
              </div>

              {/* Quantities */}
              <div className="shrink-0 flex flex-col items-end justify-center pr-3 py-2.5">
                <div className="text-lg font-bold text-red-600 leading-tight">{Number(r.qty_backordered)}</div>
                <div className="text-[10px] text-gray-400">backordered</div>
                <div className="text-xs font-medium text-gray-700 mt-1">{r.qty_inventory ?? '—'} <span className="text-gray-400 font-normal">on hand</span></div>
              </div>
            </div>
          </button>
        ))}
      </div>

      {!loading && rows.length >= 300 && (
        <p className="text-center text-xs text-gray-400 mt-3">Showing first 300 — narrow with filters to see more.</p>
      )}
    </div>
  );
}
