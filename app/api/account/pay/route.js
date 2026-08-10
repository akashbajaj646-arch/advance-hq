// app/api/account/pay/route.js
// PUBLIC. Creates a Stripe Checkout Session for the amount that was
// signed into the customer's link. The amount comes from the token or
// session cookie, never from the request body, so it can't be edited.
//
// Checkout is Stripe-hosted: saved cards, Link, Apple Pay, Google Pay,
// and new card entry all appear automatically based on your Stripe
// payment method settings.

import { getStripe, resolveStripeCustomer } from "@/lib/stripe";
import { authenticateCustomer, respondWithSession, EXPIRED_MESSAGE } from "@/lib/customerAuth";

export const dynamic = "force-dynamic";

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": process.env.ALLOWED_ORIGIN || "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}

export async function POST(req) {
  let session;
  try {
    session = await authenticateCustomer(req);
  } catch (e) {
    console.error("account/pay auth:", e);
    return respondWithSession({ error: "Could not verify this link" }, 500);
  }
  if (!session) return respondWithSession({ error: EXPIRED_MESSAGE }, 401);
  if (!session.pay || !session.pay.amount)
    return respondWithSession({ error: "This link has no payment attached." }, 400, session);

  try {
    const customer = await resolveStripeCustomer(session.email);
    const base = (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");

    const checkout = await getStripe().checkout.sessions.create({
      mode: "payment",
      customer: customer.id,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: session.pay.currency || "usd",
            unit_amount: session.pay.amount,
            product_data: { name: session.pay.reference || "Wholesale order" },
          },
        },
      ],
      // Keep the card on file for future orders on terms
      payment_intent_data: {
        setup_future_usage: "off_session",
        description: session.pay.reference || "Wholesale order",
        metadata: { source: "advance-hq", customer_email: session.email },
      },
      saved_payment_method_options: { payment_method_save: "enabled" },
      metadata: { source: "advance-hq", customer_email: session.email },
      success_url: `${base}/account/payment-methods?paid=1`,
      cancel_url: `${base}/account/payment-methods`,
    });

    return respondWithSession({ url: checkout.url }, 200, session);
  } catch (e) {
    console.error("account/pay:", e);
    return respondWithSession(
      { error: "Could not start the payment. Please contact us and we'll help." },
      500,
      session
    );
  }
}
