import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { verifyToken } from '@/lib/jwt-core';

// ═══════════════════════════════════════════════════════════════
// Next.js Middleware — Frontend-only concerns
//
// Rate limiting, auth enforcement, and business logic live in FastAPI.
// This middleware only:
//   1. Validates the __session cookie for page-level access control
//   2. Injects user headers for the thin /api/auth proxy
//   3. Handles domain → store slug routing (multi-tenant storefronts)
// ═══════════════════════════════════════════════════════════════

const COOKIE_NAME = '__session';

// Domain cache for multi-tenant routing
const domainCache = new Map<string, { storeId: string; storeSlug: string; cachedAt: number }>();
const DOMAIN_CACHE_TTL = 300_000;

async function resolveDomainToStore(hostname: string): Promise<{ storeId: string; storeSlug: string } | null> {
  const cached = domainCache.get(hostname);
  if (cached && Date.now() - cached.cachedAt < DOMAIN_CACHE_TTL) {
    return { storeId: cached.storeId, storeSlug: cached.storeSlug };
  }
  try {
    const backendUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8003';
    const res = await fetch(`${backendUrl}/api/v1/stores/lookup/domain?domain=${hostname}`, {
      headers: { 'x-internal-key': process.env.INTERNAL_API_KEY || 'development_key' },
    });
    if (res.ok) {
      const data = await res.json();
      domainCache.set(hostname, { storeId: data.storeId, storeSlug: data.storeSlug, cachedAt: Date.now() });
      return { storeId: data.storeId, storeSlug: data.storeSlug };
    }
  } catch {
    // Domain lookup failed — treat as unknown host
  }
  return null;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hostname = request.headers.get('host') ?? '';

  // ─── 1. Domain routing (multi-tenant storefronts) ─────────────
  if (hostname && !hostname.startsWith('localhost') && !hostname.startsWith('127.0.0.1')) {
    const storeMatch = await resolveDomainToStore(hostname);
    if (storeMatch) {
      const response = NextResponse.next();
      response.headers.set('x-store-id', storeMatch.storeId);
      response.headers.set('x-store-slug', storeMatch.storeSlug);

      if (
        !pathname.startsWith('/api') &&
        !pathname.startsWith('/_next') &&
        !pathname.includes('.') &&
        !pathname.startsWith(`/${storeMatch.storeSlug}`)
      ) {
        return NextResponse.rewrite(
          new URL(`/${storeMatch.storeSlug}${pathname}`, request.url),
          { headers: response.headers },
        );
      }
      return response;
    }
  }

  // ─── 2. /api/v1/* — pass through (proxied to FastAPI by next.config rewrites) ─
  // FastAPI handles auth, rate limiting, and CSRF for all /api/v1/* routes.
  if (pathname.startsWith('/api/v1/')) {
    return NextResponse.next();
  }

  // ─── 3. /api/auth — thin proxy, no middleware interference ─────
  if (pathname.startsWith('/api/auth')) {
    return NextResponse.next();
  }

  // ─── 4. Inject user headers from cookie for authenticated page routes ──
  const sessionCookie = request.cookies.get(COOKIE_NAME);
  if (sessionCookie?.value) {
    const payload = await verifyToken(sessionCookie.value);
    if (payload) {
      const requestHeaders = new Headers(request.headers);
      requestHeaders.set('x-user-id', payload.userId);
      requestHeaders.set('x-user-role', payload.role);
      requestHeaders.set('x-user-store-id', payload.storeId ?? '');
      return NextResponse.next({ request: { headers: requestHeaders } });
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/api/v1/:path*',
    '/api/auth/:path*',
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
