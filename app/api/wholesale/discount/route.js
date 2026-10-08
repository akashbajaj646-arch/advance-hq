// app/api/wholesale/discount/route.js
// The on/off switch for volume pricing.
//
// A Shopify Function only runs when an automatic discount points at it. This
// creates, activates and removes that one discount record.
//
// GET  -> available functions and any discount already pointing at one
// POST -> { action: "create" | "delete", id? }

import { shopifyGraphQL } from "@/lib/shopifyAdmin";

export const dynamic = "force-dynamic";

const FUNCTIONS = `
  query {
    shopifyFunctions(first: 50) {
      nodes { id title apiType app { title } }
    }
  }`;

const EXISTING = `
  query {
    discountNodes(first: 50) {
      nodes {
        id
        discount {
          __typename
          ... on DiscountAutomaticApp {
            title
            status
            startsAt
            appDiscountType { functionId title }
          }
        }
      }
    }
  }`;

const CREATE = `
  mutation($discount: DiscountAutomaticAppInput!) {
    discountAutomaticAppCreate(automaticAppDiscount: $discount) {
      automaticAppDiscount { discountId title status }
      userErrors { field message }
    }
  }`;

const UPDATE = `
  mutation($id: ID!, $discount: DiscountAutomaticAppInput!) {
    discountAutomaticAppUpdate(id: $id, automaticAppDiscount: $discount) {
      automaticAppDiscount { discountId title status startsAt }
      userErrors { field message }
    }
  }`;

const DELETE = `
  mutation($id: ID!) {
    discountAutomaticDelete(id: $id) {
      deletedAutomaticDiscountId
      userErrors { field message }
    }
  }`;

export async function GET() {
  try {
    const [f, e] = await Promise.all([
      shopifyGraphQL(FUNCTIONS, {}),
      shopifyGraphQL(EXISTING, {}),
    ]);

    const functions = (f?.shopifyFunctions?.nodes || []).map((n) => ({
      id: n.id,
      title: n.title,
      apiType: n.apiType,
      app: n.app?.title,
    }));

    const discounts = (e?.discountNodes?.nodes || [])
      .filter((n) => n.discount?.__typename === "DiscountAutomaticApp")
      .map((n) => ({
        id: n.id,
        title: n.discount.title,
        status: n.discount.status,
        functionId: n.discount.appDiscountType?.functionId,
      }));

    return Response.json({ functions, discounts });
  } catch (err) {
    console.error("wholesale/discount GET:", err);
    return Response.json({ error: String(err?.message || err) }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const b = await req.json();

    if (b.action === "delete") {
      if (!b.id) return Response.json({ error: "id required" }, { status: 400 });
      const d = await shopifyGraphQL(DELETE, { id: b.id });
      const errs = d?.discountAutomaticDelete?.userErrors || [];
      if (errs.length) throw new Error(JSON.stringify(errs));
      return Response.json({ ok: true, deleted: d.discountAutomaticDelete.deletedAutomaticDiscountId });
    }

    if (b.action === "create") {
      if (!b.functionId) return Response.json({ error: "functionId required" }, { status: 400 });

      const discount = {
        title: b.title || "Wholesale volume pricing",
        functionId: b.functionId,
        // Scheduled far ahead means the discount exists but does nothing.
        // Call action "activate" when you actually want prices to change.
        startsAt: b.activate
          ? new Date().toISOString()
          : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
        combinesWith: {
          orderDiscounts: false,
          productDiscounts: false,
          shippingDiscounts: true,
        },
        discountClasses: ["PRODUCT"],
      };

      let d = await shopifyGraphQL(CREATE, { discount });
      let errs = d?.discountAutomaticAppCreate?.userErrors || [];

      // Older API shapes reject discountClasses.
      if (errs.length && JSON.stringify(errs).match(/discountClasses/i)) {
        delete discount.discountClasses;
        d = await shopifyGraphQL(CREATE, { discount });
        errs = d?.discountAutomaticAppCreate?.userErrors || [];
      }

      if (errs.length) throw new Error(JSON.stringify(errs));
      return Response.json({ ok: true, discount: d.discountAutomaticAppCreate.automaticAppDiscount });
    }

    if (b.action === "activate" || b.action === "deactivate") {
      if (!b.id) return Response.json({ error: "id required" }, { status: 400 });
      const startsAt =
        b.action === "activate"
          ? new Date().toISOString()
          : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();

      const d = await shopifyGraphQL(UPDATE, {
        id: b.id,
        discount: { startsAt },
      });
      const errs = d?.discountAutomaticAppUpdate?.userErrors || [];
      if (errs.length) throw new Error(JSON.stringify(errs));
      return Response.json({ ok: true, discount: d.discountAutomaticAppUpdate.automaticAppDiscount });
    }

    return Response.json({ error: "action must be create, activate, deactivate or delete" }, { status: 400 });
  } catch (err) {
    console.error("wholesale/discount POST:", err);
    return Response.json({ error: String(err?.message || err) }, { status: 500 });
  }
}
