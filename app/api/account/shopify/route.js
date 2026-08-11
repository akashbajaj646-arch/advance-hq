// app/api/account/shopify/route.js
// PUBLIC path (add to middleware PUBLIC_PATHS) but NOT unauthenticated:
// every request must carry a Shopify session token issued to a signed-in
// customer inside the customer account UI extension.
//
// GET  -> { linked, email, cards }
// POST -> { url }  Stripe billing portal session for that customer
//
// Env: SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET, SHOPIFY_STORE
//      plus the Stripe and Supabase vars already in use.

import crypto from "crypto";
import { getStripe, listCards } from "@/lib/stripe";
import { shopifyGraphQL } from "@/lib/shopifyAdmin";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const cors = () => ({
  "Access-Control-Allow-Origin": "*", // extension origin is Shopify-controlled
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Cache-Control": "no-store",
});

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: cors() });
}

let _db = null;
function db() {
  if (!_db) {
    _db = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false } }
    );
  }
  return _db;
}

const unb64url = (s) =>
  Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

/**
 * Verifies a Shopify session token (HS256, signed with the app's client
 * secret). Returns { customerGid, shop } or null.
 */
function verifySessionToken(raw) {
  try {
    const parts = String(raw || "").split(".");
    if (parts.length !== 3) return null;
    const [h, p, sig] = parts;

    const expected = crypto
      .createHmac("sha256", process.env.SHOPIFY_CLIENT_SECRET)
      .update(`${h}.${p}`)
      .digest();
    const given = unb64url(sig);
    if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;

    const claims = JSON.parse(unb64url(p).toString("utf8"));
    const now = Math.floor(Date.now() / 1000);
    if (claims.exp && claims.exp < now) return null;
    if (claims.nbf && claims.nbf > now + 5) return null;
    if (claims.aud !== process.env.SHOPIFY_CLIENT_ID) return null;

    const shop = String(claims.dest || "").replace(/^https:\/\//, "");
    if (!shop.startsWith(process.env.SHOPIFY_STORE)) return null;

    // sub is only present when the app has protected customer data access
    if (!claims.sub) return null;

    return { customerGid: String(claims.sub), shop };
  } catch {
    return null;
  }
}

/** Resolves the linked Stripe customer. Never creates one here. */
async function resolveLink(customerGid) {
  const { data: byGid } = await db()
    .from("stripe_links")
    .select("stripe_customer_id, matched_email")
    .eq("shopify_customer_gid", customerGid)
    .maybeSingle();
  if (byGid) return { stripeCustomerId: byGid.stripe_customer_id, email: byGid.matched_email };

  // Not mapped yet: look up the email on the Shopify customer, then match
  // an existing link by that email and remember the GID for next time.
  const data = await shopifyGraphQL(
    `query($id: ID!) { customer(id: $id) { email } }`,
    { id: customerGid }
  );
  const email = (data?.customer?.email || "").trim().toLowerCase();
  if (!email) return null;

  // Several HQ customer records can share an email, so take the most
  // recently linked rather than failing on multiple matches.
  const { data: matches } = await db()
    .from("stripe_links")
    .select("hq_customer_id, stripe_customer_id")
    .eq("matched_email", email)
    .order("linked_at", { ascending: false })
    .limit(5);
  if (!matches || !matches.length) return null;

  const distinct = [...new Set(matches.map((m) => m.stripe_customer_id))];
  if (distinct.length > 1) {
    console.warn("email maps to multiple Stripe customers:", email, distinct);
  }
  const byEmail = matches[0];

  await db()
    .from("stripe_links")
    .update({ shopify_customer_gid: customerGid })
    .eq("hq_customer_id", byEmail.hq_customer_id);

  return { stripeCustomerId: byEmail.stripe_customer_id, email };
}

async function authed(req) {
  const raw = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  return verifySessionToken(raw);
}

export async function GET(req) {
  const session = await authed(req);
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401, headers: cors() });

  try {
    const link = await resolveLink(session.customerGid);
    if (!link) return Response.json({ linked: false, cards: [] }, { headers: cors() });

    const cards = await listCards(link.stripeCustomerId);
    return Response.json({ linked: true, email: link.email, cards }, { headers: cors() });
  } catch (e) {
    console.error("account/shopify GET:", e);
    return Response.json({ error: "Could not load payment methods" }, { status: 500, headers: cors() });
  }
}

export async function POST(req) {
  const session = await authed(req);
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401, headers: cors() });

  try {
    const link = await resolveLink(session.customerGid);
    if (!link)
      return Response.json(
        { error: "We haven't set up billing for this account yet. Contact us and we'll get it sorted." },
        { status: 404, headers: cors() }
      );

    const portal = await getStripe().billingPortal.sessions.create({
      customer: link.stripeCustomerId,
      return_url: `https://${process.env.SHOPIFY_STORE}.myshopify.com/account`,
    });
    return Response.json({ url: portal.url }, { headers: cors() });
  } catch (e) {
    console.error("account/shopify POST:", e);
    return Response.json({ error: "Could not open the card manager" }, { status: 500, headers: cors() });
  }
}
