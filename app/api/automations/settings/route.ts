import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getSession } from '@/lib/auth';

// GET  /api/automations/settings → { shopify_mode, env: { b2b_configured, dtc_configured } }
// POST /api/automations/settings { shopify_mode: 'off' | 'dry_run' | 'live' }  (admin only)
// 'live' requires both stores' env vars to be configured.

export const dynamic = 'force-dynamic';

function envStatus() {
  return {
    b2b_configured: !!(process.env.SHOPIFY_B2B_DOMAIN && process.env.SHOPIFY_B2B_TOKEN),
    dtc_configured: !!(process.env.SHOPIFY_DTC_DOMAIN && process.env.SHOPIFY_DTC_TOKEN),
  };
}

export async function GET() {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });

    const { data } = await supabaseAdmin.from('automation_settings').select('key,value').eq('key', 'shopify_mode').single();
    const mode = typeof data?.value === 'string' ? data.value : 'off';

    return NextResponse.json({ shopify_mode: ['off', 'dry_run', 'live'].includes(mode) ? mode : 'off', env: envStatus() });
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

    const { shopify_mode } = await request.json();
    if (!['off', 'dry_run', 'live'].includes(shopify_mode)) {
      return NextResponse.json({ error: "shopify_mode must be 'off', 'dry_run', or 'live'" }, { status: 400 });
    }

    const env = envStatus();
    if (shopify_mode === 'live' && (!env.b2b_configured || !env.dtc_configured)) {
      return NextResponse.json({ error: 'Cannot go live: Shopify env vars are not configured for both stores' }, { status: 400 });
    }

    const { error } = await supabaseAdmin
      .from('automation_settings')
      .upsert({ key: 'shopify_mode', value: shopify_mode, updated_at: new Date().toISOString(), updated_by: session.user.id }, { onConflict: 'key' });
    if (error) return NextResponse.json({ error: 'Save failed', detail: error.message }, { status: 500 });

    return NextResponse.json({ success: true, shopify_mode, env });
  } catch (error: any) {
    return NextResponse.json({ error: 'Internal error', detail: String(error?.message || error) }, { status: 500 });
  }
}
