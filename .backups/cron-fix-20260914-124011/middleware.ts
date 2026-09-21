import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Routes that don't require auth
const PUBLIC_PATHS = ["/api/admin/", '/login', '/signup', '/api/auth/login', '/api/auth/signup', '/api/auth/bootstrap', '/api/auth/me'];

// Paths a warehouse-role user is allowed to touch. Everything else redirects
// to /warehouse (pages) or returns 403 (APIs). The role comes from the
// ahq_role cookie set at login/signup — server-side API routes still do their
// own session checks; this is the navigation fence.
const WAREHOUSE_ALLOWED_PREFIXES = ['/warehouse', '/api/warehouse', '/api/auth/'];

export function middleware(request: NextRequest) {
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

  // Warehouse role confinement
  const role = request.cookies.get('ahq_role')?.value;
  if (role === 'warehouse' && !WAREHOUSE_ALLOWED_PREFIXES.some(p => pathname.startsWith(p))) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Warehouse accounts can only use the warehouse view' }, { status: 403 });
    }
    return NextResponse.redirect(new URL('/warehouse', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
