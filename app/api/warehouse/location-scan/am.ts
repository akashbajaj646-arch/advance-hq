import { createClient } from "@supabase/supabase-js";

// Legacy AM JSON API (read via query token, write via token+time in body — proven pattern)
// Uses the same env vars as the existing legacy sync routes.
const AM_JSON_TOKEN = (process.env.APPARELMAGIC_TOKEN || process.env.AM_JSON_TOKEN)!;
const AM_JSON_BASE = (() => {
  const raw = (process.env.NEXT_PUBLIC_APPARELMAGIC_URL || process.env.AM_JSON_BASE || "").replace(/\/+$/, "");
  return raw.endsWith("/api/json") ? raw : `${raw}/api/json`;
})();

export const WAREHOUSES: Record<string, string> = { "1": "Leuning St", "2": "State St" };

export function sb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

function authParams() {
  return { time: String(Math.floor(Date.now() / 1000)), token: AM_JSON_TOKEN };
}

function unwrap(data: any): any[] {
  if (Array.isArray(data)) return data;
  for (const k of ["response", "results", "sku_warehouse", "data"]) {
    if (Array.isArray(data?.[k])) return data[k];
  }
  return [];
}

export async function amGet(resource: string, params: Record<string, string> = {}) {
  const qs = new URLSearchParams({ ...authParams(), "pagination[page_size]": "10", ...params });
  const res = await fetch(`${AM_JSON_BASE}/${resource}?${qs}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`AM GET ${resource} -> HTTP ${res.status}`);
  return res.json();
}

export async function amGetSkuWarehouse(skuId: string, warehouseId: string) {
  const data = await amGet("sku_warehouse", {
    "parameters[0][field]": "sku_id",
    "parameters[0][operator]": "=",
    "parameters[0][value]": skuId,
  });
  const rows = unwrap(data);
  return rows.filter(
    (r) => String(r.warehouse_id ?? r.warehouse ?? "") === String(warehouseId)
  );
}

export async function amPutSkuWarehouseLocation(rowId: string, location: string): Promise<string> {
  const res = await fetch(`${AM_JSON_BASE}/sku_warehouse/${rowId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...authParams(), location }),
  });
  const text = await res.text().catch(() => "");
  if (!res.ok) throw new Error(`AM PUT sku_warehouse/${rowId} -> HTTP ${res.status} ${text.slice(0, 200)}`);
  // No-op writes return 200 with empty body; caller must verify by re-reading.
  return text;
}

export async function logActivity(entry: {
  event: string;
  warehouse_id?: number | null;
  bin?: string | null;
  batch_id?: string | null;
  summary?: any;
  image_paths?: string[] | null;
}) {
  try {
    const { error } = await sb().from("location_activity_log").insert({
      event: entry.event,
      warehouse_id: entry.warehouse_id ?? null,
      bin: entry.bin ?? null,
      batch_id: entry.batch_id ?? null,
      summary: entry.summary ?? null,
      image_paths: entry.image_paths ?? null,
    });
    if (error) console.error("activity log failed", error.message);
  } catch (e) {
    console.error("activity log failed", e);
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---- location string helpers ----
export const segments = (loc: string) =>
  String(loc || "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);

export const joinSegments = (segs: string[]) => segs.join(", ");

/** Ensure bin exists after the pickable (first) segment. Returns null if no change. */
export function withBoxAdded(loc: string, bin: string): string | null {
  const segs = segments(loc);
  if (segs.includes(bin)) return null;
  if (segs.length === 0) return null; // no pickable area on record — flag upstream, don't invent one
  return joinSegments([...segs, bin]);
}

/** Remove bin from post-comma segments only. Returns null if no change. */
export function withBoxRemoved(loc: string, bin: string): string | null {
  const segs = segments(loc);
  if (segs.length === 0) return null;
  const [pick, ...rest] = segs;
  if (!rest.includes(bin)) return null;
  return joinSegments([pick, ...rest.filter((s) => s !== bin)]);
}

/** Compare two location strings by their parsed segments (AM normalizes strings on save). */
export function segmentsEqual(a: string, b: string): boolean {
  const sa = segments(a);
  const sb = segments(b);
  return sa.length === sb.length && sa.every((v, i) => v === sb[i]);
}

/** Set bin as the pickable (first) segment, keeping box segments. Returns null if no change. */
export function withPickableSet(loc: string, bin: string): string | null {
  const segs = segments(loc);
  if (segs.length === 0) return bin;
  if (segs[0] === bin) return null;
  const rest = segs.slice(1).filter((s) => s !== bin);
  return joinSegments([bin, ...rest]);
}

export function isPickableSegment(loc: string, bin: string): boolean {
  const segs = segments(loc);
  return segs.length > 0 && segs[0] === bin;
}

// ---- runtime column detection (schemas differ between synced tables) ----
export function detectKey(row: any, candidates: string[]): string | null {
  if (!row) return null;
  const keys = Object.keys(row);
  for (const c of candidates) {
    const hit = keys.find((k) => k.toLowerCase() === c);
    if (hit) return hit;
  }
  return null;
}

export const STYLE_KEYS = ["style_number", "style_no", "style"];
export const SKU_KEYS = ["sku_id", "am_sku_id", "skuid"];
export const WH_KEYS = ["warehouse_id", "warehouse", "am_warehouse_id"];
export const LOC_KEYS = ["location", "bins", "bin_location", "bin"];

export function styleVariants(input: string): string[] {
  const raw = input.toUpperCase().replace(/\s/g, "");
  const bare = raw.replace(/^AB-?/, "");
  return Array.from(new Set([raw, bare, `AB-${bare}`, `AB${bare}`]));
}

/** Resolve a style (as written on pallet papers) to its sku_ids via the inventory table. */
export async function skuIdsForStyle(style: string): Promise<{
  skuIds: string[];
  matchedStyle: string | null;
  detected: { styleKey: string | null; skuKey: string | null };
}> {
  const supabase = sb();
  const probe = await supabase.from("inventory").select("*").limit(1);
  if (probe.error) throw new Error(`inventory probe: ${probe.error.message}`);
  const sample = probe.data?.[0];
  const styleKey = detectKey(sample, STYLE_KEYS);
  const skuKey = detectKey(sample, SKU_KEYS);
  if (!styleKey || !skuKey) {
    throw new Error(
      `Could not detect columns on inventory. Keys: ${Object.keys(sample || {}).join(", ")}`
    );
  }
  for (const v of styleVariants(style)) {
    const { data, error } = await supabase
      .from("inventory")
      .select(`${skuKey}, ${styleKey}`)
      .eq(styleKey, v)
      .limit(2000);
    if (error) throw new Error(`inventory query: ${error.message}`);
    if (data && data.length > 0) {
      return {
        skuIds: Array.from(new Set(data.map((r: any) => String(r[skuKey])))),
        matchedStyle: v,
        detected: { styleKey, skuKey },
      };
    }
  }
  return { skuIds: [], matchedStyle: null, detected: { styleKey, skuKey } };
}

/** Batch-resolve sku_ids back to their product/style numbers (for display). */
export async function stylesForSkuIds(skuIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (skuIds.length === 0) return map;
  const supabase = sb();
  const probe = await supabase.from("inventory").select("*").limit(1);
  const sample = probe.data?.[0];
  const styleKey = detectKey(sample, STYLE_KEYS);
  const skuKey = detectKey(sample, SKU_KEYS);
  if (!styleKey || !skuKey) return map;
  for (let i = 0; i < skuIds.length; i += 500) {
    const chunk = skuIds.slice(i, i + 500);
    const { data } = await supabase
      .from("inventory")
      .select(`${skuKey}, ${styleKey}`)
      .in(skuKey, chunk);
    for (const r of (data || []) as any[]) map.set(String(r[skuKey]), String(r[styleKey]));
  }
  return map;
}

/** Find synced sku_warehouse rows in a warehouse whose location mentions a bin. */
export async function syncedRowsMentioningBin(warehouseId: string, bin: string) {
  const supabase = sb();
  const probe = await supabase.from("sku_warehouse_locations").select("*").limit(1);
  if (probe.error) throw new Error(`sku_warehouse_locations probe: ${probe.error.message}`);
  const sample = probe.data?.[0];
  const whKey = detectKey(sample, WH_KEYS);
  const locKey = detectKey(sample, LOC_KEYS);
  const skuKey = detectKey(sample, SKU_KEYS);
  if (!whKey || !locKey || !skuKey) {
    throw new Error(
      `Could not detect columns on sku_warehouse_locations. Keys: ${Object.keys(sample || {}).join(", ")}`
    );
  }
  const { data, error } = await supabase
    .from("sku_warehouse_locations")
    .select("*")
    .eq(whKey, warehouseId)
    .ilike(locKey, `%${bin}%`)
    .limit(3000);
  if (error) throw new Error(`sku_warehouse_locations query: ${error.message}`);
  // exact segment match only (avoid G1B matching G11B etc.)
  return (data || [])
    .filter((r: any) => segments(String(r[locKey])).includes(bin))
    .map((r: any) => ({ skuId: String(r[skuKey]), syncedLocation: String(r[locKey]) }));
}

export async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]);
      }
    })
  );
  return out;
}
