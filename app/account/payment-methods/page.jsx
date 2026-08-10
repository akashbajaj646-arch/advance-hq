"use client";
// app/account/payment-methods/page.jsx
// Customer-facing payment page. Renders as a fixed full-viewport surface so
// it escapes the Advance HQ shell entirely, and mirrors Stripe Checkout's
// split layout so the handoff to Stripe feels like one continuous flow.

import { useEffect, useState } from "react";

const BRAND = {
  visa: "Visa", mastercard: "Mastercard", amex: "American Express",
  discover: "Discover", diners: "Diners Club", jcb: "JCB", unionpay: "UnionPay",
};

const money = (cents, currency = "usd") =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(
    (Number(cents) || 0) / 100
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
  const [broken, setBroken] = useState({});

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
          error: ok ? "" : j.error || "We couldn't load this page.",
          email: j.email || "",
          cards: j.cards || [],
          pay: j.pay || null,
          invoice: j.invoice || null,
        });
      })
      .catch(() =>
        setState({ loading: false, error: "Check your connection and reload the page.", email: "", cards: [], pay: null, invoice: null })
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
      else setState((s) => ({ ...s, error: j.error || "That didn't go through. Try again." }));
    } catch {
      setState((s) => ({ ...s, error: "Check your connection and try again." }));
    } finally {
      setBusy("");
    }
  };

  const showPay = state.pay && state.pay.amount > 0 && !paid;
  const items = state.invoice?.items || [];
  const subtotal = items.reduce((s, i) => s + (Number(i.amount) || 0), 0);
  const due = state.pay ? state.pay.amount / 100 : 0;
  const hasAdjustments = items.length > 0 && Math.abs(subtotal - due) >= 0.01;

  return (
    <div className="aa-root">
      <style>{`
        .aa-root{position:fixed;inset:0;z-index:9999;overflow-y:auto;background:#fff;
          color:#0A2540;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
          -webkit-font-smoothing:antialiased;font-variant-numeric:tabular-nums;}
        .aa-grid{display:grid;grid-template-columns:1fr;min-height:100%;}
        .aa-summary{background:#F6F9FC;border-bottom:1px solid #E6EBF1;padding:32px 24px 28px;}
        .aa-action{padding:32px 24px 56px;}
        .aa-inner{max-width:420px;margin:0 auto;width:100%;}
        .aa-brand{font-size:13px;font-weight:600;letter-spacing:.02em;color:#425466;margin:0 0 26px;}
        .aa-label{font-size:13px;color:#425466;margin:0 0 6px;}
        .aa-amount{font-size:38px;font-weight:700;letter-spacing:-.02em;line-height:1.05;margin:0;}
        .aa-ref{font-size:14px;color:#425466;margin:8px 0 0;}
        .aa-items{margin:26px 0 0;border-top:1px solid #E6EBF1;}
        .aa-row{display:flex;gap:14px;align-items:center;padding:14px 0;border-bottom:1px solid #E6EBF1;}
        .aa-thumb{width:52px;height:69px;flex:0 0 52px;border-radius:4px;object-fit:cover;
          background:#E6EBF1;cursor:zoom-in;display:block;}
        .aa-ph{width:52px;height:69px;flex:0 0 52px;border-radius:4px;background:#E6EBF1;}
        .aa-name{font-size:14px;font-weight:600;margin:0;}
        .aa-desc{font-size:13px;color:#425466;margin:2px 0 0;line-height:1.4;}
        .aa-meta{font-size:12px;color:#8792A2;margin:4px 0 0;}
        .aa-line{font-size:14px;font-weight:600;white-space:nowrap;}
        .aa-tot{display:flex;justify-content:space-between;font-size:14px;color:#425466;padding:8px 0;}
        .aa-tot--final{color:#0A2540;font-weight:700;border-top:1px solid #E6EBF1;margin-top:6px;padding-top:14px;}
        .aa-btn{width:100%;padding:14px 18px;border:0;border-radius:6px;background:#0A2540;color:#fff;
          font-size:15px;font-weight:600;cursor:pointer;transition:background .15s ease;}
        .aa-btn:hover:not(:disabled){background:#1B3A5C;}
        .aa-btn:disabled{opacity:.55;cursor:default;}
        .aa-btn--ghost{background:#fff;color:#0A2540;border:1px solid #D5DDE6;font-weight:600;}
        .aa-btn--ghost:hover:not(:disabled){background:#F6F9FC;}
        .aa-note{font-size:12px;color:#8792A2;text-align:center;line-height:1.6;margin:14px 0 0;}
        .aa-h2{font-size:13px;font-weight:600;color:#425466;letter-spacing:.02em;margin:34px 0 12px;}
        .aa-card{border:1px solid #E6EBF1;border-radius:6px;padding:14px 16px;margin:0 0 10px;}
        .aa-card b{font-size:14px;font-weight:600;}
        .aa-card span{display:block;font-size:12px;color:#8792A2;margin-top:3px;}
        .aa-tag{display:inline-block;margin-left:8px;font-size:10px;font-weight:700;letter-spacing:.06em;
          background:#E3F1E6;color:#1B7A3D;padding:3px 7px;border-radius:3px;vertical-align:1px;}
        .aa-alert{padding:14px 16px;border-radius:6px;font-size:14px;line-height:1.6;margin:0 0 22px;}
        .aa-alert--bad{background:#FDEDED;color:#9E2146;}
        .aa-alert--good{background:#E3F1E6;color:#1B7A3D;}
        .aa-empty{border:1px dashed #D5DDE6;border-radius:6px;padding:26px;text-align:center;
          color:#8792A2;font-size:14px;margin:0 0 10px;}
        .aa-box{position:fixed;inset:0;background:rgba(10,37,64,.88);display:flex;align-items:center;
          justify-content:center;padding:24px;z-index:10000;cursor:zoom-out;}
        .aa-box img{max-width:min(520px,100%);max-height:76vh;object-fit:contain;border-radius:6px;display:block;margin:0 auto;}
        .aa-root :focus-visible{outline:2px solid #0A66C2;outline-offset:2px;}
        @media (min-width:900px){
          .aa-grid{grid-template-columns:1fr 1fr;}
          .aa-summary{border-bottom:0;border-right:1px solid #E6EBF1;padding:64px 48px;}
          .aa-action{padding:64px 48px;}
          .aa-inner{max-width:400px;margin:0;}
          .aa-summary .aa-inner{margin-left:auto;margin-right:48px;}
          .aa-amount{font-size:42px;}
        }
        @media (prefers-reduced-motion:reduce){.aa-btn{transition:none;}}
      `}</style>

      <div className="aa-grid">
        <section className="aa-summary">
          <div className="aa-inner">
            <p className="aa-brand">ADVANCE APPARELS</p>

            {state.loading && <p style={{ color: "#8792A2", fontSize: 14 }}>Loading…</p>}

            {showPay && (
              <>
                <p className="aa-label">Amount due</p>
                <p className="aa-amount">{money(state.pay.amount, state.pay.currency)}</p>
                <p className="aa-ref">
                  {state.invoice?.invoiceNumber
                    ? `Invoice ${state.invoice.invoiceNumber}`
                    : state.pay.reference}
                </p>
              </>
            )}

            {!showPay && !state.loading && (
              <>
                <p className="aa-label">Your account</p>
                <p className="aa-amount" style={{ fontSize: 24 }}>Payment methods</p>
                <p className="aa-ref">{state.email}</p>
              </>
            )}

            {showPay && items.length > 0 && (
              <div className="aa-items">
                {items.map((it, i) => (
                  <div className="aa-row" key={i}>
                    {it.imageUrl && !broken[i] ? (
                      <img
                        className="aa-thumb"
                        src={it.imageUrl}
                        alt=""
                        onError={() => setBroken((b) => ({ ...b, [i]: true }))}
                        onClick={() => setLightbox(it)}
                      />
                    ) : (
                      <div className="aa-ph" />
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p className="aa-name">{it.styleNumber || "Item"}</p>
                      {it.description && <p className="aa-desc">{it.description}</p>}
                      <p className="aa-meta">
                        {[it.color, it.size].filter(Boolean).join(" · ")}
                        {(it.color || it.size) && " · "}
                        {it.qty} at {dollars(it.unitPrice)}
                      </p>
                    </div>
                    <div className="aa-line">{dollars(it.amount)}</div>
                  </div>
                ))}

                {hasAdjustments && (
                  <>
                    <div className="aa-tot"><span>Items</span><span>{dollars(subtotal)}</span></div>
                    <div className="aa-tot">
                      <span>Shipping and tax</span><span>{dollars(due - subtotal)}</span>
                    </div>
                  </>
                )}
                <div className="aa-tot aa-tot--final"><span>Total</span><span>{dollars(due)}</span></div>
              </div>
            )}
          </div>
        </section>

        <section className="aa-action">
          <div className="aa-inner">
            {paid && (
              <div className="aa-alert aa-alert--good">
                Payment received. Your receipt is on its way by email.
              </div>
            )}

            {state.error && <div className="aa-alert aa-alert--bad">{state.error}</div>}

            {showPay && (
              <>
                <button className="aa-btn" onClick={() => go("/api/account/pay", "pay")} disabled={busy === "pay"}>
                  {busy === "pay" ? "Opening secure checkout…" : `Pay ${money(state.pay.amount, state.pay.currency)}`}
                </button>
                <p className="aa-note">
                  Continue to Stripe to pay with a saved card, a new card, Link, Apple Pay, or Google Pay.
                </p>
              </>
            )}

            {!state.loading && !state.error && (
              <>
                <p className="aa-h2">CARDS ON FILE</p>

                {state.cards.length === 0 && (
                  <div className="aa-empty">No cards saved yet.</div>
                )}

                {state.cards.map((c) => (
                  <div className="aa-card" key={c.id}>
                    <b>
                      {BRAND[c.brand] || c.brand} •••• {c.last4}
                      {c.isDefault && <span className="aa-tag">DEFAULT</span>}
                    </b>
                    <span>Expires {String(c.expMonth).padStart(2, "0")}/{String(c.expYear).slice(-2)}</span>
                  </div>
                ))}

                <button
                  className={`aa-btn ${showPay ? "aa-btn--ghost" : ""}`}
                  onClick={() => go("/api/account/payment-methods", "portal")}
                  disabled={busy === "portal"}
                  style={{ marginTop: 4 }}>
                  {busy === "portal"
                    ? "Opening…"
                    : state.cards.length
                    ? "Manage cards"
                    : "Add a card"}
                </button>

                <p className="aa-note">
                  Card details are entered on Stripe and never stored on our servers.
                </p>
              </>
            )}
          </div>
        </section>
      </div>

      {lightbox && (
        <div className="aa-box" onClick={() => setLightbox(null)}>
          <div>
            <img src={lightbox.imageUrl} alt={lightbox.description || lightbox.styleNumber || ""} />
            <p style={{ color: "#fff", textAlign: "center", marginTop: 14, fontSize: 15, fontWeight: 600 }}>
              {lightbox.styleNumber}
            </p>
            <p style={{ color: "#B8C4D0", textAlign: "center", marginTop: 4, fontSize: 13 }}>
              {[lightbox.description, lightbox.color, lightbox.size].filter(Boolean).join(" · ")}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
