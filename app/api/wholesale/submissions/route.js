// app/api/wholesale/submissions/route.js
// GET ?status=pending|approved|denied|abandoned|all&q=&limit=
// Reads the Supabase application log, not Shopify. Internal route.

import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const url = new URL(request.url);
    const status = (url.searchParams.get("status") || "all").toLowerCase();
    const q = (url.searchParams.get("q") || "").trim();
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "500", 10) || 500, 2000);

    let query = supabaseAdmin
      .from("wholesale_applications")
      .select("*")
      .order("last_submitted_at", { ascending: false })
      .limit(limit);

    if (status !== "all") query = query.eq("status", status);
    if (q) {
      const like = `%${q.replace(/[%,]/g, "")}%`;
      query = query.or(
        `email.ilike.${like},business_name.ilike.${like},contact_name.ilike.${like},phone.ilike.${like}`
      );
    }

    const { data, error } = await query;
    if (error) throw error;

    const { data: counts } = await supabaseAdmin
      .from("wholesale_applications")
      .select("status");

    const tally = {};
    (counts || []).forEach((r) => { tally[r.status] = (tally[r.status] || 0) + 1; });
    tally.all = (counts || []).length;

    return Response.json({ submissions: data || [], counts: tally });
  } catch (e) {
    console.error("wholesale/submissions:", e);
    return Response.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
