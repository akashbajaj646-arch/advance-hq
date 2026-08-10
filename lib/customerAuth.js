// lib/customerAuth.js
// Shared auth ladder for the customer-facing account routes:
//   1. Valid session cookie -> use it
//   2. Link token in URL    -> verify, burn, issue session cookie
//   3. Otherwise            -> null

import {
  verifyLinkToken,
  createSessionValue,
  verifySessionValue,
  SESSION_COOKIE,
} from "@/lib/customerToken";
import { consumeToken } from "@/lib/tokenStore";

export const EXPIRED_MESSAGE =
  "This link has expired or has already been used. Please ask us for a new one.";

export async function authenticateCustomer(req) {
  const cookie = req.cookies.get(SESSION_COOKIE)?.value;
  const fromCookie = cookie ? verifySessionValue(cookie) : null;
  if (fromCookie) return { email: fromCookie.email, pay: fromCookie.pay };

  const url = new URL(req.url);
  const bearer = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const raw = bearer || url.searchParams.get("token");
  if (!raw) return null;

  const link = verifyLinkToken(raw);
  if (!link) return null;

  const fresh = await consumeToken(link.jti, link.email);
  if (!fresh) return null;

  return {
    email: link.email,
    pay: link.pay,
    setCookie: createSessionValue(link.email, link.pay),
  };
}

export function respondWithSession(body, status, session, extraHeaders = {}) {
  const res = Response.json(body, {
    status,
    headers: {
      "Access-Control-Allow-Origin": process.env.ALLOWED_ORIGIN || "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Cache-Control": "no-store",
      ...extraHeaders,
    },
  });
  if (session?.setCookie) {
    res.headers.append(
      "Set-Cookie",
      `${SESSION_COOKIE}=${session.setCookie.value}; Path=/; Max-Age=${session.setCookie.maxAge}; HttpOnly; Secure; SameSite=Lax`
    );
  }
  return res;
}
