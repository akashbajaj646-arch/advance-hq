// app/api/wholesale/stripe-links/route.js
// INTERNAL, protected by the existing middleware session check.
//
// GET  -> { links, count }
// POST { links: [{ hqCustomerId, stripeCustomerId, matchedEmail, matchMethod }] }
//      -> { saved }  upserts in batches

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

export async function GET() {
  try {
    const { data, error, count } = await db()
      .from("stripe_links")
      .select("hq_customer_id, stripe_customer_id, matched_email, match_method, linked_at", {
        count: "exact",
      })
      .order("linked_at", { ascending: false })
      .limit(500);
    if (error) throw error;
    return Response.json({ links: data || [], count: count ?? (data || []).length });
  } catch (e) {
    console.error("stripe-links GET:", e);
    return Response.json({ error: "Could not load links", detail: String(e?.message || e) }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const { links } = await req.json();
    if (!Array.isArray(links) || !links.length)
      return Response.json({ error: "links array required" }, { status: 400 });

    const rows = links
      .filter((l) => l.hqCustomerId && l.stripeCustomerId)
      .map((l) => ({
        hq_customer_id: String(l.hqCustomerId),
        stripe_customer_id: String(l.stripeCustomerId),
        matched_email: l.matchedEmail || null,
        match_method: l.matchMethod || "email",
        linked_at: new Date().toISOString(),
      }));

    let saved = 0;
    for (let i = 0; i < rows.length; i += 200) {
      const batch = rows.slice(i, i + 200);
      const { error } = await db()
        .from("stripe_links")
        .upsert(batch, { onConflict: "hq_customer_id" });
      if (error) throw error;
      saved += batch.length;
    }

    return Response.json({ saved });
  } catch (e) {
    console.error("stripe-links POST:", e);
    return Response.json({ error: "Could not save links", detail: String(e?.message || e) }, { status: 500 });
  }
}
