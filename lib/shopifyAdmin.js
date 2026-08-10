// lib/shopifyAdmin.js
// Server-side only. 2026 Dev Dashboard flow: exchanges Client ID + Secret
// for an Admin API access token via client credentials grant, cached in
// memory and refreshed automatically before expiry.
//
// Env: SHOPIFY_STORE, SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET

const API_VERSION = "2026-01";

let cachedToken = null;
let tokenExpiresAt = 0;

async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiresAt - 60000) return cachedToken;

  const r = await fetch(
    `https://${process.env.SHOPIFY_STORE}.myshopify.com/admin/oauth/access_token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: process.env.SHOPIFY_CLIENT_ID,
        client_secret: process.env.SHOPIFY_CLIENT_SECRET,
        grant_type: "client_credentials",
      }),
    }
  );
  if (!r.ok) throw new Error(`Token exchange failed: ${r.status} ${await r.text()}`);
  const j = await r.json();
  cachedToken = j.access_token;
  // expires_in is seconds when present; permanent offline tokens omit it
  tokenExpiresAt = j.expires_in ? Date.now() + j.expires_in * 1000 : Date.now() + 86400000;
  return cachedToken;
}

export async function shopifyGraphQL(query, variables) {
  const token = await getAccessToken();
  const r = await fetch(
    `https://${process.env.SHOPIFY_STORE}.myshopify.com/admin/api/${API_VERSION}/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token,
      },
      body: JSON.stringify({ query, variables }),
      cache: "no-store",
    }
  );
  const j = await r.json();
  if (j.errors) throw new Error(JSON.stringify(j.errors));
  return j.data;
}

export const ACCESS_TAGS = ["wholesale", "wholesaletier", "VerifiedbyWholesaleAllInOne"];
