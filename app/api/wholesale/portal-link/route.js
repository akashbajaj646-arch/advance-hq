// app/api/wholesale/portal-link/route.js
// INTERNAL, protected by the existing middleware session check.
//
// POST { email, minutes?, amount?, reference?, invoiceNumber?, items? }
//      -> { url, expiresAt, amount }
//   Pass invoiceNumber + items to snapshot an itemized request.
// GET  ?email=...  -> { cards }   staff view of cards on file
// GET  (no email)  -> { links }   recently issued links

import { createLinkToken } from "@/lib/customerToken";
import { recordIssued, recentLinks } from "@/lib/tokenStore";
import { resolveStripeCustomer, listCards } from "@/lib/stripe";

export const dynamic = "force-dynamic";

export async function POST(req) {
  try {
    const { email, minutes, amount, reference, invoiceNumber, items } = await req.json();
    const clean = String(email || "").trim().toLowerCase();
    if (!clean || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean))
      return Response.json({ error: "Valid email required" }, { status: 400 });

    const dollars = Number(amount);
    let pay = null;
    if (dollars > 0) {
      if (dollars > 100000)
        return Response.json({ error: "Amount looks too large, please confirm" }, { status: 400 });
      pay = {
        amount: Math.round(dollars * 100),
        currency: "usd",
        reference: reference || (invoiceNumber ? `Invoice ${invoiceNumber}` : "Wholesale order"),
        invoiceNumber: invoiceNumber || null,
      };
    }

    const ttl = (Number(minutes) > 0 ? Number(minutes) : 30) * 60;
    const { token, jti, expiresAt } = createLinkToken(clean, ttl, pay);

    const base = (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
    const url = `${base}/account/payment-methods?token=${encodeURIComponent(token)}`;

    await recordIssued({
      jti,
      email: clean,
      expiresAt,
      amountCents: pay ? pay.amount : null,
      reference: pay ? pay.reference : null,
      invoiceNumber: invoiceNumber || null,
      items: Array.isArray(items) && items.length ? items : null,
    });

    return Response.json({ url, expiresAt, amount: pay ? pay.amount / 100 : null });
  } catch (e) {
    console.error("wholesale/portal-link POST:", e);
    return Response.json({ error: "Could not create link" }, { status: 500 });
  }
}

export async function GET(req) {
  try {
    const email = new URL(req.url).searchParams.get("email");
    if (email) {
      const customer = await resolveStripeCustomer(email.trim().toLowerCase());
      const cards = await listCards(customer.id);
      return Response.json({ cards });
    }
    return Response.json({ links: await recentLinks(20) });
  } catch (e) {
    console.error("wholesale/portal-link GET:", e);
    return Response.json({ error: "Could not load" }, { status: 500 });
  }
}
