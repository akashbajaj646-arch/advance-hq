import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getSession } from '@/lib/auth';

// GET  /api/automations/events?status=pending|all&limit=100 → { events, counts }
// POST /api/automations/events { id, action: 'dismiss' | 'requeue' }  (admin only)

export const dynamic = 'force-dynamic';

const STATUSES = ['pending', 'dry_run', 'completed', 'failed', 'dismissed'];

export async function GET(request: Request) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') || 'pending';
    const limit = Math.min(500, Math.max(1, parseInt(searchParams.get('limit') || '200', 10)));

    let query = supabaseAdmin
      .from('automation_events')
      .select('*')
      .order('detected_at', { ascending: false })
      .limit(limit);
    if (status !== 'all') query = query.eq('status', status);

    const { data: events, error } = await query;
    if (error) return NextResponse.json({ error: 'Query failed', detail: error.message }, { status: 500 });

    const counts: Record<string, number> = {};
    await Promise.all(STATUSES.map(async s => {
      const { count } = await supabaseAdmin
        .from('automation_events')
        .select('*', { count: 'exact', head: true })
        .eq('status', s);
      counts[s] = count ?? 0;
    }));

    return NextResponse.json({ events: events || [], counts });
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

    const { id, action } = await request.json();
    if (!id || !['dismiss', 'requeue'].includes(action)) {
      return NextResponse.json({ error: "id and action ('dismiss' | 'requeue') are required" }, { status: 400 });
    }

    const newStatus = action === 'dismiss' ? 'dismissed' : 'pending';
    const { error } = await supabaseAdmin
      .from('automation_events')
      .update({ status: newStatus, processed_at: action === 'dismiss' ? new Date().toISOString() : null })
      .eq('id', id);
    if (error) return NextResponse.json({ error: 'Update failed', detail: error.message }, { status: 500 });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: 'Internal error', detail: String(error?.message || error) }, { status: 500 });
  }
}
