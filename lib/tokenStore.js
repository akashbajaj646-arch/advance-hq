// lib/tokenStore.js
// Burns single-use link tokens and keeps an issuance audit trail.
//
// Env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Table: see sql/payment_link_tokens.sql

import { createClient } from "@supabase/supabase-js";

let _db = null;
function db() {
  if (!_db) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key)
      throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
    _db = createClient(url, key, { auth: { persistSession: false } });
  }
  return _db;
}

/** Returns true if this call consumed the token, false if already spent. */
export async function consumeToken(jti, email) {
  const { error } = await db()
    .from("payment_link_tokens")
    .insert({ jti, email, used_at: new Date().toISOString() });

  if (!error) return true;
  if (error.code === "23505") return false;
  throw error;
}

export async function recordIssued(jti, email, expiresAt, issuedBy, amountCents, reference) {
  const { error } = await db().from("payment_link_audit").insert({
    jti,
    email,
    expires_at: expiresAt,
    issued_by: issuedBy || null,
    amount_cents: amountCents || null,
    reference: reference || null,
  });
  if (error) console.error("recordIssued:", error);
}

export async function recentLinks(limit = 20) {
  const { data, error } = await db()
    .from("payment_link_audit")
    .select("jti, email, expires_at, issued_by, amount_cents, reference, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;

  const ids = (data || []).map((r) => r.jti);
  let used = new Set();
  if (ids.length) {
    const { data: u } = await db().from("payment_link_tokens").select("jti").in("jti", ids);
    used = new Set((u || []).map((r) => r.jti));
  }
  return (data || []).map((r) => ({
    ...r,
    status: used.has(r.jti)
      ? "opened"
      : new Date(r.expires_at) < new Date()
      ? "expired"
      : "unopened",
  }));
}
