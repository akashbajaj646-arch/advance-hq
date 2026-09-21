import { NextRequest, NextResponse } from "next/server";
import { amGetSkuWarehouse, amPutSkuWarehouseLocation, mapLimit, sb, segmentsEqual } from "../am";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POST { changes: [{ skuId, amRowId, oldLocation, newLocation, action, style }], warehouse_id }
// Each write: re-read live -> verify still matches oldLocation (drift guard) -> PUT -> re-read -> verify newLocation.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const warehouseId = String(body.warehouse_id || "");
    const bin = String(body.location || "").trim().toUpperCase();
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
        style: String(c.style || ""),
        amRowId: String(c.amRowId),
        action: c.action,
        oldLocation: String(c.oldLocation),
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
        // AM normalizes location strings on save (spacing/trailing commas), so compare segments not raw text.
        const verified = segmentsEqual(String(rowAfter?.location || ""), base.newLocation);
        return verified
          ? { ...base, status: "ok" }
          : { ...base, status: "error", detail: `write not reflected (reads "${rowAfter?.location}")` };
      } catch (e: any) {
        return { ...base, status: "error", detail: e.message };
      }
    });

    // Audit log — one row per attempted change, grouped by batch.
    const batchId = crypto.randomUUID();
    try {
      const { error: logErr } = await sb().from("location_change_log").insert(
        results.map((r: any) => ({
          batch_id: batchId,
          warehouse_id: Number(warehouseId),
          bin,
          style: r.style || null,
          sku_id: r.skuId,
          am_row_id: r.amRowId,
          action: r.action,
          old_location: r.oldLocation,
          new_location: r.newLocation,
          status: r.status,
          detail: r.detail || null,
        }))
      );
      if (logErr) console.error("change log insert failed", logErr);
    } catch (e) {
      console.error("change log insert failed", e);
    }

    const ok = results.filter((r) => r.status === "ok").length;
    return NextResponse.json({
      batch_id: batchId,
      applied: ok,
      skipped: results.filter((r) => r.status === "skipped_drift").length,
      errors: results.filter((r) => r.status === "error").length,
      results,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "apply failed" }, { status: 500 });
  }
}
