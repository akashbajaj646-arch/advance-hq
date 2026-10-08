// app/api/wholesale/rules/sync/route.js
// Stamps every product with the id of the rule that applies to it.
//
// A Shopify Function can't look up collections at cart time, so the matching
// happens here and the answer rides along on the product as a metafield.
//
// Runs in pages so it never outlives a serverless request. POST with
// { after } and it returns { next } until done is true.

import { shopifyGraphQL } from "@/lib/shopifyAdmin";
import { compileRules } from "@/lib/wholesaleRules";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const PAGE_SIZE = 50;
const PAGES_PER_CALL = 8; // 400 products per request

const PRODUCTS = `
  query($first: Int!, $after: String) {
    products(first: $first, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        title
        handle
        tags
        collections(first: 60) { nodes { id } }
        variants(first: 100) { nodes { sku } }
        current: metafield(namespace: "wholesale", key: "rule_id") { value }
      }
    }
  }`;

const SET = `
  mutation($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      userErrors { field message }
    }
  }`;

const lower = (s) => String(s || "").toLowerCase();

// Rules arrive already sorted: products and SKU matches, then tags, then
// collections. First match wins, so we stop at the first hit.
function matchRule(product, rules) {
  const tags = (product.tags || []).map(lower);
  const colls = new Set((product.collections?.nodes || []).map((c) => c.id));
  const skus = (product.variants?.nodes || []).map((v) => lower(v.sku));
  const title = lower(product.title);
  const handle = lower(product.handle);

  for (const rule of rules) {
    const values = rule.match?.values || [];
    switch (rule.match?.type) {
      case "products":
        if (values.some((v) => lower(v) === handle)) return rule;
        break;
      case "sku_contains":
        if (values.some((v) => v && skus.some((s) => s.includes(lower(v))))) return rule;
        break;
      case "title_contains":
        if (values.some((v) => v && title.includes(lower(v)))) return rule;
        break;
      case "product_tag":
        if (values.some((v) => tags.includes(lower(v)))) return rule;
        break;
      case "collection":
        if ((rule.match.resolved || []).some((c) => colls.has(c.id))) return rule;
        break;
      default:
        break;
    }
  }
  return null;
}

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    let after = body.after || null;

    const { doc } = await compileRules();
    const rules = doc.rules;

    let scanned = 0, stamped = 0, cleared = 0, pages = 0;
    let hasNext = true;

    while (pages < PAGES_PER_CALL && hasNext) {
      pages++;
      const d = await shopifyGraphQL(PRODUCTS, { first: PAGE_SIZE, after });
      const conn = d?.products;
      if (!conn) break;

      const writes = [];
      for (const p of conn.nodes || []) {
        scanned++;
        const rule = matchRule(p, rules);
        const want = rule ? rule.id : "";
        const have = p.current?.value || "";
        if (want === have) continue;

        writes.push({
          ownerId: p.id,
          namespace: "wholesale",
          key: "rule_id",
          type: "single_line_text_field",
          value: want,
        });
        if (want) stamped++; else cleared++;
      }

      // metafieldsSet takes 25 at a time.
      for (let i = 0; i < writes.length; i += 25) {
        const batch = writes.slice(i, i + 25);
        const r = await shopifyGraphQL(SET, { metafields: batch });
        const errs = r?.metafieldsSet?.userErrors || [];
        if (errs.length) console.error("sync metafieldsSet:", JSON.stringify(errs));
      }

      hasNext = !!conn.pageInfo?.hasNextPage;
      after = conn.pageInfo?.endCursor || null;
    }

    return Response.json({
      ok: true,
      scanned,
      stamped,
      cleared,
      done: !hasNext,
      next: hasNext ? after : null,
    });
  } catch (e) {
    console.error("wholesale/rules/sync:", e);
    return Response.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
