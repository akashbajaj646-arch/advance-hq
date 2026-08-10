// app/api/account/payment-methods/route.js
// PUBLIC route (add to middleware PUBLIC_PATHS). Auth is the signed
// customer token, passed as ?token= or Authorization: Bearer <token>.
// Later the Shopify customer account extension will call this same route.
//
// GET    -> { cards: [...] }
// POST   -> { url } Stripe hosted portal session for adding/updating cards
// DELETE -> { ok } detach a card, body { paymentMethodId }

import { stripe, resolveStripeCustomer, listCards } from "@/lib/stripe";
import { verifyCustomerToken } from "@/lib/customerToken";

const corsHeaders = () => ({
  "Access-Control-Allow-Origin": process.env.ALLOWED_ORIGIN || "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
});

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

function auth(req) {
  const url = new URL(req.url);
  const bearer = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  return verifyCustomerToken(bearer || url.searchParams.get("token"));
}

export async function GET(req) {
  const json = (b, s = 200) => Response.json(b, { status: s, headers: corsHeaders() });
  const session = auth(req);
  if (!session) return json({ error: "Link expired or invalid" }, 401);

  try {
    const customer = await resolveStripeCustomer(session.email);
    const cards = await listCards(customer.id);
    return json({ email: session.email, cards });
  } catch (e) {
    console.error("account/payment-methods GET:", e);
    return json({ error: "Could not load payment methods" }, 500);
  }
}

export async function POST(req) {
  const json = (b, s = 200) => Response.json(b, { status: s, headers: corsHeaders() });
  const session = auth(req);
  if (!session) return json({ error: "Link expired or invalid" }, 401);

  try {
    const body = await req.json().catch(() => ({}));
    const customer = await resolveStripeCustomer(session.email);
    const returnUrl =
      body.returnUrl ||
      `${process.env.NEXT_PUBLIC_APP_URL || ""}/account/payment-methods?token=${encodeURIComponent(
        new URL(req.url).searchParams.get("token") || ""
      )}`;

    const portal = await stripe.billingPortal.sessions.create({
      customer: customer.id,
      return_url: returnUrl,
    });
    return json({ url: portal.url });
  } catch (e) {
    console.error("account/payment-methods POST:", e);
    return json(
      { error: "Could not open the card manager. Please contact us and we'll help." },
      500
    );
  }
}

export async function DELETE(req) {
  const json = (b, s = 200) => Response.json(b, { status: s, headers: corsHeaders() });
  const session = auth(req);
  if (!session) return json({ error: "Link expired or invalid" }, 401);

  try {
    const { paymentMethodId } = await req.json();
    if (!paymentMethodId) return json({ error: "paymentMethodId required" }, 400);

    // Confirm the card belongs to this customer before detaching
    const customer = await resolveStripeCustomer(session.email);
    const pm = await stripe.paymentMethods.retrieve(paymentMethodId);
    if (pm.customer !== customer.id) return json({ error: "Not found" }, 404);

    await stripe.paymentMethods.detach(paymentMethodId);
    return json({ ok: true });
  } catch (e) {
    console.error("account/payment-methods DELETE:", e);
    return json({ error: "Could not remove that card" }, 500);
  }
}
