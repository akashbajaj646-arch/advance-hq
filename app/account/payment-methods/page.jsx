"use client";
// app/account/payment-methods/page.jsx
// Customer-facing. The link token is exchanged for a short browser session
// on first load, then stripped from the address bar. If the link carried a
// payment request, the amount due is shown with a Pay button that opens
// Stripe Checkout (saved cards, Link, Apple Pay, Google Pay, new card).

import { useEffect, useState } from "react";

const BRAND = {
  visa: "Visa", mastercard: "Mastercard", amex: "American Express",
  discover: "Discover", diners: "Diners Club", jcb: "JCB", unionpay: "UnionPay",
};

const money = (cents, currency = "usd") =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(
    cents / 100
  );

export default function PaymentMethods() {
  const [state, setState] = useState({ loading: true, error: "", email: "", cards: [], pay: null });
  const [busy, setBusy] = useState("");
  const [paid, setPaid] = useState(false);

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
        });
      })
      .catch(() =>
        setState({ loading: false, error: "Network error. Please try again.", email: "", cards: [], pay: null })
      );
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

  return (
    <div style={{ maxWidth: 620, margin: "0 auto", padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ margin: "0 0 4px", fontSize: 26 }}>
        {showPay ? "Complete Your Payment" : "Payment Methods"}
      </h1>
      <p style={{ color: "#666", margin: "0 0 28px" }}>
        {state.email
          ? `Account: ${state.email}`
          : "Manage the cards we keep on file for your wholesale orders."}
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
        <div style={{ border: "2px solid #000", borderRadius: 10, padding: 24, marginBottom: 28 }}>
          <div style={{ color: "#666", fontSize: 13, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 6 }}>
            Amount due
          </div>
          <div style={{ fontSize: 38, fontWeight: 700, lineHeight: 1.1 }}>
            {money(state.pay.amount, state.pay.currency)}
          </div>
          {state.pay.reference && (
            <div style={{ color: "#555", marginTop: 8 }}>{state.pay.reference}</div>
          )}
          <button
            onClick={() => go("/api/account/pay", "pay")}
            disabled={busy === "pay"}
            style={{ marginTop: 20, width: "100%", padding: 16, background: "#000", color: "#fff", border: 0, borderRadius: 6, fontWeight: 600, fontSize: 16, cursor: "pointer", opacity: busy === "pay" ? 0.6 : 1 }}>
            {busy === "pay" ? "Opening secure checkout..." : "Pay now"}
          </button>
          <p style={{ color: "#888", fontSize: 12, marginTop: 12, textAlign: "center", lineHeight: 1.6 }}>
            Pay with a saved card, a new card, Link, Apple Pay, or Google Pay.
          </p>
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
            {busy === "portal"
              ? "Opening..."
              : state.cards.length
              ? "Add, update, or remove a card"
              : "Add a card"}
          </button>
        </>
      )}

      <p style={{ color: "#999", fontSize: 12, marginTop: 18, textAlign: "center", lineHeight: 1.6 }}>
        Card details are entered on Stripe's secure pages and are never stored on our servers.
      </p>
    </div>
  );
}
