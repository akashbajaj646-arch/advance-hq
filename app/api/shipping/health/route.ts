/**
 * GET /api/shipping/health
 *
 * Smoke test that confirms our shipping infrastructure is wired up:
 *   - UPS OAuth (gets a token from the cache or fresh from UPS)
 *   - EasyPost auth (basic ping to the addresses endpoint)
 *   - Supabase reachability (checks shipping_service_map seed rows exist)
 *
 * Returns 200 if everything works, 503 if anything is broken — with detail
 * in the body so we can debug from the browser.
 */

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getUpsToken } from '@/lib/carriers/ups/auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

interface CheckResult {
  ok: boolean;
  detail?: string;
  ms?: number;
}

async function timed<T>(fn: () => Promise<T>): Promise<{ result: T | null; err: string | null; ms: number }> {
  const t0 = Date.now();
  try {
    const result = await fn();
    return { result, err: null, ms: Date.now() - t0 };
  } catch (e) {
    return { result: null, err: e instanceof Error ? e.message : String(e), ms: Date.now() - t0 };
  }
}

export async function GET() {
  const checks: Record<string, CheckResult> = {};

  // 1. Supabase + service map seed rows
  {
    const { result, err, ms } = await timed(async () => {
      const { data, error } = await supabaseAdmin
        .from('shipping_service_map')
        .select('ship_via_value', { count: 'exact', head: false })
        .eq('is_active', true);
      if (error) throw new Error(error.message);
      return data?.length ?? 0;
    });
    checks.shipping_service_map = err
      ? { ok: false, detail: err, ms }
      : { ok: (result ?? 0) > 0, detail: `${result} active rows`, ms };
  }

  // 2. UPS OAuth
  {
    const { result, err, ms } = await timed(async () => {
      const token = await getUpsToken();
      return token.slice(0, 20) + '…';   // token preview, never the full thing
    });
    checks.ups_oauth = err ? { ok: false, detail: err, ms } : { ok: true, detail: `token: ${result}`, ms };
  }

  // 3. EasyPost — minimal call to /addresses with a known good address.
  // Test mode, doesn't charge anything.
  {
    const { result, err, ms } = await timed(async () => {
      const key =
        process.env.EASYPOST_ENV === 'production'
          ? process.env.EASYPOST_API_KEY
          : process.env.EASYPOST_TEST_API_KEY;
      if (!key) throw new Error('EasyPost key not set in env');
      const basic = Buffer.from(`${key}:`).toString('base64');
      const res = await fetch('https://api.easypost.com/v2/addresses', {
        method: 'POST',
        headers: {
          Authorization: `Basic ${basic}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body:
          'address[street1]=388%20Townsend%20St&address[city]=San%20Francisco' +
          '&address[state]=CA&address[zip]=94107',
      });
      const json = await res.json();
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(json)?.slice(0, 200)}`);
      if (!json?.id) throw new Error('No address id returned');
      return json.id as string;
    });
    checks.easypost = err ? { ok: false, detail: err, ms } : { ok: true, detail: `address id: ${result}`, ms };
  }

  const allOk = Object.values(checks).every((c) => c.ok);
  return NextResponse.json(
    {
      ok: allOk,
      ups_env: process.env.UPS_ENV ?? 'unset',
      easypost_env: process.env.EASYPOST_ENV ?? 'unset',
      checks,
    },
    { status: allOk ? 200 : 503 }
  );
}
