import { NextRequest, NextResponse } from "next/server";
import { amGet, amGetSkuWarehouse, amPutSkuWarehouseLocation, mapLimit } from "../am";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POST { changes: [{ skuId, amRowId, oldLocation, newLocation, action, style }], warehouse_id }
// Each write: re-read live -> verify still matches oldLocation (drift guard) -> PUT -> re-read -> verify newLocation.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const warehouseId = String(body.warehouse_id || "");
    const changes: any[] = Array.isArray(body.changes) ? body.changes : [];
    if (changes.length === 0) {
      return NextResponse.json({ error: "No changes" }, { status: 400 });
    }
    if (changes.length > 500) {
      return NextResponse.json({ error: "Too many changes in one apply (max 500)" }, { status: 400 });
    }

    const results = await mapLimit(changes, 3, async (c) => {
      const base = {
        skuId: String(c.skuId),
        amRowId: String(c.amRowId),
        action: c.action,
        newLocation: String(c.newLocation),
      };
      try {
        // drift guard: confirm live state still matches what preview showed
        const before = await amGetSkuWarehouse(base.skuId, warehouseId);
        const row = before.find((r: any) => String(r.id) === base.amRowId);
        if (!row) return { ...base, status: "error", detail: "row not found on re-read" };
        const live = String(row.location || "");
        if (live !== String(c.oldLocation)) {
          return {
            ...base,
            status: "skipped_drift",
            detail: `location changed since preview ("${live}") — re-run preview`,
          };
        }

        await amPutSkuWarehouseLocation(base.amRowId, base.newLocation);

        // round-trip proof (no-op writes also return 200, so this is the only real check)
        const after = await amGetSkuWarehouse(base.skuId, warehouseId);
        const rowAfter = after.find((r: any) => String(r.id) === base.amRowId);
        const verified = String(rowAfter?.location || "") === base.newLocation;
        return verified
          ? { ...base, status: "ok" }
          : { ...base, status: "error", detail: `write not reflected (reads "${rowAfter?.location}")` };
      } catch (e: any) {
        return { ...base, status: "error", detail: e.message };
      }
    });

    const ok = results.filter((r) => r.status === "ok").length;
    return NextResponse.json({
      applied: ok,
      skipped: results.filter((r) => r.status === "skipped_drift").length,
      errors: results.filter((r) => r.status === "error").length,
      results,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "apply failed" }, { status: 500 });
  }
}
