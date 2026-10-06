import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {
  moduleForPath,
  moduleForApiPath,
  hasModuleAccess,
  isRestricted,
  firstAllowedHref,
  type AppUser,
} from '@/lib/modules';
import {
  ACCESS_COOKIE,
  verifyAccess,
  lookupAccess,
  signAccess,
  accessCookieOptions,
  type AccessClaims,
} from '@/lib/access-cookie';

// Routes that don't require auth. /api/cron/ MUST stay in this list:
// Vercel cron invocations carry no session cookie, so gating them behind
// auth silently kills every scheduled sync.
// Customer-facing and unauthenticated routes. These are NOT internal HQ pages:
// wholesale customers reach them with no HQ account, so gating them breaks the
// storefront application form, payment links, and the Shopify account page.
// If you rewrite this file, keep every entry below.
const CUSTOMER_FACING_PATHS = [
  '/account/payment-methods',   // customer payment page opened from a link
  '/api/account/',              // payment methods + pay + Shopify extension
  '/api/wholesale/apply',       // storefront wholesale application form
];

const PUBLIC_PATHS = [
  ...CUSTOMER_FACING_PATHS,
  '/api/track/', '/api/tickets/', '/support',
  "/api/admin/", "/api/cron/",
  '/login', '/signup',
  '/api/auth/login', '/api/auth/signup', '/api/auth/bootstrap', '/api/auth/me',
];

// APIs any logged-in user may call regardless of module access.
// /api/data is the shared table proxy every page uses (lib/db.ts).
const SHARED_API_PREFIXES = ['/api/auth', '/api/data'];

// Roles that are denied any API not owned by one of their modules.
// Keeps warehouse accounts off unmapped APIs (orders, invoices, etc.).
const STRICT_API_ROLES = ['warehouse'];

function matchesPrefix(pathname: string, prefix: string) {
  return pathname === prefix || pathname.startsWith(prefix + '/');
}

function canAccess(pathname: string, user: AppUser): boolean {
  if (pathname.startsWith('/api/')) {
    if (SHARED_API_PREFIXES.some(p => matchesPrefix(pathname, p))) return true;
    const mod = moduleForApiPath(pathname);
    if (mod) return hasModuleAccess(user, mod);
    return !STRICT_API_ROLES.includes(user.role ?? '');
  }
  const mod = moduleForPath(pathname);
  if (mod) return hasModuleAccess(user, mod);
  // Pages outside the module registry (e.g. /scan-audit) are for unrestricted users only.
  return !isRestricted(user);
}

function toLogin(request: NextRequest, pathname: string, clearCookies: boolean) {
  const res = pathname.startsWith('/api/')
    ? NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    : (() => {
        const loginUrl = new URL('/login', request.url);
        loginUrl.searchParams.set('redirect', pathname);
        return NextResponse.redirect(loginUrl);
      })();
  if (clearCookies) {
    for (const name of ['ahq_session', 'ahq_role', ACCESS_COOKIE]) {
      res.cookies.set({ name, value: '', path: '/', maxAge: 0 });
    }
  }
  return res;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // CORS preflights carry no cookies, so never gate them on a session
  if (request.method === 'OPTIONS') {
    return NextResponse.next();
  }

  // Allow public paths
  if (PUBLIC_PATHS.some(p => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // Allow static assets and Next.js internals
  if (pathname.startsWith('/_next') || pathname.startsWith('/favicon') || pathname.includes('.')) {
    return NextResponse.next();
  }

  // Check for session cookie
  const sessionToken = request.cookies.get('ahq_session')?.value;
  if (!sessionToken) {
    return toLogin(request, pathname, false);
  }

  // Resolve access: signed cookie first, DB lookup when missing/expired.
  let claims: AccessClaims | null = null;
  let reissue = false;
  const existing = request.cookies.get(ACCESS_COOKIE)?.value;
  if (existing) claims = await verifyAccess(existing, sessionToken);

  if (!claims) {
    try {
      claims = await lookupAccess(sessionToken);
      if (!claims) return toLogin(request, pathname, true); // session expired or user disabled
      reissue = true;
    } catch (e) {
      // Supabase unreachable: fall back to the old role-cookie fence rather than locking everyone out.
      console.error('[middleware] access lookup failed, using role cookie fallback:', e);
      const role = request.cookies.get('ahq_role')?.value || 'viewer';
      claims = { uid: '', role, permissions: null, sid: '', exp: 0 };
    }
  }

  const user: AppUser = { role: claims.role, permissions: claims.permissions };

  let res: NextResponse;
  if (canAccess(pathname, user)) {
    res = NextResponse.next();
  } else if (pathname.startsWith('/api/')) {
    res = NextResponse.json({ error: 'Your account does not have access to this module' }, { status: 403 });
  } else {
    res = NextResponse.redirect(new URL(firstAllowedHref(user), request.url));
  }

  if (reissue) {
    try {
      res.cookies.set(accessCookieOptions(await signAccess(claims)));
    } catch (e) {
      console.error('[middleware] could not sign access cookie:', e);
    }
  }
  return res;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
