"use client";
// Attributes tab. Controlled vocabulary with typeahead, so filters on the
// storefront stay clean. Fabric and Origin derive from ApparelMagic fields
// and can be overridden.

import { useEffect, useRef, useState } from "react";

type Def = {
  key: string; label: string; multi: boolean;
  derived_from: string | null; values: string[];
};

export default function ProductAttributes({ productId }: { productId: string }) {
  const [defs, setDefs] = useState<Def[] | null>(null);
  const [attrs, setAttrs] = useState<Record<string, string[]>>({});
  const [derived, setDerived] = useState<Record<string, string[]>>({});
  const [source, setSource] = useState<Record<string, string | null>>({});
  const [meta, setMeta] = useState<{ confirmed: boolean; by: string | null; at: string | null }>({
    confirmed: false, by: null, at: null,
  });
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    fetch(`/api/products/${productId}/attributes`)
      .then((r) => r.json())
      .then((j) => {
        if (j.error) return setErr(j.error);
        setDefs(j.defs);
        setAttrs(j.attrs || {});
        setDerived(j.derived || {});
        setSource(j.source || {});
        setMeta({ confirmed: !!j.confirmed, by: j.updated_by, at: j.updated_at });
      })
      .catch(() => setErr("Could not load attributes"));
  }, [productId]);

  const current = (key: string) => attrs[key] || derived[key] || [];
  const isDerived = (key: string) => !attrs[key]?.length && !!derived[key]?.length;

  const set = (key: string, values: string[]) => {
    setAttrs((a) => ({ ...a, [key]: values }));
    setDirty(true);
  };

  const save = async () => {
    setSaving(true); setErr("");
    try {
      // Derived values get written down on save, so they stop being guesses.
      const merged: Record<string, string[]> = { ...derived, ...attrs };
      Object.keys(merged).forEach((k) => { if (!merged[k]?.length) delete merged[k]; });
      const r = await fetch(`/api/products/${productId}/attributes`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attrs: merged, confirmed: true }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setAttrs(merged);
      setMeta((m) => ({ ...m, confirmed: true }));
      setDirty(false);
    } catch (e: any) {
      setErr(String(e.message || e));
    } finally {
      setSaving(false);
    }
  };

  if (err) return <div className="p-6 text-sm text-red-600">{err}</div>;
  if (!defs) return <div className="p-6 text-sm text-gray-400">Loading attributes...</div>;

  return (
    <div className="p-6">
      <div className="flex items-center gap-3 mb-5">
        <span className={`text-xs px-2 py-1 rounded-full font-medium ${
          meta.confirmed ? "bg-green-50 text-green-700" : "bg-amber-50 text-amber-700"
        }`}>
          {meta.confirmed ? "Confirmed" : "Not reviewed"}
        </span>
        {meta.by && <span className="text-xs text-gray-400">by {meta.by}</span>}
        <button
          onClick={save}
          disabled={!dirty || saving}
          className="ml-auto px-4 py-2 text-sm font-medium rounded-md bg-brand-600 text-white disabled:opacity-40"
        >
          {saving ? "Saving..." : dirty ? "Save attributes" : "Saved"}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-5 max-w-4xl">
        {defs.map((d) => (
          <Field
            key={d.key}
            def={d}
            values={current(d.key)}
            derivedFlag={isDerived(d.key)}
            sourceText={d.derived_from ? source[d.derived_from] : null}
            onChange={(v) => set(d.key, v)}
          />
        ))}
      </div>
    </div>
  );
}

function Field({ def, values, derivedFlag, sourceText, onChange }: {
  def: Def; values: string[]; derivedFlag: boolean;
  sourceText: string | null; onChange: (v: string[]) => void;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [vocab, setVocab] = useState<string[]>(def.values || []);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, []);

  const matches = vocab
    .filter((v) => !values.includes(v))
    .filter((v) => !q || v.toLowerCase().includes(q.toLowerCase()))
    .slice(0, 8);

  const exact = vocab.some((v) => v.toLowerCase() === q.trim().toLowerCase());

  const add = (v: string) => {
    onChange(def.multi ? [...values, v] : [v]);
    setQ(""); setOpen(false);
  };

  const create = async () => {
    const v = q.trim();
    if (!v) return;
    const r = await fetch("/api/product-attributes/defs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: def.key, value: v }),
    });
    const j = await r.json();
    if (j.values) setVocab(j.values);
    add(v);
  };

  return (
    <div ref={box} className="relative">
      <div className="flex items-baseline gap-2 mb-1.5">
        <span className="text-xs uppercase tracking-wide text-gray-500 font-medium">{def.label}</span>
        {def.multi && <span className="text-[10px] text-gray-400">multiple</span>}
        {derivedFlag && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-600">
            from {def.derived_from}
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5 mb-1.5">
        {values.map((v) => (
          <span key={v} className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-gray-100 text-sm text-gray-800">
            {v}
            <button
              onClick={() => onChange(values.filter((x) => x !== v))}
              className="text-gray-400 hover:text-gray-700 leading-none"
              aria-label={`Remove ${v}`}
            >×</button>
          </span>
        ))}
        {!values.length && <span className="text-sm text-gray-300">Not set</span>}
      </div>

      {(def.multi || !values.length) && (
        <input
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder={`Add ${def.label.toLowerCase()}`}
          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
      )}
      {!def.multi && values.length > 0 && (
        <button onClick={() => onChange([])} className="text-xs text-gray-400 hover:text-gray-600">
          Change
        </button>
      )}

      {open && (matches.length > 0 || (q.trim() && !exact)) && (
        <div className="absolute z-20 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-md shadow-lg overflow-hidden">
          {matches.map((v) => (
            <button
              key={v}
              onClick={() => add(v)}
              className="block w-full text-left px-3 py-2 text-sm hover:bg-gray-50"
            >{v}</button>
          ))}
          {q.trim() && !exact && (
            <button
              onClick={create}
              className="block w-full text-left px-3 py-2 text-sm border-t border-gray-100 text-brand-600 hover:bg-gray-50"
            >Create "{q.trim()}"</button>
          )}
        </div>
      )}

      {sourceText && (
        <div className="text-[11px] text-gray-400 mt-1 truncate" title={sourceText}>
          {def.derived_from}: {sourceText}
        </div>
      )}
    </div>
  );
}
