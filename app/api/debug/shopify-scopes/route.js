// Temporary. Asks Shopify which scopes this app's token actually holds.
import { shopifyGraphQL } from "@/lib/shopifyAdmin";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const d = await shopifyGraphQL(
      `query {
        currentAppInstallation {
          id
          accessScopes { handle }
        }
        shop { id name }
      }`,
      {}
    );
    return Response.json({
      granted: (d?.currentAppInstallation?.accessScopes || []).map((s) => s.handle),
      installation: d?.currentAppInstallation?.id || null,
      shop: d?.shop || null,
    });
  } catch (e) {
    return Response.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
