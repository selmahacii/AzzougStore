/**
 * ═══════════════════════════════════════════════════════════════
 * /api/auth — Thin Proxy to FastAPI Auth
 * ─────────────────────────────────────────────────────────────
 * This route no longer contains any business logic or DB access.
 *
 * All auth logic (bcrypt, JWT signing, audit logging, rate limiting)
 * is handled by FastAPI at /api/v1/auth/*.
 *
 * This Next.js handler ONLY:
 *   - Forwards login/logout requests to FastAPI
 *   - Passes through Set-Cookie headers (httpOnly session)
 *   - Returns the FastAPI response as-is
 *
 * The __session cookie is set by FastAPI and forwarded by Next.js.
 * ═══════════════════════════════════════════════════════════════
 */

import { NextResponse } from 'next/server';
import { getBackendUrl } from '@/lib/utils';

const FASTAPI_URL = getBackendUrl();

function getClientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  const realIp = request.headers.get('x-real-ip');
  return forwarded?.split(',')[0]?.trim() ?? realIp ?? '127.0.0.1';
}

// ─── POST /api/auth — Login ────────────────────────────────────────────────

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = await request.json();
    const clientIp = getClientIp(request);

    // Forward to FastAPI login endpoint
    const fastApiResponse = await fetch(`${FASTAPI_URL}/api/v1/auth/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': clientIp,
        'X-Real-Ip': clientIp,
      },
      body: JSON.stringify(body),
      credentials: 'include',
    });

    const data = await fastApiResponse.json().catch(() => ({}));

    // Forward the response (including Set-Cookie from FastAPI)
    const response = NextResponse.json(data, { status: fastApiResponse.status });

    // Forward any Set-Cookie headers from FastAPI (the __session cookie)
    const setCookie = fastApiResponse.headers.get('set-cookie');
    if (setCookie) {
      response.headers.set('set-cookie', setCookie);
    }

    return response;
  } catch (error) {
    console.error('[POST /api/auth] FastAPI proxy error:', error);
    return NextResponse.json(
      { success: false, message: 'Service d\'authentification temporairement indisponible.' },
      { status: 503 },
    );
  }
}

// ─── DELETE /api/auth — Logout ────────────────────────────────────────────

export async function DELETE(request: Request): Promise<NextResponse> {
  try {
    const sessionCookie = request.headers.get('cookie') || '';

    // Forward logout to FastAPI
    const fastApiResponse = await fetch(`${FASTAPI_URL}/api/v1/auth/`, {
      method: 'DELETE',
      headers: {
        'Cookie': sessionCookie,
        'X-Forwarded-For': getClientIp(request),
      },
    });

    const data = await fastApiResponse.json().catch(() => ({ success: true }));

    const response = NextResponse.json(data, { status: fastApiResponse.status });

    // Forward cookie clearing from FastAPI
    const setCookie = fastApiResponse.headers.get('set-cookie');
    if (setCookie) {
      response.headers.set('set-cookie', setCookie);
    }

    return response;
  } catch (error) {
    console.error('[DELETE /api/auth] FastAPI proxy error:', error);
    // Even on error: clear cookie client-side
    const response = NextResponse.json({ success: true });
    response.cookies.set('__session', '', { maxAge: 0, path: '/' });
    return response;
  }
}
