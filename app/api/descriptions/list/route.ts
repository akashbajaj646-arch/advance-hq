import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getSession } from '@/lib/auth';

// GET /api/descriptions/list?status=pending&search=dashiki&limit=100&offset=0

export const dynamic = 'force-dynamic';

const STATUSES = ['pending', 'drafted', 'pushed', 'skipped', 'ok'] as const;

export async function GET(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') || 'pending';
    const search = (searchParams.get('search') || '').trim();
    const active = searchParams.get('active') || 'active'; // active | inactive | all
    const category = (searchParams.get('category') || '').trim();
    const limit = Math.min(200, Math.max(1, parseInt(searchParams.get('limit') || '100', 10)));
    const offset = Math.max(0, parseInt(searchParams.get('offset') || '0', 10));

    // Rows not yet re-scanned since the am_active column was added have null; treat null as active.
    const applyFilters = (q: any) => {
      if (active === 'active') q = q.or('am_active.eq.true,am_active.is.null');
      else if (active === 'inactive') q = q.eq('am_active', false);
      if (category) q = q.eq('category', category);
      return q;
    };

    let query = supabaseAdmin
      .from('product_copy')
      .select('*')
      .eq('status', status)
      .order('style_number', { ascending: true })
      .range(offset, offset + limit - 1);
    query = applyFilters(query);

    if (search) {
      query = query.or(`style_number.ilike.%${search}%,category.ilike.%${search}%`);
    }

    const { data: rows, error } = await query;
    if (error) {
      return NextResponse.json({ error: 'Query failed', detail: error.message }, { status: 500 });
    }

    // Bucket counts for the tabs (same active/category filters applied)
    const counts: Record<string, number> = {};
    await Promise.all(STATUSES.map(async s => {
      let cq = supabaseAdmin
        .from('product_copy')
        .select('*', { count: 'exact', head: true })
        .eq('status', s);
      cq = applyFilters(cq);
      const { count } = await cq;
      counts[s] = count ?? 0;
    }));

    // Distinct categories for the filter dropdown
    const { data: catRows } = await supabaseAdmin.from('product_copy').select('category').not('category', 'is', null);
    const categories = Array.from(new Set((catRows || []).map((r: any) => r.category).filter(Boolean))).sort();

    return NextResponse.json({ rows: rows || [], counts, categories });
  } catch (error: any) {
    console.error('Descriptions list error:', error);
    return NextResponse.json({ error: 'Internal error', detail: String(error?.message || error) }, { status: 500 });
  }
}
