// app/api/wholesale/collections/route.js
// Every collection in the store, so the rules dashboard can list them all
// instead of making you add them one at a time.

import { shopifyGraphQL } from "@/lib/shopifyAdmin";

export const dynamic = "force-dynamic";

const PAGE = `
  query($first: Int!, $after: String) {
    collections(first: $first, after: $after, sortKey: TITLE) {
      pageInfo { hasNextPage endCursor }
      nodes { id title handle productsCount { count } }
    }
  }`;

export async function GET() {
  try {
    const out = [];
    let after = null;
    for (let i = 0; i < 12; i++) {
      const d = await shopifyGraphQL(PAGE, { first: 250, after });
      const c = d?.collections;
      if (!c) break;
      out.push(
        ...(c.nodes || []).map((n) => ({
          id: n.id,
          title: n.title,
          handle: n.handle,
          products: n.productsCount?.count ?? null,
        }))
      );
      if (!c.pageInfo?.hasNextPage) break;
      after = c.pageInfo.endCursor;
    }
    return Response.json({ collections: out });
  } catch (e) {
    console.error("wholesale/collections:", e);
    return Response.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
