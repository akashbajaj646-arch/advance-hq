import { NextRequest, NextResponse } from "next/server";
import {
  amGetSkuWarehouse,
  amPutSkuWarehouseLocation,
  mapLimit,
  sb,
  segmentsEqual,
} from "../am";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// GET — recent change log rows (newest first), grouped into batches by the page.
export async function GET() {
  try {
    const { data, error } = await sb()
      .from("location_change_log")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(300);
    if (error) throw new Error(error.message);
    return NextResponse.json({ rows: data || [] });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "history failed" }, { status: 500 });
  }
}

// POST { batch_id } — revert every successfully applied change in the batch.
// Drift-guarded: only reverts rows whose live AM location still matches what the batch wrote.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const batchId = String(body.batch_id || "");
    if (!batchId) return NextResponse.json({ error: "batch_id required" }, { status: 400 });

    const supabase = sb();
    const { data, error } = await supabase
      .from("location_change_log")
      .select("*")
      .eq("batch_id", batchId)
      .eq("status", "ok")
      .is("reverted_at", null);
    if (error) throw new Error(error.message);
    const rows = data || [];
    if (rows.length === 0) {
      return NextResponse.json({ reverted: 0, skipped: 0, errors: 0, results: [] });
    }

    const results = await mapLimit(rows, 3, async (row: any) => {
      const label = row.style || `sku ${row.sku_id}`;
      try {
        const live = await amGetSkuWarehouse(String(row.sku_id), String(row.warehouse_id));
        const amRow = live.find((r: any) => String(r.id) === String(row.am_row_id));
        if (!amRow) return { id: row.id, label, status: "error", detail: "row not found in AM" };
        const current = String(amRow.location || "");
        if (!segmentsEqual(current, String(row.new_location))) {
          return {
            id: row.id,
            label,
            status: "skipped_drift",
            detail: `location changed since this batch ("${current}")`,
          };
        }
        await amPutSkuWarehouseLocation(String(row.am_row_id), String(row.old_location));
        const after = await amGetSkuWarehouse(String(row.sku_id), String(row.warehouse_id));
        const afterRow = after.find((r: any) => String(r.id) === String(row.am_row_id));
        if (!segmentsEqual(String(afterRow?.location || ""), String(row.old_location))) {
          return { id: row.id, label, status: "error", detail: "revert write not reflected" };
        }
        await supabase
          .from("location_change_log")
          .update({ reverted_at: new Date().toISOString() })
          .eq("id", row.id);
        return { id: row.id, label, status: "ok" };
      } catch (e: any) {
        return { id: row.id, label, status: "error", detail: e.message };
      }
    });

    return NextResponse.json({
      reverted: results.filter((r) => r.status === "ok").length,
      skipped: results.filter((r) => r.status === "skipped_drift").length,
      errors: results.filter((r) => r.status === "error").length,
      results,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "revert failed" }, { status: 500 });
  }
}
