// app/api/wholesale/stripe-customer/route.js
// INTERNAL, protected by the existing middleware session check.
//
// GET  ?hqCustomerId=10705&email=a@b.com   -> { linked, stripeCustomer, cards, payments, suggestion }
// GET  ?q=<email or name>                  -> { results }  search Stripe for manual linking
// POST { hqCustomerId, stripeCustomerId }  -> { ok }       link
// DELETE ?hqCustomerId=10705               -> { ok }       unlink
//
// The stripe_links table is authoritative. Email is only ever offered as a
// suggestion so a mismatched address can't silently attach the wrong profile.

import { getStripe, listCards } from "@/lib/stripe";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

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

async function recentPayments(customerId) {
  const res = await getStripe().paymentIntents.list({ customer: customerId, limit: 12 });
  return res.data.map((p) => ({
    id: p.id,
    amount: p.amount,
    currency: p.currency,
    status: p.status,
    created: p.created,
    description: p.description || "",
    invoiceNumber: p.metadata?.invoice_number || "",
  }));
}

export async function GET(req) {
  try {
    const url = new URL(req.url);
    const q = (url.searchParams.get("q") || "").trim();

    if (q) {
      const res = await getStripe().customers.search({
        query: `email~"${q.replace(/"/g, "")}" OR name~"${q.replace(/"/g, "")}"`,
        limit: 10,
      });
      return Response.json({
        results: res.data.map((c) => ({ id: c.id, email: c.email || "", name: c.name || "" })),
      });
    }

    const hqCustomerId = url.searchParams.get("hqCustomerId");
    const email = (url.searchParams.get("email") || "").trim().toLowerCase();
    if (!hqCustomerId) return Response.json({ error: "hqCustomerId required" }, { status: 400 });

    const { data: link } = await db()
      .from("stripe_links")
      .select("stripe_customer_id, matched_email, match_method, linked_at")
      .eq("hq_customer_id", String(hqCustomerId))
      .maybeSingle();

    if (!link) {
      // Offer a match, but never attach it automatically
      let suggestion = null;
      if (email) {
        const found = await getStripe().customers.list({ email, limit: 2 });
        if (found.data.length) {
          suggestion = {
            id: found.data[0].id,
            email: found.data[0].email || "",
            name: found.data[0].name || "",
            ambiguous: found.data.length > 1,
          };
        }
      }
      return Response.json({ linked: false, suggestion });
    }

    const stripeId = link.stripe_customer_id;
    const [customer, cards, payments] = await Promise.all([
      getStripe().customers.retrieve(stripeId),
      listCards(stripeId),
      recentPayments(stripeId),
    ]);

    return Response.json({
      linked: true,
      link,
      stripeCustomer: customer.deleted
        ? { id: stripeId, deleted: true }
        : { id: customer.id, email: customer.email || "", name: customer.name || "" },
      cards,
      payments,
    });
  } catch (e) {
    console.error("stripe-customer GET:", e);
    return Response.json({ error: "Could not load Stripe profile", detail: String(e?.message || e) }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const { hqCustomerId, stripeCustomerId, matchedEmail } = await req.json();
    if (!hqCustomerId || !stripeCustomerId)
      return Response.json({ error: "hqCustomerId and stripeCustomerId required" }, { status: 400 });

    const { error } = await db().from("stripe_links").upsert(
      {
        hq_customer_id: String(hqCustomerId),
        stripe_customer_id: String(stripeCustomerId),
        matched_email: matchedEmail || null,
        match_method: "manual",
        linked_at: new Date().toISOString(),
      },
      { onConflict: "hq_customer_id" }
    );
    if (error) throw error;
    return Response.json({ ok: true });
  } catch (e) {
    console.error("stripe-customer POST:", e);
    return Response.json({ error: "Could not link", detail: String(e?.message || e) }, { status: 500 });
  }
}

export async function DELETE(req) {
  try {
    const hqCustomerId = new URL(req.url).searchParams.get("hqCustomerId");
    if (!hqCustomerId) return Response.json({ error: "hqCustomerId required" }, { status: 400 });
    const { error } = await db().from("stripe_links").delete().eq("hq_customer_id", String(hqCustomerId));
    if (error) throw error;
    return Response.json({ ok: true });
  } catch (e) {
    console.error("stripe-customer DELETE:", e);
    return Response.json({ error: "Could not unlink", detail: String(e?.message || e) }, { status: 500 });
  }
}
