// app/api/account/payment-methods/route.js
// PUBLIC route. Auth ladder:
//   1. Valid session cookie  -> use it
//   2. Link token in URL     -> verify, burn it, issue session cookie
//   3. Otherwise             -> 401
//
// Card removal is intentionally NOT exposed here. Customers remove cards
// inside Stripe's own authenticated portal.
//
// GET  -> { email, cards }
// POST -> { url } Stripe hosted portal session

import { getStripe, resolveStripeCustomer, listCards } from "@/lib/stripe";
import {
  verifyLinkToken,
  createSessionValue,
  verifySessionValue,
  SESSION_COOKIE,
} from "@/lib/customerToken";
import { consumeToken } from "@/lib/tokenStore";

export const dynamic = "force-dynamic";

const corsHeaders = () => ({
  "Access-Control-Allow-Origin": process.env.ALLOWED_ORIGIN || "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Cache-Control": "no-store",
});

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

/**
 * Resolves the caller. Returns { email, setCookie? } or null.
 * Burns the link token the first time it is seen.
 */
async function authenticate(req) {
  const cookie = req.cookies.get(SESSION_COOKIE)?.value;
  const fromCookie = cookie ? verifySessionValue(cookie) : null;
  if (fromCookie) return { email: fromCookie.email };

  const url = new URL(req.url);
  const bearer = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const raw = bearer || url.searchParams.get("token");
  if (!raw) return null;

  const link = verifyLinkToken(raw);
  if (!link) return null;

  const fresh = await consumeToken(link.jti, link.email);
  if (!fresh) return null; // already opened once

  return { email: link.email, setCookie: createSessionValue(link.email) };
}

function respond(body, status, session) {
  const res = Response.json(body, { status, headers: corsHeaders() });
  if (session?.setCookie) {
    res.headers.append(
      "Set-Cookie",
      `${SESSION_COOKIE}=${session.setCookie.value}; Path=/; Max-Age=${session.setCookie.maxAge}; HttpOnly; Secure; SameSite=Lax`
    );
  }
  return res;
}

export async function GET(req) {
  let session;
  try {
    session = await authenticate(req);
  } catch (e) {
    console.error("account/payment-methods auth:", e);
    return respond({ error: "Could not verify this link" }, 500);
  }
  if (!session)
    return respond(
      { error: "This link has expired or has already been used. Please ask us for a new one." },
      401
    );

  try {
    const customer = await resolveStripeCustomer(session.email);
    const cards = await listCards(customer.id);
    return respond({ email: session.email, cards }, 200, session);
  } catch (e) {
    console.error("account/payment-methods GET:", e);
    return respond({ error: "Could not load payment methods" }, 500, session);
  }
}

export async function POST(req) {
  let session;
  try {
    session = await authenticate(req);
  } catch (e) {
    console.error("account/payment-methods auth:", e);
    return respond({ error: "Could not verify this link" }, 500);
  }
  if (!session)
    return respond(
      { error: "This link has expired or has already been used. Please ask us for a new one." },
      401
    );

  try {
    const customer = await resolveStripeCustomer(session.email);
    const base = process.env.NEXT_PUBLIC_APP_URL || "";
    const portal = await getStripe().billingPortal.sessions.create({
      customer: customer.id,
      return_url: `${base}/account/payment-methods`,
    });
    return respond({ url: portal.url }, 200, session);
  } catch (e) {
    console.error("account/payment-methods POST:", e);
    return respond(
      { error: "Could not open the card manager. Please contact us and we'll help." },
      500,
      session
    );
  }
}
