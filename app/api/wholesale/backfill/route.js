// app/api/wholesale/backfill/route.js
// POST once to seed the log from Shopify, so the dashboard isn't empty on day
// one. Walks all customers, maps tags to a status, and inserts rows that don't
// already exist. Safe to re-run: it never overwrites an existing row.

import { shopifyGraphQL, ACCESS_TAGS } from "@/lib/shopifyAdmin";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const PAGE = `
  query($first: Int!, $after: String) {
    customers(first: $first, after: $after, sortKey: UPDATED_AT, reverse: true) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id email firstName lastName phone tags createdAt
        metafields(namespace: "wholesale", first: 20) { nodes { key value } }
      }
    }
  }`;

function statusFor(tags) {
  const t = new Set((tags || []).map((x) => String(x).trim().toLowerCase()));
  if (ACCESS_TAGS.some((a) => t.has(a.toLowerCase()))) return "approved";
  if (t.has("denied")) return "denied";
  if (t.has("pending")) return "pending";
  if (t.has("abandoned-application")) return "abandoned";
  return null;
}

export async function POST() {
  try {
    const { data: known } = await supabaseAdmin
      .from("wholesale_applications")
      .select("email");
    const have = new Set((known || []).map((r) => r.email));

    let after = null, scanned = 0, inserted = 0, pages = 0;
    const batch = [];

    while (pages < 60) {
      pages++;
      const d = await shopifyGraphQL(PAGE, { first: 250, after });
      const conn = d?.customers;
      if (!conn) break;

      for (const c of conn.nodes || []) {
        scanned++;
        const email = String(c.email || "").trim().toLowerCase();
        if (!email || have.has(email)) continue;
        const status = statusFor(c.tags);
        if (!status) continue;

        const mf = Object.fromEntries(
          (c.metafields?.nodes || []).map((m) => [m.key, m.value])
        );
        have.add(email);
        batch.push({
          email,
          shopify_customer_id: c.id,
          contact_name: [c.firstName, c.lastName].filter(Boolean).join(" ") || null,
          business_name: mf.business_name || null,
          phone: c.phone || null,
          ein_resale: mf.ein_resale || null,
          website: mf.website || null,
          about: mf.business_about || null,
          sms_consent: mf.sms_consent === "yes",
          submission_type: mf.application_status === "partial" ? "partial" : "complete",
          status,
          source: "backfill",
          submitted_at: mf.applied_at || c.createdAt,
          last_submitted_at: mf.applied_at || c.createdAt,
          decided_at: status === "approved" || status === "denied" ? (mf.applied_at || c.createdAt) : null,
          decided_by: status === "approved" || status === "denied" ? "backfill (pre-dashboard)" : null,
        });
      }

      if (batch.length >= 250) {
        const { error } = await supabaseAdmin.from("wholesale_applications").insert(batch);
        if (error) throw error;
        inserted += batch.length;
        batch.length = 0;
      }

      if (!conn.pageInfo?.hasNextPage) break;
      after = conn.pageInfo.endCursor;
    }

    if (batch.length) {
      const { error } = await supabaseAdmin.from("wholesale_applications").insert(batch);
      if (error) throw error;
      inserted += batch.length;
    }

    return Response.json({ ok: true, scanned, inserted, pages });
  } catch (e) {
    console.error("wholesale/backfill:", e);
    return Response.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
