import { publishRules, compileRules } from "@/lib/wholesaleRules";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Dry run: see what would publish, and which collections don't resolve.
export async function GET() {
  try {
    const { doc, missing } = await compileRules();
    return Response.json({
      rules: doc.rules.length,
      bytes: JSON.stringify(doc).length,
      missing_collections: missing,
      preview: doc,
    });
  } catch (e) {
    console.error("rules/publish GET:", e);
    return Response.json({ error: String(e?.message || e) }, { status: 500 });
  }
}

export async function POST() {
  try {
    let who = null;
    try {
      const s = await getSession();
      who = s?.user?.email || s?.user?.name || null;
    } catch (e) {}
    const result = await publishRules(who);
    return Response.json(result);
  } catch (e) {
    console.error("rules/publish POST:", e);
    return Response.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
