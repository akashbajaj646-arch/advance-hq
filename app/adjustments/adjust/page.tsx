'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

interface SkuResult {
  sku_id: string;
  product_id: string;
  style_number: string;
  description: string | null;
  attr_2: string | null;
  size: string | null;
  sku_concat: string | null;
  qty_inventory: number;
  qty_avail_sell: number;
}

interface Warehouse {
  warehouse_id?: string;
  id?: string;
  location_id?: string;
  warehouse_name?: string;
  name?: string;
  description?: string;
}

// AM names the warehouse id field inconsistently across accounts — take whatever exists
function whId(w: Warehouse): string {
  const v = w.warehouse_id ?? w.id ?? w.location_id ?? (w as any)[Object.keys(w).find(k => /(^|_)id$/.test(k)) || ''];
  return v === undefined || v === null ? '' : String(v);
}

function whName(w: Warehouse): string {
  return w.warehouse_name || w.name || w.description || `Warehouse ${whId(w)}`;
}

interface HistoryRow {
  id: string;
  sku_id: string;
  style_number: string | null;
  sku_concat: string | null;
  qty_before: number;
  qty_target: number;
  qty_delta: number;
  status: string;
  error: string | null;
  source: string;
  deactivated?: boolean | null;
  created_at: string;
}

const QTY_LABELS: Record<string, string> = {
  qty_inventory: 'On Hand',
  qty_avail_sell: 'Available to Sell',
  qty_alloc: 'Allocated',
  qty_picked: 'Picked',
  qty_open_so: 'Open Sales Orders',
  qty_open_po: 'Open POs',
  qty_wip: 'WIP',
  qty_min_reorder: 'Min Reorder',
  qty_min_inventory: 'Min Inventory',
};

function prettyQtyLabel(key: string) {
  return QTY_LABELS[key] || key.replace(/^qty_/, '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

async function api(payload: any) {
  const res = await fetch('/api/adjustments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return res.json();
}

export default function AdjustmentsPage() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SkuResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);

  const [selected, setSelected] = useState<SkuResult | null>(null);
  const [record, setRecord] = useState<any | null>(null);
  const [isLive, setIsLive] = useState(false);
  const [loadingLive, setLoadingLive] = useState(false);

  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [warehouseId, setWarehouseId] = useState('');

  const [targetQty, setTargetQty] = useState('');
  const [notes, setNotes] = useState('');
  const [deactivate, setDeactivate] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const [history, setHistory] = useState<HistoryRow[]>([]);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadHistory = useCallback(async () => {
    const data = await api({ action: 'history' });
    setHistory(data.history || []);
  }, []);

  // Auto-load a SKU passed from the backorder list (?sku_id=…)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const skuParam = params.get('sku_id');
    if (!skuParam) return;
    (async () => {
      setLoadingLive(true);
      setShowResults(false);
      const data = await api({ action: 'live', sku_id: skuParam });
      const rec = data.record;
      if (rec) {
        const sel: SkuResult = {
          sku_id: String(rec.sku_id || skuParam),
          product_id: String(rec.product_id || ''),
          style_number: rec.style_number || '',
          description: rec.description || null,
          attr_2: rec.attr_2 || null,
          size: rec.size || null,
          sku_concat: rec.sku_concat || null,
          qty_inventory: parseFloat(rec.qty_inventory) || 0,
          qty_avail_sell: parseFloat(rec.qty_avail_sell) || 0,
        };
        setSelected(sel);
        setQuery(sel.sku_concat || sel.style_number);
        setRecord(rec);
        setIsLive(!!data.live);
      }
      setLoadingLive(false);
    })();
  }, []);

  useEffect(() => {
    api({ action: 'warehouses' }).then(data => {
      const list: Warehouse[] = data.warehouses || [];
      setWarehouses(list);
      if (list.length > 0) setWarehouseId(whId(list[0]));
    });
    loadHistory();
  }, [loadHistory]);

  // Debounced SKU search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!showResults) return;
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      const data = await api({ action: 'search', q: query });
      setResults(data.results || []);
      setSearching(false);
    }, 250);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, showResults]);

  async function selectSku(sku: SkuResult) {
    setSelected(sku);
    setShowResults(false);
    setQuery(sku.sku_concat || `${sku.style_number} ${sku.attr_2 || ''} ${sku.size || ''}`.trim());
    setRecord(null);
    setTargetQty('');
    setResult(null);
    setLoadingLive(true);
    const data = await api({ action: 'live', sku_id: sku.sku_id });
    setRecord(data.record || null);
    setIsLive(!!data.live);
    setLoadingLive(false);
  }

  const currentQty = record ? parseFloat(record.qty_inventory) || 0 : null;
  const target = targetQty === '' ? null : parseFloat(targetQty);
  const delta = currentQty !== null && target !== null && !isNaN(target) ? target - currentQty : null;
  const targetIsZero = target === 0;

  useEffect(() => {
    // Out-of-stock default: setting to 0 pre-checks deactivation (still un-checkable)
    setDeactivate(targetIsZero);
  }, [targetIsZero]);

  async function submit() {
    if (!selected || target === null || isNaN(target) || !warehouseId) return;
    const lines = [`Set ${selected.sku_concat || selected.style_number} inventory to ${target}?`, '', `Current: ${currentQty}`, `Adjustment: ${delta! > 0 ? '+' : ''}${delta}`];
    if (deactivate) lines.push('', '⚠️ This will also DEACTIVATE the SKU in ApparelMagic.');
    if (!confirm(lines.join('\n'))) return;

    setSubmitting(true);
    setResult(null);
    const data = await api({
      action: 'submit',
      sku_id: selected.sku_id,
      target_qty: target,
      warehouse_id: warehouseId,
      notes,
      deactivate,
    });
    setSubmitting(false);

    if (data.success) {
      if (data.noop) {
        setResult({ ok: true, msg: 'No change needed — inventory already at that quantity.' });
      } else {
        let msg = `Done. ${data.qty_before} → ${data.qty_target} (${data.delta > 0 ? '+' : ''}${data.delta})${data.verified ? ' — verified in ApparelMagic' : ''}`;
        if (data.deactivated) msg += ' · SKU deactivated';
        if (data.deactivate_error) msg += ` · ⚠️ deactivation failed: ${data.deactivate_error}`;
        setResult({ ok: true, msg });
        // Refresh the displayed record
        const fresh = await api({ action: 'live', sku_id: selected.sku_id });
        setRecord(fresh.record || null);
        setIsLive(!!fresh.live);
        setTargetQty('');
        setNotes('');
      }
      loadHistory();
    } else {
      setResult({ ok: false, msg: `Failed: ${typeof data.detail === 'string' ? data.detail : data.error || 'Unknown error'}` });
      loadHistory();
    }
  }

  const qtyEntries = record
    ? Object.keys(record).filter(k => k.startsWith('qty_')).map(k => [k, record[k]] as [string, any])
    : [];

  return (
    <div className="p-4 md:p-8 max-w-2xl mx-auto pb-32">
      <div className="mb-5">
        <a href="/adjustments" className="text-sm text-brand-600 hover:text-brand-700 font-medium">← Backorders</a>
        <h1 className="text-2xl font-bold text-gray-900 mt-1">Inventory Adjust</h1>
        <p className="text-gray-500 mt-1 text-sm">Set a SKU&apos;s on-hand quantity — writes directly to ApparelMagic</p>
      </div>

      {/* SKU search */}
      <div className="relative mb-4">
        <input
          type="text"
          inputMode="search"
          value={query}
          onChange={e => { setQuery(e.target.value); setShowResults(true); setSelected(null); setRecord(null); setResult(null); }}
          onFocus={() => setShowResults(true)}
          placeholder="Search style, SKU, or description…"
          className="w-full px-4 py-4 text-lg border border-gray-300 rounded-xl focus:ring-2 focus:ring-brand-500 focus:border-brand-500 bg-white"
        />
        {showResults && (
          <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-lg max-h-80 overflow-y-auto">
            {searching && <div className="px-4 py-3 text-sm text-gray-400">Searching…</div>}
            {!searching && results.length === 0 && (
              <div className="px-4 py-3 text-sm text-gray-400">No SKUs match &quot;{query}&quot;</div>
            )}
            {!searching && results.map(r => (
              <button
                key={r.sku_id}
                onClick={() => selectSku(r)}
                className="w-full text-left px-4 py-3 hover:bg-gray-50 active:bg-gray-100 border-b border-gray-100 last:border-b-0"
              >
                <div className="font-medium text-gray-900">{r.sku_concat || r.style_number}</div>
                <div className="text-sm text-gray-500 flex justify-between">
                  <span className="truncate mr-2">{r.description}{r.attr_2 ? ` · ${r.attr_2}` : ''}{r.size ? ` · ${r.size}` : ''}</span>
                  <span className="shrink-0 font-medium text-gray-700">{r.qty_inventory} on hand</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Loading live data */}
      {loadingLive && (
        <div className="card text-center py-8 text-gray-500">
          <div className="animate-pulse">Fetching live inventory from ApparelMagic…</div>
        </div>
      )}

      {/* Selected SKU */}
      {selected && record && !loadingLive && (
        <div className="card mb-4">
          <div className="flex items-start justify-between mb-3">
            <div>
              <div className="font-semibold text-gray-900 text-lg">{record.sku_concat || selected.sku_concat || record.style_number}</div>
              <div className="text-sm text-gray-500">
                {record.description}{record.attr_2 ? ` · ${record.attr_2}` : ''}{record.size ? ` · ${record.size}` : ''}
              </div>
            </div>
            <span className={`text-xs px-2 py-1 rounded-full font-medium shrink-0 ml-2 ${isLive ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
              {isLive ? 'Live from AM' : 'Local snapshot'}
            </span>
          </div>

          {/* All inventory fields */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {qtyEntries.map(([key, val]) => (
              <div key={key} className={`rounded-lg px-3 py-2 ${key === 'qty_inventory' ? 'bg-brand-50 border border-brand-200' : 'bg-gray-50'}`}>
                <div className="text-xs text-gray-500">{prettyQtyLabel(key)}</div>
                <div className={`font-semibold ${key === 'qty_inventory' ? 'text-brand-700 text-xl' : 'text-gray-900'}`}>
                  {parseFloat(val) || 0}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Adjustment form */}
      {selected && record && !loadingLive && (
        <div className="card mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">Set on-hand quantity to</label>
          <input
            type="number"
            inputMode="numeric"
            value={targetQty}
            onChange={e => setTargetQty(e.target.value)}
            placeholder={`Currently ${currentQty}`}
            className="w-full px-4 py-4 text-2xl font-semibold border border-gray-300 rounded-xl focus:ring-2 focus:ring-brand-500 focus:border-brand-500 text-center"
          />

          {delta !== null && (
            <div className={`mt-3 text-center text-sm font-medium rounded-lg py-2 ${delta === 0 ? 'bg-gray-100 text-gray-500' : delta > 0 ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
              {delta === 0 ? 'No change' : `Adjustment: ${delta > 0 ? '+' : ''}${delta} (${currentQty} → ${target})`}
            </div>
          )}

          {targetIsZero && (
            <label className="mt-3 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 cursor-pointer">
              <input
                type="checkbox"
                checked={deactivate}
                onChange={e => setDeactivate(e.target.checked)}
                className="mt-0.5 h-5 w-5 rounded border-amber-300 text-amber-600 focus:ring-amber-500"
              />
              <span className="text-sm">
                <span className="font-semibold text-amber-800">Also deactivate this SKU</span>
                <span className="block text-amber-700">Out of stock — turns the SKU off in ApparelMagic so it can't be sold.</span>
              </span>
            </label>
          )}

          {warehouses.length > 1 && (
            <div className="mt-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">Warehouse</label>
              <select
                value={warehouseId}
                onChange={e => setWarehouseId(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-xl bg-white"
              >
                {warehouses.map(w => (
                  <option key={whId(w)} value={whId(w)}>
                    {whName(w)}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="mt-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">Note (optional)</label>
            <input
              type="text"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="e.g. Cycle count — found 2 damaged"
              className="w-full px-4 py-3 border border-gray-300 rounded-xl"
            />
          </div>

          <button
            onClick={submit}
            disabled={submitting || target === null || isNaN(target!) || (delta === 0 && !deactivate) || !warehouseId}
            className="mt-5 w-full py-4 bg-brand-600 hover:bg-brand-700 active:bg-brand-800 disabled:bg-gray-300 disabled:cursor-not-allowed text-white text-lg font-semibold rounded-xl transition-colors"
          >
            {submitting ? 'Updating ApparelMagic…' : deactivate ? 'Update inventory + deactivate' : 'Update inventory'}
          </button>

          {result && (
            <div className={`mt-3 rounded-lg px-4 py-3 text-sm font-medium ${result.ok ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
              {result.msg}
            </div>
          )}
        </div>
      )}

      {/* Recent adjustments */}
      {history.length > 0 && (
        <div className="card">
          <h3 className="font-semibold text-gray-900 mb-3">Recent adjustments</h3>
          <div className="divide-y divide-gray-100">
            {history.map(h => (
              <div key={h.id} className="py-2.5 flex items-center justify-between text-sm">
                <div className="min-w-0 mr-2">
                  <div className="font-medium text-gray-900 truncate">{h.sku_concat || h.style_number || h.sku_id}</div>
                  <div className="text-xs text-gray-400">
                    {new Date(h.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                    {h.status === 'error' && <span className="text-red-500 ml-1">· failed</span>}
                    {h.status === 'noop' && <span className="ml-1">· no change</span>}
                    {h.deactivated && <span className="text-amber-600 ml-1 font-medium">· deactivated</span>}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="font-medium text-gray-900">{h.qty_before} → {h.qty_target}</div>
                  <div className={`text-xs font-medium ${h.qty_delta > 0 ? 'text-green-600' : h.qty_delta < 0 ? 'text-red-600' : 'text-gray-400'}`}>
                    {h.qty_delta > 0 ? '+' : ''}{h.qty_delta}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
