// app/api/products/[id]/attributes/route.js
// Attribute values for one product.

import { supabaseAdmin } from "@/lib/supabase-admin";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Normalises AM's free-text content into a known fabric, e.g. "100% Rayon".
function deriveFabric(content, vocabulary) {
  const c = String(content || "").toLowerCase();
  if (!c) return null;
  for (const v of vocabulary) {
    if (c.includes(String(v).toLowerCase())) return v;
  }
  return null;
}

export async function GET(req, { params }) {
  try {
    const { id } = await params;

    const [{ data: row }, { data: defs }, { data: product }] = await Promise.all([
      supabaseAdmin.from("product_attributes").select("*").eq("product_id", id).maybeSingle(),
      supabaseAdmin.from("product_attribute_defs").select("*").eq("enabled", true).order("position"),
      supabaseAdmin.from("products").select("content, origin").eq("product_id", id).maybeSingle(),
    ]);

    const attrs = row?.attrs || {};

    // Fill derived attributes where nothing has been set by hand.
    const derived = {};
    for (const d of defs || []) {
      if (!d.derived_from) continue;
      if (attrs[d.key] && attrs[d.key].length) continue;
      const raw = product ? product[d.derived_from] : null;
      const hit = d.key === "fabric" ? deriveFabric(raw, d.values || []) : (raw || null);
      if (hit) derived[d.key] = [hit];
    }

    return Response.json({
      defs: defs || [],
      attrs,
      derived,
      confirmed: !!row?.confirmed,
      updated_at: row?.updated_at || null,
      updated_by: row?.updated_by || null,
      source: { content: product?.content || null, origin: product?.origin || null },
    });
  } catch (e) {
    console.error("product attributes GET:", e);
    return Response.json({ error: String(e?.message || e) }, { status: 500 });
  }
}

export async function PUT(req, { params }) {
  try {
    const { id } = await params;
    const b = await req.json();

    let who = null;
    try {
      const s = await getSession();
      who = s?.user?.email || s?.user?.name || null;
    } catch (e) {}

    const { error } = await supabaseAdmin.from("product_attributes").upsert(
      {
        product_id: Number(id),
        attrs: b.attrs || {},
        confirmed: b.confirmed !== false,
        updated_at: new Date().toISOString(),
        updated_by: who,
      },
      { onConflict: "product_id" }
    );
    if (error) throw error;
    return Response.json({ ok: true });
  } catch (e) {
    console.error("product attributes PUT:", e);
    return Response.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
