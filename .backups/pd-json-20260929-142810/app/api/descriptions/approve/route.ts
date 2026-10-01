import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getSession } from '@/lib/auth';
import { amUpdate } from '@/lib/apparelmagic';
import { loadCopySettings, loadBullets, sanitizeCopy, cleanQuickFacts, composeHtml, htmlToText } from '@/lib/copy-rules';
import { pushSeoToDtc } from '@/lib/copy-seo';

// POST /api/descriptions/approve  { product_id }
// 1) Pushes description, web_title, web_description (prose + selected bullets) to
//    ApparelMagic using the proven form-body/auth-in-body PUT. AM's Shopify sync carries it onward.
//    web_description is sent as HTML (<p> prose + <ul><li> bullets) because AM's field is rich text:
//    plain newline-separated lines do not survive as bullets.
// 2) Pushes SEO title + meta description to the DTC Shopify store only (AM has no SEO fields,
//    B2B is password protected). An SEO failure does not undo the AM push; it is reported.

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session || session.user.role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { product_id } = await request.json();
    if (!product_id) {
      return NextResponse.json({ error: 'product_id is required' }, { status: 400 });
    }

    const { data: row } = await supabaseAdmin.from('product_copy').select('*').eq('product_id', String(product_id)).single();
    if (!row) {
      return NextResponse.json({ error: 'Product not found in copy queue' }, { status: 404 });
    }
    if (!row.draft_web_title || !row.draft_web_description) {
      return NextResponse.json({ error: 'Drafts are incomplete. Web title and web description are required before pushing.' }, { status: 400 });
    }

    // Final hard-rule gate: nothing banned can reach AM, even via manual edits.
    // Bullets are composed here from quick_facts (any stale bullet block in the prose is stripped first).
    const settings = await loadCopySettings();
    const bank = await loadBullets(false);
    const facts = cleanQuickFacts(row.quick_facts).map((f: string) => sanitizeCopy(f, settings));
    const prose = sanitizeCopy(row.draft_web_description, settings);
    const known = bank.map(b => b.text);
    const pushFacts = settings.quick_facts_enabled ? facts : [];
    const webDescription = composeHtml(prose, pushFacts, [...known, ...facts]);

    const fields: Record<string, any> = {
      web_title: sanitizeCopy(row.draft_web_title, settings),
      web_description: webDescription,
    };
    if (row.draft_description) fields.description = sanitizeCopy(row.draft_description, settings);

    const result = await amUpdate('products', String(product_id), fields);

    if (!result.ok) {
      const detail = JSON.stringify(result.errors).slice(0, 500);
      await supabaseAdmin.from('product_copy').update({
        push_error: detail,
        updated_at: new Date().toISOString(),
      }).eq('product_id', String(product_id));
      return NextResponse.json({ error: 'ApparelMagic rejected the update', detail, status: result.status }, { status: 502 });
    }

    const now = new Date().toISOString();
    const rec = result.record || {};
    const { error: upErr } = await supabaseAdmin.from('product_copy').update({
      status: 'pushed',
      approved_at: now,
      approved_by: session.user.id,
      pushed_at: now,
      push_error: null,
      current_description: rec.description ?? row.draft_description ?? row.current_description,
      current_web_title: rec.web_title ?? row.draft_web_title,
      current_web_description: rec.web_description ?? webDescription,
      missing_copy: false,
      all_caps: false,
      updated_at: now,
    }).eq('product_id', String(product_id));

    // SEO -> DTC only
    const seo = await pushSeoToDtc(row);

    const warnings: string[] = [];
    // Verify-after-write: AM returns the saved record; confirm the bullet list actually landed.
    if (pushFacts.length && typeof rec.web_description === 'string') {
      const saved = htmlToText(rec.web_description).toLowerCase();
      if (!saved.includes(pushFacts[0].toLowerCase())) warnings.push('AM saved the description but the bullets are missing from its returned record');
    }
    if (upErr) warnings.push(`Pushed to AM but local status update failed: ${upErr.message}`);
    if (!seo.ok) warnings.push(`AM push succeeded, SEO push to DTC failed: ${seo.error}`);

    return NextResponse.json({
      success: true,
      product_id: String(product_id),
      seo: seo.skipped ? 'skipped' : seo.ok ? 'pushed' : 'failed',
      ...(warnings.length ? { warning: warnings.join(' | ') } : {}),
    });
  } catch (error: any) {
    console.error('Descriptions approve error:', error);
    return NextResponse.json({ error: 'Internal error', detail: String(error?.message || error) }, { status: 500 });
  }
}
