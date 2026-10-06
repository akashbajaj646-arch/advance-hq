// app/api/wholesale/applications/route.js
// Lists customers tagged "pending" with their application metafields.
// Does NOT use Shopify's customer search index (query: "tag:pending"), which
// lags behind writes and silently returned zero results. Instead it walks the
// most recently updated customers and filters tags in JS.
// INTERNAL: add your Advance HQ auth guard at the top, same as other routes.

import { shopifyGraphQL } from "@/lib/shopifyAdmin";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 250;
const MAX_PAGES = 3; // 750 most recently updated customers

const PAGE_QUERY = `
  query RecentCustomers($first: Int!, $after: String) {
    customers(first: $first, after: $after, sortKey: UPDATED_AT, reverse: true) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        email
        firstName
        lastName
        phone
        tags
        createdAt
        updatedAt
        metafields(namespace: "wholesale", first: 20) {
          nodes { key value }
        }
      }
    }
  }
`;

function hasTag(tags, wanted) {
  return (tags || []).some(
    (t) => String(t).trim().toLowerCase() === wanted
  );
}

export async function GET(request) {
  // TODO: insert your standard Advance HQ session/auth check here and 401 if absent.

  const url = new URL(request.url);
  const wanted = (url.searchParams.get("tag") || "pending").toLowerCase();
  const debug = url.searchParams.get("debug") === "1";

  try {
    const nodes = [];
    let after = null;

    for (let page = 0; page < MAX_PAGES; page++) {
      const data = await shopifyGraphQL(PAGE_QUERY, {
        first: PAGE_SIZE,
        after,
      });
      const conn = data?.customers;
      if (!conn) break;
      nodes.push(...(conn.nodes || []));
      if (!conn.pageInfo?.hasNextPage) break;
      after = conn.pageInfo.endCursor;
    }

    const matched = nodes.filter((c) => hasTag(c.tags, wanted));

    const applications = matched.map((c) => {
      const mf = Object.fromEntries(
        (c.metafields?.nodes || []).map((m) => [m.key, m.value])
      );
      return {
        id: c.id,
        email: c.email,
        name: [c.firstName, c.lastName].filter(Boolean).join(" "),
        phone: c.phone,
        tags: c.tags,
        businessName: mf.business_name || "",
        businessType: mf.business_type || "",
        businessAbout: mf.business_about || "",
        einResale: mf.ein_resale || "",
        website: mf.website || "",
        smsConsent: mf.sms_consent || "",
        heardFrom: mf.heard_from || "",
        applicationStatus: mf.application_status || "",
        appliedAt: mf.applied_at || c.createdAt,
      };
    });

    if (debug) {
      return Response.json({
        applications,
        _debug: {
          wanted,
          scanned: nodes.length,
          matched: matched.length,
          sampleTags: nodes.slice(0, 10).map((c) => ({
            email: c.email,
            tags: c.tags,
          })),
        },
      });
    }

    return Response.json({ applications });
  } catch (e) {
    console.error("wholesale/applications:", e);
    return Response.json(
      { error: "Failed to load applications", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
