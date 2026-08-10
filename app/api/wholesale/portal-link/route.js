// app/api/wholesale/portal-link/route.js
// INTERNAL (protected by your existing middleware session check).
// Staff generate a secure, expiring link to send a customer so they can
// manage their own cards. POST { email, days? } -> { url, expiresAt }

import { createCustomerToken } from "@/lib/customerToken";

export async function POST(req) {
  try {
    const { email, days } = await req.json();
    if (!email) return Response.json({ error: "email required" }, { status: 400 });

    const ttl = (Number(days) > 0 ? Number(days) : 7) * 86400;
    const token = createCustomerToken(email, ttl);
    const base = process.env.NEXT_PUBLIC_APP_URL || "";
    return Response.json({
      url: `${base}/account/payment-methods?token=${encodeURIComponent(token)}`,
      expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
    });
  } catch (e) {
    console.error("wholesale/portal-link:", e);
    return Response.json({ error: "Could not create link" }, { status: 500 });
  }
}
