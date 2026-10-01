import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getSession } from '@/lib/auth';
import { loadBullets } from '@/lib/copy-rules';

// Bullet bank (copy_bullets).
// GET    /api/descriptions/bullets                    → { bullets } (active + inactive)
// POST   /api/descriptions/bullets { group_name, text }            → add
// POST   /api/descriptions/bullets { id, text?, group_name?, active? } → edit / toggle
// DELETE /api/descriptions/bullets?id=X

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  const bullets = await loadBullets(false);
  return NextResponse.json({ bullets });
}

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session || session.user.role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }
    const body = await request.json();
    const text = body.text != null ? String(body.text).replace(/[\u2014\u2013]/g, '-').replace(/^[-•*]\s*/, '').replace(/[.;,]\s*$/, '').trim() : undefined;
    const group = body.group_name != null ? String(body.group_name).trim() : undefined;

    if (body.id) {
      const patch: Record<string, any> = {};
      if (text !== undefined) { if (!text) return NextResponse.json({ error: 'text cannot be empty' }, { status: 400 }); patch.text = text; }
      if (group !== undefined) { if (!group) return NextResponse.json({ error: 'group cannot be empty' }, { status: 400 }); patch.group_name = group; }
      if ('active' in body) patch.active = !!body.active;
      if (!Object.keys(patch).length) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
      const { error } = await supabaseAdmin.from('copy_bullets').update(patch).eq('id', body.id);
      if (error) return NextResponse.json({ error: 'Update failed', detail: error.message }, { status: 500 });
      return NextResponse.json({ success: true, bullets: await loadBullets(false) });
    }

    if (!text || !group) return NextResponse.json({ error: 'group_name and text are required' }, { status: 400 });

    // Sort: end of its group, or a new block after everything else for a new group
    const all = await loadBullets(false);
    const inGroup = all.filter(b => b.group_name.toLowerCase() === group.toLowerCase());
    const sort = inGroup.length
      ? Math.max(...inGroup.map(b => b.sort)) + 1
      : (all.length ? Math.ceil((Math.max(...all.map(b => b.sort)) + 1) / 10) * 10 : 10);
    const groupName = inGroup[0]?.group_name || group;

    const { error } = await supabaseAdmin.from('copy_bullets').insert({ group_name: groupName, text, sort, active: true });
    if (error) {
      const dup = /duplicate|unique/i.test(error.message);
      return NextResponse.json({ error: dup ? 'That bullet already exists' : 'Insert failed', detail: error.message }, { status: dup ? 409 : 500 });
    }
    return NextResponse.json({ success: true, bullets: await loadBullets(false) });
  } catch (error: any) {
    return NextResponse.json({ error: 'Internal error', detail: String(error?.message || error) }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const session = await getSession();
  if (!session || session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  }
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
  const { error } = await supabaseAdmin.from('copy_bullets').delete().eq('id', id);
  if (error) return NextResponse.json({ error: 'Delete failed', detail: error.message }, { status: 500 });
  return NextResponse.json({ success: true, bullets: await loadBullets(false) });
}
