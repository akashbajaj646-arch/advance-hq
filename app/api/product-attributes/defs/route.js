// app/api/product-attributes/defs/route.js
// The attribute vocabulary. GET to list, POST to add a value to one.

import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from("product_attribute_defs")
      .select("*")
      .eq("enabled", true)
      .order("position", { ascending: true });
    if (error) throw error;
    return Response.json({ defs: data || [] });
  } catch (e) {
    console.error("attribute defs GET:", e);
    return Response.json({ error: String(e?.message || e) }, { status: 500 });
  }
}

// Adding a value is deliberate, so the vocabulary doesn't sprawl.
export async function POST(req) {
  try {
    const { key, value } = await req.json();
    const v = String(value || "").trim();
    if (!key || !v) return Response.json({ error: "key and value required" }, { status: 400 });

    const { data: def, error: e1 } = await supabaseAdmin
      .from("product_attribute_defs")
      .select("values")
      .eq("key", key)
      .single();
    if (e1) throw e1;

    const values = def.values || [];
    const exists = values.some((x) => String(x).toLowerCase() === v.toLowerCase());
    if (!exists) {
      values.push(v);
      values.sort((a, b) => String(a).localeCompare(String(b)));
      const { error: e2 } = await supabaseAdmin
        .from("product_attribute_defs")
        .update({ values })
        .eq("key", key);
      if (e2) throw e2;
    }
    return Response.json({ ok: true, values });
  } catch (e) {
    console.error("attribute defs POST:", e);
    return Response.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
