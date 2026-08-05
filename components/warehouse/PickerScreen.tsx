'use client';

import { useMemo, useState } from 'react';

// Parse "A3D" → { aisle: "A", rack: 3, level: "D" } for route sorting
function parseLocation(loc: string | null) {
  if (!loc) return null;
  const m = String(loc).trim().toUpperCase().match(/^([A-Z]+)\s*-?\s*(\d+)\s*-?\s*([A-Z]*)$/);
  if (!m) return null;
  return { aisle: m[1], rack: parseInt(m[2], 10), level: m[3] || '' };
}

function locationSortKey(loc: string | null): string {
  const p = parseLocation(loc);
  if (!p) return 'ZZZ~9999~Z'; // unknown locations go last
  return `${p.aisle}~${String(p.rack).padStart(4, '0')}~${p.level}`;
}

function locationLabel(loc: string | null) {
  const p = parseLocation(loc);
  if (!p) return { big: loc || 'NO LOCATION', sub: 'Location not set · Sin ubicación' };
  const levelNames = ['', '1st', '2nd', '3rd', '4th', '5th', '6th'];
  const levelIdx = p.level ? p.level.charCodeAt(0) - 64 : 0;
  return {
    big: loc as string,
    sub: `Aisle ${p.aisle} · Rack ${p.rack}${p.level ? ` · Level ${levelNames[levelIdx] || p.level}` : ''}`,
  };
}

const PROBLEM_OPTIONS = [
  { key: 'short', label: 'Not enough · Falta cantidad' },
  { key: 'not_found', label: "Can't find · No se encuentra" },
  { key: 'damaged', label: 'Damaged · Dañado' },
  { key: 'other', label: 'Other · Otro' },
];

export default function PickerScreen({ job, items, api, onDone, onRefresh }: {
  job: any; items: any[]; api: (p: any) => Promise<any>; onDone: () => Promise<boolean> | void; onRefresh: () => Promise<void>;
}) {
  // Group items by location, sorted along the walking route
  const groups = useMemo(() => {
    const byLoc: Record<string, any[]> = {};
    items.forEach(i => {
      const key = (i.location || '').trim().toUpperCase() || '__NONE__';
      (byLoc[key] = byLoc[key] || []).push(i);
    });
    return Object.entries(byLoc)
      .map(([loc, its]) => ({ loc: loc === '__NONE__' ? null : loc, items: its }))
      .sort((a, b) => locationSortKey(a.loc).localeCompare(locationSortKey(b.loc)));
  }, [items]);

  // Start at the first location with unfinished items
  const firstOpen = groups.findIndex(g => g.items.some(i => !i.is_picked && !i.problem));
  const [idx, setIdx] = useState(firstOpen === -1 ? 0 : firstOpen);
  const [picked, setPicked] = useState<Record<string, boolean>>(
    Object.fromEntries(items.map(i => [i.id, !!i.is_picked]))
  );
  const [problems, setProblems] = useState<Record<string, any>>(
    Object.fromEntries(items.filter(i => i.problem).map(i => [i.id, { problem: i.problem, qty: i.qty_picked }]))
  );
  const [problemFor, setProblemFor] = useState<any>(null);
  const [problemQty, setProblemQty] = useState<number>(0);
  const [finishing, setFinishing] = useState(false);

  const group = groups[Math.min(idx, groups.length - 1)];
  if (!group) return <div className="p-10 text-center text-gray-400">No items on this pick ticket</div>;

  const label = locationLabel(group.loc);
  const notes = [...new Set(group.items.map(i => i.notes).filter(Boolean))];

  async function togglePick(item: any) {
    if (problems[item.id]) return; // resolve via problem card
    const next = !picked[item.id];
    setPicked(p => ({ ...p, [item.id]: next }));
    await api({ action: 'save_pick', id: item.id, is_picked: next, qty_picked: next ? Number(item.qty_ordered) : null });
  }

  async function saveProblem(kind: string) {
    const item = problemFor;
    setProblems(p => ({ ...p, [item.id]: { problem: kind, qty: problemQty } }));
    setPicked(p => ({ ...p, [item.id]: false }));
    setProblemFor(null);
    await api({ action: 'save_pick', id: item.id, is_picked: false, problem: kind, qty_picked: problemQty });
  }

  async function clearProblem(item: any) {
    setProblems(p => { const n = { ...p }; delete n[item.id]; return n; });
    await api({ action: 'save_pick', id: item.id, is_picked: false, problem: null, qty_picked: null });
  }

  const groupDone = group.items.every(i => picked[i.id] || problems[i.id]);
  const allDone = groups.every(g => g.items.every(i => picked[i.id] || problems[i.id]));
  const isLast = idx >= groups.length - 1;

  async function next() {
    if (!isLast) { setIdx(idx + 1); return; }
    setFinishing(true);
    await onRefresh();
    await onDone();
    setFinishing(false);
  }

  return (
    <div className="p-5 pb-32">
      {/* Location header */}
      <div className="bg-gray-900 text-white rounded-2xl px-6 py-5 mb-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-4xl font-black tracking-wide">📍 {label.big}</p>
            <p className="text-gray-300 text-lg mt-1">{label.sub}</p>
          </div>
          <div className="text-right">
            <p className="text-sm text-gray-400 uppercase tracking-wide">Location</p>
            <p className="text-2xl font-bold">{idx + 1}<span className="text-gray-400 text-lg">/{groups.length}</span></p>
          </div>
        </div>
        <div className="mt-3 h-2 bg-gray-700 rounded-full overflow-hidden">
          <div className="h-full bg-brand-500 transition-all" style={{ width: `${((idx + 1) / groups.length) * 100}%` }} />
        </div>
      </div>

      {notes.length > 0 && (
        <div className="bg-amber-50 border-2 border-amber-300 rounded-xl px-5 py-3 mb-4">
          <p className="text-sm font-bold text-amber-800 uppercase tracking-wide mb-1">📝 Notes · Notas</p>
          {notes.map((n, i) => <p key={i} className="text-amber-900 text-lg">{n}</p>)}
        </div>
      )}

      <p className="text-lg font-bold text-gray-700 uppercase tracking-wide mb-3">
        Pick {group.items.length} item{group.items.length > 1 ? 's' : ''} here · Recoger aquí
      </p>

      <div className="grid gap-3">
        {group.items.map(item => {
          const isPicked = picked[item.id];
          const prob = problems[item.id];
          return (
            <div key={item.id} className={`rounded-2xl border-2 overflow-hidden transition-colors ${
              prob ? 'border-red-300 bg-red-50' : isPicked ? 'border-green-400 bg-green-50' : 'border-gray-200 bg-white'
            }`}>
              <button onClick={() => togglePick(item)} className="w-full flex items-center gap-4 p-4 text-left">
                <div className="w-20 h-20 rounded-xl bg-gray-100 overflow-hidden shrink-0 border border-gray-200">
                  {item.image_url
                    ? <img src={item.image_url} alt="" className="w-full h-full object-cover" />
                    : <div className="w-full h-full flex items-center justify-center text-gray-300 text-2xl">👕</div>}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-2xl font-black text-gray-900">{item.style_number}</p>
                  <p className="text-gray-600 text-lg truncate">{item.description}</p>
                  <p className="text-gray-500 text-lg font-semibold">
                    {[item.attr_2, item.size].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <div className="text-center shrink-0">
                  <p className="text-sm text-gray-400 uppercase font-bold">Qty</p>
                  <p className="text-4xl font-black text-gray-900">{Number(item.qty_ordered)}</p>
                </div>
                <div className={`w-12 h-12 rounded-xl border-4 flex items-center justify-center text-2xl shrink-0 ${
                  prob ? 'border-red-400 bg-red-100' : isPicked ? 'border-green-500 bg-green-500 text-white' : 'border-gray-300'
                }`}>
                  {prob ? '⚠️' : isPicked ? '✓' : ''}
                </div>
              </button>
              {prob && (
                <div className="px-4 pb-3 flex items-center justify-between">
                  <p className="text-red-700 font-semibold">
                    ⚠️ {PROBLEM_OPTIONS.find(o => o.key === prob.problem)?.label || prob.problem}
                    {prob.qty != null ? ` — picked ${prob.qty}/${Number(item.qty_ordered)}` : ''}
                  </p>
                  <button onClick={() => clearProblem(item)} className="text-sm font-bold text-gray-500 underline">Undo</button>
                </div>
              )}
              {!isPicked && !prob && (
                <div className="px-4 pb-3">
                  <button
                    onClick={() => { setProblemFor(item); setProblemQty(0); }}
                    className="text-red-600 font-semibold text-base"
                  >
                    Problem with this item? · ¿Problema?
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Bottom action */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 p-4 z-30">
        <div className="max-w-4xl mx-auto flex gap-3">
          {idx > 0 && (
            <button onClick={() => setIdx(idx - 1)} className="px-6 py-4 rounded-xl text-xl font-bold bg-gray-100 text-gray-600">
              ←
            </button>
          )}
          <button
            onClick={next}
            disabled={(isLast ? !allDone : !groupDone) || finishing}
            className={`flex-1 py-4 rounded-xl text-xl font-black transition-colors ${
              (isLast ? allDone : groupDone)
                ? 'bg-brand-600 text-white hover:bg-brand-700'
                : 'bg-gray-200 text-gray-400'
            }`}
          >
            {finishing ? '…' : isLast
              ? 'FINISH PICKING · TERMINAR →'
              : groupDone ? 'ALL PICKED · NEXT LOCATION →' : `${group.items.filter(i => picked[i.id] || problems[i.id]).length}/${group.items.length} PICKED`}
          </button>
        </div>
      </div>

      {/* Problem modal */}
      {problemFor && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-4" onClick={() => setProblemFor(null)}>
          <div className="bg-white rounded-2xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
            <p className="text-xl font-black text-gray-900 mb-1">{problemFor.style_number} · {[problemFor.attr_2, problemFor.size].filter(Boolean).join(' ')}</p>
            <p className="text-gray-500 mb-4">Ordered · Pedido: {Number(problemFor.qty_ordered)}</p>

            <p className="font-bold text-gray-700 mb-2">How many did you pick? · ¿Cuántos recogiste?</p>
            <div className="flex items-center gap-4 mb-5">
              <button onClick={() => setProblemQty(Math.max(0, problemQty - 1))} className="w-14 h-14 rounded-xl bg-gray-100 text-3xl font-black">−</button>
              <p className="flex-1 text-center text-4xl font-black">{problemQty}</p>
              <button onClick={() => setProblemQty(Math.min(Number(problemFor.qty_ordered), problemQty + 1))} className="w-14 h-14 rounded-xl bg-gray-100 text-3xl font-black">+</button>
            </div>

            <p className="font-bold text-gray-700 mb-2">What happened? · ¿Qué pasó?</p>
            <div className="grid gap-2">
              {PROBLEM_OPTIONS.map(o => (
                <button key={o.key} onClick={() => saveProblem(o.key)}
                  className="w-full py-4 rounded-xl text-lg font-bold bg-red-50 text-red-700 border-2 border-red-200 hover:bg-red-100">
                  {o.label}
                </button>
              ))}
            </div>
            <button onClick={() => setProblemFor(null)} className="w-full mt-3 py-3 text-gray-500 font-semibold">Cancel · Cancelar</button>
          </div>
        </div>
      )}
    </div>
  );
}
