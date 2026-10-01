// SEO for the Descriptions module. DTC store ONLY (B2B is password protected, no SEO).
// - seoPromptRules(): shared prompt block used by the full generate call and the SEO-only call
// - generateSeoText(): text-only Anthropic call (no images) to (re)write SEO title + meta
// - findDtcProductId(): AM product -> DTC Shopify product via inventory.sku_concat === variant SKU
// - pushSeoToDtc(): write + verify, records status on product_copy
// Server-side only.

import { supabaseAdmin } from '@/lib/supabase-admin';
import { findVariantBySku, setProductSeo } from '@/lib/shopify';
import { CopySettings, sanitizeCopy } from '@/lib/copy-rules';
import { clampAtWord, SEO_TITLE_MAX, SEO_DESC_MAX } from '@/lib/copy-format';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
export const COPY_MODEL = process.env.DESCRIPTIONS_MODEL || 'claude-sonnet-5';

export function seoPromptRules(seoKeywords: string, seoGuidelines: string): string {
  const kw = (seoKeywords || '').trim();
  return [
    `SEO FIELDS (for the retail web store's Google listing):`,
    kw
      ? `- TARGET KEYWORDS (the first one is the primary): ${kw}`
      : `- No target keywords given: pick the most likely phrase a shopper would Google for this garment.`,
    `- "seo_title": max ${SEO_TITLE_MAX} characters. Lead with the primary keyword, worded naturally (not keyword-stuffed). No brand or store name, no pipes, no ALL CAPS.`,
    `- "seo_description": max ${SEO_DESC_MAX} characters. One or two sentences that include the primary keyword and at most one secondary keyword, describe the garment's appeal, and end with a soft call to action. Never mention a specific color.`,
    seoGuidelines ? `- Additional SEO guidelines: ${seoGuidelines}` : null,
  ].filter(Boolean).join('\n');
}

export function cleanSeo(title: any, description: any, settings: CopySettings) {
  return {
    title: clampAtWord(sanitizeCopy(String(title || ''), settings), SEO_TITLE_MAX),
    description: clampAtWord(sanitizeCopy(String(description || ''), settings), SEO_DESC_MAX),
  };
}

/** Text-only SEO generation from existing copy (fast, no vision). */
export async function generateSeoText(input: {
  webTitle: string;
  prose: string;
  facts: string[];
  category: string | null;
  seoKeywords: string;
  seoGuidelines: string;
  settings: CopySettings;
}): Promise<{ ok: boolean; title?: string; description?: string; error?: string }> {
  if (!ANTHROPIC_API_KEY) return { ok: false, error: 'ANTHROPIC_API_KEY is not set' };
  if (!input.webTitle && !input.prose) return { ok: false, error: 'No web title or description to base SEO on. Generate the description first.' };

  const prompt = `You are writing SEO metadata for a product page on Advance Apparels' retail web store.

PRODUCT:
Category: ${input.category || 'unknown'}
Web title: ${input.webTitle || '(none)'}
Web description: ${input.prose || '(none)'}
${input.facts.length ? `Key facts: ${input.facts.join('; ')}` : ''}

${seoPromptRules(input.seoKeywords, input.seoGuidelines)}
- Only use facts stated above. Never use em dashes.

Respond with ONLY a JSON object, no markdown fences, no preamble:
{"seo_title": "...", "seo_description": "..."}`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: COPY_MODEL, max_tokens: 400, messages: [{ role: 'user', content: prompt }] }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data) return { ok: false, error: data?.error?.message || `HTTP ${res.status}` };

  const text = (data.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n');
  try {
    const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
    const seo = cleanSeo(parsed.seo_title, parsed.seo_description, input.settings);
    if (!seo.title || !seo.description) return { ok: false, error: 'AI output missing SEO fields' };
    return { ok: true, ...seo };
  } catch {
    return { ok: false, error: `Unparseable AI output: ${text.slice(0, 200)}` };
  }
}

/** Resolve the DTC Shopify product GID for an AM product via its SKUs. */
export async function findDtcProductId(productId: string): Promise<{ ok: boolean; id: string | null; tried: string[]; error?: any }> {
  const { data, error } = await supabaseAdmin
    .from('inventory')
    .select('sku_concat')
    .eq('product_id', productId)
    .not('sku_concat', 'is', null)
    .limit(25);
  if (error) return { ok: false, id: null, tried: [], error: `inventory lookup failed: ${error.message}` };

  const skus = Array.from(new Set((data || []).map((r: any) => String(r.sku_concat || '').trim()).filter(Boolean))).slice(0, 8);
  const tried: string[] = [];
  for (const sku of skus) {
    tried.push(sku);
    const r = await findVariantBySku('dtc', sku);
    if (!r.ok) return { ok: false, id: null, tried, error: r.errors };
    if (r.variant?.productId) return { ok: true, id: r.variant.productId, tried };
  }
  return { ok: true, id: null, tried };
}

/** Push draft SEO to the DTC store and record the outcome on product_copy. */
export async function pushSeoToDtc(row: any): Promise<{ ok: boolean; skipped?: boolean; error?: string; dtc_product_id?: string }> {
  const title = String(row.draft_seo_title || '').trim();
  const description = String(row.draft_seo_meta_description || '').trim();
  if (!title && !description) return { ok: true, skipped: true };

  const record = async (fields: Record<string, any>) => {
    await supabaseAdmin.from('product_copy').update({ ...fields, updated_at: new Date().toISOString() }).eq('product_id', String(row.product_id));
  };

  const attempt = async (id: string) => setProductSeo('dtc', id, { title, description });

  // Try the cached product id first; if it fails (deleted/recreated in Shopify), re-resolve once.
  let dtcId: string | null = row.dtc_product_id || null;
  if (dtcId) {
    const r = await attempt(dtcId);
    if (r.ok) {
      await record({ seo_pushed_at: new Date().toISOString(), seo_push_error: null });
      return { ok: true, dtc_product_id: dtcId };
    }
    dtcId = null;
  }

  const found = await findDtcProductId(String(row.product_id));
  if (!found.ok) {
    const err = `DTC lookup failed: ${JSON.stringify(found.error).slice(0, 300)}`;
    await record({ seo_push_error: err });
    return { ok: false, error: err };
  }
  if (!found.id) {
    const err = found.tried.length
      ? `No DTC Shopify product found (checked ${found.tried.length} SKU${found.tried.length === 1 ? '' : 's'}, e.g. ${found.tried[0]})`
      : 'No SKUs found in inventory for this product';
    await record({ seo_push_error: err });
    return { ok: false, error: err };
  }

  const r = await attempt(found.id);
  if (!r.ok) {
    const err = `Shopify rejected SEO: ${JSON.stringify(r.errors).slice(0, 300)}`;
    await record({ dtc_product_id: found.id, seo_push_error: err });
    return { ok: false, error: err, dtc_product_id: found.id };
  }
  await record({ dtc_product_id: found.id, seo_pushed_at: new Date().toISOString(), seo_push_error: null });
  return { ok: true, dtc_product_id: found.id };
}
