import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

const FIELDS = [
  "name","priority","enabled","match_type","match_values","customer_tags",
  "moq_enabled","moq_mode","moq_min","moq_default","moq_increment",
  "volume_enabled","volume_mode","volume_type","tiers","notes",
];

export async function PUT(req, { params }) {
  try {
    const { id } = await params;
    const b = await req.json();
    const patch = { updated_at: new Date().toISOString() };
    for (const f of FIELDS) if (f in b) patch[f] = b[f];

    const { data, error } = await supabaseAdmin
      .from("wholesale_rules")
      .update(patch)
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw error;
    return Response.json({ rule: data });
  } catch (e) {
    console.error("wholesale/rules PUT:", e);
    return Response.json({ error: String(e?.message || e) }, { status: 500 });
  }
}

export async function DELETE(req, { params }) {
  try {
    const { id } = await params;
    const { error } = await supabaseAdmin.from("wholesale_rules").delete().eq("id", id);
    if (error) throw error;
    return Response.json({ ok: true });
  } catch (e) {
    console.error("wholesale/rules DELETE:", e);
    return Response.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
