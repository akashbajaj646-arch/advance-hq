// app/api/wholesale/apply/route.js
// PUBLIC endpoint the storefront form posts to. No auth (guard it with
// Turnstile via TURNSTILE_SECRET). Everything else in /api/wholesale/*
// should sit behind your normal Advance HQ auth.
//
// Env: SHOPIFY_STORE, SHOPIFY_ADMIN_TOKEN
// Optional: TURNSTILE_SECRET, ALLOWED_ORIGIN (e.g. https://www.advanceapparelswholesale.com)

import { shopifyGraphQL, ACCESS_TAGS } from "@/lib/shopifyAdmin";

const corsHeaders = () => ({
  "Access-Control-Allow-Origin": process.env.ALLOWED_ORIGIN || "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
});

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function POST(req) {
  const json = (body, status = 200) =>
    Response.json(body, { status, headers: corsHeaders() });

  try {
    const b = await req.json();
    const email = String(b.email || "").trim().toLowerCase();
    const businessName = String(b.business_name || "").trim();
    const contactName = String(b.contact_name || "").trim();
    const phone = String(b.phone || "").trim();
    const einResale = String(b.ein_resale || "").trim();

    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
      return json({ error: "Valid email required" }, 400);
    if (!businessName) return json({ error: "Business name required" }, 400);
    if (!contactName) return json({ error: "Contact name required" }, 400);
    if (!phone) return json({ error: "Phone required" }, 400);
    if (!einResale) return json({ error: "EIN or resale certificate number required" }, 400);

    if (process.env.TURNSTILE_SECRET) {
      const tr = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          secret: process.env.TURNSTILE_SECRET,
          response: b.turnstile_token || "",
        }),
      }).then((r) => r.json());
      if (!tr.success) return json({ error: "Spam check failed, please retry" }, 400);
    }

    const metafields = [
      ["business_name", businessName],
      ["business_type", String(b.business_type || "n/a").trim()],
      ["ein_resale", einResale],
      ["website", String(b.website || "n/a").trim()],
      ["heard_from", String(b.heard_from || "n/a").trim()],
      ["applied_at", new Date().toISOString()],
    ].map(([key, value]) => ({
      namespace: "wholesale",
      key,
      type: "single_line_text_field",
      value,
    }));

    const nameParts = contactName.split(/\s+/);
    const firstName = nameParts.shift() || "";
    const lastName = nameParts.join(" ");

    const found = await shopifyGraphQL(
      `query($q: String!) { customers(first: 1, query: $q) { nodes { id tags } } }`,
      { q: `email:${email}` }
    );
    const existing = found.customers.nodes[0] || null;

    const mutation = (name) => `
      mutation($input: CustomerInput!) {
        ${name}(input: $input) {
          customer { id }
          userErrors { field message }
        }
      }`;

    if (existing) {
      const tags = new Set(existing.tags);
      const approved = ACCESS_TAGS.some((t) => tags.has(t));
      if (!approved) tags.add("pending");
      const d = await shopifyGraphQL(mutation("customerUpdate"), {
        input: { id: existing.id, firstName, lastName, tags: Array.from(tags), metafields },
      });
      const errs = d.customerUpdate.userErrors;
      if (errs.length) throw new Error(JSON.stringify(errs));
      return json({ ok: true, status: approved ? "already_approved" : "pending" });
    }

    const input = {
      email, firstName, lastName, phone: phone || null,
      tags: ["pending"], metafields,
    };
    let d = await shopifyGraphQL(mutation("customerCreate"), { input });
    let errs = d.customerCreate.userErrors;
    if (errs.length && JSON.stringify(errs).includes("phone")) {
      delete input.phone;
      d = await shopifyGraphQL(mutation("customerCreate"), { input });
      errs = d.customerCreate.userErrors;
    }
    if (errs.length) throw new Error(JSON.stringify(errs));
    return json({ ok: true, status: "pending" });
  } catch (e) {
    console.error("wholesale/apply:", e);
    return json({ error: "Something went wrong. Please email sales@advanceapparels.com." }, 500);
  }
}
