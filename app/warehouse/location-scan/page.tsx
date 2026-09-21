"use client";

import { useRef, useState } from "react";

type Row = { sku: string; qty: string; crossed_out: boolean; note: string };
type Img = { name: string; dataUrl: string };
type Change = {
  action: "add" | "remove";
  style: string;
  skuId: string;
  amRowId: string;
  oldLocation: string;
  newLocation: string;
};
type Preview = { adds: Change[]; removals: Change[]; flags: string[] };

const MAX_DIM = 1800;
const JPEG_Q = 0.8;
const WAREHOUSES = [
  { id: "1", name: "Leuning St" },
  { id: "2", name: "State St" },
];

async function downscale(file: File): Promise<Img> {
  const dataUrl: string = await new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = () => rej(new Error("read failed"));
    r.readAsDataURL(file);
  });
  const img: HTMLImageElement = await new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error("decode failed"));
    i.src = dataUrl;
  });
  const scale = Math.min(1, MAX_DIM / Math.max(img.width, img.height));
  if (scale === 1 && file.type === "image/jpeg" && file.size < 900_000) {
    return { name: file.name, dataUrl };
  }
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return { name: file.name, dataUrl: canvas.toDataURL("image/jpeg", JPEG_Q) };
}

export default function LocationScanPage() {
  const [warehouse, setWarehouse] = useState("1");
  const [location, setLocation] = useState("");
  const [images, setImages] = useState<Img[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [amBusy, setAmBusy] = useState(false);
  const [applying, setApplying] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [applyResult, setApplyResult] = useState<any>(null);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [histRows, setHistRows] = useState<any[]>([]);
  const [histBusy, setHistBusy] = useState(false);
  const [revertingBatch, setRevertingBatch] = useState<string | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const filesRef = useRef<HTMLInputElement>(null);

  const loc = location.trim().toUpperCase();
  const keptRows = rows.filter((r) => !r.crossed_out && r.sku.trim() !== "");

  async function addFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    setErr("");
    try {
      const next: Img[] = [];
      for (const f of Array.from(list)) next.push(await downscale(f));
      setImages((prev) => [...prev, ...next]);
    } catch {
      setErr("Could not read one of the images. Try again.");
    }
  }

  async function scan() {
    setErr("");
    setMsg("");
    setPreview(null);
    setApplyResult(null);
    setSaved(false);
    if (!/^[A-Z][0-9]+[A-F]$/.test(loc)) {
      setErr("Location should look like A1A (aisle letter, rack number, level A-F).");
      return;
    }
    if (images.length === 0) {
      setErr("Add at least one photo.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/warehouse/location-scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          location: loc,
          images: images.map((i) => ({ media_type: "image/jpeg", data: i.dataUrl.split(",")[1] })),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Scan failed");
      const items: Row[] = (json.items || []).map((it: any) => ({
        sku: String(it.sku || ""),
        qty: it.qty == null ? "" : String(it.qty),
        crossed_out: !!it.crossed_out,
        note: String(it.note || ""),
      }));
      setRows(items);
      const kept = items.filter((r) => !r.crossed_out).length;
      setMsg(
        `Read ${items.length} line${items.length === 1 ? "" : "s"} (${kept} kept, ${items.length - kept} crossed out). Review, then save.`
      );
    } catch (e: any) {
      setErr(e.message || "Scan failed");
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setErr("");
    if (keptRows.length === 0) {
      setErr("Nothing to save.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/warehouse/location-scan/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          location: loc,
          warehouse_id: warehouse,
          items: keptRows.map((r) => ({
            sku: r.sku.trim().toUpperCase(),
            qty: r.qty.trim() === "" ? null : Number(r.qty),
          })),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Save failed");
      setSaved(true);
      setMsg(`Saved ${json.inserted} rows for ${loc}. Now preview the AM update.`);
    } catch (e: any) {
      setErr(e.message || "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function previewAm() {
    setErr("");
    setApplyResult(null);
    setAmBusy(true);
    try {
      const res = await fetch("/api/warehouse/location-scan/am-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          warehouse_id: warehouse,
          location: loc,
          styles: keptRows.map((r) => r.sku.trim().toUpperCase()),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Preview failed");
      setPreview(json);
      setMsg("");
    } catch (e: any) {
      setErr(e.message || "Preview failed");
    } finally {
      setAmBusy(false);
    }
  }

  async function applyAm() {
    if (!preview) return;
    const changes = [...preview.adds, ...preview.removals];
    if (changes.length === 0) return;
    setErr("");
    setApplying(true);
    try {
      const res = await fetch("/api/warehouse/location-scan/am-apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ warehouse_id: warehouse, location: loc, changes }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Apply failed");
      setApplyResult(json);
    } catch (e: any) {
      setErr(e.message || "Apply failed");
    } finally {
      setApplying(false);
    }
  }

  async function loadHistory() {
    setHistBusy(true);
    try {
      const res = await fetch("/api/warehouse/location-scan/history");
      const json = await res.json();
      setHistRows(json.rows || []);
    } catch {}
    setHistBusy(false);
  }

  async function revertBatch(batchId: string) {
    if (!window.confirm("Revert every applied change in this batch back to its previous location?")) return;
    setRevertingBatch(batchId);
    setErr("");
    try {
      const res = await fetch("/api/warehouse/location-scan/history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batch_id: batchId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Revert failed");
      await loadHistory();
    } catch (e: any) {
      setErr(e.message || "Revert failed");
    }
    setRevertingBatch(null);
  }

  function resetAll() {
    setLocation("");
    setImages([]);
    setRows([]);
    setPreview(null);
    setApplyResult(null);
    setSaved(false);
    setMsg("");
    setErr("");
  }

  function downloadCsv() {
    const lines = ["SKU,Location", ...keptRows.map((r) => `${r.sku.trim().toUpperCase()},${loc}`)];
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${loc || "scan"}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function setRow(i: number, patch: Partial<Row>) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  return (
    <div style={{ maxWidth: 560, margin: "0 auto", padding: "16px 14px 90px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Box Location Update</h1>
        <button
          type="button"
          onClick={() => {
            const n = !showHistory;
            setShowHistory(n);
            if (n) loadHistory();
          }}
          style={btnLink}
        >
          {showHistory ? "Close history" : "History"}
        </button>
      </div>
      <p style={{ fontSize: 13, color: "#666", marginBottom: 14 }}>
        Pick the warehouse, enter the bin, photograph the pallet papers, scan, save, then push to AM.
      </p>

      {showHistory && (
        <div style={{ marginBottom: 20 }}>
          {histBusy ? (
            <div style={{ fontSize: 13, color: "#666" }}>Loading history…</div>
          ) : (
            (() => {
              const batches = new Map<string, any[]>();
              for (const r of histRows) {
                if (!batches.has(r.batch_id)) batches.set(r.batch_id, []);
                batches.get(r.batch_id)!.push(r);
              }
              if (batches.size === 0)
                return <div style={{ fontSize: 13, color: "#666" }}>No changes logged yet.</div>;
              return Array.from(batches.entries()).map(([bid, rows]) => {
                const first = rows[0];
                const okCount = rows.filter((r: any) => r.status === "ok").length;
                const fullyReverted =
                  okCount > 0 && rows.every((r: any) => r.status !== "ok" || r.reverted_at);
                const d = new Date(first.created_at);
                return (
                  <div
                    key={bid}
                    style={{ border: "1px solid #eee", borderRadius: 10, padding: "10px 12px", marginBottom: 10 }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <b style={{ fontSize: 13 }}>
                        {first.bin} · {Number(first.warehouse_id) === 1 ? "Leuning St" : "State St"} ·{" "}
                        {d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                      </b>
                      {fullyReverted ? (
                        <span style={{ fontSize: 12, color: "#999" }}>reverted</span>
                      ) : okCount > 0 ? (
                        <button
                          type="button"
                          onClick={() => revertBatch(bid)}
                          disabled={revertingBatch === bid}
                          style={{ ...btnLink, color: "#a12622" }}
                        >
                          {revertingBatch === bid ? "Reverting…" : "Revert"}
                        </button>
                      ) : null}
                    </div>
                    <div style={{ fontSize: 12, color: "#666", margin: "2px 0 6px" }}>
                      {okCount} applied · {rows.length - okCount} other
                    </div>
                    {rows.map((r: any, i: number) => (
                      <div
                        key={i}
                        style={{
                          fontSize: 12,
                          padding: "3px 0",
                          borderTop: "1px solid #f5f5f5",
                          opacity: r.reverted_at ? 0.5 : 1,
                        }}
                      >
                        <b>{r.style || `sku ${r.sku_id}`}</b> [{r.action}]{" "}
                        <span style={{ color: "#999" }}>{r.old_location}</span> → {r.new_location}
                        {r.status !== "ok" && <span style={{ color: "#a12622" }}> ({r.status})</span>}
                        {r.reverted_at && <span style={{ color: "#999" }}> (reverted)</span>}
                      </div>
                    ))}
                  </div>
                );
              });
            })()
          )}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        {WAREHOUSES.map((w) => (
          <button
            key={w.id}
            type="button"
            onClick={() => setWarehouse(w.id)}
            style={{
              flex: 1,
              padding: "12px 8px",
              fontSize: 15,
              fontWeight: 700,
              borderRadius: 10,
              border: warehouse === w.id ? "2px solid #111" : "1px solid #ddd",
              background: warehouse === w.id ? "#111" : "#fff",
              color: warehouse === w.id ? "#fff" : "#111",
            }}
          >
            {w.name}
          </button>
        ))}
      </div>

      <label style={{ fontSize: 13, fontWeight: 600 }}>Location</label>
      <input
        value={location}
        onChange={(e) => setLocation(e.target.value.toUpperCase())}
        placeholder="A1A"
        autoCapitalize="characters"
        autoCorrect="off"
        inputMode="text"
        style={{
          width: "100%",
          fontSize: 22,
          letterSpacing: 2,
          padding: "12px 14px",
          border: "1px solid #ccc",
          borderRadius: 10,
          margin: "6px 0 14px",
          textTransform: "uppercase",
        }}
      />

      <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
        <button type="button" onClick={() => cameraRef.current?.click()} style={btnSecondary}>
          📷 Take photo
        </button>
        <button type="button" onClick={() => filesRef.current?.click()} style={btnSecondary}>
          🖼 Choose files
        </button>
      </div>
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => {
          addFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <input
        ref={filesRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          addFiles(e.target.files);
          e.target.value = "";
        }}
      />

      {images.length > 0 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
          {images.map((img, i) => (
            <div key={i} style={{ position: "relative" }}>
              <img src={img.dataUrl} alt="" style={{ width: 84, height: 84, objectFit: "cover", borderRadius: 8 }} />
              <button
                type="button"
                onClick={() => setImages((prev) => prev.filter((_, idx) => idx !== i))}
                style={{ position: "absolute", top: -6, right: -6, width: 22, height: 22, borderRadius: 11, border: "none", background: "#111", color: "#fff", fontSize: 12, lineHeight: "22px" }}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      <button type="button" onClick={scan} disabled={busy} style={btnPrimary}>
        {busy ? "Scanning…" : `Scan${images.length > 0 ? ` (${images.length})` : ""}`}
      </button>

      {err && <div style={boxErr}>{err}</div>}
      {msg && !err && <div style={boxOk}>{msg}</div>}

      {rows.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span style={{ fontSize: 14, fontWeight: 700 }}>
              {WAREHOUSES.find((w) => w.id === warehouse)?.name} · {loc} · {keptRows.length} SKUs
            </span>
            <button type="button" onClick={() => setRows((p) => [...p, { sku: "", qty: "", crossed_out: false, note: "" }])} style={btnLink}>
              + Add row
            </button>
          </div>
          {rows.map((r, i) => (
            <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", padding: "8px 0", borderBottom: "1px solid #eee", opacity: r.crossed_out ? 0.45 : 1 }}>
              <input
                value={r.sku}
                onChange={(e) => setRow(i, { sku: e.target.value.toUpperCase() })}
                placeholder="AB-12345"
                style={{ flex: 1, fontSize: 16, padding: "10px 10px", border: "1px solid #ddd", borderRadius: 8, textDecoration: r.crossed_out ? "line-through" : "none" }}
              />
              <input
                value={r.qty}
                onChange={(e) => setRow(i, { qty: e.target.value.replace(/[^0-9]/g, "") })}
                placeholder="qty"
                inputMode="numeric"
                style={{ width: 58, fontSize: 16, padding: "10px 8px", border: "1px solid #ddd", borderRadius: 8, textAlign: "center" }}
              />
              <button type="button" title={r.crossed_out ? "Include" : "Exclude"} onClick={() => setRow(i, { crossed_out: !r.crossed_out })} style={{ ...iconBtn, background: r.crossed_out ? "#eee" : "#fff" }}>
                {r.crossed_out ? "↩" : "✂"}
              </button>
              <button type="button" onClick={() => setRows((prev) => prev.filter((_, idx) => idx !== i))} style={iconBtn}>
                🗑
              </button>
            </div>
          ))}
          {rows.some((r) => r.note) && (
            <div style={{ fontSize: 12, color: "#8a6d1a", background: "#fdf6e3", borderRadius: 8, padding: "8px 10px", marginTop: 10 }}>
              {rows.filter((r) => r.note).map((r, i) => (
                <div key={i}>
                  <b>{r.sku || "?"}</b>: {r.note}
                </div>
              ))}
            </div>
          )}
          <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
            <button type="button" onClick={save} disabled={saving} style={{ ...btnPrimary, marginTop: 0 }}>
              {saving ? "Saving…" : saved ? "Saved ✓" : "Save to HQ"}
            </button>
            <button type="button" onClick={downloadCsv} style={{ ...btnSecondary, flex: "0 0 auto" }}>
              CSV
            </button>
          </div>

          {saved && !preview && (
            <button type="button" onClick={previewAm} disabled={amBusy} style={{ ...btnPrimary, background: "#0a58ca", marginTop: 12 }}>
              {amBusy ? "Checking AM…" : "Preview AM changes"}
            </button>
          )}
        </div>
      )}

      {preview && (
        <div style={{ marginTop: 18 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>
            AM changes for {loc} — {WAREHOUSES.find((w) => w.id === warehouse)?.name}
          </h2>

          <ChangeList title={`Adds (${preview.adds.length})`} color="#1e6b2e" items={preview.adds} />
          <ChangeList title={`Removals (${preview.removals.length})`} color="#a12622" items={preview.removals} />

          {preview.flags.length > 0 && (
            <div style={{ fontSize: 12, color: "#8a6d1a", background: "#fdf6e3", borderRadius: 8, padding: "8px 10px", marginTop: 10 }}>
              {preview.flags.map((f, i) => (
                <div key={i}>⚠ {f}</div>
              ))}
            </div>
          )}

          {preview.adds.length + preview.removals.length === 0 ? (
            <div style={{ ...boxOk, marginTop: 12 }}>AM already matches this scan. Nothing to write.</div>
          ) : (
            !applyResult && (
              <button type="button" onClick={applyAm} disabled={applying} style={{ ...btnPrimary, background: "#a12622", marginTop: 14 }}>
                {applying ? "Writing to AM…" : `Apply ${preview.adds.length + preview.removals.length} changes to AM`}
              </button>
            )
          )}

          {applyResult && (
            <div style={{ marginTop: 12 }}>
              <div style={applyResult.errors === 0 ? boxOk : boxErr}>
                Applied {applyResult.applied}, skipped {applyResult.skipped}, errors {applyResult.errors}.
              </div>
              {applyResult.results
                .filter((r: any) => r.status !== "ok")
                .map((r: any, i: number) => (
                  <div key={i} style={{ fontSize: 12, color: "#a12622", marginTop: 6 }}>
                    {r.style || `sku ${r.skuId}`}: {r.status} {r.detail ? `(${r.detail})` : ""}
                  </div>
                ))}
            </div>
          )}
        </div>
      )}

      {(saved || applyResult) && (
        <button type="button" onClick={resetAll} style={{ ...btnSecondary, width: "100%", marginTop: 20 }}>
          New scan
        </button>
      )}
    </div>
  );
}

function ChangeList({ title, color, items }: { title: string; color: string; items: Change[] }) {
  if (items.length === 0) return null;
  const groups = new Map<string, Change[]>();
  for (const c of items) {
    const k = c.style || `sku ${c.skuId}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(c);
  }
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color, marginBottom: 4 }}>{title}</div>
      {Array.from(groups.entries()).map(([style, list], i) => {
        const uniform = list.every(
          (c) => c.oldLocation === list[0].oldLocation && c.newLocation === list[0].newLocation
        );
        return (
          <div key={i} style={{ fontSize: 12, padding: "6px 0", borderBottom: "1px solid #f0f0f0" }}>
            <b>{style}</b>{" "}
            <span style={{ color: "#999" }}>
              ({list.length} SKU{list.length === 1 ? "" : "s"})
            </span>
            {uniform ? (
              <div>
                <span style={{ color: "#999" }}>{list[0].oldLocation}</span> → <b>{list[0].newLocation}</b>
              </div>
            ) : (
              list.map((c, j) => (
                <div key={j}>
                  <span style={{ color: "#999" }}>{c.oldLocation}</span> → <b>{c.newLocation}</b>
                </div>
              ))
            )}
          </div>
        );
      })}
    </div>
  );
}

const btnPrimary: React.CSSProperties = {
  width: "100%",
  padding: "14px 16px",
  fontSize: 16,
  fontWeight: 700,
  color: "#fff",
  background: "#111",
  border: "none",
  borderRadius: 10,
  marginTop: 4,
};

const btnSecondary: React.CSSProperties = {
  flex: 1,
  padding: "12px 10px",
  fontSize: 15,
  fontWeight: 600,
  color: "#111",
  background: "#f3f3f3",
  border: "1px solid #ddd",
  borderRadius: 10,
};

const btnLink: React.CSSProperties = {
  background: "none",
  border: "none",
  color: "#0a58ca",
  fontSize: 13,
  fontWeight: 600,
  padding: 0,
};

const iconBtn: React.CSSProperties = {
  width: 40,
  height: 40,
  fontSize: 16,
  border: "1px solid #ddd",
  borderRadius: 8,
  background: "#fff",
};

const boxErr: React.CSSProperties = {
  background: "#fdecec",
  color: "#a12622",
  padding: "10px 12px",
  borderRadius: 8,
  marginTop: 12,
  fontSize: 14,
};

const boxOk: React.CSSProperties = {
  background: "#eaf6ec",
  color: "#1e6b2e",
  padding: "10px 12px",
  borderRadius: 8,
  marginTop: 12,
  fontSize: 14,
};
