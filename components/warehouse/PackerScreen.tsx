'use client';

import { useEffect, useState, useCallback } from 'react';

const keyOf = (r: any) => `${r.style_number}||${r.attr_2 || ''}||${r.size || ''}`;

export default function PackerScreen({ job, api, onDone }: {
  job: any; api: (p: any) => Promise<any>; onDone: () => Promise<void>;
}) {
  const [targets, setTargets] = useState<any[]>([]);
  const [boxes, setBoxes] = useState<any[]>([]);
  const [boxItems, setBoxItems] = useState<any[]>([]);
  const [activeBox, setActiveBox] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [qtyModal, setQtyModal] = useState<any>(null); // { target, remaining, qty }
  const [errors, setErrors] = useState<string[]>([]);
  const [completing, setCompleting] = useState(false);

  const load = useCallback(async () => {
    const data = await api({ action: 'get_pack_data', job_id: job.id });
    setTargets(data.targets || []);
    setBoxes(data.boxes || []);
    setBoxItems(data.box_items || []);
    setActiveBox(prev => prev || data.boxes?.[0]?.id || null);
    setLoading(false);
  }, [api, job.id]);

  useEffect(() => { load(); }, [load]);

  const packedByKey: Record<string, number> = {};
  boxItems.forEach(i => { packedByKey[keyOf(i)] = (packedByKey[keyOf(i)] || 0) + Number(i.qty); });

  const remainingFor = (t: any) => Math.max(0, Number(t.qty) - (packedByKey[keyOf(t)] || 0));
  const allPacked = targets.every(t => remainingFor(t) === 0);
  const totalRemaining = targets.reduce((a, t) => a + remainingFor(t), 0);

  async function addBox() {
    const nextNum = boxes.length > 0 ? Math.max(...boxes.map(b => b.box_number)) + 1 : 1;
    const res = await api({ action: 'save_box', job_id: job.id, box_number: nextNum });
    if (res.box) setActiveBox(res.box.id);
    await load();
  }

  async function removeBox(boxId: string) {
    if (!confirm('Delete this box? · ¿Eliminar caja?')) return;
    await api({ action: 'delete_box', box_id: boxId });
    if (activeBox === boxId) setActiveBox(null);
    await load();
  }

  async function updateBoxField(box: any, field: string, value: string) {
    const v = value === '' ? null : Number(value);
    setBoxes(bs => bs.map(b => b.id === box.id ? { ...b, [field]: v } : b));
    await api({
      action: 'save_box', job_id: job.id, box_id: box.id, box_number: box.box_number,
      length_in: field === 'length_in' ? v : box.length_in,
      width_in: field === 'width_in' ? v : box.width_in,
      height_in: field === 'height_in' ? v : box.height_in,
      weight_lb: field === 'weight_lb' ? v : box.weight_lb,
    });
  }

  async function addToBox(target: any, qty: number) {
    if (!activeBox || qty <= 0) return;
    const existing = boxItems.find(i => i.box_id === activeBox && keyOf(i) === keyOf(target));
    const newQty = (existing ? Number(existing.qty) : 0) + qty;
    await api({
      action: 'save_box_item', job_id: job.id, box_id: activeBox,
      style_number: target.style_number, attr_2: target.attr_2, size: target.size, qty: newQty,
    });
    setQtyModal(null);
    await load();
  }

  async function removeFromBox(item: any) {
    await api({
      action: 'save_box_item', job_id: job.id, box_id: item.box_id,
      style_number: item.style_number, attr_2: item.attr_2, size: item.size, qty: 0,
    });
    await load();
  }

  async function complete() {
    setCompleting(true);
    setErrors([]);
    const res = await api({ action: 'complete_job', job_id: job.id });
    setCompleting(false);
    if (res.ok) { await onDone(); return; }
    setErrors(res.problems || [res.error || 'Could not complete']);
  }

  if (loading) return <div className="p-10 text-center text-gray-400 text-xl">Loading…</div>;

  const activeBoxObj = boxes.find(b => b.id === activeBox);
  const activeBoxItems = boxItems.filter(i => i.box_id === activeBox);

  return (
    <div className="p-5 pb-36">
      <h2 className="text-2xl font-black text-gray-900 mb-1">Empacar · Pack boxes</h2>
      <p className="text-gray-500 text-lg mb-4">
        {totalRemaining > 0
          ? <>Tap an item to add it to <b>Box {activeBoxObj?.box_number || '—'}</b> · {totalRemaining} pcs left</>
          : 'Everything is boxed. Enter dimensions and weight for each box.'}
      </p>

      {/* Remaining to pack */}
      <div className="grid gap-2 mb-6">
        {targets.map(t => {
          const rem = remainingFor(t);
          return (
            <button
              key={keyOf(t)}
              disabled={rem === 0 || !activeBox}
              onClick={() => setQtyModal({ target: t, remaining: rem, qty: rem })}
              className={`flex items-center gap-3 rounded-xl border-2 px-4 py-3 text-left ${
                rem === 0 ? 'border-green-200 bg-green-50 opacity-70' : 'border-gray-200 bg-white active:border-brand-400'
              }`}
            >
              <div className="w-14 h-14 rounded-lg bg-gray-100 overflow-hidden shrink-0 border border-gray-200">
                {t.image_url
                  ? <img src={t.image_url} alt="" className="w-full h-full object-cover" />
                  : <div className="w-full h-full flex items-center justify-center text-2xl text-gray-300">👕</div>}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-lg font-black text-gray-900">{t.style_number} <span className="font-semibold text-gray-500">{[t.attr_2, t.size].filter(Boolean).join(' · ')}</span></p>
              </div>
              <div className="text-right shrink-0">
                {rem === 0
                  ? <p className="font-black text-green-600 text-lg">✓ {Number(t.qty)}</p>
                  : <p className="font-black text-gray-900 text-2xl">{rem}<span className="text-gray-400 text-base font-bold">/{Number(t.qty)}</span></p>}
              </div>
            </button>
          );
        })}
      </div>

      {/* Boxes */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        {boxes.map(b => {
          const count = boxItems.filter(i => i.box_id === b.id).reduce((a, i) => a + Number(i.qty), 0);
          return (
            <button key={b.id} onClick={() => setActiveBox(b.id)}
              className={`px-5 py-3 rounded-xl font-black text-lg ${activeBox === b.id ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600'}`}>
              📦 Box {b.box_number} <span className="font-bold opacity-70">({count})</span>
            </button>
          );
        })}
        <button onClick={addBox} className="px-5 py-3 rounded-xl font-black text-lg border-2 border-dashed border-gray-300 text-gray-500">
          + Box · Caja
        </button>
      </div>

      {activeBoxObj && (
        <div className="rounded-2xl border-2 border-gray-200 bg-white p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xl font-black text-gray-900">📦 Box {activeBoxObj.box_number}</p>
            <button onClick={() => removeBox(activeBoxObj.id)} className="text-red-500 font-bold text-sm">Delete</button>
          </div>

          {activeBoxItems.length === 0
            ? <p className="text-gray-400 text-lg py-3">Empty — tap items above to add · Vacía</p>
            : (
              <div className="divide-y divide-gray-100 mb-3">
                {activeBoxItems.map(i => (
                  <div key={i.id} className="flex items-center justify-between py-2.5">
                    <p className="font-bold text-gray-800 text-lg">{i.style_number} <span className="text-gray-500 font-semibold">{[i.attr_2, i.size].filter(Boolean).join(' · ')}</span></p>
                    <div className="flex items-center gap-3">
                      <p className="font-black text-xl">{Number(i.qty)}</p>
                      <button onClick={() => removeFromBox(i)} className="w-9 h-9 rounded-lg bg-gray-100 text-gray-500 font-black">✕</button>
                    </div>
                  </div>
                ))}
              </div>
            )}

          <div className="grid grid-cols-4 gap-2">
            {([
              ['length_in', 'L (in)'],
              ['width_in', 'W (in)'],
              ['height_in', 'H (in)'],
              ['weight_lb', 'Weight (lb)'],
            ] as const).map(([field, label]) => (
              <div key={field}>
                <label className="block text-xs font-bold text-gray-400 uppercase mb-1">{label}</label>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.1"
                  value={activeBoxObj[field] ?? ''}
                  onChange={e => updateBoxField(activeBoxObj, field, e.target.value)}
                  className={`w-full px-2 py-3 text-xl font-black text-center border-2 rounded-xl outline-none focus:border-brand-500 ${
                    Number(activeBoxObj[field]) > 0 ? 'border-gray-200' : 'border-amber-300 bg-amber-50'
                  }`}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {errors.length > 0 && (
        <div className="mt-4 bg-red-50 border-2 border-red-300 rounded-xl p-4">
          <p className="font-black text-red-700 mb-1">Cannot complete · No se puede terminar:</p>
          {errors.map((e, i) => <p key={i} className="text-red-700">• {e}</p>)}
        </div>
      )}

      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 p-4 z-30">
        <div className="max-w-4xl mx-auto">
          <button
            onClick={complete}
            disabled={completing || !allPacked || boxes.length === 0}
            className={`w-full py-4 rounded-xl text-xl font-black ${
              allPacked && boxes.length > 0 ? 'bg-brand-600 text-white' : 'bg-gray-200 text-gray-400'
            }`}
          >
            {completing ? '…' : allPacked && boxes.length > 0 ? 'COMPLETE ORDER · TERMINAR ✓' : `${totalRemaining} PCS NOT BOXED YET`}
          </button>
        </div>
      </div>

      {/* Quantity modal */}
      {qtyModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-4" onClick={() => setQtyModal(null)}>
          <div className="bg-white rounded-2xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
            <p className="text-xl font-black text-gray-900 mb-1">
              {qtyModal.target.style_number} {[qtyModal.target.attr_2, qtyModal.target.size].filter(Boolean).join(' · ')}
            </p>
            <p className="text-gray-500 mb-4">→ Box {activeBoxObj?.box_number} · {qtyModal.remaining} remaining</p>

            <div className="flex items-center gap-4 mb-5">
              <button onClick={() => setQtyModal({ ...qtyModal, qty: Math.max(1, qtyModal.qty - 1) })}
                className="w-16 h-16 rounded-xl bg-gray-100 text-4xl font-black">−</button>
              <p className="flex-1 text-center text-5xl font-black">{qtyModal.qty}</p>
              <button onClick={() => setQtyModal({ ...qtyModal, qty: Math.min(qtyModal.remaining, qtyModal.qty + 1) })}
                className="w-16 h-16 rounded-xl bg-gray-100 text-4xl font-black">+</button>
            </div>

            <button onClick={() => addToBox(qtyModal.target, qtyModal.qty)}
              className="w-full py-4 rounded-xl text-xl font-black bg-brand-600 text-white mb-2">
              ADD {qtyModal.qty} TO BOX {activeBoxObj?.box_number} ✓
            </button>
            <button onClick={() => setQtyModal(null)} className="w-full py-3 text-gray-500 font-semibold">Cancel · Cancelar</button>
          </div>
        </div>
      )}
    </div>
  );
}
