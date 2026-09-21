import { NextRequest, NextResponse } from "next/server";
import { sb } from "./am";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MODEL = process.env.SCAN_VISION_MODEL || "claude-sonnet-5";
const MAX_IMAGES = 8;

const PROMPT = `You are reading photos of warehouse pallet papers for a wholesale apparel company. Each pallet has one or more handwritten or printed papers listing style numbers (SKUs), usually in the form AB-12345 or AB12345, often followed by "= qty" (box count).

Extract every SKU line you can read across ALL images. Rules:
- Normalize SKUs to the form AB-XXXXX (uppercase, single hyphen after AB). Keep longer numbers as written (e.g. AB-724101).
- A line that is struck through / crossed out must still be returned, with "crossed_out": true.
- Do not invent SKUs. If a line is partially illegible, return your best reading and describe the uncertainty in "note" (e.g. "last digit could be 3 or 8"). If fully illegible, return sku as "" with a note.
- Printed box labels (STYLE No. fields) are context only; the handwritten summary papers are the source of truth. Only fall back to printed box labels if a pallet clearly has no summary paper.
- Deduplicate exact repeats across images of the same paper.
- qty is the number after "=" if present, else null.

Respond with ONLY valid JSON, no markdown fences, in this shape:
{"items":[{"sku":"AB-12345","qty":3,"crossed_out":false,"note":""}]}`;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const images: { media_type: string; data: string }[] = Array.isArray(body.images)
      ? body.images.slice(0, MAX_IMAGES)
      : [];
    if (images.length === 0) {
      return NextResponse.json({ error: "No images provided" }, { status: 400 });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });
    }

    // Persist the photos so history can show the source papers (best-effort).
    const imageUrls: string[] = [];
    try {
      const supabase = sb();
      const stamp = new Date().toISOString().slice(0, 10);
      for (let i = 0; i < images.length; i++) {
        const path = `${stamp}/${crypto.randomUUID()}.jpg`;
        const { error: upErr } = await supabase.storage
          .from("location-scan-photos")
          .upload(path, Buffer.from(images[i].data, "base64"), { contentType: "image/jpeg" });
        if (!upErr) {
          const { data: pub } = supabase.storage.from("location-scan-photos").getPublicUrl(path);
          if (pub?.publicUrl) imageUrls.push(pub.publicUrl);
        } else {
          console.error("photo upload failed", upErr.message);
        }
      }
    } catch (e) {
      console.error("photo upload failed", e);
    }

    const content: any[] = images.map((img) => ({
      type: "image",
      source: {
        type: "base64",
        media_type: img.media_type || "image/jpeg",
        data: img.data,
      },
    }));
    content.push({ type: "text", text: PROMPT });

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2000,
        messages: [{ role: "user", content }],
      }),
    });

    if (!res.ok) {
      const detail = await res.text();
      console.error("anthropic error", res.status, detail.slice(0, 500));
      return NextResponse.json({ error: `Vision API error (${res.status})` }, { status: 502 });
    }

    const data = await res.json();
    const text = (data.content || [])
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("\n");

    let parsed: any;
    try {
      parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
    } catch {
      console.error("parse failure, raw model text:", text.slice(0, 500));
      return NextResponse.json({ error: "Could not parse model output, retry the scan" }, { status: 502 });
    }

    const items = Array.isArray(parsed.items)
      ? parsed.items.map((it: any) => ({
          sku: String(it.sku || "").toUpperCase(),
          qty: typeof it.qty === "number" ? it.qty : null,
          crossed_out: !!it.crossed_out,
          note: String(it.note || ""),
        }))
      : [];

    return NextResponse.json({ items, image_urls: imageUrls });
  } catch (e: any) {
    console.error("location-scan error", e);
    return NextResponse.json({ error: e.message || "Scan failed" }, { status: 500 });
  }
}
