import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

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

// Edge-safe JWT payload decoder (no crypto — FastAPI does real verification)
function _decodeJwtPayload(token: string): { userId?: string; role?: string; storeId?: string } | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const padded = parts[1].replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(parts[1].length / 4) * 4, '=');
    const decoded = JSON.parse(atob(padded));
    return {
      userId: decoded.sub ?? decoded.userId,
      role: decoded.role,
      storeId: decoded.storeId ?? decoded.store_id ?? null,
    };
  } catch {
    return null;
  }
}

// Domain cache for multi-tenant routing
const domainCache = new Map<string, { storeId: string; storeSlug: string; cachedAt: number }>();
const DOMAIN_CACHE_TTL = 300_000;

async function resolveDomainToStore(hostname: string): Promise<{ storeId: string; storeSlug: string } | null> {
  // Support subdomain routing (e.g. store-slug.azghub.com)
  let lookupDomain = hostname;
  const mainDomain = 'azghub.com';
  
  if (hostname.endsWith(`.${mainDomain}`) && hostname !== `www.${mainDomain}`) {
    lookupDomain = hostname.slice(0, -(mainDomain.length + 1)); // extract the subdomain (slug)
  }

  const cached = domainCache.get(lookupDomain);
  if (cached && Date.now() - cached.cachedAt < DOMAIN_CACHE_TTL) {
    return { storeId: cached.storeId, storeSlug: cached.storeSlug };
  }
  try {
    const getBackendUrl = () => {
      let url = 'http://localhost:8003';
      if (process.env.BACKEND_URL) {
        url = process.env.BACKEND_URL;
      } else {
        const publicUrl = process.env.NEXT_PUBLIC_API_URL;
        if (publicUrl && publicUrl.startsWith('http')) {
          url = publicUrl;
        } else if (process.env.VERCEL_URL) {
          url = `https://${process.env.VERCEL_URL}/_/backend`;
        }
      }

      if (url.includes('api.azghub.com')) {
        return 'https://selmabcpdchozz00-azzoug-backend.hf.space';
      }
      return url;
    };
    const backendUrl = getBackendUrl();
    console.log(`[Middleware] Looking up domain in backend: ${lookupDomain} using URL: ${backendUrl}`);
    const res = await fetch(`${backendUrl}/api/v1/stores/lookup/domain?domain=${lookupDomain}`, {
      headers: { 'x-internal-key': process.env.INTERNAL_API_KEY || 'development_key' },
    });
    if (res.ok) {
      const data = await res.json();
      console.log(`[Middleware] Successfully resolved domain ${lookupDomain} to storeId=${data.storeId}, storeSlug=${data.storeSlug}`);
      domainCache.set(lookupDomain, { storeId: data.storeId, storeSlug: data.storeSlug, cachedAt: Date.now() });
      return { storeId: data.storeId, storeSlug: data.storeSlug };
    } else {
      console.warn(`[Middleware] Domain lookup failed for ${lookupDomain} with status: ${res.status}`);
    }
  } catch (err) {
    console.error(`[Middleware] Exception during domain lookup for ${lookupDomain}:`, err);
  }
  return null;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hostname = request.headers.get('host') ?? '';

  // ─── 0. Redirect path-based storefronts to subdomains (e.g. azghub.com/slug -> slug.azghub.com) ───
  const segments = pathname.split('/').filter(Boolean);
  if (
    (hostname === 'azghub.com' || hostname === 'www.azghub.com') &&
    segments.length > 0
  ) {
    const potentialSlug = segments[0];
    const reservedWords = [
      'admin', 'api', 'env', 'login', 'register', 'dashboard', 
      'static', 'assets', '_next', 'lp', 'theme', 
      'uploads', 'images', 'favicon.ico'
    ];
    if (!reservedWords.includes(potentialSlug) && !potentialSlug.includes('.')) {
      const storeMatch = await resolveDomainToStore(potentialSlug);
      if (storeMatch) {
        const remainingPath = pathname.substring(potentialSlug.length + 1);
        const search = request.nextUrl.search;
        return NextResponse.redirect(
          new URL(`https://${storeMatch.storeSlug}.azghub.com${remainingPath}${search}`, request.url)
        );
      }
    }
  }

  // ─── 1. Domain routing (multi-tenant storefronts) ─────────────
  if (
    hostname && 
    !hostname.startsWith('localhost') && 
    !hostname.startsWith('127.0.0.1') &&
    hostname !== 'azghub.com' &&
    hostname !== 'www.azghub.com'
  ) {
    const storeMatch = await resolveDomainToStore(hostname);
    if (storeMatch) {
      const response = NextResponse.next();
      response.headers.set('x-store-id', storeMatch.storeId);
      response.headers.set('x-store-slug', storeMatch.storeSlug);

      if (
        !pathname.startsWith('/api') &&
        !pathname.startsWith('/env') &&
        !pathname.startsWith('/_next') &&
        !pathname.includes('.') &&
        !pathname.startsWith(`/${storeMatch.storeSlug}`)
      ) {
        if (pathname.startsWith('/lp/')) {
          const lpSlug = pathname.replace('/lp/', '');
          const newUrl = new URL(`/lp/${lpSlug}`, request.url);
          newUrl.searchParams.set('store_id', storeMatch.storeId);
          newUrl.searchParams.set('store', storeMatch.storeSlug);
          return NextResponse.rewrite(newUrl, { headers: response.headers });
        }

        return NextResponse.rewrite(
          new URL(`/${storeMatch.storeSlug}${pathname}`, request.url),
          { headers: response.headers },
        );
      }
      return response;
    }
  }

  // ─── 2. /api/v1/* — inject real user identity, then pass through ────────
  // FastAPI handles auth, rate limiting, and CSRF for all /api/v1/* routes.
  // The proxy at src/app/api/[...path]/route.ts always attaches the internal
  // API key, so without x-user-id, app/api/deps.py's get_current_user falls
  // back to the first SUPER_ADMIN in the DB for EVERY request — misattributing
  // every action (order status changes, etc.) to that account regardless of
  // who is actually logged in. Decode the session cookie here so the real
  // actor is forwarded.
  if (pathname.startsWith('/api/v1/')) {
    const sessionCookie = request.cookies.get(COOKIE_NAME);
    if (sessionCookie?.value) {
      const payload = _decodeJwtPayload(sessionCookie.value);
      if (payload?.userId) {
        const requestHeaders = new Headers(request.headers);
        requestHeaders.set('x-user-id', payload.userId);
        return NextResponse.next({ request: { headers: requestHeaders } });
      }
    }
    return NextResponse.next();
  }

  // ─── 3. /api/auth — thin proxy, no middleware interference ─────
  if (pathname.startsWith('/api/auth')) {
    return NextResponse.next();
  }

  // ─── 4. Inject user headers from cookie for authenticated page routes ──
  // Decode JWT payload without signature verification (FastAPI handles real auth).
  const sessionCookie = request.cookies.get(COOKIE_NAME);
  if (sessionCookie?.value) {
    const payload = _decodeJwtPayload(sessionCookie.value);
    if (payload) {
      const requestHeaders = new Headers(request.headers);
      requestHeaders.set('x-user-id', payload.userId ?? '');
      requestHeaders.set('x-user-role', payload.role ?? '');
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
