"use client";
// app/stripe-links/page.jsx
// Reconciliation between Advance HQ customers and Stripe customers.
// Run the audit first, read the match rate, then decide whether to save.

import { useEffect, useState } from "react";

const norm = (e) => String(e || "").trim().toLowerCase();

export default function StripeLinks() {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [existing, setExisting] = useState(0);
  const [saving, setSaving] = useState(false);
  const [savedCount, setSavedCount] = useState(null);
  const [tab, setTab] = useState("matched");

  useEffect(() => {
    fetch("/api/wholesale/stripe-links")
      .then((r) => r.json())
      .then((j) => setExisting(j.count || 0))
      .catch(() => {});
  }, []);

  const runAudit = async () => {
    setRunning(true); setError(""); setResult(null); setSavedCount(null);
    try {
      // Stripe side
      const stripe = [];
      let cursor = null;
      do {
        setProgress(`Reading Stripe customers… ${stripe.length}`);
        const r = await fetch(`/api/wholesale/stripe-audit?source=stripe${cursor ? `&cursor=${cursor}` : ""}`);
        const j = await r.json();
        if (!r.ok) throw new Error(j.detail || j.error);
        stripe.push(...j.customers);
        cursor = j.nextCursor;
      } while (cursor && stripe.length < 20000);

      // HQ side
      const hq = [];
      let offset = 0;
      let columns = [];
      while (offset !== null && hq.length < 50000) {
        setProgress(`Reading Advance HQ customers… ${hq.length}`);
        const r = await fetch(`/api/wholesale/stripe-audit?source=hq&offset=${offset}`);
        const j = await r.json();
        if (!r.ok) throw new Error(j.detail || j.error);
        hq.push(...j.customers);
        if (j.columns && j.columns.length) columns = j.columns;
        offset = j.nextOffset;
      }

      setProgress("Matching…");

      // Index Stripe by email, tracking duplicates
      const byEmail = new Map();
      const dupes = new Map();
      for (const s of stripe) {
        if (!s.email) continue;
        if (byEmail.has(s.email)) {
          dupes.set(s.email, (dupes.get(s.email) || 1) + 1);
        } else {
          byEmail.set(s.email, s);
        }
      }

      const matched = [];
      const noEmail = [];
      const unmatched = [];
      const usedStripeIds = new Set();

      for (const c of hq) {
        if (!c.email) { noEmail.push(c); continue; }
        const s = byEmail.get(norm(c.email));
        if (s) {
          matched.push({ hq: c, stripe: s, duplicate: dupes.has(c.email) });
          usedStripeIds.add(s.id);
        } else {
          unmatched.push(c);
        }
      }

      const stripeOnly = stripe.filter((s) => !usedStripeIds.has(s.id));

      setResult({
        hqTotal: hq.length,
        stripeTotal: stripe.length,
        matched, unmatched, noEmail, stripeOnly,
        duplicateEmails: [...dupes.keys()],
        columns,
      });
      setProgress("");
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setRunning(false);
    }
  };

  const saveMatched = async () => {
    if (!result) return;
    setSaving(true); setError("");
    try {
      const links = result.matched.map((m) => ({
        hqCustomerId: m.hq.id,
        stripeCustomerId: m.stripe.id,
        matchedEmail: m.hq.email,
        matchMethod: "email",
      }));
      const r = await fetch("/api/wholesale/stripe-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ links }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.detail || j.error);
      setSavedCount(j.saved);
      setExisting(j.saved);
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setSaving(false);
    }
  };

  const pct = result && result.hqTotal
    ? Math.round((result.matched.length / result.hqTotal) * 100)
    : 0;

  const card = { border: "1px solid #e5e5e5", borderRadius: 8, padding: "16px 18px", flex: "1 1 150px" };
  const big = { fontSize: 26, fontWeight: 700, margin: "4px 0 0" };
  const tabBtn = (k, label, n) => (
    <button key={k} onClick={() => setTab(k)}
      style={{
        padding: "8px 14px", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 600,
        background: tab === k ? "#000" : "#fff", color: tab === k ? "#fff" : "#555",
        border: "1px solid " + (tab === k ? "#000" : "#ccc"),
      }}>
      {label} ({n})
    </button>
  );

  const rows = result
    ? tab === "matched" ? result.matched.map((m) => ({
        a: m.hq.name || m.hq.id, b: m.hq.email, c: m.stripe.id, warn: m.duplicate ? "duplicate email in Stripe" : "",
      }))
    : tab === "unmatched" ? result.unmatched.map((c) => ({ a: c.name || c.id, b: c.email, c: "", warn: "" }))
    : tab === "noEmail" ? result.noEmail.map((c) => ({ a: c.name || c.id, b: "(no email on file)", c: "", warn: "" }))
    : result.stripeOnly.map((s) => ({ a: s.name || "(no name)", b: s.email || "(no email)", c: s.id, warn: "" }))
    : [];

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: 24 }}>
      <h1 style={{ margin: "0 0 4px" }}>Stripe Links</h1>
      <p style={{ color: "#666", margin: "0 0 20px" }}>
        Match Advance HQ customers to their Stripe billing profiles. Nothing is written until you save.
      </p>

      <div style={{ display: "flex", gap: 10, marginBottom: 20, alignItems: "center", flexWrap: "wrap" }}>
        <button onClick={runAudit} disabled={running}
          style={{ padding: "12px 22px", background: "#000", color: "#fff", border: 0, borderRadius: 6, fontWeight: 600, cursor: "pointer", opacity: running ? 0.6 : 1 }}>
          {running ? "Running…" : "Run audit"}
        </button>
        <span style={{ color: "#888", fontSize: 13 }}>
          {progress || (existing ? `${existing} links already saved` : "No links saved yet")}
        </span>
      </div>

      {error && (
        <div style={{ background: "#fdecea", color: "#b71c1c", padding: 14, borderRadius: 6, marginBottom: 20 }}>
          {error}
        </div>
      )}

      {result && (
        <>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
            <div style={card}>
              <div style={{ fontSize: 12, color: "#888", textTransform: "uppercase", letterSpacing: 0.6 }}>Match rate</div>
              <div style={{ ...big, color: pct >= 70 ? "#1b5e20" : pct >= 40 ? "#8a6d1f" : "#b71c1c" }}>{pct}%</div>
            </div>
            <div style={card}>
              <div style={{ fontSize: 12, color: "#888", textTransform: "uppercase", letterSpacing: 0.6 }}>HQ customers</div>
              <div style={big}>{result.hqTotal.toLocaleString()}</div>
            </div>
            <div style={card}>
              <div style={{ fontSize: 12, color: "#888", textTransform: "uppercase", letterSpacing: 0.6 }}>In Stripe</div>
              <div style={big}>{result.stripeTotal.toLocaleString()}</div>
            </div>
            <div style={card}>
              <div style={{ fontSize: 12, color: "#888", textTransform: "uppercase", letterSpacing: 0.6 }}>Matched</div>
              <div style={{ ...big, color: "#1b5e20" }}>{result.matched.length.toLocaleString()}</div>
            </div>
          </div>

          {result.duplicateEmails.length > 0 && (
            <div style={{ background: "#fdf6e3", color: "#8a6d1f", padding: 14, borderRadius: 6, marginBottom: 20, fontSize: 14, lineHeight: 1.6 }}>
              {result.duplicateEmails.length} email{result.duplicateEmails.length === 1 ? " appears" : "s appear"} on more than one Stripe customer. Those matched to the oldest record, so check them before relying on the link.
            </div>
          )}

          {result.matched.length > 0 && (
            <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 22, flexWrap: "wrap" }}>
              <button onClick={saveMatched} disabled={saving}
                style={{ padding: "12px 22px", background: "#1b5e20", color: "#fff", border: 0, borderRadius: 6, fontWeight: 600, cursor: "pointer", opacity: saving ? 0.6 : 1 }}>
                {saving ? "Saving…" : `Save ${result.matched.length} links`}
              </button>
              {savedCount !== null && (
                <span style={{ color: "#1b5e20", fontWeight: 600, fontSize: 14 }}>Saved {savedCount}.</span>
              )}
            </div>
          )}

          <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
            {tabBtn("matched", "Matched", result.matched.length)}
            {tabBtn("unmatched", "No Stripe profile", result.unmatched.length)}
            {tabBtn("noEmail", "No email in HQ", result.noEmail.length)}
            {tabBtn("stripeOnly", "Stripe only", result.stripeOnly.length)}
          </div>

          <div style={{ border: "1px solid #eee", borderRadius: 8, overflow: "hidden" }}>
            {rows.slice(0, 200).map((r, i) => (
              <div key={i} style={{ display: "flex", gap: 12, padding: "10px 14px", borderBottom: "1px solid #f4f4f4", fontSize: 13, alignItems: "center" }}>
                <div style={{ flex: "1 1 200px", minWidth: 0, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.a}</div>
                <div style={{ flex: "1 1 220px", minWidth: 0, color: "#666", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.b}</div>
                <div style={{ color: "#999", fontFamily: "monospace", fontSize: 11, whiteSpace: "nowrap" }}>{r.c}</div>
                {r.warn && <div style={{ color: "#8a6d1f", fontSize: 11, whiteSpace: "nowrap" }}>{r.warn}</div>}
              </div>
            ))}
            {rows.length === 0 && <div style={{ padding: 24, color: "#888", fontSize: 14 }}>Nothing in this group.</div>}
            {rows.length > 200 && (
              <div style={{ padding: 12, color: "#888", fontSize: 12, textAlign: "center" }}>
                Showing first 200 of {rows.length.toLocaleString()}.
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
