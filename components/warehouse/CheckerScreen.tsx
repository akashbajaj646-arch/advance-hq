'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

const cellKey = (c: string, s: string) => `${c}||${s}`;

export default function CheckerScreen({ job, api, onDone }: {
  job: any; api: (p: any) => Promise<any>; onDone: () => Promise<boolean> | void;
}) {
  const [view, setView] = useState<'grid' | 'matrix' | 'verify'>('grid');
  const [styles, setStyles] = useState<any[]>([]);
  const [counts, setCounts] = useState<any[]>([]);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);

  // Matrix state
  const [active, setActive] = useState<any>(null);
  const [matrix, setMatrix] = useState<{ colors: { code: string; name: string | null }[]; sizes: string[] } | null>(null);
  const [cells, setCells] = useState<Record<string, number>>({});
  const [delta, setDelta] = useState<number>(1);
  const [minusMode, setMinusMode] = useState(false);
  const [history, setHistory] = useState<string[]>([]);

  // Search modal ("found item not shown")
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQ, setSearchQ] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);

  // Verify state
  const [verifyData, setVerifyData] = useState<any>(null);
  const [verifying, setVerifying] = useState(false);

  const load = useCallback(async () => {
    const data = await api({ action: 'get_check_data', job_id: job.id });
    setStyles(data.styles || []);
    setCounts(data.counts || []);
    setLoading(false);
  }, [api, job.id]);

  useEffect(() => { load(); }, [load]);

  const countedByStyle: Record<string, number> = {};
  counts.forEach(c => {
    countedByStyle[c.style_number] = (countedByStyle[c.style_number] || 0) + Number(c.qty_counted);
  });

  // ── Open a style's matrix ──────────────────────────────────
  async function openStyle(style: any) {
    setActive(style);
    setMatrix(null);
    setView('matrix');
    const m = await api({ action: 'get_style_matrix', product_id: style.product_id, style_number: style.style_number, job_id: job.id });
    const colors = m.colors?.length ? m.colors : [{ code: '', name: null }];
    const sizes = m.sizes?.length ? m.sizes : [''];
    setMatrix({ colors, sizes });
    const existing: Record<string, number> = {};
    counts.filter(c => c.style_number === style.style_number).forEach(c => {
      existing[cellKey(c.attr_2 || '', c.size || '')] = Number(c.qty_counted);
    });
    setCells(existing);
    setHistory([]);
  }

  function tapCell(c: string, s: string) {
    const k = cellKey(c, s);
    const d = minusMode ? -1 : delta;
    setCells(prev => ({ ...prev, [k]: Math.max(0, (prev[k] || 0) + d) }));
    if (!minusMode) setHistory(h => [...h, k]);
  }

  // Long-press = −1
  const pressTimer = useRef<any>(null);
  const longPressed = useRef(false);
  function pressStart(c: string, s: string) {
    longPressed.current = false;
    pressTimer.current = setTimeout(() => {
      longPressed.current = true;
      const k = cellKey(c, s);
      setCells(prev => ({ ...prev, [k]: Math.max(0, (prev[k] || 0) - 1) }));
      if (navigator.vibrate) navigator.vibrate(30);
    }, 500);
  }
  function pressEnd(c: string, s: string) {
    clearTimeout(pressTimer.current);
    if (!longPressed.current) tapCell(c, s);
  }

  function undoLast() {
    const k = history[history.length - 1];
    if (!k) return;
    setCells(prev => ({ ...prev, [k]: Math.max(0, (prev[k] || 0) - delta) }));
    setHistory(h => h.slice(0, -1));
  }

  async function doneWithStyle() {
    const rows = Object.entries(cells)
      .filter(([, q]) => q > 0)
      .map(([k, qty]) => {
        const [attr_2, size] = k.split('||');
        return { attr_2, size, qty };
      });
    await api({
      action: 'save_counts',
      job_id: job.id,
      product_id: active.product_id,
      style_number: active.style_number,
      is_unexpected: !!active.is_unexpected,
      counts: rows,
    });
    await load();
    setView('grid');
    setActive(null);
  }

  // ── Product search for wrong items ─────────────────────────
  useEffect(() => {
    if (!searchOpen || !searchQ.trim()) { setSearchResults([]); return; }
    const t = setTimeout(async () => {
      const data = await api({ action: 'search_products', q: searchQ });
      setSearchResults(data.products || []);
    }, 300);
    return () => clearTimeout(t);
  }, [searchQ, searchOpen, api]);

  // ── Verification ───────────────────────────────────────────
  async function runVerify() {
    setVerifying(true);
    const data = await api({ action: 'verify', job_id: job.id });
    setVerifyData(data);
    setView('verify');
    setVerifying(false);
  }

  async function resolve(d: any, resolution: string) {
    await api({ action: 'resolve_discrepancy', id: d.id, resolution });
    // Note: do NOT re-run verify here — verify rebuilds rows and resets resolutions.
    setVerifyData((prev: any) => ({
      ...prev,
      discrepancies: prev.discrepancies.map((x: any) => x.id === d.id ? { ...x, resolution } : x),
    }));
  }

  if (loading) return <div className="p-10 text-center text-gray-400 text-xl">Loading…</div>;

  // ══════════════ VERIFY VIEW ══════════════
  if (view === 'verify' && verifyData) {
    const matched = verifyData.matched || [];
    const discs = verifyData.discrepancies || [];
    const unresolved = discs.filter((d: any) => !d.resolution);
    return (
      <div className="p-5 pb-32">
        <h2 className="text-2xl font-black text-gray-900 mb-4">Verificación · Order Check</h2>

        {matched.length > 0 && (
          <div className="mb-5">
            <p className="font-bold text-green-700 text-lg mb-2">✓ MATCHED · CORRECTO ({matched.length})</p>
            <div className="bg-green-50 border-2 border-green-200 rounded-xl divide-y divide-green-100">
              {matched.map((m: any, i: number) => (
                <div key={i} className="flex items-center justify-between px-4 py-3">
                  <p className="font-bold text-gray-800 text-lg">{m.style_number} <span className="font-semibold text-gray-500">{[m.attr_2, m.size].filter(Boolean).join(' · ')}</span></p>
                  <p className="font-black text-green-700 text-lg">{m.qty_found} = {m.qty_expected} ✓</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {discs.length > 0 && (
          <div className="mb-5">
            <p className="font-bold text-red-700 text-lg mb-2">⚠️ DISCREPANCIES · DIFERENCIAS ({discs.length})</p>
            <div className="grid gap-3">
              {discs.map((d: any) => (
                <div key={d.id} className={`rounded-xl border-2 p-4 ${d.resolution ? 'border-gray-200 bg-gray-50' : 'border-red-300 bg-red-50'}`}>
                  <div className="flex items-center justify-between mb-1">
                    <p className="font-black text-gray-900 text-xl">{d.style_number} <span className="font-semibold text-gray-500 text-lg">{[d.attr_2, d.size].filter(Boolean).join(' · ')}</span></p>
                    <span className="px-3 py-1 rounded-full text-sm font-bold bg-white border border-gray-300 text-gray-600">
                      {d.kind === 'short' ? 'MISSING · FALTA' : d.kind === 'over' ? 'TOO MANY · SOBRA' : 'WRONG ITEM · NO VA'}
                    </span>
                  </div>
                  <p className="text-lg text-gray-700 mb-1">
                    Expected · Esperado: <b>{Number(d.qty_expected)}</b> &nbsp;·&nbsp; Found · Encontrado: <b>{Number(d.qty_found)}</b>
                  </p>
                  {d.picker_problem && (
                    <p className="text-amber-700 font-semibold mb-2">ℹ️ Picker flagged: {d.picker_problem}{d.picker_qty != null ? ` (picked ${Number(d.picker_qty)})` : ''}</p>
                  )}
                  {d.resolution ? (
                    <p className="font-bold text-gray-600 mt-2">
                      ✓ {d.resolution === 'corrected' ? 'Cart fixed — matches order · Carrito corregido' : 'Ship as counted · Enviar como está'}
                    </p>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3">
                      <button onClick={() => resolve(d, 'corrected')}
                        className="py-3 rounded-xl font-bold bg-green-600 text-white text-base">
                        CART FIXED · CORREGIDO ✓
                      </button>
                      <button onClick={() => resolve(d, 'accepted')}
                        className="py-3 rounded-xl font-bold bg-gray-800 text-white text-base">
                        SHIP AS COUNTED · ENVIAR ASÍ
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
            <p className="text-gray-500 mt-3 text-base">
              Fixed the cart (added missing / removed extra items)? Go back and recount that style, then verify again.
            </p>
          </div>
        )}

        {discs.length === 0 && (
          <div className="bg-green-50 border-2 border-green-300 rounded-xl p-6 text-center mb-5">
            <p className="text-3xl mb-2">🎯</p>
            <p className="text-xl font-black text-green-800">Perfect match · Todo correcto</p>
            <p className="text-green-700">Every count matches the order exactly.</p>
          </div>
        )}

        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 p-4 z-30">
          <div className="max-w-4xl mx-auto flex gap-3">
            <button onClick={() => setView('grid')} className="px-6 py-4 rounded-xl text-lg font-bold bg-gray-100 text-gray-600">
              ← Recount
            </button>
            <button
              onClick={() => onDone()}
              disabled={unresolved.length > 0}
              className={`flex-1 py-4 rounded-xl text-xl font-black ${
                unresolved.length === 0 ? 'bg-brand-600 text-white' : 'bg-gray-200 text-gray-400'
              }`}
            >
              {unresolved.length > 0 ? `RESOLVE ${unresolved.length} FIRST` : 'START PACKING · EMPACAR →'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ══════════════ MATRIX VIEW ══════════════
  if (view === 'matrix' && active) {
    const total = Object.values(cells).reduce((a, b) => a + b, 0);
    return (
      <div className="p-5 pb-32 select-none">
        <button onClick={() => { setView('grid'); setActive(null); }} className="text-brand-600 font-bold text-lg mb-3">← Back · Atrás</button>

        <div className="flex items-center gap-4 mb-5">
          <div className="w-28 h-28 rounded-2xl bg-gray-100 overflow-hidden border border-gray-200 shrink-0">
            {active.image_url
              ? <img src={active.image_url} alt="" className="w-full h-full object-cover" />
              : <div className="w-full h-full flex items-center justify-center text-4xl text-gray-300">👕</div>}
          </div>
          <div>
            <p className="text-3xl font-black text-gray-900">{active.style_number}</p>
            <p className="text-gray-500 text-lg">{active.description || ''}</p>
            {active.is_unexpected && <span className="inline-block mt-1 px-3 py-1 rounded-full text-sm font-bold bg-amber-100 text-amber-700">Not on order · No en pedido</span>}
          </div>
        </div>

        {/* Delta chips */}
        <div className="flex items-center gap-2 mb-4">
          <span className="text-gray-500 font-bold uppercase text-sm">Tap adds:</span>
          {[1, 6, 12, 24].map(d => (
            <button key={d} onClick={() => { setDelta(d); setMinusMode(false); }}
              className={`px-5 py-2.5 rounded-full font-black text-lg ${delta === d && !minusMode ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600'}`}>
              +{d}
            </button>
          ))}
          <button onClick={() => setMinusMode(!minusMode)}
            className={`px-5 py-2.5 rounded-full font-black text-lg ${minusMode ? 'bg-red-600 text-white' : 'bg-red-50 text-red-600'}`}>
            −1
          </button>
        </div>

        {!matrix ? (
          <div className="py-16 text-center text-gray-400 text-lg">Loading sizes…</div>
        ) : (
          <div className="overflow-x-auto">
            <p className="text-lg font-bold text-gray-700 uppercase tracking-wide mb-3">Tap to count · Toca para contar</p>
            <table className="border-separate" style={{ borderSpacing: '8px' }}>
              <thead>
                <tr>
                  <th></th>
                  {matrix.sizes.map(s => (
                    <th key={s} className="text-gray-600 font-black text-lg px-2">{s || '—'}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {matrix.colors.map(c => (
                  <tr key={c.code}>
                    <td className="text-gray-700 font-black text-lg pr-2 whitespace-nowrap">
                      {c.code || '—'}
                      {c.name && <span className="block text-sm font-semibold text-gray-400">{c.name}</span>}
                    </td>
                    {matrix.sizes.map(s => {
                      const q = cells[cellKey(c.code, s)] || 0;
                      return (
                        <td key={s}>
                          <button
                            onPointerDown={() => pressStart(c.code, s)}
                            onPointerUp={() => pressEnd(c.code, s)}
                            onPointerLeave={() => clearTimeout(pressTimer.current)}
                            onContextMenu={e => e.preventDefault()}
                            className={`w-24 h-20 rounded-xl border-2 text-3xl font-black transition-colors ${
                              q > 0 ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-gray-200 bg-white text-gray-300'
                            }`}
                          >
                            {q}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-gray-400 text-base mt-2">Hold a cell for −1 · Mantén presionado para −1</p>
          </div>
        )}

        <div className="flex gap-3 mt-5">
          <button onClick={undoLast} className="px-6 py-3 rounded-xl font-bold bg-gray-100 text-gray-600">UNDO LAST</button>
          <button onClick={() => { setCells({}); setHistory([]); }} className="px-6 py-3 rounded-xl font-bold bg-gray-100 text-gray-600">CLEAR ALL</button>
        </div>

        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 p-4 z-30">
          <div className="max-w-4xl mx-auto">
            <button onClick={doneWithStyle} className="w-full py-4 rounded-xl text-xl font-black bg-brand-600 text-white">
              DONE WITH THIS STYLE ({total}) · LISTO →
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ══════════════ GRID VIEW ══════════════
  const shown = styles.filter(s => !filter || s.style_number?.toLowerCase().includes(filter.toLowerCase()));
  return (
    <div className="p-5 pb-32">
      <h2 className="text-2xl font-black text-gray-900 mb-1">Inventario · Count the cart</h2>
      <p className="text-gray-500 text-lg mb-4">Count everything in the cart. The app checks it against the order.</p>

      <input
        type="text"
        placeholder="🔍  Search by style # · Buscar estilo"
        value={filter}
        onChange={e => setFilter(e.target.value)}
        className="w-full px-5 py-4 text-lg border-2 border-gray-300 rounded-xl mb-4 focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none"
      />

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        {shown.map(s => {
          const counted = countedByStyle[s.style_number] || 0;
          return (
            <button key={s.style_number} onClick={() => openStyle(s)}
              className={`rounded-2xl border-2 overflow-hidden text-left transition-colors ${counted > 0 ? 'border-brand-400' : 'border-gray-200'} bg-white`}>
              <div className="aspect-square bg-gray-100 relative">
                {s.image_url
                  ? <img src={s.image_url} alt="" className="w-full h-full object-cover" />
                  : <div className="w-full h-full flex items-center justify-center text-6xl text-gray-300">👕</div>}
                {counted > 0 && (
                  <span className="absolute top-2 right-2 px-3 py-1.5 rounded-full bg-brand-600 text-white font-black text-lg">{counted}</span>
                )}
                {s.is_unexpected && (
                  <span className="absolute top-2 left-2 px-2 py-1 rounded-full bg-amber-500 text-white font-bold text-xs">EXTRA</span>
                )}
              </div>
              <div className="p-3">
                <p className="text-xl font-black text-gray-900">{s.style_number}</p>
                <p className="text-gray-500 truncate">{s.description || ''}</p>
              </div>
            </button>
          );
        })}
      </div>

      <button onClick={() => { setSearchOpen(true); setSearchQ(''); }}
        className="w-full mt-5 py-4 rounded-xl border-2 border-dashed border-amber-400 bg-amber-50 text-amber-800 font-bold text-lg">
        ⚠️ Found an item not shown here? · ¿Artículo que no aparece?
      </button>

      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 p-4 z-30">
        <div className="max-w-4xl mx-auto">
          <button onClick={runVerify} disabled={verifying}
            className="w-full py-4 rounded-xl text-xl font-black bg-brand-600 text-white disabled:opacity-50">
            {verifying ? 'Checking…' : 'DONE · VERIFY → · VERIFICAR'}
          </button>
        </div>
      </div>

      {/* Wrong-item search modal */}
      {searchOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center p-4 pt-16" onClick={() => setSearchOpen(false)}>
          <div className="bg-white rounded-2xl w-full max-w-lg p-5 max-h-[75vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <p className="text-xl font-black text-gray-900 mb-3">What did you find? · ¿Qué encontraste?</p>
            <input
              autoFocus
              type="text"
              placeholder="Style # …"
              value={searchQ}
              onChange={e => setSearchQ(e.target.value)}
              className="w-full px-5 py-4 text-lg border-2 border-gray-300 rounded-xl mb-4 outline-none focus:border-brand-500"
            />
            <div className="grid grid-cols-2 gap-3">
              {searchResults.map(p => (
                <button key={p.product_id}
                  onClick={() => { setSearchOpen(false); openStyle({ ...p, is_unexpected: true }); }}
                  className="rounded-xl border-2 border-gray-200 overflow-hidden text-left">
                  <div className="aspect-square bg-gray-100">
                    {p.image_url && <img src={p.image_url} alt="" className="w-full h-full object-cover" />}
                  </div>
                  <div className="p-2">
                    <p className="font-black text-gray-900">{p.style_number}</p>
                    <p className="text-sm text-gray-500 truncate">{p.description || ''}</p>
                  </div>
                </button>
              ))}
            </div>
            <button onClick={() => setSearchOpen(false)} className="w-full mt-4 py-3 text-gray-500 font-semibold">Cancel · Cancelar</button>
          </div>
        </div>
      )}
    </div>
  );
}
