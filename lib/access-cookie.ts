// Signed, short-lived access cookie used by middleware to enforce module access
// without a DB lookup on every request. Edge-safe (Web Crypto + fetch only).
//
// - Payload: user id, role, permissions, a fingerprint of the session token, expiry.
// - HMAC-SHA256 signed with AHQ_ACCESS_SECRET (falls back to SUPABASE_SERVICE_ROLE_KEY).
// - Bound to the ahq_session token, so it can't be reused with another session.
// - Expires after ACCESS_TTL_SECONDS; middleware then re-reads hq_users and re-issues it.
//   Permission changes in Settings > Users therefore apply within ~5 minutes.

export const ACCESS_COOKIE = 'ahq_access';
export const ACCESS_TTL_SECONDS = 300;

export type AccessClaims = {
  uid: string;
  role: string;
  permissions: string[] | null;
  sid: string;
  exp: number;
};

const enc = new TextEncoder();

function secret(): string {
  const s = process.env.AHQ_ACCESS_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!s) throw new Error('No AHQ_ACCESS_SECRET or SUPABASE_SERVICE_ROLE_KEY for access cookie signing');
  return s;
}

function b64url(bytes: Uint8Array): string {
  let s = '';
  bytes.forEach(b => { s += String.fromCharCode(b); });
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(str: string): Uint8Array {
  let s = str.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}

async function hmacKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', enc.encode(secret()), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function sessionFingerprint(token: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', enc.encode(token));
  return b64url(new Uint8Array(d)).slice(0, 22);
}

export async function signAccess(claims: AccessClaims): Promise<string> {
  const body = b64url(enc.encode(JSON.stringify(claims)));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(), enc.encode(body));
  return `${body}.${b64url(new Uint8Array(sig))}`;
}

export async function verifyAccess(value: string, sessionToken: string): Promise<AccessClaims | null> {
  try {
    const [body, sig] = value.split('.');
    if (!body || !sig) return null;
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(), fromB64url(sig) as BufferSource, enc.encode(body));
    if (!ok) return null;
    const claims = JSON.parse(new TextDecoder().decode(fromB64url(body))) as AccessClaims;
    if (typeof claims.exp !== 'number' || claims.exp * 1000 < Date.now()) return null;
    if (claims.sid !== (await sessionFingerprint(sessionToken))) return null;
    return claims;
  } catch {
    return null;
  }
}

export function accessCookieOptions(value: string) {
  return {
    name: ACCESS_COOKIE,
    value,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: ACCESS_TTL_SECONDS,
  };
}

/**
 * Look up the session's user straight from Supabase REST (edge-safe).
 * Returns null when the session is missing/expired or the user is disabled.
 * Throws on infrastructure errors so the caller can degrade gracefully.
 */
export async function lookupAccess(sessionToken: string): Promise<AccessClaims | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase URL or service role key missing in middleware env');

  const q =
    `${url}/rest/v1/app_sessions` +
    `?select=user:hq_users(id,role,permissions,is_active)` +
    `&token=eq.${encodeURIComponent(sessionToken)}` +
    `&expires_at=gt.${encodeURIComponent(new Date().toISOString())}` +
    `&limit=1`;

  const res = await fetch(q, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`access lookup HTTP ${res.status}`);

  const rows = await res.json();
  const u = Array.isArray(rows) ? rows[0]?.user : null;
  if (!u || u.is_active === false) return null;

  return {
    uid: u.id,
    role: u.role || 'viewer',
    permissions: Array.isArray(u.permissions) ? u.permissions : null,
    sid: await sessionFingerprint(sessionToken),
    exp: Math.floor(Date.now() / 1000) + ACCESS_TTL_SECONDS,
  };
}
