import { NextRequest, NextResponse } from 'next/server';
import { getBackendUrl } from '@/lib/utils';

export const dynamic = 'force-dynamic';

const BACKEND_URL = getBackendUrl();

export async function GET(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const resolvedParams = await params;
  return handleProxy(request, resolvedParams);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const resolvedParams = await params;
  return handleProxy(request, resolvedParams);
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const resolvedParams = await params;
  return handleProxy(request, resolvedParams);
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const resolvedParams = await params;
  return handleProxy(request, resolvedParams);
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const resolvedParams = await params;
  return handleProxy(request, resolvedParams);
}

async function handleProxy(request: NextRequest, { path }: { path: string[] }) {
  try {
    const subPath = path.join('/');
    // Skip proxying for /api/auth which has its own route handler
    if (subPath.startsWith('auth')) {
      return NextResponse.next();
    }

    const searchParams = request.nextUrl.searchParams.toString();
    const targetUrl = `${BACKEND_URL}/api/${subPath}${searchParams ? `?${searchParams}` : ''}`;

    // Filter headers to only pass essential ones, stripping Host/Origin/Referer
    const headers = new Headers();
    request.headers.forEach((value, key) => {
      const lowerKey = key.toLowerCase();
      if (
        !lowerKey.startsWith('host') &&
        !lowerKey.startsWith('origin') &&
        !lowerKey.startsWith('referer') &&
        !lowerKey.startsWith('x-forwarded') &&
        !lowerKey.startsWith('x-vercel')
      ) {
        headers.set(key, value);
      }
    });

    // Add internal API key if present
    if (process.env.INTERNAL_API_KEY) {
      headers.set('x-internal-key', process.env.INTERNAL_API_KEY);
    }

    const fetchOptions: RequestInit = {
      method: request.method,
      headers,
    };

    // Forward request body as a raw buffer for all mutation methods
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) {
      const arrayBuffer = await request.arrayBuffer().catch(() => null);
      if (arrayBuffer && arrayBuffer.byteLength > 0) {
        fetchOptions.body = arrayBuffer;
      }
    }

    // Without a timeout here, a slow/unreachable backend (e.g. right after
    // an HF Space redeploy/restart, while the container is still booting)
    // leaves this fetch() hanging until VERCEL'S OWN platform-level function
    // timeout kills it — which bypasses our try/catch entirely and returns
    // a raw Vercel-branded HTML 500 page (confirmed in prod: response had
    // `server: Vercel`, text/html, none of our JSON error shape below).
    // That's slow (waits out the full platform timeout, ~10s+) AND opaque
    // to the frontend's retry logic, which expects a normal HTTP status.
    // Aborting at 8s guarantees OUR catch block runs first every time,
    // producing the same fast, structured 503 JSON as any other proxy
    // failure — which api-client.ts already retries.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    let response: Response;
    try {
      response = await fetch(targetUrl, { ...fetchOptions, signal: controller.signal });
    } finally {
      clearTimeout(timeoutId);
    }

    // Build the proxied response headers
    const resHeaders = new Headers();
    // Backend responses that set both __session and __refresh (login, refresh)
    // emit TWO Set-Cookie headers. Headers.set() overwrites same-key entries,
    // so the second Set-Cookie was silently clobbering the first — only one
    // of the two cookies ever reached the browser. append() preserves both.
    if (typeof (response.headers as any).getSetCookie === 'function') {
      for (const cookie of (response.headers as any).getSetCookie()) {
        resHeaders.append('set-cookie', cookie);
      }
      response.headers.forEach((value, key) => {
        if (key.toLowerCase() !== 'set-cookie') {
          resHeaders.set(key, value);
        }
      });
    } else {
      response.headers.forEach((value, key) => {
        if (key.toLowerCase() === 'set-cookie') {
          resHeaders.append(key, value);
        } else {
          resHeaders.set(key, value);
        }
      });
    }

    // ── CDN cache override for safe, non-personalized public GET endpoints ──
    // Only applied when: GET request, 2xx response, no Set-Cookie on the
    // response, and (for endpoints whose backend response can vary by role —
    // products/stores widen results for staff) no __session cookie on the
    // INCOMING request, so a staff-scoped response can never be cached and
    // served back to an anonymous shopper. Prices/stock/promos still come
    // straight from the backend on every request past s-maxage — this only
    // shaves off repeat hits within a short revalidation window.
    if (subPath === 'v1/auth/me' || subPath.startsWith('v1/auth/')) {
      // Session-specific — never let a shared cache serve this across users.
      resHeaders.set('Cache-Control', 'private, no-store');
    } else if (request.method === 'GET' && response.ok && !resHeaders.has('set-cookie')) {
      const hasSession = !!request.cookies.get('__session');
      if (subPath === 'v1/reviews' || subPath.startsWith('v1/reviews')) {
        // Public reviews list — no current_user dependency in the backend, never personalized.
        resHeaders.set('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
      } else if (subPath === 'v1/stores/lookup/domain') {
        // Pure domain→store lookup, no auth dependency at all.
        resHeaders.set('Cache-Control', 'public, s-maxage=120, stale-while-revalidate=600');
      } else if (
        !hasSession &&
        (subPath === 'v1/products' || subPath.startsWith('v1/products/') || subPath === 'v1/products/categories')
      ) {
        // Product list/detail widens for staff (draft/inactive items) — only cache anonymous requests.
        resHeaders.set('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=120');
      } else if (!hasSession && subPath === 'v1/stores') {
        // Store list is scoped per staff role — only cache anonymous requests.
        resHeaders.set('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=120');
      }
    }

    const responseData = await response.arrayBuffer();

    return new NextResponse(responseData, {
      status: response.status,
      statusText: response.statusText,
      headers: resHeaders,
    });
  } catch (error: any) {
    console.error(`[API Proxy Error] failed to proxy /api/${path.join('/')}:`, error);
    return NextResponse.json(
      { 
        success: false, 
        message: 'Le serveur de base de données est temporairement inaccessible.',
        error: error?.message || String(error),
        cause: error?.cause ? (error.cause.message || error.cause.code || String(error.cause)) : null,
        env: {
          BACKEND_URL: process.env.BACKEND_URL || null,
          NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || null,
          VERCEL_URL: process.env.VERCEL_URL || null,
          NODE_ENV: process.env.NODE_ENV || null,
        },
        stack: error?.stack || ''
      },
      { status: 503 }
    );
  }
}
