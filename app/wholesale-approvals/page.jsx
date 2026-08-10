"use client";
// app/wholesale-approvals/page.jsx
// Wholesale application approval queue. One-click Approve / Deny.

import { useEffect, useState } from "react";

export default function WholesaleApprovals() {
  const [apps, setApps] = useState(null);
  const [busy, setBusy] = useState({});
  const [error, setError] = useState("");

  const load = () =>
    fetch("/api/wholesale/applications")
      .then((r) => r.json())
      .then((j) => (j.applications ? setApps(j.applications) : setError(j.error || "Load failed")))
      .catch(() => setError("Load failed"));

  useEffect(() => { load(); }, []);

  const decide = async (id, decision) => {
    setBusy((b) => ({ ...b, [id]: decision }));
    try {
      const r = await fetch("/api/wholesale/decide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId: id, decision }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setApps((a) => a.filter((x) => x.id !== id));
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setBusy((b) => { const c = { ...b }; delete c[id]; return c; });
    }
  };

  const shopifyLink = (gid) =>
    `https://admin.shopify.com/store/advance-apparels-wholesale/customers/${gid.split("/").pop()}`;

  return (
    <div style={{ maxWidth: 1000, margin: "0 auto", padding: 24 }}>
      <h1 style={{ margin: "0 0 4px" }}>Wholesale Approvals</h1>
      <p style={{ color: "#666", margin: "0 0 24px" }}>
        {apps ? `${apps.length} pending application${apps.length === 1 ? "" : "s"}` : "Loading..."}
      </p>

      {error && (
        <div style={{ background: "#fdecea", color: "#b71c1c", padding: 12, borderRadius: 6, marginBottom: 16 }}>
          {error} <button onClick={() => { setError(""); load(); }} style={{ marginLeft: 8 }}>Retry</button>
        </div>
      )}

      {apps && apps.length === 0 && (
        <div style={{ border: "1px dashed #ccc", borderRadius: 8, padding: 48, textAlign: "center", color: "#888" }}>
          Queue is clear. New applications appear here automatically.
        </div>
      )}

      {apps && apps.map((a) => (
        <div key={a.id} style={{ border: "1px solid #e5e5e5", borderRadius: 8, padding: 20, marginBottom: 14, display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
          <div style={{ flex: "1 1 320px", minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 16 }}>{a.businessName || "(no business name)"}</div>
            <div style={{ color: "#555", fontSize: 14, marginTop: 2 }}>
              {a.name} · <a href={`mailto:${a.email}`}>{a.email}</a>{a.phone ? ` · ${a.phone}` : ""}
            </div>
            <div style={{ color: "#555", fontSize: 13, marginTop: 8, display: "flex", gap: 14, flexWrap: "wrap" }}>
              <span><b>Type:</b> {a.businessType || "n/a"}</span>
              <span><b>EIN/Resale:</b> {a.einResale || "n/a"}</span>
              <span><b>Web:</b> {a.website && a.website !== "n/a"
                ? <a href={a.website.startsWith("http") ? a.website : `https://${a.website}`} target="_blank" rel="noreferrer">{a.website}</a>
                : "n/a"}</span>
              <span><b>Heard from:</b> {a.heardFrom || "n/a"}</span>
            </div>
            <div style={{ color: "#999", fontSize: 12, marginTop: 6 }}>
              Applied {new Date(a.appliedAt).toLocaleString()}
              {" · "}
              <a href={shopifyLink(a.id)} target="_blank" rel="noreferrer">Open in Shopify</a>
            </div>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button
              onClick={() => decide(a.id, "approve")}
              disabled={!!busy[a.id]}
              style={{ padding: "12px 22px", background: "#1b5e20", color: "#fff", border: 0, borderRadius: 6, fontWeight: 600, cursor: "pointer", opacity: busy[a.id] ? 0.6 : 1 }}>
              {busy[a.id] === "approve" ? "Approving..." : "Approve"}
            </button>
            <button
              onClick={() => decide(a.id, "deny")}
              disabled={!!busy[a.id]}
              style={{ padding: "12px 22px", background: "#fff", color: "#b71c1c", border: "1px solid #b71c1c", borderRadius: 6, fontWeight: 600, cursor: "pointer", opacity: busy[a.id] ? 0.6 : 1 }}>
              {busy[a.id] === "deny" ? "Denying..." : "Deny"}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
