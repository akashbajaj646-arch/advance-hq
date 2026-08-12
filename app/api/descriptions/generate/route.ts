import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getSession } from '@/lib/auth';
import { amGet } from '@/lib/apparelmagic';
import { loadCopySettings, sanitizeCopy } from '@/lib/copy-rules';

// POST /api/descriptions/generate  { product_id, keywords? }
// Generates draft copy for ONE product (the UI loops over a selected batch).
// Inputs: product images (up to 4), category, tags, size range, content/origin,
// existing copy as raw material, global + category guidelines, user keywords.

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const MODEL = process.env.DESCRIPTIONS_MODEL || 'claude-sonnet-4-6';

function decodeEntities(s: string): string {
  return (s || '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ');
}

function extractImageUrls(images: any, limit?: number): string[] {
  const urls = new Set<string>();
  const list: any[] = Array.isArray(images) ? images : [];
  for (const img of list) {
    const u = img?.img;
    if (typeof u === 'string' && u.startsWith('http')) urls.add(u);
  }
  const arr = Array.from(urls);
  return limit ? arr.slice(0, limit) : arr;
}

function enforceFiveWords(s: string): string {
  return (s || '').trim().split(/\s+/).slice(0, 5).join(' ');
}

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session || session.user.role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }
    if (!ANTHROPIC_API_KEY) {
      return NextResponse.json({ error: 'ANTHROPIC_API_KEY is not set' }, { status: 500 });
    }

    const { product_id, keywords } = await request.json();
    if (!product_id) {
      return NextResponse.json({ error: 'product_id is required' }, { status: 400 });
    }

    const { data: row } = await supabaseAdmin.from('product_copy').select('*').eq('product_id', String(product_id)).single();
    if (!row) {
      return NextResponse.json({ error: 'Product not in copy queue — run Refresh first' }, { status: 404 });
    }

    // Fresh product record from AM (images, tags, facts)
    const am = await amGet(`products/${product_id}`);
    const product = am.record;
    if (!product) {
      return NextResponse.json({ error: 'Could not fetch product from ApparelMagic', detail: am.errors }, { status: 502 });
    }

    const settings = await loadCopySettings();

    // Guidelines: global + this product's category
    const { data: guidelineRows } = await supabaseAdmin.from('copy_guidelines').select('*');
    const globalGuidelines = (guidelineRows || []).find(g => g.scope === 'global')?.guidelines || '';
    const categoryGuidelines = (guidelineRows || []).find(
      g => g.scope === 'category' && g.category === (product.category ?? row.category)
    )?.guidelines || '';

    // Facts for the prompt
    const tags = (Array.isArray(product.tags) ? product.tags : []).map((t: any) => t?.text).filter(Boolean);
    const sizeInfo = product.size_range_info
      ? Object.values(product.size_range_info).filter(Boolean).join(', ')
      : '';
    const existingCopy = [
      decodeEntities(product.description || ''),
      decodeEntities(product.web_title || ''),
      decodeEntities(product.web_description || ''),
    ].filter(Boolean).join(' | ');

    const imageUrls: string[] = extractImageUrls(product.images, 4);

    const userKeywords = (keywords ?? row.keywords ?? '').trim();

    const specsText = Array.isArray(product.specs) && product.specs.length
      ? JSON.stringify(product.specs).slice(0, 400)
      : '';

    const factLines = [
      `Style number: ${product.style_number || 'unknown'}`,
      `Category: ${product.category || 'unknown'}`,
      tags.length ? `Tags: ${tags.join(', ')}` : null,
      sizeInfo ? `Available sizes: ${sizeInfo}` : null,
      product.content ? `Fabric content (from product record): ${product.content}` : null,
      product.care_instructions ? `Care instructions: ${product.care_instructions}` : null,
      product.origin ? `Origin: ${product.origin}` : null,
      specsText ? `Specs: ${specsText}` : null,
      existingCopy ? `Existing copy (raw material — real facts like fabric/origin often live here in ALL CAPS): ${existingCopy}` : null,
      userKeywords ? `MUST INCORPORATE these user-specified keywords/features: ${userKeywords}` : null,
    ].filter(Boolean).join('\n');

    const styleRulesBlock = settings.rules.length
      ? `STYLE RULES (hard requirements, never violate):\n${settings.rules.map(r => `- ${r}`).join('\n')}\n`
      : '';
    const examplesBlock = settings.examples.length
      ? `EXAMPLE DESCRIPTIONS (match their tone, structure, and quality — NEVER copy their content or reuse their specific product details):\n${settings.examples.map((e, i) => `Example ${i + 1}${e.title ? ` (${e.title})` : ''}:\n${e.body}`).join('\n\n')}\n`
      : '';

    const prompt = `You are writing product copy for Advance Apparels, a wholesale apparel company. Study the product images and facts, then write three fields.

${globalGuidelines ? `BRAND VOICE GUIDELINES (follow these):\n${globalGuidelines}\n` : ''}${styleRulesBlock}${examplesBlock}${categoryGuidelines ? `CATEGORY-SPECIFIC RULES for "${product.category}":\n${categoryGuidelines}\n` : ''}
PRODUCT FACTS:
${factLines}

RULES:
- The images may show multiple colorways of the same style. NEVER mention a specific color — describe the style, silhouette, print type, and construction instead.
- Only state facts you can see in the images or that are given above. Never invent fabric content, origin, sizing, or care details.
- Fabric, sizing, care, and spec facts above are CONTEXT. Do not automatically list them in the copy — include them only when the brand voice guidelines, category rules, or user keywords call for them. Never write anything that contradicts these facts.
- "description": maximum 5 words, a plain general concept of the garment (e.g. "Traditional Print Dashiki Kaftan").
- "web_title": a concise, shopper-friendly product title for the web store.
- "web_description": the main selling description for the web store.

Respond with ONLY a JSON object, no markdown fences, no preamble:
{"description": "...", "web_title": "...", "web_description": "..."}`;

    const content: any[] = imageUrls.map(url => ({ type: 'image', source: { type: 'url', url } }));
    content.push({ type: 'text', text: prompt });

    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        messages: [{ role: 'user', content }],
      }),
    });

    const aiData = await aiRes.json();
    if (!aiRes.ok) {
      const detail = aiData?.error?.message || JSON.stringify(aiData).slice(0, 300);
      await supabaseAdmin.from('product_copy').update({ generation_error: detail, updated_at: new Date().toISOString() }).eq('product_id', String(product_id));
      return NextResponse.json({ error: 'AI generation failed', detail }, { status: 502 });
    }

    const text = (aiData.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n');
    let parsed: any;
    try {
      parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
    } catch {
      await supabaseAdmin.from('product_copy').update({ generation_error: `Unparseable AI output: ${text.slice(0, 200)}`, updated_at: new Date().toISOString() }).eq('product_id', String(product_id));
      return NextResponse.json({ error: 'AI returned unparseable output', raw: text.slice(0, 500) }, { status: 502 });
    }

    const drafts = {
      draft_description: sanitizeCopy(enforceFiveWords(String(parsed.description || '')), settings),
      draft_web_title: sanitizeCopy(String(parsed.web_title || '').trim(), settings),
      draft_web_description: sanitizeCopy(String(parsed.web_description || '').trim(), settings),
    };

    if (!drafts.draft_web_description || !drafts.draft_web_title) {
      return NextResponse.json({ error: 'AI output missing required fields', raw: parsed }, { status: 502 });
    }

    const { error: upErr } = await supabaseAdmin.from('product_copy').update({
      ...drafts,
      keywords: userKeywords || null,
      status: 'drafted',
      generated_at: new Date().toISOString(),
      generation_model: MODEL,
      generation_error: null,
      updated_at: new Date().toISOString(),
    }).eq('product_id', String(product_id));

    if (upErr) {
      return NextResponse.json({ error: 'Failed to save drafts', detail: upErr.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, product_id: String(product_id), drafts, images_used: imageUrls.length });
  } catch (error: any) {
    console.error('Descriptions generate error:', error);
    return NextResponse.json({ error: 'Internal error', detail: String(error?.message || error) }, { status: 500 });
  }
}
