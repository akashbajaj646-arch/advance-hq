// app/api/wholesale/apply/route.js
// PUBLIC endpoint for the storefront wizard form. Handles full submissions
// and partial (abandon) captures. Guard with Turnstile via TURNSTILE_SECRET.
//
// Env: SHOPIFY_STORE, SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET
// Optional: TURNSTILE_SECRET, ALLOWED_ORIGIN

import { shopifyGraphQL, ACCESS_TAGS } from "@/lib/shopifyAdmin";

const corsHeaders = () => ({
  "Access-Control-Allow-Origin": process.env.ALLOWED_ORIGIN || "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
});

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

const CUSTOMER_MUTATION = (name) => `
  mutation($input: CustomerInput!) {
    ${name}(input: $input) {
      customer { id }
      userErrors { field message }
    }
  }`;

export async function POST(req) {
  const json = (body, status = 200) =>
    Response.json(body, { status, headers: corsHeaders() });

  try {
    const b = await req.json();
    const isPartial = b.partial === true || b.partial === "true";
    const email = String(b.email || "").trim().toLowerCase();
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
      return json({ error: "Valid email required" }, 400);

    const firstName = String(b.first_name || "").trim();
    const lastName = String(b.last_name || "").trim();
    const businessName = String(b.business_name || "").trim();
    const phone = String(b.phone || "").trim();
    const einResale = String(b.ein_resale || "").trim();

    if (!isPartial) {
      if (!businessName) return json({ error: "Business name required" }, 400);
      if (!firstName) return json({ error: "Name required" }, 400);
      if (!phone) return json({ error: "Phone required" }, 400);
      if (!einResale) return json({ error: "Tax ID required" }, 400);

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
    }

    const mfPairs = [
      ["business_name", businessName],
      ["business_about", String(b.about || "").trim()],
      ["ein_resale", einResale],
      ["website", String(b.website || "").trim()],
      ["sms_consent", b.sms_consent === "yes" ? "yes" : "no"],
      ["applied_at", new Date().toISOString()],
      ["application_status", isPartial ? "partial" : "complete"],
    ].filter(([, v]) => v !== "");
    const metafields = mfPairs.map(([key, value]) => ({
      namespace: "wholesale",
      key,
      type: "single_line_text_field",
      value,
    }));

    const address1 = String(b.address1 || "").trim();
    const addresses = address1
      ? [{
          address1,
          address2: String(b.address2 || "").trim() || null,
          city: String(b.city || "").trim(),
          province: String(b.state || "").trim(),
          zip: String(b.zip || "").trim(),
          country: String(b.country || "United States").trim(),
          firstName, lastName,
          company: businessName || null,
          phone: phone || null,
        }]
      : undefined;

    const found = await shopifyGraphQL(
      `query($q: String!) { customers(first: 1, query: $q) { nodes { id tags } } }`,
      { q: `email:${email}` }
    );
    const existing = found.customers.nodes[0] || null;

    if (existing) {
      const tags = new Set(existing.tags);
      const approved = ACCESS_TAGS.some((t) => tags.has(t));
      const alreadyPending = tags.has("pending");
      if (!approved) {
        if (isPartial) {
          // never downgrade a completed application to abandoned
          if (!alreadyPending) tags.add("abandoned-application");
        } else {
          tags.delete("abandoned-application");
          tags.add("pending");
        }
      }
      const input = { id: existing.id, tags: Array.from(tags), metafields };
      if (firstName) input.firstName = firstName;
      if (lastName) input.lastName = lastName;
      if (!isPartial && addresses) input.addresses = addresses;
      const d = await shopifyGraphQL(CUSTOMER_MUTATION("customerUpdate"), { input });
      if (d.customerUpdate.userErrors.length)
        throw new Error(JSON.stringify(d.customerUpdate.userErrors));
      return json({ ok: true, status: approved ? "already_approved" : isPartial ? "partial" : "pending" });
    }

    const input = {
      email,
      firstName: firstName || null,
      lastName: lastName || null,
      tags: [isPartial ? "abandoned-application" : "pending"],
      metafields,
    };
    if (!isPartial && phone) input.phone = phone;
    if (!isPartial && addresses) input.addresses = addresses;

    let d = await shopifyGraphQL(CUSTOMER_MUTATION("customerCreate"), { input });
    let errs = d.customerCreate.userErrors;
    if (errs.length && JSON.stringify(errs).match(/phone|address/i)) {
      // formatting rejections shouldn't lose the lead; retry bare
      delete input.phone;
      delete input.addresses;
      d = await shopifyGraphQL(CUSTOMER_MUTATION("customerCreate"), { input });
      errs = d.customerCreate.userErrors;
    }
    if (errs.length) throw new Error(JSON.stringify(errs));
    return json({ ok: true, status: isPartial ? "partial" : "pending" });
  } catch (e) {
    console.error("wholesale/apply:", e);
    return json({ error: "Something went wrong. Please email sales@advanceapparels.com." }, 500);
  }
}
