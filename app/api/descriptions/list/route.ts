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
    const limit = Math.min(200, Math.max(1, parseInt(searchParams.get('limit') || '100', 10)));
    const offset = Math.max(0, parseInt(searchParams.get('offset') || '0', 10));

    let query = supabaseAdmin
      .from('product_copy')
      .select('*')
      .eq('status', status)
      .order('style_number', { ascending: true })
      .range(offset, offset + limit - 1);

    if (search) {
      query = query.or(`style_number.ilike.%${search}%,category.ilike.%${search}%`);
    }

    const { data: rows, error } = await query;
    if (error) {
      return NextResponse.json({ error: 'Query failed', detail: error.message }, { status: 500 });
    }

    // Bucket counts for the tabs
    const counts: Record<string, number> = {};
    await Promise.all(STATUSES.map(async s => {
      const { count } = await supabaseAdmin
        .from('product_copy')
        .select('*', { count: 'exact', head: true })
        .eq('status', s);
      counts[s] = count ?? 0;
    }));

    return NextResponse.json({ rows: rows || [], counts });
  } catch (error: any) {
    console.error('Descriptions list error:', error);
    return NextResponse.json({ error: 'Internal error', detail: String(error?.message || error) }, { status: 500 });
  }
}
