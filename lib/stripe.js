// lib/stripe.js
// Server-side only. Env: STRIPE_SECRET_KEY

import Stripe from "stripe";

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2025-06-30.basil",
});

/**
 * Finds the Stripe customer for an email, creating one if absent.
 * Matches your existing Stripe customers by email so cards already
 * on file are picked up without any migration.
 */
export async function resolveStripeCustomer(email, name) {
  const clean = String(email || "").trim().toLowerCase();
  if (!clean) throw new Error("email required");

  const found = await stripe.customers.list({ email: clean, limit: 1 });
  if (found.data.length) return found.data[0];

  return stripe.customers.create({
    email: clean,
    name: name || undefined,
    metadata: { source: "advance-hq" },
  });
}

/** Saved cards for a Stripe customer, newest first. */
export async function listCards(customerId) {
  const [pms, customer] = await Promise.all([
    stripe.paymentMethods.list({ customer: customerId, type: "card" }),
    stripe.customers.retrieve(customerId),
  ]);
  const defaultId =
    customer && !customer.deleted
      ? customer.invoice_settings?.default_payment_method
      : null;

  return pms.data.map((pm) => ({
    id: pm.id,
    brand: pm.card.brand,
    last4: pm.card.last4,
    expMonth: pm.card.exp_month,
    expYear: pm.card.exp_year,
    isDefault: pm.id === defaultId,
  }));
}
