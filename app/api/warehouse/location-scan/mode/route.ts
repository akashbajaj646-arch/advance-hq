import { NextRequest, NextResponse } from "next/server";
import { sb } from "../am";

export const dynamic = "force-dynamic";

// GET ?bin=A1B — returns a stored mode override for the bin, or null.
export async function GET(req: NextRequest) {
  try {
    const bin = String(req.nextUrl.searchParams.get("bin") || "").trim().toUpperCase();
    if (!bin) return NextResponse.json({ mode: null });
    const { data, error } = await sb().from("bin_mode_overrides").select("mode").eq("bin", bin).maybeSingle();
    if (error) throw new Error(error.message);
    return NextResponse.json({ mode: data?.mode || null });
  } catch (e: any) {
    return NextResponse.json({ mode: null, error: e.message }, { status: 200 });
  }
}

// POST { bin, mode } — remember the user's choice for this bin.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const bin = String(body.bin || "").trim().toUpperCase();
    const mode = body.mode === "pickable" ? "pickable" : "box";
    if (!/^[A-Z][0-9]+[A-F]$/.test(bin)) {
      return NextResponse.json({ error: "Invalid bin" }, { status: 400 });
    }
    const { error } = await sb()
      .from("bin_mode_overrides")
      .upsert({ bin, mode, updated_at: new Date().toISOString() }, { onConflict: "bin" });
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "save failed" }, { status: 500 });
  }
}
