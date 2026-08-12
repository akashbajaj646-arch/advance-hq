// Shopify Admin API (GraphQL) client for the two AM-synced stores.
// Server-side only. Env vars per store (Dev Dashboard apps, post-Jan-2026):
//   SHOPIFY_B2B_DOMAIN + SHOPIFY_B2B_CLIENT_ID + SHOPIFY_B2B_CLIENT_SECRET
//   SHOPIFY_DTC_DOMAIN + SHOPIFY_DTC_CLIENT_ID + SHOPIFY_DTC_CLIENT_SECRET
// (Legacy static SHOPIFY_{STORE}_TOKEN still supported if present.)
// Optional: SHOPIFY_API_VERSION (default 2025-07).
//
// Variant matching: Shopify variant `sku` field === AM inventory.sku_concat
// (style+color+size, verified 2026-08-13 against 16317-267 on both stores).

export type ShopifyStore = 'b2b' | 'dtc';

export type ShopifyVariant = {
  id: string;
  sku: string;
  inventoryPolicy: 'CONTINUE' | 'DENY';
  displayName: string;
  productId: string;
  productTitle: string;
};

const API_VERSION = process.env.SHOPIFY_API_VERSION || '2025-07';

// Dev Dashboard apps (post-Jan-2026) don't expose a static token: you get a Client ID +
// Client Secret and exchange them for an access token via the client credentials grant.
// We support both: SHOPIFY_{STORE}_TOKEN (legacy static token) OR
// SHOPIFY_{STORE}_CLIENT_ID + SHOPIFY_{STORE}_CLIENT_SECRET (CCG, token cached in-memory).

type StoreCfg = { domain: string; token?: string; clientId?: string; clientSecret?: string };

export function storeConfig(store: ShopifyStore): StoreCfg | null {
  const P = store === 'b2b' ? 'SHOPIFY_B2B' : 'SHOPIFY_DTC';
  const domain = process.env[`${P}_DOMAIN`];
  const token = process.env[`${P}_TOKEN`];
  const clientId = process.env[`${P}_CLIENT_ID`];
  const clientSecret = process.env[`${P}_CLIENT_SECRET`];
  if (!domain) return null;
  if (!token && !(clientId && clientSecret)) return null;
  return { domain, token, clientId, clientSecret };
}

// Per-store access-token cache (per serverless instance; refetched on cold start / expiry)
const tokenCache: Record<string, { token: string; expiresAt: number }> = {};

async function getAccessToken(store: ShopifyStore, cfg: StoreCfg): Promise<{ token: string | null; error?: any }> {
  if (cfg.token) return { token: cfg.token };

  const cached = tokenCache[store];
  if (cached && cached.expiresAt > Date.now() + 60_000) return { token: cached.token };

  try {
    const res = await fetch(`https://${cfg.domain}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'client_credentials',
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
      }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.access_token) {
      return { token: null, error: { message: `Token exchange failed (HTTP ${res.status})`, body } };
    }
    const expiresInMs = (typeof body.expires_in === 'number' ? body.expires_in : 86400) * 1000;
    tokenCache[store] = { token: body.access_token, expiresAt: Date.now() + expiresInMs };
    return { token: body.access_token };
  } catch (e: any) {
    return { token: null, error: { message: String(e?.message || e) } };
  }
}

async function shopifyGraphql(store: ShopifyStore, query: string, variables: Record<string, any>): Promise<{ ok: boolean; data?: any; errors?: any }> {
  const cfg = storeConfig(store);
  if (!cfg) return { ok: false, errors: [{ message: `${store.toUpperCase()} store env vars not configured` }] };

  const auth = await getAccessToken(store, cfg);
  if (!auth.token) return { ok: false, errors: [{ message: `${store.toUpperCase()} access-token exchange failed`, detail: auth.error }] };

  try {
    const res = await fetch(`https://${cfg.domain}/admin/api/${API_VERSION}/graphql.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': auth.token },
      body: JSON.stringify({ query, variables }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body) {
      return { ok: false, errors: [{ message: `HTTP ${res.status}`, body: typeof body === 'object' ? body : String(body).slice(0, 300) }] };
    }
    if (body.errors?.length) return { ok: false, errors: body.errors };
    return { ok: true, data: body.data };
  } catch (e: any) {
    return { ok: false, errors: [{ message: String(e?.message || e) }] };
  }
}

/** Find a variant by exact SKU match. Returns null if not found. */
export async function findVariantBySku(store: ShopifyStore, sku: string): Promise<{ ok: boolean; variant: ShopifyVariant | null; errors?: any }> {
  const query = `
    query FindVariant($q: String!) {
      productVariants(first: 10, query: $q) {
        nodes {
          id
          sku
          inventoryPolicy
          displayName
          product { id title }
        }
      }
    }`;
  // Quote the SKU so spaces don't split the search term
  const result = await shopifyGraphql(store, query, { q: `sku:"${sku.replace(/"/g, '\\"')}"` });
  if (!result.ok) return { ok: false, variant: null, errors: result.errors };

  const nodes = result.data?.productVariants?.nodes || [];
  const exact = nodes.find((n: any) => n.sku === sku);
  if (!exact) return { ok: true, variant: null };

  return {
    ok: true,
    variant: {
      id: exact.id,
      sku: exact.sku,
      inventoryPolicy: exact.inventoryPolicy,
      displayName: exact.displayName,
      productId: exact.product?.id,
      productTitle: exact.product?.title,
    },
  };
}

/** Set a variant's inventory policy (CONTINUE = keep selling when out of stock, DENY = stop). */
export async function setInventoryPolicy(
  store: ShopifyStore,
  productId: string,
  variantId: string,
  policy: 'CONTINUE' | 'DENY'
): Promise<{ ok: boolean; errors?: any }> {
  const mutation = `
    mutation SetPolicy($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkUpdate(productId: $productId, variants: $variants) {
        productVariants { id inventoryPolicy }
        userErrors { field message }
      }
    }`;
  const result = await shopifyGraphql(store, mutation, {
    productId,
    variants: [{ id: variantId, inventoryPolicy: policy }],
  });
  if (!result.ok) return { ok: false, errors: result.errors };

  const userErrors = result.data?.productVariantsBulkUpdate?.userErrors || [];
  if (userErrors.length) return { ok: false, errors: userErrors };

  const updated = result.data?.productVariantsBulkUpdate?.productVariants?.[0];
  if (updated?.inventoryPolicy !== policy) {
    return { ok: false, errors: [{ message: `Policy did not update (got ${updated?.inventoryPolicy ?? 'nothing'})` }] };
  }
  return { ok: true };
}
