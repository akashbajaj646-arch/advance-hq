"use client";
// components/StripeCustomerPanel.jsx
// Drop into the customer detail page as a "Stripe" tab:
//   <StripeCustomerPanel hqCustomerId={customer.apparel_magic_customer_id} email={customer.email} />

import { useEffect, useState } from "react";

const BRAND = {
  visa: "Visa", mastercard: "Mastercard", amex: "American Express",
  discover: "Discover", diners: "Diners Club", jcb: "JCB", unionpay: "UnionPay",
};

const STATUS = {
  succeeded: { label: "Paid", color: "#1b5e20", bg: "#eef6ee" },
  processing: { label: "Processing", color: "#8a6d1f", bg: "#fdf6e3" },
  requires_payment_method: { label: "Failed", color: "#b71c1c", bg: "#fdecea" },
  requires_action: { label: "Needs action", color: "#8a6d1f", bg: "#fdf6e3" },
  canceled: { label: "Canceled", color: "#777", bg: "#f2f2f2" },
};

const money = (cents, currency = "usd") =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() })
    .format((Number(cents) || 0) / 100);

export default function StripeCustomerPanel({ hqCustomerId, email }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [search, setSearch] = useState("");
  const [results, setResults] = useState([]);
  const [linkOut, setLinkOut] = useState(null);
  const [copied, setCopied] = useState(false);

  const load = () => {
    setError("");
    const qs = new URLSearchParams({ hqCustomerId: String(hqCustomerId || "") });
    if (email) qs.set("email", email);
    fetch(`/api/wholesale/stripe-customer?${qs}`)
      .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => (ok ? setData(j) : setError(j.detail || j.error)))
      .catch(() => setError("Could not reach Stripe"));
  };

  useEffect(() => { if (hqCustomerId) load(); }, [hqCustomerId, email]);

  const link = async (stripeCustomerId, matchedEmail) => {
    setBusy("link");
    try {
      const r = await fetch("/api/wholesale/stripe-customer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hqCustomerId, stripeCustomerId, matchedEmail }),
      });
      if (!r.ok) throw new Error((await r.json()).error);
      setResults([]); setSearch(""); setData(null); load();
    } catch (e) { setError(String(e.message || e)); } finally { setBusy(""); }
  };

  const unlink = async () => {
    if (!confirm("Unlink this Stripe profile from the customer?")) return;
    setBusy("unlink");
    try {
      await fetch(`/api/wholesale/stripe-customer?hqCustomerId=${encodeURIComponent(hqCustomerId)}`, { method: "DELETE" });
      setData(null); load();
    } finally { setBusy(""); }
  };

  const runSearch = async () => {
    if (!search.trim()) return;
    setBusy("search");
    try {
      const r = await fetch(`/api/wholesale/stripe-customer?q=${encodeURIComponent(search)}`);
      const j = await r.json();
      setResults(j.results || []);
    } finally { setBusy(""); }
  };

  const makeLink = async () => {
    const target = data?.stripeCustomer?.email || email;
    if (!target) { setError("No email available to send a link to"); return; }
    setBusy("cardlink");
    try {
      const r = await fetch("/api/wholesale/portal-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: target, minutes: 30 }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setLinkOut(j.url);
    } catch (e) { setError(String(e.message || e)); } finally { setBusy(""); }
  };

  const box = { border: "1px solid #e5e5e5", borderRadius: 8, padding: 18, marginBottom: 16 };
  const btn = { padding: "10px 16px", borderRadius: 6, fontWeight: 600, fontSize: 14, cursor: "pointer", border: 0, background: "#000", color: "#fff" };
  const ghost = { ...btn, background: "#fff", color: "#333", border: "1px solid #ccc" };

  if (error) return (
    <div style={{ background: "#fdecea", color: "#b71c1c", padding: 14, borderRadius: 6 }}>
      {error} <button onClick={load} style={{ marginLeft: 8, background: "none", border: 0, color: "#b71c1c", textDecoration: "underline", cursor: "pointer" }}>Retry</button>
    </div>
  );

  if (!data) return <p style={{ color: "#888", padding: 20 }}>Loading Stripe profile…</p>;

  // Not linked yet
  if (!data.linked) {
    return (
      <div style={{ maxWidth: 640 }}>
        <div style={box}>
          <h3 style={{ margin: "0 0 6px", fontSize: 16 }}>No Stripe profile linked</h3>
          <p style={{ color: "#666", margin: "0 0 16px", fontSize: 14, lineHeight: 1.6 }}>
            Link this customer to their Stripe billing profile to see cards on file and payment history here.
          </p>

          {data.suggestion && (
            <div style={{ background: "#f7f7f7", borderRadius: 6, padding: 14, marginBottom: 16 }}>
              <div style={{ fontSize: 13, color: "#666", marginBottom: 6 }}>
                Possible match by email{data.suggestion.ambiguous ? " (more than one Stripe profile uses this email)" : ""}
              </div>
              <div style={{ fontWeight: 600 }}>{data.suggestion.name || "(no name)"}</div>
              <div style={{ color: "#666", fontSize: 13, marginBottom: 12 }}>{data.suggestion.email}</div>
              <button style={btn} disabled={busy === "link"} onClick={() => link(data.suggestion.id, data.suggestion.email)}>
                {busy === "link" ? "Linking…" : "Link this profile"}
              </button>
            </div>
          )}

          <div style={{ display: "flex", gap: 8 }}>
            <input value={search} onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && runSearch()}
              placeholder="Search Stripe by email or business name"
              style={{ flex: 1, padding: 11, border: "1px solid #ccc", borderRadius: 6, fontSize: 14 }} />
            <button style={ghost} onClick={runSearch} disabled={busy === "search"}>
              {busy === "search" ? "Searching…" : "Search"}
            </button>
          </div>

          {results.map((r) => (
            <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: "1px solid #f2f2f2" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{r.name || "(no name)"}</div>
                <div style={{ color: "#888", fontSize: 13 }}>{r.email || "(no email)"}</div>
              </div>
              <button style={ghost} onClick={() => link(r.id, r.email)}>Link</button>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Linked
  const { stripeCustomer, cards = [], payments = [], link: meta } = data;
  const totalPaid = payments.filter((p) => p.status === "succeeded").reduce((s, p) => s + p.amount, 0);

  return (
    <div style={{ maxWidth: 720 }}>
      <div style={{ ...box, display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontWeight: 700 }}>{stripeCustomer.name || "Stripe profile"}</div>
          <div style={{ color: "#666", fontSize: 13, marginTop: 2 }}>{stripeCustomer.email}</div>
          <div style={{ color: "#aaa", fontSize: 11, fontFamily: "monospace", marginTop: 4 }}>{stripeCustomer.id}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 11, color: "#888", textTransform: "uppercase", letterSpacing: 0.6 }}>Paid via Stripe</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{money(totalPaid)}</div>
        </div>
        <button style={{ ...ghost, color: "#b71c1c", borderColor: "#e0b4b4" }} onClick={unlink} disabled={busy === "unlink"}>
          {busy === "unlink" ? "Unlinking…" : "Unlink"}
        </button>
      </div>

      <div style={box}>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 15, flex: 1 }}>Cards on file</h3>
          <button style={ghost} onClick={makeLink} disabled={busy === "cardlink"}>
            {busy === "cardlink" ? "Generating…" : "Send card update link"}
          </button>
        </div>

        {cards.length === 0 && <p style={{ color: "#888", fontSize: 14, margin: 0 }}>No cards saved.</p>}
        {cards.map((c) => (
          <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", fontSize: 14 }}>
            <span style={{ fontWeight: 600 }}>{BRAND[c.brand] || c.brand} •••• {c.last4}</span>
            <span style={{ color: "#888", fontSize: 13 }}>exp {String(c.expMonth).padStart(2, "0")}/{String(c.expYear).slice(-2)}</span>
            {c.isDefault && <span style={{ fontSize: 10, fontWeight: 700, background: "#eef6ee", color: "#1b5e20", padding: "3px 7px", borderRadius: 3 }}>DEFAULT</span>}
          </div>
        ))}

        {linkOut && (
          <div style={{ marginTop: 14, background: "#f7f7f7", borderRadius: 6, padding: 12 }}>
            <div style={{ fontFamily: "monospace", fontSize: 11, wordBreak: "break-all", marginBottom: 8 }}>{linkOut}</div>
            <button style={btn} onClick={() => { navigator.clipboard.writeText(linkOut); setCopied(true); setTimeout(() => setCopied(false), 2000); }}>
              {copied ? "Copied" : "Copy link"}
            </button>
          </div>
        )}
      </div>

      <div style={box}>
        <h3 style={{ margin: "0 0 12px", fontSize: 15 }}>Recent payments</h3>
        {payments.length === 0 && <p style={{ color: "#888", fontSize: 14, margin: 0 }}>No payments through Stripe yet.</p>}
        {payments.map((p) => {
          const s = STATUS[p.status] || { label: p.status, color: "#777", bg: "#f2f2f2" };
          return (
            <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: "1px solid #f4f4f4", fontSize: 14 }}>
              <div style={{ width: 96, color: "#888", fontSize: 13 }}>
                {new Date(p.created * 1000).toLocaleDateString()}
              </div>
              <div style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {p.invoiceNumber ? `Invoice ${p.invoiceNumber}` : p.description || "Payment"}
              </div>
              <span style={{ background: s.bg, color: s.color, fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 20 }}>
                {s.label}
              </span>
              <div style={{ fontWeight: 600, width: 90, textAlign: "right" }}>{money(p.amount, p.currency)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
