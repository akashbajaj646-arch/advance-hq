// lib/customerToken.js
// Signed, expiring tokens that let a customer (not an HQ staff user)
// access their own account pages. No dependencies, HMAC-SHA256.
//
// Env: CUSTOMER_TOKEN_SECRET (any long random string)

import crypto from "crypto";

const b64url = (buf) =>
  Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function sign(payload) {
  return b64url(
    crypto.createHmac("sha256", process.env.CUSTOMER_TOKEN_SECRET).update(payload).digest()
  );
}

/** Create a token for an email. Default lifetime 7 days. */
export function createCustomerToken(email, ttlSeconds = 60 * 60 * 24 * 7) {
  const clean = String(email || "").trim().toLowerCase();
  if (!clean) throw new Error("email required");
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = b64url(JSON.stringify({ email: clean, exp }));
  return `${payload}.${sign(payload)}`;
}

/** Returns { email } or null if invalid/expired. */
export function verifyCustomerToken(token) {
  try {
    const [payload, sig] = String(token || "").split(".");
    if (!payload || !sig) return null;
    const expected = sign(payload);
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

    const data = JSON.parse(Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64"));
    if (!data.exp || data.exp < Math.floor(Date.now() / 1000)) return null;
    return { email: data.email };
  } catch {
    return null;
  }
}
