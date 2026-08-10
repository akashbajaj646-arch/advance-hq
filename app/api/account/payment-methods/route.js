// app/api/account/payment-methods/route.js
// PUBLIC. Auth ladder lives in lib/customerAuth.
// Card removal is intentionally not exposed here; that happens inside
// Stripe's own authenticated portal.
//
// GET  -> { email, cards, pay }
// POST -> { url } Stripe hosted billing portal session

import { getStripe, resolveStripeCustomer, listCards } from "@/lib/stripe";
import { authenticateCustomer, respondWithSession, EXPIRED_MESSAGE } from "@/lib/customerAuth";

export const dynamic = "force-dynamic";

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": process.env.ALLOWED_ORIGIN || "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}

export async function GET(req) {
  let session;
  try {
    session = await authenticateCustomer(req);
  } catch (e) {
    console.error("account/payment-methods auth:", e);
    return respondWithSession({ error: "Could not verify this link" }, 500);
  }
  if (!session) return respondWithSession({ error: EXPIRED_MESSAGE }, 401);

  try {
    const customer = await resolveStripeCustomer(session.email);
    const cards = await listCards(customer.id);
    return respondWithSession({ email: session.email, cards, pay: session.pay || null }, 200, session);
  } catch (e) {
    console.error("account/payment-methods GET:", e);
    return respondWithSession({ error: "Could not load payment methods" }, 500, session);
  }
}

export async function POST(req) {
  let session;
  try {
    session = await authenticateCustomer(req);
  } catch (e) {
    console.error("account/payment-methods auth:", e);
    return respondWithSession({ error: "Could not verify this link" }, 500);
  }
  if (!session) return respondWithSession({ error: EXPIRED_MESSAGE }, 401);

  try {
    const customer = await resolveStripeCustomer(session.email);
    const base = (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
    const portal = await getStripe().billingPortal.sessions.create({
      customer: customer.id,
      return_url: `${base}/account/payment-methods`,
    });
    return respondWithSession({ url: portal.url }, 200, session);
  } catch (e) {
    console.error("account/payment-methods POST:", e);
    return respondWithSession(
      { error: "Could not open the card manager. Please contact us and we'll help." },
      500,
      session
    );
  }
}
