import { NextRequest, NextResponse } from 'next/server';

// Lightweight, edge-safe check: just looks at whether the session cookie is
// present, to bounce obviously-logged-out visitors straight to /login. The
// real, cryptographically verified check AND role-based access control
// happens inside each page/API route via getSession() in lib/auth.ts.
const COOKIE_NAME = 'mini_crm_session';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSession = Boolean(request.cookies.get(COOKIE_NAME)?.value);

  const isProtected =
    pathname.startsWith('/dashboard') ||
    pathname.startsWith('/admin') ||
    pathname.startsWith('/data-upload') ||
    pathname.startsWith('/coming-soon');

  if (isProtected && !hasSession) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard/:path*', '/admin/:path*', '/data-upload/:path*', '/coming-soon/:path*'],
};
