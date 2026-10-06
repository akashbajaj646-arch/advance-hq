"use client";
// app/wholesale-applications/page.jsx
// Full history of website wholesale submissions: pending, approved, denied,
// and abandoned leads. Reads the Supabase log, acts through Shopify.

import { useEffect, useMemo, useState } from "react";

const TABS = [
  { key: "pending", label: "Pending" },
  { key: "approved", label: "Approved" },
  { key: "denied", label: "Denied" },
  { key: "abandoned", label: "Abandoned" },
  { key: "all", label: "All" },
];

const CHIP = {
  pending: { bg: "#FFF4E0", fg: "#8A5A00" },
  approved: { bg: "#E8F3E9", fg: "#1B5E20" },
  denied: { bg: "#FDECEA", fg: "#B71C1C" },
  abandoned: { bg: "#EEF1F5", fg: "#4A5568" },
};

const fmt = (d) => (d ? new Date(d).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "");
const fmtLong = (d) => (d ? new Date(d).toLocaleString() : "n/a");

export default function WholesaleApplications() {
  const [tab, setTab] = useState("pending");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState(null);
  const [counts, setCounts] = useState({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState({});
  const [open, setOpen] = useState(null);

  const load = (status = tab, search = q) => {
    setRows(null);
    const p = new URLSearchParams({ status, q: search });
    fetch(`/api/wholesale/submissions?${p}`)
      .then((r) => r.json())
      .then((j) => {
        if (j.error) { setError(j.error); setRows([]); return; }
        setError("");
        setRows(j.submissions || []);
        setCounts(j.counts || {});
      })
      .catch(() => { setError("Load failed"); setRows([]); });
  };

  useEffect(() => { load(tab, q); /* eslint-disable-next-line */ }, [tab]);

  useEffect(() => {
    const t = setTimeout(() => load(tab, q), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line
  }, [q]);

  const decide = async (row, decision) => {
    if (!row.shopify_customer_id) {
      setError("No Shopify customer linked to this row, so it can't be decided here.");
      return;
    }
    setBusy((b) => ({ ...b, [row.id]: decision }));
    try {
      const r = await fetch("/api/wholesale/decide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId: row.shopify_customer_id, decision }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      load(tab, q);
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setBusy((b) => { const c = { ...b }; delete c[row.id]; return c; });
    }
  };

  const shopifyLink = (gid) =>
    gid ? `https://admin.shopify.com/store/advance-apparels-wholesale/customers/${String(gid).split("/").pop()}` : null;

  const exportCsv = () => {
    if (!rows || !rows.length) return;
    const cols = ["business_name","contact_name","email","phone","status","submission_type","ein_resale","website","address","sms_consent","submitted_at","decided_at","decided_by"];
    const esc = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
    const csv = [cols.join(",")].concat(rows.map((r) => cols.map((c) => esc(r[c])).join(","))).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `wholesale-${tab}-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
  };

  const total = useMemo(() => (rows ? rows.length : 0), [rows]);

  return (
    <div style={{ maxWidth: 1180, margin: "0 auto", padding: 24 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 16, flexWrap: "wrap" }}>
        <h1 style={{ margin: "0 0 4px" }}>Website Submissions</h1>
        <span style={{ color: "#888", fontSize: 13 }}>
          {rows === null ? "Loading..." : `${total} shown`}
        </span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <button onClick={exportCsv} disabled={!rows || !rows.length}
            style={btn(false)}>Export CSV</button>
          <button onClick={() => load(tab, q)} style={btn(false)}>Refresh</button>
        </div>
      </div>

      <div style={{ display: "flex", gap: 6, margin: "18px 0 14px", flexWrap: "wrap" }}>
        {TABS.map((t) => {
          const on = tab === t.key;
          return (
            <button key={t.key} onClick={() => setTab(t.key)}
              style={{
                padding: "8px 16px", borderRadius: 999, cursor: "pointer",
                border: on ? "1px solid #1C1A17" : "1px solid #DDD",
                background: on ? "#1C1A17" : "#fff",
                color: on ? "#fff" : "#444", fontWeight: 600, fontSize: 13,
              }}>
              {t.label}
              {counts[t.key] != null && (
                <span style={{ opacity: .65, marginLeft: 7 }}>{counts[t.key]}</span>
              )}
            </button>
          );
        })}
      </div>

      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search business, name, email or phone"
        style={{ width: "100%", padding: "11px 14px", border: "1px solid #DDD", borderRadius: 8, fontSize: 14, marginBottom: 16 }}
      />

      {error && (
        <div style={{ background: "#fdecea", color: "#b71c1c", padding: 12, borderRadius: 6, marginBottom: 16 }}>
          {error}
          <button onClick={() => { setError(""); load(tab, q); }} style={{ marginLeft: 8 }}>Retry</button>
        </div>
      )}

      {rows && rows.length === 0 && (
        <div style={{ border: "1px dashed #ccc", borderRadius: 8, padding: 48, textAlign: "center", color: "#888" }}>
          Nothing here yet.
        </div>
      )}

      {rows && rows.length > 0 && (
        <div style={{ border: "1px solid #E8E8E8", borderRadius: 10, overflow: "hidden" }}>
          {rows.map((r, i) => {
            const chip = CHIP[r.status] || CHIP.abandoned;
            const isOpen = open === r.id;
            return (
              <div key={r.id} style={{ borderTop: i ? "1px solid #F0F0F0" : 0 }}>
                <div
                  onClick={() => setOpen(isOpen ? null : r.id)}
                  style={{ display: "flex", gap: 14, alignItems: "center", padding: "14px 16px", cursor: "pointer", background: isOpen ? "#FAFAFA" : "#fff" }}>
                  <div style={{ flex: "1 1 300px", minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 15 }}>
                      {r.business_name || "(no business name)"}
                    </div>
                    <div style={{ color: "#666", fontSize: 13, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {r.contact_name || "n/a"} · {r.email}{r.phone ? ` · ${r.phone}` : ""}
                    </div>
                  </div>
                  <div style={{ width: 110, textAlign: "right", color: "#999", fontSize: 12 }}>
                    {fmt(r.last_submitted_at)}
                  </div>
                  <span style={{ background: chip.bg, color: chip.fg, padding: "4px 11px", borderRadius: 999, fontSize: 12, fontWeight: 700, textTransform: "capitalize" }}>
                    {r.status}
                  </span>
                </div>

                {isOpen && (
                  <div style={{ padding: "4px 16px 18px", background: "#FAFAFA", fontSize: 13, color: "#444" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: "10px 24px", marginBottom: 14 }}>
                      <Field label="Email" value={<a href={`mailto:${r.email}`}>{r.email}</a>} />
                      <Field label="Phone" value={r.phone || "n/a"} />
                      <Field label="Tax ID / resale" value={r.ein_resale || "not provided"} />
                      <Field label="Website" value={r.website
                        ? <a href={r.website.startsWith("http") ? r.website : `https://${r.website}`} target="_blank" rel="noreferrer">{r.website}</a>
                        : "n/a"} />
                      <Field label="SMS consent" value={r.sms_consent ? "Yes" : "No"} />
                      <Field label="Submission" value={r.submission_type === "partial" ? "Partial (abandoned)" : "Complete"} />
                      <Field label="First submitted" value={fmtLong(r.submitted_at)} />
                      <Field label="Last submitted" value={fmtLong(r.last_submitted_at)} />
                      <Field label="Decided" value={r.decided_at ? `${fmtLong(r.decided_at)} by ${r.decided_by || "unknown"}` : "not yet"} />
                      <Field label="Source" value={r.source || "website"} />
                    </div>
                    {r.address && <Field label="Shipping address" value={r.address} />}
                    {r.about && (
                      <div style={{ marginTop: 10 }}>
                        <div style={{ color: "#888", fontSize: 11, textTransform: "uppercase", letterSpacing: ".04em" }}>About the business</div>
                        <div style={{ marginTop: 3, whiteSpace: "pre-wrap" }}>{r.about}</div>
                      </div>
                    )}

                    <div style={{ display: "flex", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
                      {r.status !== "approved" && (
                        <button onClick={(e) => { e.stopPropagation(); decide(r, "approve"); }}
                          disabled={!!busy[r.id]} style={btn(true, "#1b5e20")}>
                          {busy[r.id] === "approve" ? "Approving..." : "Approve"}
                        </button>
                      )}
                      {r.status !== "denied" && (
                        <button onClick={(e) => { e.stopPropagation(); decide(r, "deny"); }}
                          disabled={!!busy[r.id]} style={btn(false, "#b71c1c")}>
                          {busy[r.id] === "deny" ? "Denying..." : "Deny"}
                        </button>
                      )}
                      {shopifyLink(r.shopify_customer_id) && (
                        <a href={shopifyLink(r.shopify_customer_id)} target="_blank" rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          style={{ ...btn(false), textDecoration: "none", display: "inline-block" }}>
                          Open in Shopify
                        </a>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Field({ label, value }) {
  return (
    <div>
      <div style={{ color: "#888", fontSize: 11, textTransform: "uppercase", letterSpacing: ".04em" }}>{label}</div>
      <div style={{ marginTop: 2 }}>{value}</div>
    </div>
  );
}

function btn(solid, color) {
  const c = color || "#1C1A17";
  return {
    padding: "9px 18px",
    background: solid ? c : "#fff",
    color: solid ? "#fff" : c,
    border: solid ? 0 : `1px solid ${solid ? c : "#DDD"}`,
    borderRadius: 6,
    fontWeight: 600,
    fontSize: 13,
    cursor: "pointer",
  };
}
