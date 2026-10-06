// lib/wholesaleApplications.js
// Supabase-backed log of every wholesale application. Shopify tags remain the
// system of record for ACCESS; this table is the system of record for HISTORY,
// since tags only ever show current state.

import { supabaseAdmin } from "@/lib/supabase-admin";

const TABLE = "wholesale_applications";
const TERMINAL = ["approved", "denied"];

function clean(v) {
  const s = String(v == null ? "" : v).trim();
  return s === "" ? null : s;
}

// Records a submission. Upserts on email: one row per applicant, with the
// first submission date preserved and the latest details winning.
export async function recordSubmission(input) {
  const email = String(input.email || "").trim().toLowerCase();
  if (!email) return null;

  const isPartial = !!input.isPartial;
  const now = new Date().toISOString();

  try {
    const { data: existing } = await supabaseAdmin
      .from(TABLE)
      .select("*")
      .eq("email", email)
      .maybeSingle();

    const fields = {
      shopify_customer_id: clean(input.shopifyCustomerId),
      contact_name: clean(input.contactName),
      business_name: clean(input.businessName),
      phone: clean(input.phone),
      ein_resale: clean(input.einResale),
      website: clean(input.website),
      about: clean(input.about),
      address: clean(input.address),
      sms_consent: !!input.smsConsent,
      submission_type: isPartial ? "partial" : "complete",
      last_submitted_at: now,
    };

    if (!existing) {
      await supabaseAdmin.from(TABLE).insert({
        email,
        ...fields,
        status: isPartial ? "abandoned" : "pending",
        submitted_at: now,
        source: clean(input.source) || "website",
      });
      return;
    }

    // Never let a later partial downgrade a real submission, and never let a
    // resubmission reopen a decision you already made.
    let status = existing.status;
    if (!TERMINAL.includes(status)) {
      status = isPartial ? existing.status || "abandoned" : "pending";
    }

    // Blank values on a partial shouldn't wipe details we already have.
    const patch = { last_submitted_at: now, status };
    for (const [k, v] of Object.entries(fields)) {
      if (k === "last_submitted_at") continue;
      if (k === "sms_consent" || k === "submission_type") { patch[k] = v; continue; }
      if (v !== null) patch[k] = v;
    }
    if (isPartial && existing.submission_type === "complete") {
      patch.submission_type = "complete";
    }

    await supabaseAdmin.from(TABLE).update(patch).eq("email", email);
  } catch (e) {
    // Logging must never cost you an application.
    console.error("recordSubmission:", e);
  }
}

// Records an approve/deny decision with who and when.
export async function recordDecision({ email, shopifyCustomerId, status, decidedBy, note }) {
  const e = String(email || "").trim().toLowerCase();
  if (!e) return;
  try {
    const patch = {
      status,
      decided_at: new Date().toISOString(),
      decided_by: clean(decidedBy),
      decision_note: clean(note),
    };
    if (shopifyCustomerId) patch.shopify_customer_id = shopifyCustomerId;

    const { data } = await supabaseAdmin
      .from(TABLE)
      .update(patch)
      .eq("email", e)
      .select("id");

    // A customer approved before this table existed has no row yet.
    if (!data || data.length === 0) {
      await supabaseAdmin.from(TABLE).insert({
        email: e,
        shopify_customer_id: shopifyCustomerId || null,
        status,
        decided_at: patch.decided_at,
        decided_by: patch.decided_by,
        decision_note: patch.decision_note,
        source: "decided-without-application",
      });
    }
  } catch (err) {
    console.error("recordDecision:", err);
  }
}
