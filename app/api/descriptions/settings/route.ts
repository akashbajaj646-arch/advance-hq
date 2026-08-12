import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getSession } from '@/lib/auth';
import { loadCopySettings } from '@/lib/copy-rules';

// GET  /api/descriptions/settings → { ban_em_dashes, rules, examples }
// POST /api/descriptions/settings  { ban_em_dashes?, rules?, examples? }  (admin only)

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    const settings = await loadCopySettings();
    return NextResponse.json(settings);
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

    const body = await request.json();
    const now = new Date().toISOString();
    const writes: { key: string; value: any }[] = [];

    if ('ban_em_dashes' in body) {
      writes.push({ key: 'ban_em_dashes', value: !!body.ban_em_dashes });
    }

    if ('rules' in body) {
      if (!Array.isArray(body.rules) || body.rules.some((r: any) => typeof r !== 'string')) {
        return NextResponse.json({ error: 'rules must be an array of strings' }, { status: 400 });
      }
      writes.push({ key: 'rules', value: body.rules.map((r: string) => r.trim()).filter(Boolean).slice(0, 30) });
    }

    if ('examples' in body) {
      if (!Array.isArray(body.examples)) {
        return NextResponse.json({ error: 'examples must be an array' }, { status: 400 });
      }
      const examples = body.examples
        .filter((e: any) => e && typeof e.body === 'string' && e.body.trim())
        .slice(0, 5)
        .map((e: any) => ({ title: String(e.title || '').trim(), body: String(e.body).trim() }));
      writes.push({ key: 'examples', value: examples });
    }

    if (writes.length === 0) {
      return NextResponse.json({ error: 'Nothing to save' }, { status: 400 });
    }

    for (const w of writes) {
      const { error } = await supabaseAdmin
        .from('copy_settings')
        .upsert({ key: w.key, value: w.value, updated_at: now, updated_by: session.user.id }, { onConflict: 'key' });
      if (error) {
        return NextResponse.json({ error: `Failed to save ${w.key}`, detail: error.message }, { status: 500 });
      }
    }

    const settings = await loadCopySettings();
    return NextResponse.json({ success: true, settings });
  } catch (error: any) {
    return NextResponse.json({ error: 'Internal error', detail: String(error?.message || error) }, { status: 500 });
  }
}
