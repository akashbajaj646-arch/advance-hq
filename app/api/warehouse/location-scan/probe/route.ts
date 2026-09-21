import { NextRequest, NextResponse } from "next/server";
import { amGetSkuWarehouse, mapLimit, skuIdsForStyle, WAREHOUSES } from "../am";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/warehouse/location-scan/probe?style=16064&warehouse=1
// Read-only. Run this on a known style before trusting preview/apply.
export async function GET(req: NextRequest) {
  try {
    const style = req.nextUrl.searchParams.get("style") || "";
    const warehouse = req.nextUrl.searchParams.get("warehouse") || "1";
    if (!style) return NextResponse.json({ error: "style param required" }, { status: 400 });

    const resolved = await skuIdsForStyle(style);
    const sampleSkus = resolved.skuIds.slice(0, 5);
    const amRows = await mapLimit(sampleSkus, 3, async (skuId) => {
      const rows = await amGetSkuWarehouse(skuId, warehouse);
      return {
        skuId,
        rows: rows.map((r: any) => ({
          id: r.id,
          warehouse_id: r.warehouse_id ?? r.warehouse,
          location: r.location,
          qty_inventory: r.qty_inventory,
        })),
      };
    });

    return NextResponse.json({
      input: { style, warehouse, warehouse_name: WAREHOUSES[warehouse] },
      matchedStyle: resolved.matchedStyle,
      detectedColumns: resolved.detected,
      skuCount: resolved.skuIds.length,
      skuIds: resolved.skuIds,
      amSample: amRows,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "probe failed" }, { status: 500 });
  }
}
