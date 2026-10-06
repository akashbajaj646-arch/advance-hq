// app/api/wholesale/decide/route.js
// POST { customerId, decision: "approve" | "deny" }
// approve: remove "pending", add "wholesale" (opens the storefront gate;
//          your Shopify Flow on tag-added sends the approval email)
// deny:    remove "pending", add "denied" (kept for history)
// INTERNAL: add your Advance HQ auth guard, same as other routes.

import { shopifyGraphQL } from "@/lib/shopifyAdmin";
import { recordDecision } from "@/lib/wholesaleApplications";
import { getSession } from "@/lib/auth";

export async function POST(req) {
  // TODO: insert your standard Advance HQ session/auth check here and 401 if absent.

  try {
    const { customerId, decision } = await req.json();
    if (!customerId || !["approve", "deny"].includes(decision))
      return Response.json({ error: "customerId and decision (approve|deny) required" }, { status: 400 });

    const current = await shopifyGraphQL(
      `query($id: ID!) { customer(id: $id) { id email tags } }`,
      { id: customerId }
    );
    if (!current.customer) return Response.json({ error: "Customer not found" }, { status: 404 });

    const tags = new Set(current.customer.tags);
    tags.delete("pending");
    tags.delete(decision === "approve" ? "denied" : "wholesale");
    tags.add(decision === "approve" ? "wholesale" : "denied");

    const d = await shopifyGraphQL(
      `mutation($input: CustomerInput!) {
        customerUpdate(input: $input) {
          customer { id tags }
          userErrors { field message }
        }
      }`,
      { input: { id: customerId, tags: Array.from(tags) } }
    );
    const errs = d.customerUpdate.userErrors;
    if (errs.length) throw new Error(JSON.stringify(errs));

    let decidedBy = null;
    try {
      const s = await getSession();
      decidedBy = s?.user?.email || s?.user?.name || null;
    } catch (e) {}

    await recordDecision({
      email: current.customer.email,
      shopifyCustomerId: customerId,
      status: decision === "approve" ? "approved" : "denied",
      decidedBy,
    });

    return Response.json({ ok: true, tags: d.customerUpdate.customer.tags });
  } catch (e) {
    console.error("wholesale/decide:", e);
    return Response.json({ error: "Decision failed" }, { status: 500 });
  }
}
