// lib/customerToken.js
// Two credentials, both HMAC-signed, no dependencies:
//   1. Link token  - single use, short lived, travels in a URL
//   2. Session cookie - set after a link token is consumed, browser bound
//
// Env: CUSTOMER_TOKEN_SECRET

import crypto from "crypto";

const DEFAULT_LINK_TTL = 30 * 60; // 30 minutes
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

/** Single-use link token. jti is what gets burned on first use. */
export function createLinkToken(email, ttlSeconds = DEFAULT_LINK_TTL) {
  const clean = String(email || "").trim().toLowerCase();
  if (!clean) throw new Error("email required");
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const jti = crypto.randomUUID();
  const payload = b64url(JSON.stringify({ email: clean, exp, jti }));
  return { token: `${payload}.${sign(payload, "link")}`, expiresAt: new Date(exp * 1000).toISOString() };
}

/** Returns { email, jti } or null. Does NOT check single-use, see tokenStore. */
export function verifyLinkToken(token) {
  const d = verify(token, "link");
  return d && d.email && d.jti ? { email: d.email, jti: d.jti } : null;
}

/** Browser-bound session, issued after a link token is consumed. */
export function createSessionValue(email) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL;
  const payload = b64url(JSON.stringify({ email, exp }));
  return { value: `${payload}.${sign(payload, "session")}`, maxAge: SESSION_TTL };
}

export function verifySessionValue(value) {
  const d = verify(value, "session");
  return d && d.email ? { email: d.email } : null;
}
