import { NextRequest, NextResponse } from "next/server";
import { detectKey, sb, STYLE_KEYS } from "../am";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MATCH_MODEL = process.env.VOICE_MATCH_MODEL || "claude-haiku-4-5-20251001";
const MAX_AUDIO_BYTES = 2_000_000;

async function styleColumn() {
  const supabase = sb();
  const probe = await supabase.from("inventory").select("*").limit(1);
  if (probe.error) throw new Error(`inventory probe: ${probe.error.message}`);
  const styleKey = detectKey(probe.data?.[0], STYLE_KEYS);
  if (!styleKey) throw new Error("inventory style column not detected");
  return { supabase, styleKey };
}

async function stylePrefixes(): Promise<string[]> {
  try {
    const { supabase, styleKey } = await styleColumn();
    const { data } = await supabase.from("inventory").select(styleKey).limit(1000);
    const set = new Set<string>();
    for (const r of (data || []) as any[]) {
      const m = String(r[styleKey]).match(/^[A-Za-z]+/);
      if (m) set.add(m[0].toUpperCase());
    }
    return Array.from(set).slice(0, 12);
  } catch {
    return ["AB"];
  }
}

async function candidateStyles(transcript: string): Promise<string[]> {
  const { supabase, styleKey } = await styleColumn();
  const digitGroups = Array.from(new Set(transcript.match(/\d{3,6}/g) || []));
  const styles = new Set<string>();
  for (const g of digitGroups.slice(0, 6)) {
    const { data } = await supabase.from("inventory").select(styleKey).ilike(styleKey, `%${g}%`).limit(200);
    for (const r of (data || []) as any[]) styles.add(String(r[styleKey]));
    if (g.length >= 4) {
      // near-miss net: partial digits catch transcripts that dropped or added one digit
      const { data: d2 } = await supabase
        .from("inventory")
        .select(styleKey)
        .ilike(styleKey, `%${g.slice(0, -1)}%`)
        .limit(100);
      for (const r of (d2 || []) as any[]) styles.add(String(r[styleKey]));
    }
  }
  return Array.from(styles).slice(0, 400);
}

async function recentCorrections(): Promise<{ heard: string; chosen: string }[]> {
  try {
    const { data } = await sb()
      .from("voice_corrections")
      .select("heard, chosen")
      .order("created_at", { ascending: false })
      .limit(100);
    return (data || []) as any[];
  } catch {
    return [];
  }
}

async function transcribe(audio: Buffer, mime: string, prefixes: string[]): Promise<string> {
  const groqKey = process.env.GROQ_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  let url = "";
  let key = "";
  let model = "";
  if (groqKey) {
    url = "https://api.groq.com/openai/v1/audio/transcriptions";
    key = groqKey;
    model = "whisper-large-v3-turbo";
  } else if (openaiKey) {
    url = "https://api.openai.com/v1/audio/transcriptions";
    key = openaiKey;
    model = "whisper-1";
  } else {
    throw new Error("No transcription key configured. Add GROQ_API_KEY (or OPENAI_API_KEY) to env.");
  }
  const ext = mime.includes("mp4") ? "m4a" : mime.includes("webm") ? "webm" : "wav";
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(audio)], { type: mime }), `utterance.${ext}`);
  form.append("model", model);
  form.append("language", "en");
  form.append(
    "prompt",
    `Warehouse inventory dictation. Product style numbers with prefixes like ${prefixes.join(", ")} followed by 3 to 6 digits (e.g. ${prefixes[0] || "AB"}-16064, PAT-3257), box quantities, and bin locations like A4C or X4C.`
  );
  const res = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: form });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Transcription failed (${res.status}): ${detail.slice(0, 200)}`);
  }
  const data = await res.json();
  return String(data.text || "").trim();
}

async function matchTranscript(
  transcript: string,
  location: string,
  candidates: string[],
  corrections: { heard: string; chosen: string }[]
) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");

  const prompt = `You convert one utterance of warehouse voice dictation into product rows.

Current bin location: ${location || "(not set yet)"}
Transcript: "${transcript}"

Candidate products (the ONLY valid skus; spoken numbers/words must resolve to one of these):
${candidates.length > 0 ? candidates.join(", ") : "(none found for the digits heard)"}

Past corrections from this user (how their speech was previously mis-transcribed -> what they actually meant). Use these to resolve similar-sounding input:
${corrections.length > 0 ? corrections.map((c) => `"${c.heard}" -> ${c.chosen}`).join("\n") : "(none yet)"}

Rules:
- Spoken numbers become digits ("thirty-two fifty-seven" -> 3257; "sixteen oh six four" -> 16064).
- Prefixes may be spelled ("P A T") or said as a word ("pat") - both mean the same prefix.
- Each product mentioned becomes one row. "three boxes" / "times three" after a product is its qty; otherwise qty null.
- sku MUST be copied exactly from the candidate list. If nothing in the list plausibly matches, use "" and put your best reading in heard.
- confidence: 1.0 exact, lower when you had to guess between candidates.
- If the utterance is only a bin location (letter+digits+letter like X4C, A10B), return command "set_location" with it uppercase and no rows.
- If the utterance means undo/remove the last entry ("scratch that", "delete that", "undo", "no not that"), return command "undo_last" and no rows.
- Otherwise command "none".

Respond with ONLY valid JSON, no markdown fences:
{"command":"none","location":"","rows":[{"heard":"pat thirty two fifty seven","sku":"PAT-3257","qty":3,"confidence":0.97}]}`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MATCH_MODEL,
      max_tokens: 1000,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Match failed (${res.status}): ${detail.slice(0, 200)}`);
  }
  const data = await res.json();
  const text = (data.content || [])
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text)
    .join("\n");
  const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
  return {
    command: ["undo_last", "set_location"].includes(parsed.command) ? parsed.command : "none",
    location: String(parsed.location || "").toUpperCase(),
    rows: Array.isArray(parsed.rows)
      ? parsed.rows.map((r: any) => ({
          heard: String(r.heard || ""),
          sku: String(r.sku || "").toUpperCase(),
          qty: typeof r.qty === "number" ? r.qty : null,
          confidence: Math.max(0, Math.min(1, Number(r.confidence) || 0)),
        }))
      : [],
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const audioB64 = String(body.audio || "");
    const mime = String(body.mime || "audio/webm");
    const location = String(body.location || "").trim().toUpperCase();
    if (!audioB64) return NextResponse.json({ error: "No audio" }, { status: 400 });
    const audio = Buffer.from(audioB64, "base64");
    if (audio.length > MAX_AUDIO_BYTES) {
      return NextResponse.json({ error: "Audio too long, keep utterances short" }, { status: 400 });
    }

    const prefixes = await stylePrefixes();
    const transcript = await transcribe(audio, mime, prefixes);
    if (!transcript) return NextResponse.json({ transcript: "", command: "none", rows: [] });

    const [candidates, corrections] = await Promise.all([candidateStyles(transcript), recentCorrections()]);
    const result = await matchTranscript(transcript, location, candidates, corrections);

    return NextResponse.json({ transcript, ...result });
  } catch (e: any) {
    console.error("voice error", e);
    return NextResponse.json({ error: e.message || "Voice failed" }, { status: 500 });
  }
}
