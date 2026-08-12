import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getSession } from '@/lib/auth';
import { amUpdate } from '@/lib/apparelmagic';

// POST /api/descriptions/approve  { product_id }
// Pushes the drafted copy to ApparelMagic (description, web_title, web_description)
// using the proven form-body/auth-in-body PUT. AM's Shopify sync carries it onward.

export const dynamic = 'force-dynamic';

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
      return NextResponse.json({ error: 'Drafts are incomplete — web title and web description are required before pushing' }, { status: 400 });
    }

    const fields: Record<string, any> = {
      web_title: row.draft_web_title,
      web_description: row.draft_web_description,
    };
    if (row.draft_description) fields.description = row.draft_description;

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
      // Refresh the "current" snapshot from AM's returned record
      current_description: rec.description ?? row.draft_description ?? row.current_description,
      current_web_title: rec.web_title ?? row.draft_web_title,
      current_web_description: rec.web_description ?? row.draft_web_description,
      missing_copy: false,
      all_caps: false,
      updated_at: now,
    }).eq('product_id', String(product_id));

    if (upErr) {
      return NextResponse.json({ success: true, warning: `Pushed to AM but local status update failed: ${upErr.message}` });
    }

    return NextResponse.json({ success: true, product_id: String(product_id) });
  } catch (error: any) {
    console.error('Descriptions approve error:', error);
    return NextResponse.json({ error: 'Internal error', detail: String(error?.message || error) }, { status: 500 });
  }
}
