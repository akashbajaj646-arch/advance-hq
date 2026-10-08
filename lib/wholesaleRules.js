// lib/wholesaleRules.js
// Shared rule maths and the compiler that publishes rules to Shopify.
//
// One rule wins per line item: rules are sorted by priority ascending and the
// first match applies. Nothing stacks.

import { supabaseAdmin } from "@/lib/supabase-admin";
import { shopifyGraphQL } from "@/lib/shopifyAdmin";

export const MATCH_TYPES = [
  { value: "collection",     label: "Collection" },
  { value: "product_tag",    label: "Product tag" },
  { value: "sku_contains",   label: "SKU contains" },
  { value: "title_contains", label: "Title contains" },
  { value: "products",       label: "Specific products" },
];

export const VOLUME_TYPES = [
  { value: "percentage",  label: "Percent off", suffix: "%" },
  { value: "amount_off",  label: "Amount off each", suffix: "$" },
  { value: "fixed_price", label: "Fixed price each", suffix: "$" },
];

// Unit price at a given tier value. Money in cents throughout.
export function tierPrice(baseCents, volumeType, value) {
  const v = Number(value) || 0;
  if (volumeType === "fixed_price") return Math.round(v * 100);
  if (volumeType === "amount_off") return Math.max(0, baseCents - Math.round(v * 100));
  return Math.max(0, Math.round(baseCents * (1 - v / 100)));
}

// The tier that applies at a quantity, or null below the first break.
export function tierFor(tiers, qty) {
  let hit = null;
  for (const t of tiers || []) {
    if (qty >= Number(t.qty)) {
      if (!hit || Number(t.qty) > Number(hit.qty)) hit = t;
    }
  }
  return hit;
}

export async function loadRules() {
  const { data: rules, error } = await supabaseAdmin
    .from("wholesale_rules")
    .select("*")
    .order("priority", { ascending: true });
  if (error) throw error;

  const { data: settings } = await supabaseAdmin
    .from("wholesale_rule_settings")
    .select("*")
    .eq("id", 1)
    .maybeSingle();

  return { rules: rules || [], settings: settings || {} };
}

// Resolves collection titles to real Shopify collections so the storefront
// and the Functions can match on id instead of a display name.
async function resolveCollections(titles) {
  const found = {};
  const missing = [];
  for (const title of titles) {
    // Double quotes so apostrophes in titles survive, e.g. African Men's Clothing.
    const q = `title:"${String(title).replace(/"/g, '\\"')}"`;
    const d = await shopifyGraphQL(
      `query($q: String!) { collections(first: 5, query: $q) { nodes { id title handle } } }`,
      { q }
    );
    const nodes = d?.collections?.nodes || [];
    const exact = nodes.find(
      (n) => String(n.title).trim().toLowerCase() === String(title).trim().toLowerCase()
    );
    if (exact) found[title] = { id: exact.id, handle: exact.handle, title: exact.title };
    else missing.push(title);
  }
  return { found, missing };
}

// Builds the document the Shopify Functions and the theme read.
export async function compileRules() {
  const { rules, settings } = await loadRules();
  const active = rules.filter((r) => r.enabled);

  const titles = new Set();
  active.forEach((r) => {
    if (r.match_type === "collection") (r.match_values || []).forEach((t) => titles.add(t));
  });

  const { found, missing } = await resolveCollections(Array.from(titles));

  const compiled = active.map((r) => {
    const base = {
      id: r.id,
      name: r.name,
      priority: r.priority,
      match: { type: r.match_type, values: r.match_values || [] },
      customer_tags: r.customer_tags || [],
      moq: r.moq_enabled
        ? {
            mode: r.moq_mode,
            min: r.moq_min,
            default: r.moq_default,
            increment: r.moq_increment,
          }
        : null,
      volume: r.volume_enabled
        ? { mode: r.volume_mode, type: r.volume_type, tiers: r.tiers || [] }
        : null,
    };
    if (r.match_type === "collection") {
      base.match.resolved = (r.match_values || [])
        .map((t) => found[t])
        .filter(Boolean);
    }
    return base;
  });

  const doc = {
    version: 1,
    generated_at: new Date().toISOString(),
    order_minimum_cents: settings.order_minimum_cents ?? 30000,
    order_minimum_customer_tags: settings.order_minimum_customer_tags ?? ["wholesale"],
    exempt_tags: settings.exempt_tags ?? ["wholesaleminimumexception"],
    rules: compiled,
  };

  return { doc, missing };
}

export async function publishRules(publishedBy) {
  const { doc, missing } = await compileRules();

  const shop = await shopifyGraphQL(`query { shop { id } }`, {});
  const shopId = shop?.shop?.id;
  if (!shopId) throw new Error("Could not read shop id");

  const d = await shopifyGraphQL(
    `mutation($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { id key namespace updatedAt }
        userErrors { field message }
      }
    }`,
    {
      metafields: [
        {
          ownerId: shopId,
          namespace: "wholesale",
          key: "rules",
          type: "json",
          value: JSON.stringify(doc),
        },
      ],
    }
  );

  const errs = d?.metafieldsSet?.userErrors || [];
  if (errs.length) throw new Error(JSON.stringify(errs));

  await supabaseAdmin
    .from("wholesale_rule_settings")
    .update({ published_at: new Date().toISOString(), published_by: publishedBy || null })
    .eq("id", 1);

  return {
    ok: true,
    rules: doc.rules.length,
    bytes: JSON.stringify(doc).length,
    missing_collections: missing,
  };
}
