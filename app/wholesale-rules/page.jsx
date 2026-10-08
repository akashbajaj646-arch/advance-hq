"use client";
// app/wholesale-rules/page.jsx
// Minimum order quantities and volume pricing.
//
// Precedence: a specific product or SKU match beats a product tag, and a tag
// beats a collection. Within the collection list, the order you set decides.

import { useEffect, useMemo, useState } from "react";

const VOLUME_TYPES = [
  { value: "percentage",  label: "Percent off",      unit: "%" },
  { value: "amount_off",  label: "Amount off each",  unit: "$" },
  { value: "fixed_price", label: "Fixed price each", unit: "$" },
];

const TABS = [
  { key: "collection", label: "Collections" },
  { key: "tag",        label: "Product tags" },
  { key: "product",    label: "Products and SKUs" },
];

const PRODUCT_TYPES = ["products", "sku_contains", "title_contains"];
const money = (c) => "$" + (c / 100).toFixed(2);

function tierPrice(base, type, value) {
  const v = Number(value) || 0;
  if (type === "fixed_price") return Math.round(v * 100);
  if (type === "amount_off") return Math.max(0, base - Math.round(v * 100));
  return Math.max(0, Math.round(base * (1 - v / 100)));
}

const blankRule = (matchType, values, name) => ({
  name,
  match_type: matchType,
  match_values: values,
  customer_tags: ["wholesale"],
  enabled: true,
  moq_enabled: false,
  moq_mode: "per_product",
  moq_min: 6,
  moq_default: 1,
  moq_increment: 1,
  volume_enabled: false,
  volume_mode: "per_variant",
  volume_type: "percentage",
  tiers: [],
});

export default function WholesaleRules() {
  const [tab, setTab] = useState("collection");
  const [rules, setRules] = useState(null);
  const [settings, setSettings] = useState({});
  const [collections, setCollections] = useState(null);
  const [openKey, setOpenKey] = useState(null);
  const [draft, setDraft] = useState(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [onlyConfigured, setOnlyConfigured] = useState(false);

  const load = () =>
    fetch("/api/wholesale/rules")
      .then((r) => r.json())
      .then((j) => {
        if (j.error) return setError(j.error);
        setRules(j.rules || []);
        setSettings(j.settings || {});
      })
      .catch(() => setError("Could not load rules"));

  useEffect(() => {
    load();
    fetch("/api/wholesale/collections")
      .then((r) => r.json())
      .then((j) => setCollections(j.collections || []))
      .catch(() => setCollections([]));
  }, []);

  // Collection title -> its rule, if one exists.
  const ruleByTitle = useMemo(() => {
    const m = {};
    (rules || [])
      .filter((r) => r.match_type === "collection")
      .forEach((r) => (r.match_values || []).forEach((t) => (m[t] = r)));
    return m;
  }, [rules]);

  const tagRules = (rules || []).filter((r) => r.match_type === "product_tag");
  const productRules = (rules || []).filter((r) => PRODUCT_TYPES.includes(r.match_type));

  const openEditor = (key, existing, fallback) => {
    setOpenKey(key);
    setDraft(existing ? { ...existing } : fallback);
  };

  const closeEditor = () => { setOpenKey(null); setDraft(null); };

  const saveDraft = async () => {
    if (!draft) return;
    setBusy(true);
    try {
      const creating = !draft.id;
      const r = await fetch(creating ? "/api/wholesale/rules" : `/api/wholesale/rules/${draft.id}`, {
        method: creating ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      await load();
      setNote(`Saved ${draft.name}`);
      setTimeout(() => setNote(""), 2500);
      closeEditor();
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setBusy(false);
    }
  };

  const deleteRule = async (rule) => {
    if (!window.confirm(`Remove the rules on "${rule.name}"?`)) return;
    await fetch(`/api/wholesale/rules/${rule.id}`, { method: "DELETE" });
    await load();
    closeEditor();
  };

  const moveCollectionRule = async (rule, dir) => {
    const ordered = (rules || [])
      .filter((r) => r.match_type === "collection")
      .sort((a, b) => a.priority - b.priority);
    const i = ordered.findIndex((r) => r.id === rule.id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ordered.length) return;
    [ordered[i], ordered[j]] = [ordered[j], ordered[i]];
    const others = (rules || []).filter((r) => r.match_type !== "collection");
    const order = [...others, ...ordered].map((r) => r.id);
    await fetch("/api/wholesale/rules", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order }),
    });
    await load();
  };

  const publish = async () => {
    setBusy(true); setError(""); setNote("");
    try {
      const r = await fetch("/api/wholesale/rules/publish", { method: "POST" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      const miss = j.missing_collections || [];
      setNote(
        `Published ${j.rules} rules, ${(j.bytes / 1024).toFixed(1)}KB` +
        (miss.length ? `. Unresolved: ${miss.join(", ")}` : "")
      );
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setBusy(false);
    }
  };

  const saveSettings = async (next) => {
    setSettings(next);
    await fetch("/api/wholesale/rules", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settings: next }),
    });
  };

  const configuredCount = Object.keys(ruleByTitle).length;

  const visibleCollections = (collections || [])
    .filter((c) => !q || c.title.toLowerCase().includes(q.toLowerCase()))
    .filter((c) => !onlyConfigured || ruleByTitle[c.title]);

  // Collections that have a rule, in priority order, for the arrows.
  const collectionOrder = useMemo(
    () => (rules || []).filter((r) => r.match_type === "collection").sort((a, b) => a.priority - b.priority),
    [rules]
  );

  return (
    <div style={{ maxWidth: 1080, margin: "0 auto", padding: 24 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0 }}>Pricing Rules</h1>
        <span style={{ color: "#888", fontSize: 13 }}>
          {rules ? `${rules.length} configured` : "Loading..."}
        </span>
        <div style={{ marginLeft: "auto" }}>
          <button onClick={publish} disabled={busy} style={btn(true)}>
            {busy ? "Publishing..." : "Publish to Shopify"}
          </button>
        </div>
      </div>

      <p style={{ color: "#666", fontSize: 13, margin: "8px 0 18px", maxWidth: "74ch" }}>
        A product takes the first rule that matches it. Specific products and SKU matches win
        over product tags, and tags win over collections. Edits save immediately but only
        reach the storefront when you publish.
      </p>

      {error && <Banner tone="bad" onClose={() => setError("")}>{error}</Banner>}
      {note && <Banner tone="good" onClose={() => setNote("")}>{note}</Banner>}

      <div style={{ border: "1px solid #E8E8E8", borderRadius: 10, padding: "14px 16px", marginBottom: 18, display: "flex", gap: 28, flexWrap: "wrap", alignItems: "end" }}>
        <Field label="Order minimum" hint="Applies to the whole cart">
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ color: "#888" }}>$</span>
            <input type="number" value={(settings.order_minimum_cents ?? 30000) / 100}
              onChange={(e) => saveSettings({ ...settings, order_minimum_cents: Math.round(Number(e.target.value) * 100) })}
              style={{ ...inp, width: 90 }} />
          </div>
        </Field>
        <Field label="Exempt customer tags" hint="These customers skip every minimum">
          <input value={(settings.exempt_tags || []).join(", ")}
            onChange={(e) => saveSettings({ ...settings, exempt_tags: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
            style={{ ...inp, width: 300 }} />
        </Field>
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
        {TABS.map((t) => {
          const on = tab === t.key;
          const count = t.key === "collection" ? configuredCount : t.key === "tag" ? tagRules.length : productRules.length;
          return (
            <button key={t.key} onClick={() => { setTab(t.key); closeEditor(); }}
              style={{ padding: "8px 16px", borderRadius: 999, cursor: "pointer", fontSize: 13, fontWeight: 600,
                border: on ? "1px solid #1C1A17" : "1px solid #DDD",
                background: on ? "#1C1A17" : "#fff", color: on ? "#fff" : "#444" }}>
              {t.label} <span style={{ opacity: .6, marginLeft: 6 }}>{count}</span>
            </button>
          );
        })}
      </div>

      {tab === "collection" && (
        <>
          <div style={{ display: "flex", gap: 14, alignItems: "center", marginBottom: 14, flexWrap: "wrap" }}>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search collections"
              style={{ ...inp, flex: "1 1 260px" }} />
            <label style={{ ...chk, whiteSpace: "nowrap" }}>
              <input type="checkbox" checked={onlyConfigured} onChange={(e) => setOnlyConfigured(e.target.checked)} />
              Only ones with rules
            </label>
          </div>

          {collections === null && <Muted>Loading collections from Shopify...</Muted>}
          {collections && collections.length === 0 && <Muted>No collections came back from Shopify.</Muted>}

          {visibleCollections.map((c) => {
            const rule = ruleByTitle[c.title];
            const key = "c:" + c.id;
            const pos = rule ? collectionOrder.findIndex((r) => r.id === rule.id) : -1;
            return (
              <div key={c.id}>
                <Row
                  title={c.title}
                  subtitle={rule ? summarize(rule) : "No rules"}
                  meta={c.products == null ? "" : `${c.products} products`}
                  dim={!rule}
                  rank={pos >= 0 ? pos + 1 : null}
                  onUp={pos > 0 ? () => moveCollectionRule(rule, -1) : null}
                  onDown={pos >= 0 && pos < collectionOrder.length - 1 ? () => moveCollectionRule(rule, 1) : null}
                  onEdit={() =>
                    openKey === key
                      ? closeEditor()
                      : openEditor(key, rule, blankRule("collection", [c.title], c.title))
                  }
                  open={openKey === key}
                />
                {openKey === key && draft && (
                  <Editor draft={draft} setDraft={setDraft} onSave={saveDraft} onCancel={closeEditor}
                    onDelete={rule ? () => deleteRule(rule) : null} busy={busy} lockMatch />
                )}
              </div>
            );
          })}
        </>
      )}

      {tab === "tag" && (
        <>
          <button onClick={() => openEditor("new-tag", null, blankRule("product_tag", [], "New tag rule"))}
            style={{ ...btn(false), marginBottom: 14 }}>Add tag rule</button>
          {openKey === "new-tag" && draft && (
            <Editor draft={draft} setDraft={setDraft} onSave={saveDraft} onCancel={closeEditor} busy={busy} />
          )}
          {tagRules.length === 0 && openKey !== "new-tag" && <Muted>No tag rules yet.</Muted>}
          {tagRules.map((rule) => {
            const key = "t:" + rule.id;
            return (
              <div key={rule.id}>
                <Row title={rule.name} subtitle={summarize(rule)}
                  meta={(rule.match_values || []).join(", ")}
                  onEdit={() => (openKey === key ? closeEditor() : openEditor(key, rule))}
                  open={openKey === key} />
                {openKey === key && draft && (
                  <Editor draft={draft} setDraft={setDraft} onSave={saveDraft} onCancel={closeEditor}
                    onDelete={() => deleteRule(rule)} busy={busy} />
                )}
              </div>
            );
          })}
        </>
      )}

      {tab === "product" && (
        <>
          <button onClick={() => openEditor("new-product", null, blankRule("sku_contains", [], "New product rule"))}
            style={{ ...btn(false), marginBottom: 14 }}>Add product rule</button>
          {openKey === "new-product" && draft && (
            <Editor draft={draft} setDraft={setDraft} onSave={saveDraft} onCancel={closeEditor} busy={busy} allowProductTypes />
          )}
          {productRules.length === 0 && openKey !== "new-product" && <Muted>No product rules yet.</Muted>}
          {productRules.map((rule) => {
            const key = "p:" + rule.id;
            return (
              <div key={rule.id}>
                <Row title={rule.name} subtitle={summarize(rule)}
                  meta={(rule.match_values || []).join(", ")}
                  onEdit={() => (openKey === key ? closeEditor() : openEditor(key, rule))}
                  open={openKey === key} />
                {openKey === key && draft && (
                  <Editor draft={draft} setDraft={setDraft} onSave={saveDraft} onCancel={closeEditor}
                    onDelete={() => deleteRule(rule)} busy={busy} allowProductTypes />
                )}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

function summarize(r) {
  const bits = [];
  if (r.moq_enabled && r.moq_min)
    bits.push(`min ${r.moq_min} ${r.moq_mode === "per_variant" ? "per variant" : "per product"}`);
  if (r.volume_enabled && (r.tiers || []).length) {
    const t = VOLUME_TYPES.find((v) => v.value === r.volume_type) || VOLUME_TYPES[0];
    bits.push(
      (r.tiers || [])
        .slice()
        .sort((a, b) => a.qty - b.qty)
        .map((x) => `${x.qty} → ${t.value === "percentage" ? x.value + "%" : "$" + x.value}`)
        .join(", ")
    );
  }
  if (!r.enabled) bits.unshift("inactive");
  return bits.length ? bits.join(" · ") : "No rules";
}

function Row({ title, subtitle, meta, dim, rank, onUp, onDown, onEdit, open }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 14px",
      border: "1px solid #E8E8E8", borderRadius: 8, marginBottom: 8,
      background: open ? "#FAFAFA" : "#fff", opacity: dim ? .72 : 1 }}>
      {(onUp || onDown) && (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <button onClick={onUp} disabled={!onUp} style={arrow}>▲</button>
          <button onClick={onDown} disabled={!onDown} style={arrow}>▼</button>
        </div>
      )}
      {rank != null && (
        <span style={{ width: 22, color: "#AAA", fontSize: 12, fontVariantNumeric: "tabular-nums" }}>{rank}</span>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 14.5 }}>{title}</div>
        <div style={{ color: dim ? "#AAA" : "#777", fontSize: 12.5, marginTop: 2 }}>{subtitle}</div>
      </div>
      {meta && <span style={{ color: "#AAA", fontSize: 12 }}>{meta}</span>}
      <button onClick={onEdit} style={btn(false)}>{open ? "Close" : "Edit"}</button>
    </div>
  );
}

function Editor({ draft, setDraft, onSave, onCancel, onDelete, busy, lockMatch, allowProductTypes }) {
  const set = (f) => setDraft({ ...draft, ...f });
  const vt = VOLUME_TYPES.find((v) => v.value === draft.volume_type) || VOLUME_TYPES[0];
  const tiers = draft.tiers || [];
  const [sample, setSample] = useState(2000);

  const rows = [{ qty: 1, cents: sample }].concat(
    [...tiers].sort((a, b) => a.qty - b.qty).map((t) => ({
      qty: Number(t.qty),
      cents: tierPrice(sample, draft.volume_type, t.value),
    }))
  );

  return (
    <div style={{ border: "1px solid #E8E8E8", borderTop: 0, borderRadius: "0 0 8px 8px",
      padding: 18, marginTop: -8, marginBottom: 14, background: "#FCFCFC" }}>

      {!lockMatch && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 16 }}>
          <Field label="Rule name">
            <input value={draft.name} onChange={(e) => set({ name: e.target.value })} style={inp} />
          </Field>
          {allowProductTypes && (
            <Field label="Match on">
              <select value={draft.match_type} onChange={(e) => set({ match_type: e.target.value })} style={inp}>
                <option value="sku_contains">SKU contains</option>
                <option value="title_contains">Product title contains</option>
                <option value="products">Specific product handles</option>
              </select>
            </Field>
          )}
          <Field label={draft.match_type === "product_tag" ? "Product tags" : "Values"}
            hint="Comma separated">
            <input value={(draft.match_values || []).join(", ")}
              onChange={(e) => set({ match_values: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
              style={inp} />
          </Field>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 16 }}>
        <Field label="Customer tags" hint="Blank means every customer">
          <input value={(draft.customer_tags || []).join(", ")}
            onChange={(e) => set({ customer_tags: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
            style={inp} />
        </Field>
        <Field label="Status">
          <label style={chk}>
            <input type="checkbox" checked={!!draft.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
            Active
          </label>
        </Field>
      </div>

      <Section title="Minimum order quantity">
        <label style={chk}>
          <input type="checkbox" checked={!!draft.moq_enabled} onChange={(e) => set({ moq_enabled: e.target.checked })} />
          Require a minimum
        </label>
        {draft.moq_enabled && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 14, marginTop: 10 }}>
            <Field label="Counted">
              <select value={draft.moq_mode} onChange={(e) => set({ moq_mode: e.target.value })} style={inp}>
                <option value="per_product">Per product, any mix of variants</option>
                <option value="per_variant">Per variant, each on its own</option>
              </select>
            </Field>
            <Field label="Minimum">
              <input type="number" value={draft.moq_min ?? ""} onChange={(e) => set({ moq_min: Number(e.target.value) })} style={inp} />
            </Field>
            <Field label="Quantity box starts at">
              <input type="number" value={draft.moq_default ?? 1} onChange={(e) => set({ moq_default: Number(e.target.value) })} style={inp} />
            </Field>
            <Field label="Steps of">
              <input type="number" value={draft.moq_increment ?? 1} onChange={(e) => set({ moq_increment: Number(e.target.value) })} style={inp} />
            </Field>
          </div>
        )}
      </Section>

      <Section title="Volume pricing">
        <label style={chk}>
          <input type="checkbox" checked={!!draft.volume_enabled} onChange={(e) => set({ volume_enabled: e.target.checked })} />
          Offer price breaks
        </label>

        {draft.volume_enabled && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))", gap: 14, marginTop: 10 }}>
              <Field label="Price adjustment">
                <select value={draft.volume_type} onChange={(e) => set({ volume_type: e.target.value })} style={inp}>
                  {VOLUME_TYPES.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
                </select>
              </Field>
              <Field label="Quantity counted">
                <select value={draft.volume_mode} onChange={(e) => set({ volume_mode: e.target.value })} style={inp}>
                  <option value="per_variant">Per variant, each on its own</option>
                  <option value="per_product">Per product, summed across variants</option>
                </select>
              </Field>
            </div>

            <div style={{ display: "flex", gap: 26, flexWrap: "wrap", marginTop: 14 }}>
              <div style={{ flex: "1 1 300px", minWidth: 0 }}>
                <div style={lbl}>Price breaks</div>
                {tiers.map((t, i) => (
                  <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 7 }}>
                    <span style={{ color: "#888", fontSize: 12 }}>Buy</span>
                    <input type="number" value={t.qty}
                      onChange={(e) => set({ tiers: tiers.map((x, j) => (j === i ? { ...x, qty: Number(e.target.value) } : x)) })}
                      style={{ ...inp, width: 80 }} />
                    <span style={{ color: "#888", fontSize: 12 }}>{vt.value === "fixed_price" ? "at" : "get"}</span>
                    <input type="number" step="0.01" value={t.value}
                      onChange={(e) => set({ tiers: tiers.map((x, j) => (j === i ? { ...x, value: Number(e.target.value) } : x)) })}
                      style={{ ...inp, width: 90 }} />
                    <span style={{ color: "#888", fontSize: 12 }}>{vt.unit}</span>
                    <button onClick={() => set({ tiers: tiers.filter((_, j) => j !== i) })}
                      style={{ ...btn(false), padding: "5px 10px", color: "#B71C1C" }}>Remove</button>
                  </div>
                ))}
                <button onClick={() => set({ tiers: [...tiers, { qty: 12, value: 5 }] })} style={btn(false)}>
                  Add price break
                </button>
              </div>

              <div style={{ flex: "0 1 280px" }}>
                <div style={lbl}>What the product page shows</div>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, border: "1px solid #E8E8E8", background: "#fff" }}>
                  <thead>
                    <tr style={{ background: "#F4F4F4" }}>
                      <th style={th}>Quantity</th>
                      <th style={{ ...th, textAlign: "right" }}>Price</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={i}>
                        <td style={td}>Buy {r.qty}</td>
                        <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{money(r.cents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 8 }}>
                  <span style={{ color: "#999", fontSize: 11 }}>Example product price $</span>
                  <input type="number" value={sample / 100}
                    onChange={(e) => setSample(Math.round(Number(e.target.value) * 100))}
                    style={{ ...inp, width: 70, padding: "4px 7px", fontSize: 12 }} />
                </div>
                <div style={{ color: "#999", fontSize: 11, marginTop: 5 }}>
                  Real prices come from each product. This is only to check the shape.
                </div>
              </div>
            </div>
          </>
        )}
      </Section>

      <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
        <button onClick={onSave} disabled={busy} style={btn(true)}>{busy ? "Saving..." : "Save"}</button>
        <button onClick={onCancel} style={btn(false)}>Cancel</button>
        {onDelete && (
          <button onClick={onDelete} style={{ ...btn(false), color: "#B71C1C", borderColor: "#E8C3C3", marginLeft: "auto" }}>
            Remove rules
          </button>
        )}
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ marginTop: 18, paddingTop: 14, borderTop: "1px solid #EEE" }}>
      <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 10 }}>{title}</div>
      {children}
    </div>
  );
}

function Field({ label, hint, children }) {
  return (
    <div style={{ marginTop: 10 }}>
      <div style={lbl}>{label}</div>
      {children}
      {hint && <div style={{ color: "#999", fontSize: 11, marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

function Muted({ children }) {
  return <div style={{ border: "1px dashed #DDD", borderRadius: 8, padding: 36, textAlign: "center", color: "#999" }}>{children}</div>;
}

function Banner({ tone, children, onClose }) {
  const good = tone === "good";
  return (
    <div style={{ background: good ? "#E8F3E9" : "#FDECEA", color: good ? "#1B5E20" : "#B71C1C",
      padding: 12, borderRadius: 6, marginBottom: 14, display: "flex", gap: 10 }}>
      <span style={{ flex: 1 }}>{children}</span>
      <button onClick={onClose} style={{ border: 0, background: "transparent", cursor: "pointer", color: "inherit" }}>×</button>
    </div>
  );
}

const inp = { width: "100%", padding: "8px 10px", border: "1px solid #DDD", borderRadius: 6, fontSize: 13, background: "#fff" };
const lbl = { color: "#888", fontSize: 11, textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 4 };
const chk = { display: "flex", gap: 7, alignItems: "center", fontSize: 13.5 };
const th = { textAlign: "left", padding: "7px 10px", fontSize: 11, textTransform: "uppercase", letterSpacing: ".04em", color: "#666", borderBottom: "1px solid #E8E8E8" };
const td = { padding: "7px 10px", borderBottom: "1px solid #F2F2F2" };
const arrow = { border: "1px solid #DDD", background: "#fff", borderRadius: 4, cursor: "pointer", fontSize: 9, lineHeight: 1, padding: "3px 5px", color: "#666" };

function btn(solid) {
  return {
    padding: "8px 16px",
    background: solid ? "#1C1A17" : "#fff",
    color: solid ? "#fff" : "#1C1A17",
    border: solid ? 0 : "1px solid #DDD",
    borderRadius: 6, fontWeight: 600, fontSize: 13, cursor: "pointer",
  };
}
