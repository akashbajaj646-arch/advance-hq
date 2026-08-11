import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { moduleForPath, moduleForApiPath, isAlwaysAllowed, hasModuleAccess } from '@/lib/modules';

// Routes that don't require auth
const PUBLIC_PATHS = ["/api/admin/", '/login', '/signup', '/api/auth/login', '/api/auth/signup', '/api/auth/bootstrap', '/api/auth/me'];

type SessionUser = { role: string | null; permissions: string[] | null; is_active: boolean };

// Edge-safe session lookup via Supabase REST (no supabase-js import in middleware).
// Returns: { user } on success, 'invalid' for bad/expired sessions, null on infra error (fail open).
async function lookupSession(token: string): Promise<{ user: SessionUser } | 'invalid' | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;

  try {
    const res = await fetch(
      `${url}/rest/v1/app_sessions?select=expires_at,user:hq_users(role,permissions,is_active)&token=eq.${encodeURIComponent(token)}&limit=1`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    if (!res.ok) return null;
    const rows = await res.json();
    const session = Array.isArray(rows) ? rows[0] : null;
    if (!session?.user) return 'invalid';
    if (new Date(session.expires_at) <= new Date()) return 'invalid';
    if (!session.user.is_active) return 'invalid';
    return { user: session.user as SessionUser };
  } catch {
    return null; // network/infra error: fail open so a Supabase blip can't lock the whole app
  }
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow public paths
  if (PUBLIC_PATHS.some(p => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // Allow static assets and Next.js internals
  if (pathname.startsWith('/_next') || pathname.startsWith('/favicon') || pathname.includes('.')) {
    return NextResponse.next();
  }

  // Check for session cookie
  const session = request.cookies.get('ahq_session');
  if (!session?.value) {
    // API routes return 401
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    // Pages redirect to login
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Module-level enforcement: only hit the DB when the path belongs to a restricted module
  const isApi = pathname.startsWith('/api/');
  const moduleKey = isApi ? moduleForApiPath(pathname) : moduleForPath(pathname);

  if (moduleKey && !isAlwaysAllowed(moduleKey)) {
    const result = await lookupSession(session.value);

    if (result === 'invalid') {
      if (isApi) {
        return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
      }
      const loginUrl = new URL('/login', request.url);
      loginUrl.searchParams.set('redirect', pathname);
      const response = NextResponse.redirect(loginUrl);
      response.cookies.set({ name: 'ahq_session', value: '', path: '/', maxAge: 0 });
      return response;
    }

    if (result && !hasModuleAccess(result.user, moduleKey)) {
      if (isApi) {
        return NextResponse.json({ error: 'You do not have access to this module' }, { status: 403 });
      }
      const home = new URL('/', request.url);
      home.searchParams.set('denied', moduleKey);
      return NextResponse.redirect(home);
    }
    // result === null (infra error): fail open, page/API-level session checks still apply
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
