/**
 * UPS OAuth (client_credentials grant) with token caching in Supabase.
 *
 * UPS access tokens expire after ~4 hours. We cache them in `ups_tokens`
 * to avoid re-authing on every API call. Cache hit: ~5ms. Cache miss:
 * ~300ms HTTP round-trip to UPS.
 *
 * Token re-use across server processes (Vercel cold starts → warm starts)
 * is the whole reason we cache in the database rather than in memory.
 */

import { supabaseAdmin } from '@/lib/supabase-admin';

export type UpsEnv = 'cie' | 'production';

export function upsBaseUrl(): string {
  return process.env.UPS_ENV === 'production'
    ? 'https://onlinetools.ups.com'
    : 'https://wwwcie.ups.com';
}

interface UpsTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: string;   // UPS returns this as a string, in seconds
  status: string;
}

/**
 * Returns a valid UPS bearer token, fetching a fresh one if the cached
 * token is missing or within 60 seconds of expiry.
 *
 * Safe to call on every request — caching makes this cheap.
 */
export async function getUpsToken(): Promise<string> {
  const clientId = process.env.UPS_CLIENT_ID;
  const clientSecret = process.env.UPS_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('UPS_CLIENT_ID / UPS_CLIENT_SECRET not set in environment');
  }

  // Try cache first — pull most recent unexpired token.
  const sixtySecondsFromNow = new Date(Date.now() + 60_000).toISOString();
  const { data: cached, error: cacheErr } = await supabaseAdmin
    .from('ups_tokens')
    .select('access_token, expires_at')
    .gt('expires_at', sixtySecondsFromNow)
    .order('expires_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (cacheErr) {
    // Don't fail closed — log and fall through to refresh.
    console.warn('[ups/auth] cache read failed, refreshing token:', cacheErr.message);
  }
  if (cached?.access_token) {
    return cached.access_token;
  }

  // Cache miss → fetch fresh.
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const res = await fetch(`${upsBaseUrl()}/security/v1/oauth/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`UPS OAuth failed (${res.status}): ${body}`);
  }

  const json = (await res.json()) as UpsTokenResponse;
  const expiresInSec = parseInt(json.expires_in, 10) || 14_399;
  const expiresAt = new Date(Date.now() + expiresInSec * 1000).toISOString();

  // Best-effort cache write. Don't block the request if this fails.
  const { error: insertErr } = await supabaseAdmin.from('ups_tokens').insert({
    access_token: json.access_token,
    expires_at: expiresAt,
  });
  if (insertErr) {
    console.warn('[ups/auth] cache write failed:', insertErr.message);
  }

  // Best-effort cleanup of expired tokens. Fire-and-forget.
  void supabaseAdmin
    .from('ups_tokens')
    .delete()
    .lt('expires_at', new Date().toISOString());

  return json.access_token;
}
