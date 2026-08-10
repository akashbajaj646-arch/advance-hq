"use client";
// app/payment-links/page.jsx
// Staff module: generate single-use links, either to manage cards or to pay
// a specific invoice. Picking an invoice loads its balance and line items,
// which are snapshotted onto the link.

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

const usd = (n) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(n) || 0);
const cents = (c) => usd((Number(c) || 0) / 100);

export default function PaymentLinks() {
  const [mode, setMode] = useState("cards");
  const [email, setEmail] = useState("");
  const [minutes, setMinutes] = useState(30);

  const [search, setSearch] = useState("");
  const [invoices, setInvoices] = useState([]);
  const [picked, setPicked] = useState(null);
  const [items, setItems] = useState([]);
  const [amount, setAmount] = useState("");

  const [result, setResult] = useState(null);
  const [cards, setCards] = useState(null);
  const [links, setLinks] = useState([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");

  const loadLinks = () =>
    fetch("/api/wholesale/portal-link").then((r) => r.json()).then((j) => setLinks(j.links || [])).catch(() => {});

  useEffect(() => { loadLinks(); }, []);

  useEffect(() => {
    if (mode !== "payment") return;
    const t = setTimeout(() => {
      fetch(`/api/wholesale/invoices?q=${encodeURIComponent(search)}`)
        .then((r) => r.json())
        .then((j) => setInvoices(j.invoices || []))
        .catch(() => {});
    }, 250);
    return () => clearTimeout(t);
  }, [search, mode]);

  const pickInvoice = async (inv) => {
    setBusy("invoice"); setError(""); setResult(null);
    try {
      const r = await fetch(`/api/wholesale/invoices?invoice_number=${encodeURIComponent(inv.invoice_number)}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setPicked(j.invoice);
      setItems(j.items || []);
      const bal = Number(j.invoice.balance_due) || Number(j.invoice.total_amount) || 0;
      setAmount(String(bal.toFixed(2)));
      setInvoices([]);
      setSearch("");
    } catch (e) {
      setError("Could not load that invoice");
    } finally { setBusy(""); }
  };

  const clearInvoice = () => { setPicked(null); setItems([]); setAmount(""); setResult(null); };

  const lookup = async () => {
    if (!email) return;
    setBusy("lookup"); setError(""); setCards(null);
    try {
      const r = await fetch(`/api/wholesale/portal-link?email=${encodeURIComponent(email)}`);
      const j = await r.json();
      if (r.ok) setCards(j.cards || []); else setError(j.error || "Lookup failed");
    } catch { setError("Lookup failed"); } finally { setBusy(""); }
  };

  const generate = async () => {
    if (!email) { setError("Enter a customer email"); return; }
    if (mode === "payment" && !(Number(amount) > 0)) { setError("Pick an invoice or enter an amount"); return; }
    setBusy("generate"); setError(""); setCopied(""); setResult(null);
    try {
      const body = { email, minutes };
      if (mode === "payment") {
        body.amount = Number(amount);
        body.invoiceNumber = picked?.invoice_number || null;
        body.reference = picked ? `Invoice ${picked.invoice_number}` : "Wholesale order";
        const total = items.reduce((s, i) => s + (Number(i.amount) || 0), 0);
        if (items.length && Math.abs(total - Number(amount)) < 0.01) body.items = items;
      }
      const r = await fetch("/api/wholesale/portal-link", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const j = await r.json();
      if (r.ok) { setResult(j); loadLinks(); } else setError(j.error || "Could not create link");
    } catch { setError("Could not create link"); } finally { setBusy(""); }
  };

  const copy = (text, key) => {
    navigator.clipboard.writeText(text);
    setCopied(key); setTimeout(() => setCopied(""), 2000);
  };

  const message = result
    ? mode === "payment"
      ? `Hi, here's a secure link to pay ${usd(amount)}${picked ? ` for invoice ${picked.invoice_number}` : ""}. You'll see every item on the order, and you can pay with the card we have on file or a new one. The link opens once and expires in ${minutes} minutes: ${result.url}`
      : `Hi, here's a secure link to add or update the card we keep on file for your wholesale account. It opens once and expires in ${minutes} minutes: ${result.url}`
    : "";

  const input = { width: "100%", padding: 12, border: "1px solid #ccc", borderRadius: 6, fontSize: 15 };
  const tab = (active) => ({
    flex: 1, padding: "11px 16px", cursor: "pointer", fontWeight: 600, fontSize: 14,
    background: active ? "#000" : "#fff", color: active ? "#fff" : "#555",
    border: "1px solid " + (active ? "#000" : "#ccc"), borderRadius: 6,
  });
  const itemsTotal = items.reduce((s, i) => s + (Number(i.amount) || 0), 0);

  return (
    <div style={{ maxWidth: 820, margin: "0 auto", padding: 24 }}>
      <h1 style={{ margin: "0 0 4px" }}>Payment Links</h1>
      <p style={{ color: "#666", margin: "0 0 24px" }}>
        Single-use links you can text or email. They die after one open.
      </p>

      <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
        <button onClick={() => { setMode("cards"); setResult(null); }} style={tab(mode === "cards")}>Manage cards</button>
        <button onClick={() => { setMode("payment"); setResult(null); }} style={tab(mode === "payment")}>Request a payment</button>
      </div>

      <div style={{ border: "1px solid #e5e5e5", borderRadius: 8, padding: 20, marginBottom: 28 }}>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div style={{ flex: "1 1 280px" }}>
            <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Customer email</label>
            <input value={email} onChange={(e) => setEmail(e.target.value.trim())} placeholder="customer@example.com" style={input} />
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

        {mode === "payment" && !picked && (
          <div style={{ marginTop: 16 }}>
            <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
              Find an invoice
            </label>
            <input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Invoice number, order number, or customer name" style={input} />
            <div style={{ marginTop: 10, border: invoices.length ? "1px solid #eee" : "none", borderRadius: 6, maxHeight: 260, overflowY: "auto" }}>
              {invoices.map((inv) => (
                <div key={inv.invoice_number} onClick={() => pickInvoice(inv)}
                  style={{ padding: "10px 12px", borderBottom: "1px solid #f2f2f2", cursor: "pointer", display: "flex", gap: 12, alignItems: "center", fontSize: 14 }}>
                  <div style={{ fontWeight: 600, width: 90 }}>{inv.invoice_number}</div>
                  <div style={{ flex: 1, minWidth: 0, color: "#555", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {inv.customer_name}
                  </div>
                  <div style={{ color: "#999", fontSize: 12, whiteSpace: "nowrap" }}>
                    {inv.invoice_date ? new Date(inv.invoice_date).toLocaleDateString() : ""}
                  </div>
                  <div style={{ fontWeight: 600, whiteSpace: "nowrap" }}>{usd(inv.balance_due)}</div>
                </div>
              ))}
              {!invoices.length && search && (
                <p style={{ color: "#888", fontSize: 14, margin: "8px 0 0" }}>No matching invoices.</p>
              )}
            </div>
            {!search && (
              <p style={{ color: "#999", fontSize: 12, marginTop: 8 }}>
                Showing recent invoices with a balance. Type to search all.
              </p>
            )}
          </div>
        )}

        {mode === "payment" && picked && (
          <div style={{ marginTop: 16, border: "1px solid #e5e5e5", borderRadius: 8, overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", background: "#fafafa" }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700 }}>Invoice {picked.invoice_number}</div>
                <div style={{ color: "#666", fontSize: 13, marginTop: 2 }}>
                  {picked.customer_name}
                  {picked.payment_status ? ` · ${picked.payment_status}` : ""}
                </div>
              </div>
              <button onClick={clearInvoice}
                style={{ background: "none", border: 0, color: "#b71c1c", cursor: "pointer", fontWeight: 600, fontSize: 13 }}>
                Change
              </button>
            </div>

            <div style={{ maxHeight: 240, overflowY: "auto" }}>
              {items.map((it, i) => (
                <div key={i} style={{ display: "flex", gap: 12, alignItems: "center", padding: "10px 16px", borderTop: "1px solid #f2f2f2", fontSize: 13 }}>
                  {it.imageUrl
                    ? <img src={it.imageUrl} alt="" style={{ width: 38, height: 48, objectFit: "cover", borderRadius: 4, background: "#eee" }} />
                    : <div style={{ width: 38, height: 48, borderRadius: 4, background: "#eee" }} />}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600 }}>{it.styleNumber}</div>
                    <div style={{ color: "#888", fontSize: 12 }}>
                      {[it.description, it.color, it.size].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                  <div style={{ color: "#666", whiteSpace: "nowrap" }}>×{it.qty}</div>
                  <div style={{ fontWeight: 600, whiteSpace: "nowrap" }}>{usd(it.amount)}</div>
                </div>
              ))}
              {!items.length && (
                <p style={{ color: "#888", fontSize: 13, padding: "12px 16px", margin: 0 }}>
                  No line items found for this invoice. The link will still work, showing the amount only.
                </p>
              )}
            </div>

            <div style={{ display: "flex", gap: 12, alignItems: "flex-end", padding: 16, borderTop: "1px solid #eee" }}>
              <div style={{ width: 170 }}>
                <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Amount to request</label>
                <input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                  inputMode="decimal" style={input} />
              </div>
              <div style={{ flex: 1, fontSize: 12, color: "#888", paddingBottom: 12 }}>
                Balance due {usd(picked.balance_due)}
                {items.length ? ` · items total ${usd(itemsTotal)}` : ""}
                {items.length && Math.abs(itemsTotal - Number(amount)) >= 0.01
                  ? " · amount differs from items, the customer will see the amount only"
                  : ""}
              </div>
            </div>
          </div>
        )}

        <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
          <button onClick={generate} disabled={busy === "generate"}
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
            {cards.length === 0
              ? <p style={{ color: "#888", margin: 0, fontSize: 14 }}>No cards on file for this customer.</p>
              : cards.map((c) => (
                <div key={c.id} style={{ fontSize: 14, color: "#333", marginBottom: 6 }}>
                  {BRAND[c.brand] || c.brand} ending {c.last4} · expires {String(c.expMonth).padStart(2, "0")}/{String(c.expYear).slice(-2)}
                  {c.isDefault && <span style={{ color: "#1b5e20", fontWeight: 600 }}> · default</span>}
                </div>
              ))}
          </div>
        )}

        {result && (
          <div style={{ marginTop: 18, background: "#f7f7f7", borderRadius: 6, padding: 16 }}>
            <div style={{ fontSize: 13, color: "#666", marginBottom: 8 }}>
              {result.amount ? `Requesting ${usd(result.amount)}. ` : ""}
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
              <a href={`mailto:${email}?subject=${encodeURIComponent(mode === "payment" ? `Payment link${picked ? ` for invoice ${picked.invoice_number}` : ""}` : "Update your card on file")}&body=${encodeURIComponent(message)}`}
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
              {l.invoice_number ? <span style={{ color: "#999" }}> · inv {l.invoice_number}</span> : null}
            </div>
            {l.amount_cents ? <div style={{ fontWeight: 600, whiteSpace: "nowrap" }}>{cents(l.amount_cents)}</div> : null}
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
