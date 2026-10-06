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

    // Real counts. A plain select would cap at 1000 rows and under-report.
    const tally = {};
    const buckets = ["pending", "approved", "denied", "abandoned"];
    await Promise.all(
      buckets.map(async (s) => {
        const { count } = await supabaseAdmin
          .from("wholesale_applications")
          .select("id", { count: "exact", head: true })
          .eq("status", s);
        tally[s] = count || 0;
      })
    );
    const { count: allCount } = await supabaseAdmin
      .from("wholesale_applications")
      .select("id", { count: "exact", head: true });
    tally.all = allCount || 0;

    return Response.json({ submissions: data || [], counts: tally });
  } catch (e) {
    console.error("wholesale/submissions:", e);
    return Response.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
