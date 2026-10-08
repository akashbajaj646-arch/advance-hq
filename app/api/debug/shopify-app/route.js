// Temporary. Reports which Shopify app Advance HQ authenticates as.
export const dynamic = "force-dynamic";

export async function GET() {
  const id = process.env.SHOPIFY_CLIENT_ID || "";
  return Response.json({
    client_id: id ? `${id.slice(0, 8)}...${id.slice(-4)}` : "MISSING",
    length: id.length,
    store: process.env.SHOPIFY_STORE || "MISSING",
    secret_set: !!process.env.SHOPIFY_CLIENT_SECRET,
  });
}
