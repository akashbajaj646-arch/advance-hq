// app/api/wholesale/applications/route.js
// Lists customers tagged "pending" with their application metafields.
// INTERNAL: add your Advance HQ auth guard at the top, same as other routes.

import { shopifyGraphQL } from "@/lib/shopifyAdmin";

export async function GET() {
  // TODO: insert your standard Advance HQ session/auth check here and 401 if absent.

  try {
    const data = await shopifyGraphQL(
      `query {
        customers(first: 50, query: "tag:pending", sortKey: UPDATED_AT, reverse: true) {
          nodes {
            id
            email
            firstName
            lastName
            phone
            tags
            createdAt
            metafields(namespace: "wholesale", first: 10) {
              nodes { key value }
            }
          }
        }
      }`,
      {}
    );

    const applications = data.customers.nodes.map((c) => {
      const mf = Object.fromEntries(c.metafields.nodes.map((m) => [m.key, m.value]));
      return {
        id: c.id,
        email: c.email,
        name: [c.firstName, c.lastName].filter(Boolean).join(" "),
        phone: c.phone,
        businessName: mf.business_name || "",
        businessType: mf.business_type || "",
        einResale: mf.ein_resale || "",
        website: mf.website || "",
        heardFrom: mf.heard_from || "",
        appliedAt: mf.applied_at || c.createdAt,
      };
    });

    return Response.json({ applications });
  } catch (e) {
    console.error("wholesale/applications:", e);
    return Response.json({ error: "Failed to load applications" }, { status: 500 });
  }
}
