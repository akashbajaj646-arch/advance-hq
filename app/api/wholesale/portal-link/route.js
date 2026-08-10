// app/api/wholesale/portal-link/route.js
// INTERNAL, protected by the existing middleware session check.
//
// POST { email, minutes? } -> { url, expiresAt }   generate a single-use link
// GET  ?email=...          -> { cards }            staff view of cards on file
// GET  (no email)          -> { links }            recently issued links

import { createLinkToken } from "@/lib/customerToken";
import { recordIssued, recentLinks } from "@/lib/tokenStore";
import { resolveStripeCustomer, listCards } from "@/lib/stripe";

export const dynamic = "force-dynamic";

export async function POST(req) {
  try {
    const { email, minutes } = await req.json();
    const clean = String(email || "").trim().toLowerCase();
    if (!clean || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean))
      return Response.json({ error: "Valid email required" }, { status: 400 });

    const ttl = (Number(minutes) > 0 ? Number(minutes) : 30) * 60;
    const { token, expiresAt } = createLinkToken(clean, ttl);

    const base = process.env.NEXT_PUBLIC_APP_URL || "";
    const url = `${base.replace(/\/$/, "")}/account/payment-methods?token=${encodeURIComponent(token)}`;

    const jti = JSON.parse(
      Buffer.from(token.split(".")[0].replace(/-/g, "+").replace(/_/g, "/"), "base64")
    ).jti;
    await recordIssued(jti, clean, expiresAt, null);

    return Response.json({ url, expiresAt });
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
