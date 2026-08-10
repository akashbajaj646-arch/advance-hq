"use client";
// app/account/payment-methods/page.jsx
// Customer-facing. Auth comes from ?token= in the URL, so this page is
// public in middleware. Reads the token from window.location to avoid
// useSearchParams (no Suspense boundary needed at build time).

import { useEffect, useState } from "react";

const BRAND = {
  visa: "Visa", mastercard: "Mastercard", amex: "American Express",
  discover: "Discover", diners: "Diners Club", jcb: "JCB", unionpay: "UnionPay",
};

export default function PaymentMethods() {
  const [token, setToken] = useState(null);
  const [state, setState] = useState({ loading: true, error: "", email: "", cards: [] });
  const [busy, setBusy] = useState("");

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("token");
    setToken(t);
    if (!t) {
      setState({ loading: false, error: "This link is missing its access code.", email: "", cards: [] });
      return;
    }
    load(t);
  }, []);

  const load = (t) =>
    fetch(`/api/account/payment-methods?token=${encodeURIComponent(t)}`)
      .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
      .then(({ ok, j }) =>
        setState({
          loading: false,
          error: ok ? "" : j.error || "Could not load your cards",
          email: j.email || "",
          cards: j.cards || [],
        })
      )
      .catch(() =>
        setState((s) => ({ ...s, loading: false, error: "Network error. Please try again." }))
      );

  const openPortal = async () => {
    setBusy("portal");
    try {
      const r = await fetch(`/api/account/payment-methods?token=${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const j = await r.json();
      if (j.url) window.location.href = j.url;
      else setState((s) => ({ ...s, error: j.error || "Could not open the card manager" }));
    } catch {
      setState((s) => ({ ...s, error: "Network error. Please try again." }));
    } finally {
      setBusy("");
    }
  };

  const removeCard = async (id) => {
    if (!confirm("Remove this card from your account?")) return;
    setBusy(id);
    try {
      const r = await fetch(`/api/account/payment-methods?token=${encodeURIComponent(token)}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentMethodId: id }),
      });
      const j = await r.json();
      if (r.ok) setState((s) => ({ ...s, cards: s.cards.filter((c) => c.id !== id) }));
      else setState((s) => ({ ...s, error: j.error || "Could not remove that card" }));
    } finally {
      setBusy("");
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
        <div style={{ background: "#fdecea", color: "#b71c1c", padding: 14, borderRadius: 8, marginBottom: 20 }}>
          {state.error}
        </div>
      )}

      {!state.loading && !state.error && state.cards.length === 0 && (
        <div style={{ border: "1px dashed #ccc", borderRadius: 8, padding: 36, textAlign: "center", color: "#888", marginBottom: 20 }}>
          No cards on file yet.
        </div>
      )}

      {state.cards.map((c) => (
        <div key={c.id} style={{ border: "1px solid #e5e5e5", borderRadius: 8, padding: 18, marginBottom: 12, display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ flex: 1 }}>
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
          <button
            onClick={() => removeCard(c.id)}
            disabled={busy === c.id}
            style={{ background: "none", border: 0, color: "#b71c1c", cursor: "pointer", fontSize: 14, fontWeight: 600 }}>
            {busy === c.id ? "Removing..." : "Remove"}
          </button>
        </div>
      ))}

      {!state.loading && token && (
        <button
          onClick={openPortal}
          disabled={busy === "portal"}
          style={{ marginTop: 16, width: "100%", padding: 15, background: "#000", color: "#fff", border: 0, borderRadius: 6, fontWeight: 600, fontSize: 16, cursor: "pointer" }}>
          {busy === "portal" ? "Opening..." : state.cards.length ? "Add or update a card" : "Add a card"}
        </button>
      )}

      <p style={{ color: "#999", fontSize: 12, marginTop: 18, textAlign: "center", lineHeight: 1.6 }}>
        Card details are entered on Stripe's secure page and are never stored on our servers.
      </p>
    </div>
  );
}
