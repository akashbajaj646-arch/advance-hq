import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { logActivity } from "../am";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const location = String(body.location || "").trim().toUpperCase();
    const warehouseId = ["1", "2"].includes(String(body.warehouse_id)) ? Number(body.warehouse_id) : null;
    const items: { sku: string; qty: number | null }[] = Array.isArray(body.items) ? body.items : [];

    if (!/^[A-Z][0-9]+[A-F]$/.test(location)) {
      return NextResponse.json({ error: "Invalid location" }, { status: 400 });
    }
    const clean = items
      .map((i) => ({ sku: String(i.sku || "").trim().toUpperCase(), qty: i.qty ?? null }))
      .filter((i) => i.sku.length > 0);
    if (clean.length === 0) {
      return NextResponse.json({ error: "No items" }, { status: 400 });
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { error } = await supabase.from("sku_location_scans").insert(
      clean.map((i) => ({ sku: i.sku, location, box_qty: i.qty, warehouse_id: warehouseId }))
    );
    if (error) {
      console.error("save error", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    await logActivity({ event: "save", warehouse_id: warehouseId, bin: location, summary: { count: clean.length } });

    return NextResponse.json({ inserted: clean.length });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Save failed" }, { status: 500 });
  }
}
