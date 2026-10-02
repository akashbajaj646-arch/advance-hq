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

export type ShopifySeo = { title: string | null; description: string | null };

/** Read a product's title, handle and SEO fields (read-only probe). */
export async function getProductSeo(
  store: ShopifyStore,
  productId: string
): Promise<{ ok: boolean; product: { id: string; title: string; handle: string; seo: ShopifySeo } | null; errors?: any }> {
  const query = `
    query ProductSeo($id: ID!) {
      product(id: $id) {
        id
        title
        handle
        seo { title description }
      }
    }`;
  const result = await shopifyGraphql(store, query, { id: productId });
  if (!result.ok) return { ok: false, product: null, errors: result.errors };
  const p = result.data?.product;
  if (!p) return { ok: true, product: null };
  return { ok: true, product: { id: p.id, title: p.title, handle: p.handle, seo: { title: p.seo?.title ?? null, description: p.seo?.description ?? null } } };
}

/** Write a product's SEO title + meta description, then verify from the mutation's returned record. */
export async function setProductSeo(
  store: ShopifyStore,
  productId: string,
  seo: { title: string; description: string }
): Promise<{ ok: boolean; seo?: ShopifySeo; errors?: any }> {
  const mutation = `
    mutation SetSeo($product: ProductUpdateInput!) {
      productUpdate(product: $product) {
        product { id seo { title description } }
        userErrors { field message }
      }
    }`;
  const result = await shopifyGraphql(store, mutation, {
    product: { id: productId, seo: { title: seo.title, description: seo.description } },
  });
  if (!result.ok) return { ok: false, errors: result.errors };

  const userErrors = result.data?.productUpdate?.userErrors || [];
  if (userErrors.length) return { ok: false, errors: userErrors };

  const got: ShopifySeo = {
    title: result.data?.productUpdate?.product?.seo?.title ?? null,
    description: result.data?.productUpdate?.product?.seo?.description ?? null,
  };
  if ((got.title || '') !== seo.title || (got.description || '') !== seo.description) {
    return { ok: false, seo: got, errors: [{ message: 'SEO did not update (returned values differ from what was sent)' }] };
  }
  return { ok: true, seo: got };
}

export type ShopifyProductHit = { id: string; title: string; handle: string; skus: string[] };

/** Product search (Shopify search syntax, e.g. `sku:ABC-123*` or a free-text term). */
export async function searchProducts(store: ShopifyStore, q: string, first = 10): Promise<{ ok: boolean; products: ShopifyProductHit[]; errors?: any }> {
  const query = `
    query SearchProducts($q: String!, $first: Int!) {
      products(first: $first, query: $q) {
        nodes {
          id
          title
          handle
          variants(first: 5) { nodes { sku } }
        }
      }
    }`;
  const result = await shopifyGraphql(store, query, { q, first });
  if (!result.ok) return { ok: false, products: [], errors: result.errors };
  const nodes = result.data?.products?.nodes || [];
  return {
    ok: true,
    products: nodes.map((n: any) => ({
      id: n.id,
      title: n.title,
      handle: n.handle,
      skus: (n.variants?.nodes || []).map((v: any) => String(v.sku || '')).filter(Boolean),
    })),
  };
}

/** Batch variant lookup by exact SKU (chunks of 25 OR'ed terms). Returns a map keyed by SKU. */
export async function findVariantsBySkus(
  store: ShopifyStore,
  skus: string[]
): Promise<{ ok: boolean; variants: Record<string, ShopifyVariant>; errors?: any }> {
  const unique = Array.from(new Set(skus.filter(Boolean)));
  const variants: Record<string, ShopifyVariant> = {};
  const query = `
    query FindVariants($q: String!) {
      productVariants(first: 100, query: $q) {
        nodes {
          id
          sku
          inventoryPolicy
          displayName
          product { id title }
        }
      }
    }`;
  for (let i = 0; i < unique.length; i += 25) {
    const chunk = unique.slice(i, i + 25);
    const q = chunk.map(s => `sku:"${s.replace(/"/g, '\\"')}"`).join(' OR ');
    const result = await shopifyGraphql(store, query, { q });
    if (!result.ok) return { ok: false, variants, errors: result.errors };
    const wanted = new Set(chunk);
    for (const n of result.data?.productVariants?.nodes || []) {
      if (!wanted.has(n.sku) || variants[n.sku]) continue;
      variants[n.sku] = {
        id: n.id,
        sku: n.sku,
        inventoryPolicy: n.inventoryPolicy,
        displayName: n.displayName,
        productId: n.product?.id,
        productTitle: n.product?.title,
      };
    }
  }
  return { ok: true, variants };
}

/** Set inventory policy on several variants of one Shopify product. Returns the policy Shopify reports back per variant id. */
export async function setInventoryPolicies(
  store: ShopifyStore,
  productId: string,
  items: { id: string; policy: 'CONTINUE' | 'DENY' }[]
): Promise<{ ok: boolean; policies: Record<string, string>; errors?: any }> {
  const mutation = `
    mutation SetPolicies($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkUpdate(productId: $productId, variants: $variants) {
        productVariants { id inventoryPolicy }
        userErrors { field message }
      }
    }`;
  const result = await shopifyGraphql(store, mutation, {
    productId,
    variants: items.map(i => ({ id: i.id, inventoryPolicy: i.policy })),
  });
  if (!result.ok) return { ok: false, policies: {}, errors: result.errors };

  const policies: Record<string, string> = {};
  for (const v of result.data?.productVariantsBulkUpdate?.productVariants || []) {
    if (v?.id) policies[v.id] = v.inventoryPolicy;
  }
  const userErrors = result.data?.productVariantsBulkUpdate?.userErrors || [];
  if (userErrors.length) return { ok: false, policies, errors: userErrors };
  return { ok: true, policies };
}

export type ShopifyProductStatus = { id: string; title: string; status: string };

/** Read status (ACTIVE / DRAFT / ARCHIVED) for a set of Shopify product ids. */
export async function getProductStatuses(
  store: ShopifyStore,
  productIds: string[]
): Promise<{ ok: boolean; products: ShopifyProductStatus[]; errors?: any }> {
  const ids = Array.from(new Set(productIds.filter(Boolean)));
  if (!ids.length) return { ok: true, products: [] };
  const query = `
    query ProductStatuses($ids: [ID!]!) {
      nodes(ids: $ids) { ... on Product { id title status } }
    }`;
  const result = await shopifyGraphql(store, query, { ids });
  if (!result.ok) return { ok: false, products: [], errors: result.errors };
  const products = (result.data?.nodes || [])
    .filter((n: any) => n?.id)
    .map((n: any) => ({ id: n.id, title: n.title, status: n.status }));
  return { ok: true, products };
}

/** Set a product's status (ACTIVE / DRAFT), verified from the mutation's returned record. */
export async function setProductStatus(
  store: ShopifyStore,
  productId: string,
  status: 'ACTIVE' | 'DRAFT'
): Promise<{ ok: boolean; status?: string; errors?: any }> {
  const mutation = `
    mutation SetStatus($product: ProductUpdateInput!) {
      productUpdate(product: $product) {
        product { id status }
        userErrors { field message }
      }
    }`;
  const result = await shopifyGraphql(store, mutation, { product: { id: productId, status } });
  if (!result.ok) return { ok: false, errors: result.errors };
  const userErrors = result.data?.productUpdate?.userErrors || [];
  if (userErrors.length) return { ok: false, errors: userErrors };
  const got = result.data?.productUpdate?.product?.status;
  if (got !== status) return { ok: false, status: got, errors: [{ message: `Status did not update (got ${got ?? 'nothing'})` }] };
  return { ok: true, status: got };
}
