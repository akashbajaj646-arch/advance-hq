"use client";
// app/account/payment-methods/page.jsx
// Customer-facing. The link token is exchanged for a short browser session
// on first load, then removed from the address bar so it can't be shared
// or land in history. Card removal happens inside Stripe's portal.

import { useEffect, useState } from "react";

const BRAND = {
  visa: "Visa", mastercard: "Mastercard", amex: "American Express",
  discover: "Discover", diners: "Diners Club", jcb: "JCB", unionpay: "UnionPay",
};

export default function PaymentMethods() {
  const [state, setState] = useState({ loading: true, error: "", email: "", cards: [] });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");
    const url = token
      ? `/api/account/payment-methods?token=${encodeURIComponent(token)}`
      : "/api/account/payment-methods";

    fetch(url, { credentials: "include" })
      .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => {
        // Burn the token from the address bar once it has been exchanged
        if (token) window.history.replaceState({}, "", window.location.pathname);
        setState({
          loading: false,
          error: ok ? "" : j.error || "Could not load your cards",
          email: j.email || "",
          cards: j.cards || [],
        });
      })
      .catch(() =>
        setState({ loading: false, error: "Network error. Please try again.", email: "", cards: [] })
      );
  }, []);

  const openPortal = async () => {
    setBusy(true);
    try {
      const r = await fetch("/api/account/payment-methods", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({}),
      });
      const j = await r.json();
      if (j.url) window.location.href = j.url;
      else setState((s) => ({ ...s, error: j.error || "Could not open the card manager" }));
    } catch {
      setState((s) => ({ ...s, error: "Network error. Please try again." }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ maxWidth: 620, margin: "0 auto", padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ margin: "0 0 4px", fontSize: 26 }}>Payment Methods</h1>
      <p style={{ color: "#666", margin: "0 0 28px" }}>
        {state.email
          ? `Cards on file for ${state.email}. We use these to process your wholesale orders on terms.`
          : "Manage the cards we keep on file for your wholesale orders."}
      </p>

      {state.loading && <p style={{ color: "#888" }}>Loading your cards...</p>}

      {state.error && (
        <div style={{ background: "#fdecea", color: "#b71c1c", padding: 16, borderRadius: 8, marginBottom: 20, lineHeight: 1.6 }}>
          {state.error}
        </div>
      )}

      {!state.loading && !state.error && state.cards.length === 0 && (
        <div style={{ border: "1px dashed #ccc", borderRadius: 8, padding: 36, textAlign: "center", color: "#888", marginBottom: 20 }}>
          No cards on file yet.
        </div>
      )}

      {state.cards.map((c) => (
        <div key={c.id} style={{ border: "1px solid #e5e5e5", borderRadius: 8, padding: 18, marginBottom: 12 }}>
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

      {!state.loading && !state.error && (
        <button onClick={openPortal} disabled={busy}
          style={{ marginTop: 16, width: "100%", padding: 15, background: "#000", color: "#fff", border: 0, borderRadius: 6, fontWeight: 600, fontSize: 16, cursor: "pointer", opacity: busy ? 0.6 : 1 }}>
          {busy ? "Opening..." : state.cards.length ? "Add, update, or remove a card" : "Add a card"}
        </button>
      )}

      <p style={{ color: "#999", fontSize: 12, marginTop: 18, textAlign: "center", lineHeight: 1.6 }}>
        Card details are entered on Stripe's secure page and are never stored on our servers.
      </p>
    </div>
  );
}
