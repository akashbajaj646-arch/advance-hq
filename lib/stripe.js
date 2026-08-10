// lib/stripe.js
// Server-side only. Env: STRIPE_SECRET_KEY
// Lazily initialized so importing this module during build never
// requires the key to be present.

import Stripe from "stripe";

let _stripe = null;

export function getStripe() {
  if (!_stripe) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
    _stripe = new Stripe(key, { apiVersion: "2025-06-30.basil" });
  }
  return _stripe;
}

/**
 * Finds the Stripe customer for an email, creating one if absent.
 * Matches existing Stripe customers by email so cards already on file
 * are picked up without any migration.
 */
export async function resolveStripeCustomer(email, name) {
  const stripe = getStripe();
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

/** Saved cards for a Stripe customer. */
export async function listCards(customerId) {
  const stripe = getStripe();
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
