import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getSession } from '@/lib/auth';

// GET  /api/descriptions/guidelines  → { global, rules: [...], categories: [...] }
// POST /api/descriptions/guidelines  { scope: 'global'|'category', category?, guidelines }
//   (empty guidelines deletes a category rule)

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const { data: rows } = await supabaseAdmin.from('copy_guidelines').select('*').order('category', { ascending: true });
    const global = (rows || []).find(r => r.scope === 'global')?.guidelines || '';
    const rules = (rows || []).filter(r => r.scope === 'category');

    // Distinct categories from the queue, for the "add rule" dropdown
    const { data: catRows } = await supabaseAdmin.from('product_copy').select('category').not('category', 'is', null);
    const categories = Array.from(new Set((catRows || []).map(r => r.category).filter(Boolean))).sort();

    return NextResponse.json({ global, rules, categories });
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

    const { scope, category, guidelines } = await request.json();
    if (!['global', 'category'].includes(scope)) {
      return NextResponse.json({ error: "scope must be 'global' or 'category'" }, { status: 400 });
    }
    if (scope === 'category' && !category) {
      return NextResponse.json({ error: 'category is required for category-scoped rules' }, { status: 400 });
    }

    const cat = scope === 'global' ? null : String(category);
    const text = (guidelines ?? '').trim();

    // Find existing (unique index is on scope + coalesce(category,''), so match manually)
    let query = supabaseAdmin.from('copy_guidelines').select('id').eq('scope', scope);
    query = cat === null ? query.is('category', null) : query.eq('category', cat);
    const { data: existing } = await query.limit(1);
    const existingId = existing?.[0]?.id;

    const now = new Date().toISOString();

    if (!text && existingId && scope === 'category') {
      await supabaseAdmin.from('copy_guidelines').delete().eq('id', existingId);
      return NextResponse.json({ success: true, deleted: true });
    }

    if (existingId) {
      const { error } = await supabaseAdmin.from('copy_guidelines')
        .update({ guidelines: text, updated_at: now, updated_by: session.user.id })
        .eq('id', existingId);
      if (error) return NextResponse.json({ error: 'Update failed', detail: error.message }, { status: 500 });
    } else {
      const { error } = await supabaseAdmin.from('copy_guidelines')
        .insert({ scope, category: cat, guidelines: text, updated_at: now, updated_by: session.user.id });
      if (error) return NextResponse.json({ error: 'Insert failed', detail: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: 'Internal error', detail: String(error?.message || error) }, { status: 500 });
  }
}
