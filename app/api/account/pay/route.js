// app/api/account/pay/route.js
// PUBLIC. Creates a Stripe Checkout Session for the amount signed into the
// customer's link. The amount never comes from the request body.
//
// Checkout is Stripe-hosted: saved cards, Link, Apple Pay, Google Pay and
// new card entry appear per your Stripe payment method settings.

import { getStripe, resolveStripeCustomer } from "@/lib/stripe";
import { authenticateCustomer, respondWithSession, EXPIRED_MESSAGE } from "@/lib/customerAuth";
import { getLinkItems } from "@/lib/tokenStore";

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
    const invoiceNumber = session.pay.invoiceNumber || null;

    // Itemize in Stripe when we have a snapshot, so the receipt matches
    let line_items;
    const snap = session.jti ? await getLinkItems(session.jti) : null;
    const items = snap && Array.isArray(snap.items) ? snap.items : [];
    const itemsTotal = items.reduce((s, i) => s + Math.round((Number(i.amount) || 0) * 100), 0);

    if (items.length && items.length <= 40 && itemsTotal === session.pay.amount) {
      line_items = items.map((i) => ({
        quantity: Number(i.qty) || 1,
        price_data: {
          currency: session.pay.currency || "usd",
          unit_amount: Math.round((Number(i.unitPrice) || 0) * 100),
          product_data: {
            name: [i.styleNumber, i.description].filter(Boolean).join(" - ").slice(0, 250) || "Item",
            description: [i.color, i.size].filter(Boolean).join(" / ") || undefined,
            images: i.imageUrl ? [i.imageUrl] : undefined,
          },
        },
      }));
    } else {
      line_items = [
        {
          quantity: 1,
          price_data: {
            currency: session.pay.currency || "usd",
            unit_amount: session.pay.amount,
            product_data: { name: session.pay.reference || "Wholesale order" },
          },
        },
      ];
    }

    const checkout = await getStripe().checkout.sessions.create({
      mode: "payment",
      customer: customer.id,
      line_items,
      payment_intent_data: {
        setup_future_usage: "off_session",
        description: session.pay.reference || "Wholesale order",
        metadata: {
          source: "advance-hq",
          customer_email: session.email,
          invoice_number: invoiceNumber || "",
        },
      },
      saved_payment_method_options: { payment_method_save: "enabled" },
      metadata: {
        source: "advance-hq",
        customer_email: session.email,
        invoice_number: invoiceNumber || "",
      },
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
