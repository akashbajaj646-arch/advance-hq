"use client";
// app/payment-links/page.jsx
// Staff module: generate single-use links for customers, either to manage
// cards on file or to pay a specific amount, plus an audit trail.

import { useEffect, useState } from "react";

const BRAND = {
  visa: "Visa", mastercard: "Mastercard", amex: "American Express",
  discover: "Discover", diners: "Diners Club", jcb: "JCB", unionpay: "UnionPay",
};

const STATUS = {
  unopened: { label: "Not opened yet", color: "#8a6d1f", bg: "#fdf6e3" },
  opened: { label: "Opened", color: "#1b5e20", bg: "#eef6ee" },
  expired: { label: "Expired unused", color: "#777", bg: "#f2f2f2" },
};

const usd = (cents) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);

export default function PaymentLinks() {
  const [mode, setMode] = useState("cards"); // 'cards' | 'payment'
  const [email, setEmail] = useState("");
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [minutes, setMinutes] = useState(30);
  const [result, setResult] = useState(null);
  const [cards, setCards] = useState(null);
  const [links, setLinks] = useState([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");

  const loadLinks = () =>
    fetch("/api/wholesale/portal-link")
      .then((r) => r.json())
      .then((j) => setLinks(j.links || []))
      .catch(() => {});

  useEffect(() => { loadLinks(); }, []);

  const lookup = async () => {
    if (!email) return;
    setBusy("lookup"); setError(""); setCards(null);
    try {
      const r = await fetch(`/api/wholesale/portal-link?email=${encodeURIComponent(email)}`);
      const j = await r.json();
      if (r.ok) setCards(j.cards || []);
      else setError(j.error || "Lookup failed");
    } catch { setError("Lookup failed"); } finally { setBusy(""); }
  };

  const generate = async () => {
    if (!email) return;
    if (mode === "payment" && !(Number(amount) > 0)) { setError("Enter an amount"); return; }
    setBusy("generate"); setError(""); setCopied(""); setResult(null);
    try {
      const body = { email, minutes };
      if (mode === "payment") { body.amount = Number(amount); body.reference = reference; }
      const r = await fetch("/api/wholesale/portal-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (r.ok) { setResult(j); loadLinks(); }
      else setError(j.error || "Could not create link");
    } catch { setError("Could not create link"); } finally { setBusy(""); }
  };

  const copy = (text, key) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(""), 2000);
  };

  const message = result
    ? mode === "payment"
      ? `Hi, here's a secure link to pay ${usd(Number(amount) * 100)}${reference ? ` for ${reference}` : ""}. You can use the card we have on file or a new one. The link opens once and expires in ${minutes} minutes: ${result.url}`
      : `Hi, here's a secure link to add or update the card we keep on file for your wholesale account. It opens once and expires in ${minutes} minutes: ${result.url}`
    : "";

  const subject = mode === "payment" ? "Payment link for your order" : "Update your card on file";
  const input = { width: "100%", padding: 12, border: "1px solid #ccc", borderRadius: 6, fontSize: 15 };
  const tab = (active) => ({
    flex: 1, padding: "11px 16px", cursor: "pointer", fontWeight: 600, fontSize: 14,
    background: active ? "#000" : "#fff", color: active ? "#fff" : "#555",
    border: "1px solid " + (active ? "#000" : "#ccc"), borderRadius: 6,
  });

  return (
    <div style={{ maxWidth: 780, margin: "0 auto", padding: 24 }}>
      <h1 style={{ margin: "0 0 4px" }}>Payment Links</h1>
      <p style={{ color: "#666", margin: "0 0 24px" }}>
        Single-use links you can text or email. They die after one open.
      </p>

      <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
        <button onClick={() => { setMode("cards"); setResult(null); }} style={tab(mode === "cards")}>
          Manage cards
        </button>
        <button onClick={() => { setMode("payment"); setResult(null); }} style={tab(mode === "payment")}>
          Request a payment
        </button>
      </div>

      <div style={{ border: "1px solid #e5e5e5", borderRadius: 8, padding: 20, marginBottom: 28 }}>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div style={{ flex: "1 1 280px" }}>
            <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Customer email</label>
            <input value={email} onChange={(e) => setEmail(e.target.value.trim())}
              placeholder="customer@example.com" style={input} />
          </div>
          <div style={{ width: 130 }}>
            <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Expires in</label>
            <select value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} style={{ ...input, background: "#fff" }}>
              <option value={15}>15 minutes</option>
              <option value={30}>30 minutes</option>
              <option value={60}>1 hour</option>
              <option value={1440}>24 hours</option>
            </select>
          </div>
        </div>

        {mode === "payment" && (
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 14 }}>
            <div style={{ width: 160 }}>
              <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Amount (USD)</label>
              <input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                inputMode="decimal" placeholder="1250.00" style={input} />
            </div>
            <div style={{ flex: "1 1 260px" }}>
              <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Reference</label>
              <input value={reference} onChange={(e) => setReference(e.target.value)}
                placeholder="Invoice 10432" style={input} />
            </div>
          </div>
        )}

        <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
          <button onClick={generate} disabled={!email || busy === "generate"}
            style={{ flex: 1, padding: 13, background: "#000", color: "#fff", border: 0, borderRadius: 6, fontWeight: 600, cursor: "pointer", opacity: busy === "generate" ? 0.6 : 1 }}>
            {busy === "generate" ? "Generating..." : mode === "payment" ? "Generate payment link" : "Generate link"}
          </button>
          <button onClick={lookup} disabled={!email || busy === "lookup"}
            style={{ padding: "13px 20px", background: "#fff", color: "#333", border: "1px solid #ccc", borderRadius: 6, fontWeight: 600, cursor: "pointer" }}>
            {busy === "lookup" ? "Checking..." : "Cards on file"}
          </button>
        </div>

        {error && <p style={{ color: "#b71c1c", marginTop: 14, marginBottom: 0 }}>{error}</p>}

        {cards && (
          <div style={{ marginTop: 18, borderTop: "1px solid #eee", paddingTop: 16 }}>
            {cards.length === 0 ? (
              <p style={{ color: "#888", margin: 0, fontSize: 14 }}>No cards on file for this customer.</p>
            ) : (
              cards.map((c) => (
                <div key={c.id} style={{ fontSize: 14, color: "#333", marginBottom: 6 }}>
                  {BRAND[c.brand] || c.brand} ending {c.last4} · expires {String(c.expMonth).padStart(2, "0")}/{String(c.expYear).slice(-2)}
                  {c.isDefault && <span style={{ color: "#1b5e20", fontWeight: 600 }}> · default</span>}
                </div>
              ))
            )}
          </div>
        )}

        {result && (
          <div style={{ marginTop: 18, background: "#f7f7f7", borderRadius: 6, padding: 16 }}>
            <div style={{ fontSize: 13, color: "#666", marginBottom: 8 }}>
              {result.amount ? `Requesting ${usd(result.amount * 100)}. ` : ""}
              Opens once, then dies. Expires {new Date(result.expiresAt).toLocaleTimeString()}.
            </div>
            <div style={{ wordBreak: "break-all", fontSize: 12, fontFamily: "monospace", background: "#fff", border: "1px solid #e5e5e5", borderRadius: 4, padding: 10, marginBottom: 10 }}>
              {result.url}
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button onClick={() => copy(result.url, "url")}
                style={{ padding: "10px 16px", background: "#000", color: "#fff", border: 0, borderRadius: 6, fontWeight: 600, cursor: "pointer" }}>
                {copied === "url" ? "Copied" : "Copy link"}
              </button>
              <button onClick={() => copy(message, "msg")}
                style={{ padding: "10px 16px", background: "#fff", color: "#333", border: "1px solid #ccc", borderRadius: 6, fontWeight: 600, cursor: "pointer" }}>
                {copied === "msg" ? "Copied" : "Copy message"}
              </button>
              <a href={`mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`}
                style={{ padding: "10px 16px", background: "#fff", color: "#333", border: "1px solid #ccc", borderRadius: 6, fontWeight: 600, textDecoration: "none" }}>
                Email it
              </a>
            </div>
          </div>
        )}
      </div>

      <h2 style={{ fontSize: 17, margin: "0 0 12px" }}>Recently issued</h2>
      {links.length === 0 && <p style={{ color: "#888", fontSize: 14 }}>No links generated yet.</p>}
      {links.map((l) => {
        const s = STATUS[l.status] || STATUS.expired;
        return (
          <div key={l.jti} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: "1px solid #f0f0f0", fontSize: 14 }}>
            <div style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {l.email}
              {l.amount_cents ? <span style={{ color: "#333", fontWeight: 600 }}> · {usd(l.amount_cents)}</span> : null}
              {l.reference ? <span style={{ color: "#999" }}> · {l.reference}</span> : null}
            </div>
            <div style={{ color: "#999", fontSize: 12, whiteSpace: "nowrap" }}>{new Date(l.created_at).toLocaleString()}</div>
            <span style={{ background: s.bg, color: s.color, fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 20, letterSpacing: 0.3, whiteSpace: "nowrap" }}>
              {s.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}
