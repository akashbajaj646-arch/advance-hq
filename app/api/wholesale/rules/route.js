// app/api/wholesale/rules/route.js
// GET  -> all rules plus settings
// POST -> create a rule
// PATCH-> reorder (list of ids in priority order) or update settings

import { supabaseAdmin } from "@/lib/supabase-admin";
import { loadRules } from "@/lib/wholesaleRules";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { rules, settings } = await loadRules();
    return Response.json({ rules, settings });
  } catch (e) {
    console.error("wholesale/rules GET:", e);
    return Response.json({ error: String(e?.message || e) }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const b = await req.json();
    const { data: last } = await supabaseAdmin
      .from("wholesale_rules")
      .select("priority")
      .order("priority", { ascending: false })
      .limit(1);

    const row = {
      name: String(b.name || "New rule").slice(0, 160),
      priority: (last?.[0]?.priority || 0) + 10,
      enabled: b.enabled !== false,
      match_type: b.match_type || "collection",
      match_values: b.match_values || [],
      customer_tags: b.customer_tags || ["wholesale"],
      moq_enabled: !!b.moq_enabled,
      moq_mode: b.moq_mode || "per_product",
      moq_min: b.moq_min ?? null,
      moq_default: b.moq_default ?? 1,
      moq_increment: b.moq_increment ?? 1,
      volume_enabled: !!b.volume_enabled,
      volume_mode: b.volume_mode || "per_variant",
      volume_type: b.volume_type || "percentage",
      tiers: b.tiers || [],
      notes: b.notes || null,
    };

    const { data, error } = await supabaseAdmin
      .from("wholesale_rules")
      .insert(row)
      .select("*")
      .single();
    if (error) throw error;
    return Response.json({ rule: data });
  } catch (e) {
    console.error("wholesale/rules POST:", e);
    return Response.json({ error: String(e?.message || e) }, { status: 500 });
  }
}

export async function PATCH(req) {
  try {
    const b = await req.json();

    if (Array.isArray(b.order)) {
      // Rewrite priorities in the given order, 10 apart.
      let p = 10;
      for (const id of b.order) {
        await supabaseAdmin
          .from("wholesale_rules")
          .update({ priority: p, updated_at: new Date().toISOString() })
          .eq("id", id);
        p += 10;
      }
    }

    if (b.settings) {
      await supabaseAdmin
        .from("wholesale_rule_settings")
        .update({
          order_minimum_cents: b.settings.order_minimum_cents,
          order_minimum_customer_tags: b.settings.order_minimum_customer_tags,
          exempt_tags: b.settings.exempt_tags,
        })
        .eq("id", 1);
    }

    const { rules, settings } = await loadRules();
    return Response.json({ rules, settings });
  } catch (e) {
    console.error("wholesale/rules PATCH:", e);
    return Response.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
