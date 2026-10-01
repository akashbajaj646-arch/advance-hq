import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getSession } from '@/lib/auth';
import { amGet } from '@/lib/apparelmagic';
import { loadCopySettings, loadBullets, groupBullets, sanitizeCopy, cleanQuickFacts, stripTrailingFacts, htmlToText } from '@/lib/copy-rules';
import { seoPromptRules, cleanSeo, COPY_MODEL } from '@/lib/copy-seo';
import { normColorMode, parseWordLimit } from '@/lib/copy-format';

// POST /api/descriptions/generate  { product_id, keywords?, seo_keywords?, color_mode?, color_name?, max_words? }
// max_words: per-product word limit for web_description (blank = Settings default).
// color_mode: off (default, never name a color) | title | description | both, for single-colorway products.
// Generates draft copy for ONE product (the UI loops over a selected batch).
// Inputs: product images (up to 4), category, tags, size range, content/origin,
// existing copy as raw material, global + category guidelines, user keywords,
// the bullet bank (Claude pre-selects true bullets), and SEO target keywords.
// draft_web_description is stored as PROSE ONLY; bullets live in quick_facts and
// are appended at push time.

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';

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

    const { product_id, keywords, seo_keywords, color_mode, color_name, max_words } = await request.json();
    if (!product_id) {
      return NextResponse.json({ error: 'product_id is required' }, { status: 400 });
    }

    const { data: row } = await supabaseAdmin.from('product_copy').select('*').eq('product_id', String(product_id)).single();
    if (!row) {
      return NextResponse.json({ error: 'Product not in copy queue. Run Refresh first.' }, { status: 404 });
    }

    // Fresh product record from AM (images, tags, facts)
    const am = await amGet(`products/${product_id}`);
    const product = am.record;
    if (!product) {
      return NextResponse.json({ error: 'Could not fetch product from ApparelMagic', detail: am.errors }, { status: 502 });
    }

    const settings = await loadCopySettings();
    const bank = await loadBullets(true);

    // Guidelines: global + this product's category (brand voice + SEO)
    const { data: guidelineRows } = await supabaseAdmin.from('copy_guidelines').select('*');
    const cat = product.category ?? row.category;
    const globalRow = (guidelineRows || []).find(g => g.scope === 'global');
    const catRow = (guidelineRows || []).find(g => g.scope === 'category' && g.category === cat);
    const globalGuidelines = globalRow?.guidelines || '';
    const categoryGuidelines = catRow?.guidelines || '';
    const seoGuidelines = [globalRow?.seo_guidelines, catRow?.seo_guidelines].filter(Boolean).join(' ');

    // Facts for the prompt
    const tags = (Array.isArray(product.tags) ? product.tags : []).map((t: any) => t?.text).filter(Boolean);
    const sizeInfo = product.size_range_info
      ? Object.values(product.size_range_info).filter(Boolean).join(', ')
      : '';
    const existingCopy = [
      decodeEntities(product.description || ''),
      decodeEntities(product.web_title || ''),
      htmlToText(decodeEntities(product.web_description || '')).replace(/\s*\n\s*/g, ' '),
    ].filter(Boolean).join(' | ');

    const imageUrls: string[] = extractImageUrls(product.images, 4);

    const userKeywords = String(keywords ?? row.keywords ?? '').trim();
    const seoKeywords = String(seo_keywords ?? row.seo_keywords ?? '').trim();
    const productMaxWords = max_words !== undefined ? parseWordLimit(max_words) : parseWordLimit(row.desc_max_words);
    const maxWords = productMaxWords ?? settings.web_desc_max_words;
    const minWords = Math.max(15, Math.round(maxWords * 0.75));
    const colorMode = normColorMode(color_mode ?? row.color_mode);
    const colorName = String(color_name ?? row.color_name ?? '').trim();

    const colorTarget = colorMode === 'both' ? '"web_title" and "web_description"' : colorMode === 'title' ? '"web_title" only' : '"web_description" only';
    const colorRule = colorMode === 'off'
      ? `- The images may show multiple colorways of the same style. NEVER mention a specific color. Describe the style, silhouette, print type, and construction instead.`
      : `- This product comes ONLY in the single colorway pictured${colorName ? `, named "${colorName}"` : ''}. Name that color naturally in ${colorTarget}${colorName ? ' using that name' : ', using a clear shopper-friendly color name you can see in the images (e.g. "Emerald Green", "Black and Gold")'}. Do NOT mention color in the other fields${colorMode === 'both' ? ' (the 5-word "description" stays color-free)' : ''}. Never claim other colors are available.`;

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
      existingCopy ? `Existing copy (raw material; real facts like fabric/origin often live here in ALL CAPS): ${existingCopy}` : null,
      userKeywords ? `MUST INCORPORATE these user-specified keywords/features: ${userKeywords}` : null,
    ].filter(Boolean).join('\n');

    const styleRulesBlock = settings.rules.length
      ? `STYLE RULES (hard requirements, never violate):\n${settings.rules.map(r => `- ${r}`).join('\n')}\n`
      : '';
    const examplesBlock = settings.examples.length
      ? `EXAMPLE DESCRIPTIONS (match their tone, structure, and quality. NEVER copy their content or reuse their specific product details):\n${settings.examples.map((e, i) => `Example ${i + 1}${e.title ? ` (${e.title})` : ''}:\n${e.body}`).join('\n\n')}\n`
      : '';

    // Bullets: pick from the bank when it has entries, else legacy free-written quick facts.
    const useBank = bank.length > 0;
    const numbered: string[] = [];
    let bulletBlock = '';
    if (useBank) {
      const groups = groupBullets(bank);
      const lines: string[] = [];
      for (const g of groups) {
        lines.push(`[${g.group}]`);
        for (const b of g.items) { numbered.push(b.text); lines.push(`  ${numbered.length}. ${b.text}`); }
      }
      bulletBlock = `- "bullet_ids": numbers from the BULLET BANK below for every bullet that is TRUE for this product. At most one per group. Skip any group you cannot verify from the images or facts above (never guess fabric or origin). Color availability: ${colorMode === 'off' ? 'pick an assorted-colors bullet only when the images show multiple colorways or the facts say so' : 'this is a single-colorway product, so NEVER pick an assorted-colors bullet'}.

BULLET BANK:
${lines.join('\n')}`;
    } else {
      bulletBlock = `- "quick_facts": 3 to 6 very short lines (each under 7 words, no ending punctuation), in this order when known: sizing, fabric content, origin as "Made-in-X", color availability. ONLY include facts you can verify.`;
    }

    const jsonShape = useBank
      ? `{"description": "...", "web_title": "...", "web_description": "...", "bullet_ids": [1, 4], "seo_title": "...", "seo_description": "..."}`
      : `{"description": "...", "web_title": "...", "web_description": "...", "quick_facts": ["...", "..."], "seo_title": "...", "seo_description": "..."}`;

    const prompt = `You are writing product copy for Advance Apparels, a wholesale apparel company. Study the product images and facts, then write the fields below.

${globalGuidelines ? `BRAND VOICE GUIDELINES (follow these):\n${globalGuidelines}\n` : ''}${styleRulesBlock}${examplesBlock}${categoryGuidelines ? `CATEGORY-SPECIFIC RULES for "${product.category}":\n${categoryGuidelines}\n` : ''}
PRODUCT FACTS:
${factLines}

RULES:
${colorRule}
- Only state facts you can see in the images or that are given above. Never invent fabric content, origin, sizing, or care details.
- Fabric, sizing, care, and spec facts above are CONTEXT. Do not automatically list them in the prose; bullets carry them.
- "description": maximum 5 words, a plain general concept of the garment (e.g. "Traditional Print Dashiki Kaftan").
- "web_title": a concise, shopper-friendly product title for the web store.
- "web_description": the main selling description PROSE ONLY. No bullet lines inside it; bullets are appended separately. LENGTH: between ${minWords} and ${maxWords} words. This limit overrides any length mentioned in the guidelines or examples above.${maxWords >= 120 ? ' Use two or three short paragraphs separated by a blank line.' : ''}
${bulletBlock}

${seoPromptRules(seoKeywords, seoGuidelines, colorMode === 'off' ? 'off' : 'both', colorName)}

Respond with ONLY a JSON object, no markdown fences, no preamble:
${jsonShape}`;

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
        model: COPY_MODEL,
        max_tokens: 1500,
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

    // Bullets
    let quickFacts: string[];
    if (useBank) {
      const ids: any[] = Array.isArray(parsed.bullet_ids) ? parsed.bullet_ids : [];
      quickFacts = cleanQuickFacts(ids.map(n => numbered[Number(n) - 1]).filter(Boolean));
    } else {
      quickFacts = cleanQuickFacts(parsed.quick_facts).map(f => sanitizeCopy(f, settings));
    }

    // Prose only (strip any bullet lines the model slipped in)
    const knownBullets = [...bank.map(b => b.text), ...quickFacts];
    const prose = stripTrailingFacts(sanitizeCopy(String(parsed.web_description || '').trim(), settings), knownBullets);

    const seo = cleanSeo(parsed.seo_title, parsed.seo_description, settings);

    const drafts = {
      draft_description: sanitizeCopy(enforceFiveWords(String(parsed.description || '')), settings),
      draft_web_title: sanitizeCopy(String(parsed.web_title || '').trim(), settings),
      draft_web_description: prose,
      draft_seo_title: seo.title || null,
      draft_seo_meta_description: seo.description || null,
    };

    if (!drafts.draft_web_description || !drafts.draft_web_title) {
      return NextResponse.json({ error: 'AI output missing required fields', raw: parsed }, { status: 502 });
    }

    const { error: upErr } = await supabaseAdmin.from('product_copy').update({
      ...drafts,
      quick_facts: quickFacts.length ? quickFacts : null,
      keywords: userKeywords || null,
      seo_keywords: seoKeywords || null,
      color_mode: colorMode,
      desc_max_words: productMaxWords,
      color_name: colorName || null,
      status: 'drafted',
      generated_at: new Date().toISOString(),
      generation_model: COPY_MODEL,
      generation_error: null,
      updated_at: new Date().toISOString(),
    }).eq('product_id', String(product_id));

    if (upErr) {
      return NextResponse.json({ error: 'Failed to save drafts', detail: upErr.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, product_id: String(product_id), drafts: { ...drafts, quick_facts: quickFacts }, images_used: imageUrls.length });
  } catch (error: any) {
    console.error('Descriptions generate error:', error);
    return NextResponse.json({ error: 'Internal error', detail: String(error?.message || error) }, { status: 500 });
  }
}
