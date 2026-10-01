import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getSession } from '@/lib/auth';
import { loadCopySettings, loadBullets, cleanQuickFacts, stripTrailingFacts } from '@/lib/copy-rules';
import { generateSeoText, findDtcProductId, pushSeoToDtc } from '@/lib/copy-seo';
import { getProductSeo } from '@/lib/shopify';

// SEO for the DTC store only.
// GET  /api/descriptions/seo?product_id=X          READ-ONLY probe: resolves the DTC product and shows its live SEO
// POST /api/descriptions/seo { product_id, action: 'generate', seo_keywords? }  text-only regen of SEO drafts
// POST /api/descriptions/seo { product_id, action: 'push' }                     push saved SEO drafts to DTC

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request) {
  try {
    const session = await getSession();
    if (!session || session.user.role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }
    const productId = new URL(request.url).searchParams.get('product_id');
    if (!productId) return NextResponse.json({ error: 'product_id is required' }, { status: 400 });

    const found = await findDtcProductId(productId);
    if (!found.ok) return NextResponse.json({ ok: false, step: 'lookup', error: found.error, tried: found.tried }, { status: 502 });
    if (!found.id) return NextResponse.json({ ok: true, found: false, tried: found.tried });

    const live = await getProductSeo('dtc', found.id);
    return NextResponse.json({ ok: live.ok, found: true, dtc_product_id: found.id, tried: found.tried, product: live.product, errors: live.errors });
  } catch (error: any) {
    return NextResponse.json({ error: 'Internal error', detail: String(error?.message || error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session || session.user.role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { product_id, action, seo_keywords } = await request.json();
    if (!product_id || !['generate', 'push'].includes(action)) {
      return NextResponse.json({ error: "product_id and action ('generate' | 'push') are required" }, { status: 400 });
    }

    const { data: row } = await supabaseAdmin.from('product_copy').select('*').eq('product_id', String(product_id)).single();
    if (!row) return NextResponse.json({ error: 'Product not found in copy queue' }, { status: 404 });

    if (action === 'push') {
      const r = await pushSeoToDtc(row);
      if (r.skipped) return NextResponse.json({ error: 'No SEO title or meta description saved yet' }, { status: 400 });
      if (!r.ok) return NextResponse.json({ error: 'SEO push failed', detail: r.error }, { status: 502 });
      return NextResponse.json({ success: true, dtc_product_id: r.dtc_product_id });
    }

    // action === 'generate': base on drafts when present, else the live copy
    const settings = await loadCopySettings();
    const bank = await loadBullets(false);
    const facts = cleanQuickFacts(row.quick_facts);
    const known = [...bank.map(b => b.text), ...facts];
    const prose = stripTrailingFacts(row.draft_web_description || row.current_web_description || '', known);
    const kw = String(seo_keywords ?? row.seo_keywords ?? '').trim();

    const { data: guidelineRows } = await supabaseAdmin.from('copy_guidelines').select('*');
    const globalRow = (guidelineRows || []).find(g => g.scope === 'global');
    const catRow = (guidelineRows || []).find(g => g.scope === 'category' && g.category === row.category);
    const seoGuidelines = [globalRow?.seo_guidelines, catRow?.seo_guidelines].filter(Boolean).join(' ');

    const gen = await generateSeoText({
      webTitle: row.draft_web_title || row.current_web_title || '',
      prose,
      facts,
      category: row.category,
      seoKeywords: kw,
      seoGuidelines,
      settings,
    });
    if (!gen.ok) return NextResponse.json({ error: 'SEO generation failed', detail: gen.error }, { status: 502 });

    const { error } = await supabaseAdmin.from('product_copy').update({
      seo_keywords: kw || null,
      draft_seo_title: gen.title,
      draft_seo_meta_description: gen.description,
      updated_at: new Date().toISOString(),
    }).eq('product_id', String(product_id));
    if (error) return NextResponse.json({ error: 'Failed to save SEO drafts', detail: error.message }, { status: 500 });

    return NextResponse.json({ success: true, seo_title: gen.title, seo_description: gen.description });
  } catch (error: any) {
    console.error('Descriptions SEO error:', error);
    return NextResponse.json({ error: 'Internal error', detail: String(error?.message || error) }, { status: 500 });
  }
}
