import { NextRequest, NextResponse } from "next/server";
import {
  amGetSkuWarehouse,
  isPickableSegment,
  mapLimit,
  skuIdsForStyle,
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

    // 1) Resolve scanned styles -> sku_ids
    const presentSkuIds = new Set<string>();
    const skuStyle = new Map<string, string>();
    for (const style of styles) {
      const r = await skuIdsForStyle(style);
      if (r.skuIds.length === 0) {
        flags.push(`${style}: no matching style found in inventory — skipped`);
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
        flags.push(`${skuStyle.get(skuId)} sku ${skuId}: no sku_warehouse row in this warehouse`);
        return;
      }
      for (const row of rows) {
        const old = String(row.location || "");
        if (old.trim() === "") {
          flags.push(
            `${skuStyle.get(skuId)} sku ${skuId}: empty location (no pickable area on record) — set it manually first`
          );
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

    await mapLimit(Array.from(new Set(removalSkuIds)), 4, async (skuId) => {
      const rows = await amGetSkuWarehouse(skuId, warehouseId);
      for (const row of rows) {
        const old = String(row.location || "");
        if (isPickableSegment(old, bin)) {
          flags.push(`sku ${skuId}: ${bin} is the PICKABLE segment ("${old}") — not touched, review manually`);
          continue;
        }
        const next = withBoxRemoved(old, bin);
        if (next) {
          changes.push({
            action: "remove",
            style: "",
            skuId,
            amRowId: String(row.id),
            oldLocation: old,
            newLocation: next,
          });
        }
      }
    });

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
