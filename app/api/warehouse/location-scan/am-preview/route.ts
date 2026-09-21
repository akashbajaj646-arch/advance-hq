import { NextRequest, NextResponse } from "next/server";
import {
  amGetSkuWarehouse,
  isPickableSegment,
  mapLimit,
  skuIdsForStyle,
  stylesForSkuIds,
  syncedRowsMentioningBin,
  withBoxAdded,
  withBoxRemoved,
} from "../am";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export type Change = {
  action: "add" | "remove";
  style: string;
  skuId: string;
  amRowId: string;
  oldLocation: string;
  newLocation: string;
};

// POST { warehouse_id: "1"|"2", location: "G11B", styles: ["AB-16064", ...] }
// Dry run — computes the change set against LIVE AM reads, writes nothing.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const warehouseId = String(body.warehouse_id || "");
    const bin = String(body.location || "").trim().toUpperCase();
    const styles: string[] = Array.isArray(body.styles) ? body.styles : [];
    if (!["1", "2"].includes(warehouseId) || !bin) {
      return NextResponse.json({ error: "warehouse_id and location required" }, { status: 400 });
    }

    const changes: Change[] = [];
    const flags: string[] = [];

    const count = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) || 0) + 1);
    const emptyLoc = new Map<string, number>();
    const noRow = new Map<string, number>();
    const pickableHit = new Map<string, number>();

    // 1) Resolve scanned styles -> sku_ids
    const presentSkuIds = new Set<string>();
    const skuStyle = new Map<string, string>();
    for (const style of styles) {
      const r = await skuIdsForStyle(style);
      if (r.skuIds.length === 0) {
        flags.push(`${style}: no matching product found in inventory — skipped`);
        continue;
      }
      for (const id of r.skuIds) {
        presentSkuIds.add(id);
        skuStyle.set(id, r.matchedStyle || style);
      }
    }

    // 2) ADDS: scanned SKUs whose live AM location lacks this bin
    await mapLimit(Array.from(presentSkuIds), 4, async (skuId) => {
      const rows = await amGetSkuWarehouse(skuId, warehouseId);
      if (rows.length === 0) {
        count(noRow, skuStyle.get(skuId) || "");
        return;
      }
      for (const row of rows) {
        const old = String(row.location || "");
        if (old.trim() === "") {
          count(emptyLoc, skuStyle.get(skuId) || "");
          continue;
        }
        const next = withBoxAdded(old, bin);
        if (next) {
          changes.push({
            action: "add",
            style: skuStyle.get(skuId) || "",
            skuId,
            amRowId: String(row.id),
            oldLocation: old,
            newLocation: next,
          });
        }
      }
    });

    // 3) REMOVALS: SKUs in this warehouse whose location mentions the bin but were NOT scanned
    const candidates = await syncedRowsMentioningBin(warehouseId, bin);
    const removalSkuIds = candidates
      .map((c) => c.skuId)
      .filter((id) => !presentSkuIds.has(id));

    const uniqueRemovalIds = Array.from(new Set(removalSkuIds));
    const removalStyles = await stylesForSkuIds(uniqueRemovalIds);

    await mapLimit(uniqueRemovalIds, 4, async (skuId) => {
      const style = removalStyles.get(skuId) || `sku ${skuId}`;
      const rows = await amGetSkuWarehouse(skuId, warehouseId);
      for (const row of rows) {
        const old = String(row.location || "");
        if (isPickableSegment(old, bin)) {
          count(pickableHit, style);
          continue;
        }
        const next = withBoxRemoved(old, bin);
        if (next) {
          changes.push({
            action: "remove",
            style,
            skuId,
            amRowId: String(row.id),
            oldLocation: old,
            newLocation: next,
          });
        }
      }
    });

    const plural = (n: number) => `${n} SKU${n === 1 ? "" : "s"}`;
    for (const [style, n] of Array.from(emptyLoc)) {
      flags.push(`${style}: ${plural(n)} with empty location in AM (no pickable area to preserve) — set the pickable area in AM, then re-run`);
    }
    for (const [style, n] of Array.from(noRow)) {
      flags.push(`${style}: ${plural(n)} with no location record in this warehouse`);
    }
    for (const [style, n] of Array.from(pickableHit)) {
      flags.push(`${style}: ${bin} is the PICKABLE area for ${plural(n)} — not touched, review manually`);
    }

    return NextResponse.json({
      bin,
      warehouse_id: warehouseId,
      adds: changes.filter((c) => c.action === "add"),
      removals: changes.filter((c) => c.action === "remove"),
      flags,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "preview failed" }, { status: 500 });
  }
}
