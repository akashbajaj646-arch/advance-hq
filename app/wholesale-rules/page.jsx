"use client";
// app/wholesale-rules/page.jsx
// Volume pricing and minimum order quantity rules.
// Priority ascending: the first rule a product matches is the one that applies.

import { useEffect, useMemo, useState } from "react";

const MATCH_TYPES = [
  { value: "collection",     label: "Collection",        hint: "Collection titles, exactly as they appear in Shopify" },
  { value: "product_tag",    label: "Product tag",       hint: "Product tags" },
  { value: "sku_contains",   label: "SKU contains",      hint: "Text found anywhere in the variant SKU" },
  { value: "title_contains", label: "Title contains",    hint: "Text found anywhere in the product title" },
  { value: "products",       label: "Specific products", hint: "Product handles" },
];

const VOLUME_TYPES = [
  { value: "percentage",  label: "Percent off",      unit: "%" },
  { value: "amount_off",  label: "Amount off each",  unit: "$" },
  { value: "fixed_price", label: "Fixed price each", unit: "$" },
];

const money = (c) => "$" + (c / 100).toFixed(2);

function tierPrice(baseCents, type, value) {
  const v = Number(value) || 0;
  if (type === "fixed_price") return Math.round(v * 100);
  if (type === "amount_off") return Math.max(0, baseCents - Math.round(v * 100));
  return Math.max(0, Math.round(baseCents * (1 - v / 100)));
}

export default function WholesaleRules() {
  const [rules, setRules] = useState(null);
  const [settings, setSettings] = useState({});
  const [openId, setOpenId] = useState(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [sample, setSample] = useState(2000); // $20.00 preview base

  const load = () =>
    fetch("/api/wholesale/rules")
      .then((r) => r.json())
      .then((j) => {
        if (j.error) return setError(j.error);
        setRules(j.rules || []);
        setSettings(j.settings || {});
      })
      .catch(() => setError("Load failed"));

  useEffect(() => { load(); }, []);

  const patch = (id, fields) =>
    setRules((rs) => rs.map((r) => (r.id === id ? { ...r, ...fields } : r)));

  const save = async (rule) => {
    setBusy(true);
    try {
      const r = await fetch(`/api/wholesale/rules/${rule.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(rule),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setNote(`Saved ${rule.name}`);
      setTimeout(() => setNote(""), 2500);
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setBusy(false);
    }
  };

  const move = async (idx, dir) => {
    const next = [...rules];
    const j = idx + dir;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j], next[idx]];
    setRules(next);
    await fetch("/api/wholesale/rules", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order: next.map((r) => r.id) }),
    });
  };

  const addRule = async () => {
    const r = await fetch("/api/wholesale/rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "New rule", moq_enabled: true, moq_min: 6 }),
    });
    const j = await r.json();
    if (j.rule) { setRules((rs) => [...rs, j.rule]); setOpenId(j.rule.id); }
  };

  const remove = async (rule) => {
    if (!window.confirm(`Delete "${rule.name}"? This cannot be undone.`)) return;
    await fetch(`/api/wholesale/rules/${rule.id}`, { method: "DELETE" });
    setRules((rs) => rs.filter((r) => r.id !== rule.id));
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
        (miss.length ? ` — unresolved: ${miss.join(", ")}` : "")
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

  return (
    <div style={{ maxWidth: 1080, margin: "0 auto", padding: 24 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0 }}>Pricing Rules</h1>
        <span style={{ color: "#888", fontSize: 13 }}>
          {rules ? `${rules.length} rules` : "Loading..."}
        </span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <button onClick={addRule} style={btn(false)}>Add rule</button>
          <button onClick={publish} disabled={busy} style={btn(true)}>
            {busy ? "Publishing..." : "Publish to Shopify"}
          </button>
        </div>
      </div>

      <p style={{ color: "#666", fontSize: 13, margin: "8px 0 20px", maxWidth: "70ch" }}>
        Rules apply top to bottom. A product gets the first rule it matches, and nothing
        stacks, so put specific collections above broad ones. Changes are saved as you make
        them but only reach the storefront when you publish.
      </p>

      {error && <Banner tone="bad" onClose={() => setError("")}>{error}</Banner>}
      {note && <Banner tone="good" onClose={() => setNote("")}>{note}</Banner>}

      <div style={{ border: "1px solid #E8E8E8", borderRadius: 10, padding: 16, marginBottom: 20, display: "flex", gap: 24, flexWrap: "wrap", alignItems: "end" }}>
        <Field label="Order minimum">
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ color: "#888" }}>$</span>
            <input
              type="number"
              value={(settings.order_minimum_cents ?? 30000) / 100}
              onChange={(e) =>
                saveSettings({ ...settings, order_minimum_cents: Math.round(Number(e.target.value) * 100) })
              }
              style={{ ...inp, width: 90 }}
            />
          </div>
        </Field>
        <Field label="Exempt tags">
          <input
            value={(settings.exempt_tags || []).join(", ")}
            onChange={(e) =>
              saveSettings({ ...settings, exempt_tags: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })
            }
            style={{ ...inp, width: 280 }}
          />
        </Field>
        <Field label="Preview base price">
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ color: "#888" }}>$</span>
            <input
              type="number"
              value={sample / 100}
              onChange={(e) => setSample(Math.round(Number(e.target.value) * 100))}
              style={{ ...inp, width: 90 }}
            />
          </div>
        </Field>
      </div>

      {rules && rules.map((rule, i) => (
        <RuleCard
          key={rule.id}
          rule={rule}
          index={i}
          total={rules.length}
          open={openId === rule.id}
          sample={sample}
          onToggle={() => setOpenId(openId === rule.id ? null : rule.id)}
          onPatch={(f) => patch(rule.id, f)}
          onSave={() => save(rules.find((r) => r.id === rule.id))}
          onMove={(d) => move(i, d)}
          onDelete={() => remove(rule)}
        />
      ))}
    </div>
  );
}

function RuleCard({ rule, index, total, open, sample, onToggle, onPatch, onSave, onMove, onDelete }) {
  const vt = VOLUME_TYPES.find((v) => v.value === rule.volume_type) || VOLUME_TYPES[0];
  const tiers = rule.tiers || [];

  const preview = useMemo(() => {
    const rows = [{ qty: 1, cents: sample }];
    [...tiers]
      .sort((a, b) => Number(a.qty) - Number(b.qty))
      .forEach((t) => rows.push({ qty: Number(t.qty), cents: tierPrice(sample, rule.volume_type, t.value) }));
    return rows;
  }, [tiers, sample, rule.volume_type]);

  const setTier = (i, field, value) => {
    const next = tiers.map((t, j) => (j === i ? { ...t, [field]: value } : t));
    onPatch({ tiers: next });
  };

  return (
    <div style={{ border: "1px solid #E8E8E8", borderRadius: 10, marginBottom: 10, background: rule.enabled ? "#fff" : "#FAFAFA" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <button onClick={() => onMove(-1)} disabled={index === 0} style={arrow}>▲</button>
          <button onClick={() => onMove(1)} disabled={index === total - 1} style={arrow}>▼</button>
        </div>
        <span style={{ width: 28, color: "#AAA", fontSize: 12, fontVariantNumeric: "tabular-nums" }}>{index + 1}</span>
        <div onClick={onToggle} style={{ flex: 1, cursor: "pointer", minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>{rule.name}</div>
          <div style={{ color: "#777", fontSize: 12.5, marginTop: 2 }}>
            {(MATCH_TYPES.find((m) => m.value === rule.match_type) || {}).label}
            {" · "}
            {rule.moq_enabled ? `min ${rule.moq_min} ${rule.moq_mode === "per_variant" ? "per variant" : "per product"}` : "no minimum"}
            {rule.volume_enabled && tiers.length
              ? ` · ${tiers.length} price break${tiers.length === 1 ? "" : "s"}`
              : " · no volume pricing"}
          </div>
        </div>
        <label style={{ fontSize: 12.5, color: "#555", display: "flex", gap: 6, alignItems: "center" }}>
          <input type="checkbox" checked={!!rule.enabled} onChange={(e) => { onPatch({ enabled: e.target.checked }); setTimeout(onSave, 0); }} />
          Active
        </label>
        <button onClick={onToggle} style={btn(false)}>{open ? "Close" : "Edit"}</button>
      </div>

      {open && (
        <div style={{ borderTop: "1px solid #F0F0F0", padding: 18, background: "#FCFCFC" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 16 }}>
            <Field label="Rule name">
              <input value={rule.name} onChange={(e) => onPatch({ name: e.target.value })} style={inp} />
            </Field>
            <Field label="Applies to">
              <select value={rule.match_type} onChange={(e) => onPatch({ match_type: e.target.value })} style={inp}>
                {MATCH_TYPES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </Field>
            <Field label="Customer tags" hint="Comma separated. Blank means everyone.">
              <input
                value={(rule.customer_tags || []).join(", ")}
                onChange={(e) => onPatch({ customer_tags: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
                style={inp}
              />
            </Field>
          </div>

          <Field label="Match values" hint={(MATCH_TYPES.find((m) => m.value === rule.match_type) || {}).hint}>
            <input
              value={(rule.match_values || []).join(", ")}
              onChange={(e) => onPatch({ match_values: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
              style={inp}
            />
          </Field>

          <Section title="Minimum order quantity">
            <label style={chk}>
              <input type="checkbox" checked={!!rule.moq_enabled} onChange={(e) => onPatch({ moq_enabled: e.target.checked })} />
              Enforce a minimum
            </label>
            {rule.moq_enabled && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 14, marginTop: 10 }}>
                <Field label="Counted">
                  <select value={rule.moq_mode} onChange={(e) => onPatch({ moq_mode: e.target.value })} style={inp}>
                    <option value="per_product">Per product, any mix of variants</option>
                    <option value="per_variant">Per variant, each on its own</option>
                  </select>
                </Field>
                <Field label="Minimum"><input type="number" value={rule.moq_min ?? ""} onChange={(e) => onPatch({ moq_min: Number(e.target.value) })} style={inp} /></Field>
                <Field label="Starting quantity"><input type="number" value={rule.moq_default ?? 1} onChange={(e) => onPatch({ moq_default: Number(e.target.value) })} style={inp} /></Field>
                <Field label="Steps of"><input type="number" value={rule.moq_increment ?? 1} onChange={(e) => onPatch({ moq_increment: Number(e.target.value) })} style={inp} /></Field>
              </div>
            )}
          </Section>

          <Section title="Volume pricing">
            <label style={chk}>
              <input type="checkbox" checked={!!rule.volume_enabled} onChange={(e) => onPatch({ volume_enabled: e.target.checked })} />
              Offer price breaks
            </label>

            {rule.volume_enabled && (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 14, marginTop: 10 }}>
                  <Field label="Price adjustment">
                    <select value={rule.volume_type} onChange={(e) => onPatch({ volume_type: e.target.value })} style={inp}>
                      {VOLUME_TYPES.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
                    </select>
                  </Field>
                  <Field label="Quantity counted">
                    <select value={rule.volume_mode} onChange={(e) => onPatch({ volume_mode: e.target.value })} style={inp}>
                      <option value="per_variant">Per variant, each on its own</option>
                      <option value="per_product">Per product, summed across variants</option>
                    </select>
                  </Field>
                </div>

                <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginTop: 14 }}>
                  <div style={{ flex: "1 1 280px", minWidth: 0 }}>
                    <div style={lbl}>Price breaks</div>
                    {tiers.map((t, i) => (
                      <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 7 }}>
                        <span style={{ color: "#888", fontSize: 12 }}>Buy</span>
                        <input type="number" value={t.qty} onChange={(e) => setTier(i, "qty", Number(e.target.value))} style={{ ...inp, width: 80 }} />
                        <span style={{ color: "#888", fontSize: 12 }}>{vt.value === "fixed_price" ? "at" : "get"}</span>
                        <input type="number" step="0.01" value={t.value} onChange={(e) => setTier(i, "value", Number(e.target.value))} style={{ ...inp, width: 90 }} />
                        <span style={{ color: "#888", fontSize: 12 }}>{vt.unit}</span>
                        <button onClick={() => onPatch({ tiers: tiers.filter((_, j) => j !== i) })} style={{ ...btn(false), padding: "5px 10px", color: "#B71C1C" }}>Remove</button>
                      </div>
                    ))}
                    <button onClick={() => onPatch({ tiers: [...tiers, { qty: 12, value: 5 }] })} style={btn(false)}>Add price break</button>
                  </div>

                  <div style={{ flex: "0 1 260px" }}>
                    <div style={lbl}>Product page table</div>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, border: "1px solid #E8E8E8" }}>
                      <thead>
                        <tr style={{ background: "#F4F4F4" }}>
                          <th style={th}>Quantity</th>
                          <th style={{ ...th, textAlign: "right" }}>Price</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.map((r, i) => (
                          <tr key={i}>
                            <td style={td}>Buy {r.qty}</td>
                            <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{money(r.cents)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div style={{ color: "#999", fontSize: 11, marginTop: 6 }}>
                      Preview only, using the sample base price above.
                    </div>
                  </div>
                </div>
              </>
            )}
          </Section>

          <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
            <button onClick={onSave} style={btn(true)}>Save rule</button>
            <button onClick={onDelete} style={{ ...btn(false), color: "#B71C1C", borderColor: "#E8C3C3" }}>Delete</button>
          </div>
        </div>
      )}
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

function Banner({ tone, children, onClose }) {
  const good = tone === "good";
  return (
    <div style={{ background: good ? "#E8F3E9" : "#FDECEA", color: good ? "#1B5E20" : "#B71C1C", padding: 12, borderRadius: 6, marginBottom: 14, display: "flex", gap: 10 }}>
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
    borderRadius: 6,
    fontWeight: 600,
    fontSize: 13,
    cursor: "pointer",
  };
}
