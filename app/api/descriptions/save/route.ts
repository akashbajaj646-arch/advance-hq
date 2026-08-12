import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getSession } from '@/lib/auth';

// POST /api/descriptions/save  { product_id, updates: { keywords?, draft_description?, draft_web_title?, draft_web_description?, status? } }
// Whitelisted fields only. status may only be set to 'skipped' or 'pending' (re-queue).

export const dynamic = 'force-dynamic';

const EDITABLE = ['keywords', 'draft_description', 'draft_web_title', 'draft_web_description'] as const;

function enforceFiveWords(s: string): string {
  return (s || '').trim().split(/\s+/).slice(0, 5).join(' ');
}

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session || session.user.role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { product_id, updates } = await request.json();
    if (!product_id || !updates || typeof updates !== 'object') {
      return NextResponse.json({ error: 'product_id and updates are required' }, { status: 400 });
    }

    const clean: Record<string, any> = {};
    for (const key of EDITABLE) {
      if (key in updates) {
        clean[key] = updates[key] == null ? null : String(updates[key]).trim() || null;
      }
    }
    if ('draft_description' in clean && clean.draft_description) {
      clean.draft_description = enforceFiveWords(clean.draft_description);
    }
    if ('status' in updates) {
      if (!['skipped', 'pending'].includes(updates.status)) {
        return NextResponse.json({ error: "status may only be set to 'skipped' or 'pending'" }, { status: 400 });
      }
      clean.status = updates.status;
    }

    if (Object.keys(clean).length === 0) {
      return NextResponse.json({ error: 'No editable fields provided' }, { status: 400 });
    }

    clean.updated_at = new Date().toISOString();

    const { error } = await supabaseAdmin.from('product_copy').update(clean).eq('product_id', String(product_id));
    if (error) {
      return NextResponse.json({ error: 'Update failed', detail: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Descriptions save error:', error);
    return NextResponse.json({ error: 'Internal error', detail: String(error?.message || error) }, { status: 500 });
  }
}
