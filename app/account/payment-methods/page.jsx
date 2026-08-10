"use client";
// app/account/payment-methods/page.jsx
// Customer-facing. The link token is exchanged for a short browser session
// on first load, then stripped from the address bar. When the link carries
// an invoice, the customer sees every line with a thumbnail they can tap
// to enlarge, so there is no doubt what they are paying for.

import { useEffect, useState } from "react";

const BRAND = {
  visa: "Visa", mastercard: "Mastercard", amex: "American Express",
  discover: "Discover", diners: "Diners Club", jcb: "JCB", unionpay: "UnionPay",
};

const money = (cents, currency = "usd") =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(
    cents / 100
  );
const dollars = (n) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(n) || 0);

export default function PaymentMethods() {
  const [state, setState] = useState({
    loading: true, error: "", email: "", cards: [], pay: null, invoice: null,
  });
  const [busy, setBusy] = useState("");
  const [paid, setPaid] = useState(false);
  const [lightbox, setLightbox] = useState(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");
    if (params.get("paid") === "1") setPaid(true);

    const url = token
      ? `/api/account/payment-methods?token=${encodeURIComponent(token)}`
      : "/api/account/payment-methods";

    fetch(url, { credentials: "include" })
      .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => {
        window.history.replaceState({}, "", window.location.pathname);
        setState({
          loading: false,
          error: ok ? "" : j.error || "Could not load your cards",
          email: j.email || "",
          cards: j.cards || [],
          pay: j.pay || null,
          invoice: j.invoice || null,
        });
      })
      .catch(() =>
        setState({ loading: false, error: "Network error. Please try again.", email: "", cards: [], pay: null, invoice: null })
      );
  }, []);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && setLightbox(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const go = async (endpoint, key) => {
    setBusy(key);
    try {
      const r = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({}),
      });
      const j = await r.json();
      if (j.url) window.location.href = j.url;
      else setState((s) => ({ ...s, error: j.error || "Something went wrong" }));
    } catch {
      setState((s) => ({ ...s, error: "Network error. Please try again." }));
    } finally {
      setBusy("");
    }
  };

  const showPay = state.pay && state.pay.amount > 0 && !paid;
  const items = state.invoice?.items || [];

  return (
    <div style={{ maxWidth: 660, margin: "0 auto", padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ margin: "0 0 4px", fontSize: 26 }}>
        {showPay ? "Complete Your Payment" : "Payment Methods"}
      </h1>
      <p style={{ color: "#666", margin: "0 0 26px" }}>
        {state.email ? `Account: ${state.email}` : "Manage the cards we keep on file."}
      </p>

      {paid && (
        <div style={{ background: "#e8f5e9", color: "#1b5e20", padding: 16, borderRadius: 8, marginBottom: 20, lineHeight: 1.6 }}>
          Payment received. Thank you! A receipt is on its way to your email.
        </div>
      )}

      {state.loading && <p style={{ color: "#888" }}>Loading...</p>}

      {state.error && (
        <div style={{ background: "#fdecea", color: "#b71c1c", padding: 16, borderRadius: 8, marginBottom: 20, lineHeight: 1.6 }}>
          {state.error}
        </div>
      )}

      {showPay && (
        <div style={{ border: "2px solid #000", borderRadius: 10, overflow: "hidden", marginBottom: 28 }}>
          <div style={{ padding: "22px 22px 18px" }}>
            <div style={{ color: "#666", fontSize: 12, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 6 }}>
              Amount due
            </div>
            <div style={{ fontSize: 38, fontWeight: 700, lineHeight: 1.1 }}>
              {money(state.pay.amount, state.pay.currency)}
            </div>
            <div style={{ color: "#555", marginTop: 8 }}>
              {state.invoice?.invoiceNumber
                ? `Invoice ${state.invoice.invoiceNumber}`
                : state.pay.reference}
            </div>
          </div>

          {items.length > 0 && (
            <div style={{ borderTop: "1px solid #eee", background: "#fafafa" }}>
              <div style={{ padding: "14px 22px 6px", fontSize: 12, fontWeight: 700, color: "#666", textTransform: "uppercase", letterSpacing: 0.8 }}>
                {items.length} item{items.length === 1 ? "" : "s"}
              </div>
              <div style={{ maxHeight: 420, overflowY: "auto" }}>
                {items.map((it, idx) => (
                  <div key={idx} style={{ display: "flex", gap: 14, alignItems: "center", padding: "12px 22px", borderTop: idx ? "1px solid #eee" : "none" }}>
                    {it.imageUrl ? (
                      <img
                        src={it.imageUrl}
                        alt={it.description || it.styleNumber || "Item"}
                        onClick={() => setLightbox(it)}
                        style={{ width: 58, height: 74, objectFit: "cover", borderRadius: 5, cursor: "zoom-in", flexShrink: 0, background: "#eee" }}
                      />
                    ) : (
                      <div style={{ width: 58, height: 74, borderRadius: 5, background: "#eee", flexShrink: 0 }} />
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{it.styleNumber || "Item"}</div>
                      {it.description && (
                        <div style={{ color: "#555", fontSize: 13, marginTop: 2 }}>{it.description}</div>
                      )}
                      <div style={{ color: "#888", fontSize: 12, marginTop: 3 }}>
                        {[it.color, it.size].filter(Boolean).join(" / ")}
                        {(it.color || it.size) && " · "}
                        Qty {it.qty} @ {dollars(it.unitPrice)}
                      </div>
                    </div>
                    <div style={{ fontWeight: 600, fontSize: 14, whiteSpace: "nowrap" }}>
                      {dollars(it.amount)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={{ padding: 22, borderTop: "1px solid #eee" }}>
            <button
              onClick={() => go("/api/account/pay", "pay")}
              disabled={busy === "pay"}
              style={{ width: "100%", padding: 16, background: "#000", color: "#fff", border: 0, borderRadius: 6, fontWeight: 600, fontSize: 16, cursor: "pointer", opacity: busy === "pay" ? 0.6 : 1 }}>
              {busy === "pay" ? "Opening secure checkout..." : `Pay ${money(state.pay.amount, state.pay.currency)}`}
            </button>
            <p style={{ color: "#888", fontSize: 12, marginTop: 12, textAlign: "center", lineHeight: 1.6 }}>
              Pay with a saved card, a new card, Link, Apple Pay, or Google Pay.
            </p>
          </div>
        </div>
      )}

      {!state.loading && !state.error && (
        <>
          <h2 style={{ fontSize: 16, margin: "0 0 12px", color: "#333" }}>Cards on file</h2>

          {state.cards.length === 0 && (
            <div style={{ border: "1px dashed #ccc", borderRadius: 8, padding: 30, textAlign: "center", color: "#888", marginBottom: 16 }}>
              No cards on file yet.
            </div>
          )}

          {state.cards.map((c) => (
            <div key={c.id} style={{ border: "1px solid #e5e5e5", borderRadius: 8, padding: 16, marginBottom: 10 }}>
              <div style={{ fontWeight: 600 }}>
                {BRAND[c.brand] || c.brand} ending in {c.last4}
                {c.isDefault && (
                  <span style={{ marginLeft: 10, fontSize: 11, background: "#eef6ee", color: "#1b5e20", padding: "3px 8px", borderRadius: 20, fontWeight: 700, letterSpacing: 0.4 }}>
                    DEFAULT
                  </span>
                )}
              </div>
              <div style={{ color: "#777", fontSize: 13, marginTop: 3 }}>
                Expires {String(c.expMonth).padStart(2, "0")}/{String(c.expYear).slice(-2)}
              </div>
            </div>
          ))}

          <button
            onClick={() => go("/api/account/payment-methods", "portal")}
            disabled={busy === "portal"}
            style={{ marginTop: 8, width: "100%", padding: 14, background: showPay ? "#fff" : "#000", color: showPay ? "#333" : "#fff", border: showPay ? "1px solid #ccc" : 0, borderRadius: 6, fontWeight: 600, fontSize: 15, cursor: "pointer", opacity: busy === "portal" ? 0.6 : 1 }}>
            {busy === "portal" ? "Opening..." : state.cards.length ? "Add, update, or remove a card" : "Add a card"}
          </button>
        </>
      )}

      <p style={{ color: "#999", fontSize: 12, marginTop: 18, textAlign: "center", lineHeight: 1.6 }}>
        Card details are entered on Stripe's secure pages and are never stored on our servers.
      </p>

      {lightbox && (
        <div
          onClick={() => setLightbox(null)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.85)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, zIndex: 1000, cursor: "zoom-out" }}>
          <div style={{ maxWidth: 560, width: "100%", textAlign: "center" }}>
            <img
              src={lightbox.imageUrl}
              alt={lightbox.description || lightbox.styleNumber || "Item"}
              style={{ maxWidth: "100%", maxHeight: "78vh", objectFit: "contain", borderRadius: 8 }}
            />
            <div style={{ color: "#fff", marginTop: 14, fontSize: 15, fontWeight: 600 }}>
              {lightbox.styleNumber}
            </div>
            <div style={{ color: "#ccc", fontSize: 13, marginTop: 4 }}>
              {[lightbox.description, lightbox.color, lightbox.size].filter(Boolean).join(" · ")}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
