// lib/customerToken.js
// Two credentials, both HMAC-signed, no dependencies:
//   1. Link token  - single use, short lived, travels in a URL
//   2. Session cookie - set after a link token is consumed, browser bound
//
// A link token may also carry a payment request (amount, currency,
// reference). Because the payload is signed, the amount cannot be
// edited by the recipient.
//
// Env: CUSTOMER_TOKEN_SECRET

import crypto from "crypto";

const DEFAULT_LINK_TTL = 30 * 60;
const SESSION_TTL = 30 * 60;
export const SESSION_COOKIE = "ahq_cust";

const b64url = (buf) =>
  Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64url = (s) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

function secret() {
  const s = process.env.CUSTOMER_TOKEN_SECRET;
  if (!s) throw new Error("CUSTOMER_TOKEN_SECRET is not set");
  return s;
}

function sign(payload, kind) {
  return b64url(crypto.createHmac("sha256", secret()).update(`${kind}:${payload}`).digest());
}

function verify(token, kind) {
  try {
    const [payload, sig] = String(token || "").split(".");
    if (!payload || !sig) return null;
    const a = Buffer.from(sig);
    const b = Buffer.from(sign(payload, kind));
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const data = JSON.parse(unb64url(payload));
    if (!data.exp || data.exp < Math.floor(Date.now() / 1000)) return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * Single-use link token.
 * pay: optional { amount (cents), currency, reference }
 */
export function createLinkToken(email, ttlSeconds = DEFAULT_LINK_TTL, pay = null) {
  const clean = String(email || "").trim().toLowerCase();
  if (!clean) throw new Error("email required");
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const jti = crypto.randomUUID();
  const body = { email: clean, exp, jti };
  if (pay && pay.amount > 0) {
    body.pay = {
      amount: Math.round(pay.amount),
      currency: (pay.currency || "usd").toLowerCase(),
      reference: String(pay.reference || "Wholesale order").slice(0, 120),
    };
  }
  const payload = b64url(JSON.stringify(body));
  return {
    token: `${payload}.${sign(payload, "link")}`,
    jti,
    expiresAt: new Date(exp * 1000).toISOString(),
  };
}

/** Returns { email, jti, pay } or null. Single-use is enforced in tokenStore. */
export function verifyLinkToken(token) {
  const d = verify(token, "link");
  return d && d.email && d.jti ? { email: d.email, jti: d.jti, pay: d.pay || null } : null;
}

/** Browser-bound session. Carries the payment request through the visit. */
export function createSessionValue(email, pay = null) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL;
  const body = { email, exp };
  if (pay) body.pay = pay;
  const payload = b64url(JSON.stringify(body));
  return { value: `${payload}.${sign(payload, "session")}`, maxAge: SESSION_TTL };
}

export function verifySessionValue(value) {
  const d = verify(value, "session");
  return d && d.email ? { email: d.email, pay: d.pay || null } : null;
}
