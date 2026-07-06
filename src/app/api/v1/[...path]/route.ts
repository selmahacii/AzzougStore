/**
 * Catch-all proxy: /api/v1/* → FastAPI backend
 * Forwards cookies, headers, body, and Set-Cookie back to the client.
 */

import { NextRequest, NextResponse } from 'next/server';

const FASTAPI_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8003';

function getBackendBase(): string {
  const url = FASTAPI_URL;
  if (url.includes('api.azghub.com')) {
    return 'https://selmabcpdchozz00-azzoug-backend.hf.space';
  }
  return url;
}

async function proxy(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }): Promise<NextResponse> {
  const { path } = await params;
  const base = getBackendBase();
  const targetPath = `/api/v1/${path.join('/')}`;
  const search = request.nextUrl.search;
  const url = `${base}${targetPath}${search}`;

  const forwardHeaders = new Headers();

  // Forward relevant request headers
  for (const [key, value] of request.headers.entries()) {
    const lower = key.toLowerCase();
    if (
      lower === 'cookie' ||
      lower === 'authorization' ||
      lower === 'content-type' ||
      lower === 'x-requested-with' ||
      lower === 'x-store-id' ||
      lower === 'x-forwarded-for' ||
      lower === 'accept'
    ) {
      forwardHeaders.set(key, value);
    }
  }

  const forwarded = request.headers.get('x-forwarded-for');
  const realIp = request.headers.get('x-real-ip');
  if (!forwarded && realIp) forwardHeaders.set('x-forwarded-for', realIp);

  let body: BodyInit | undefined = undefined;
  const method = request.method.toUpperCase();
  if (['POST', 'PUT', 'PATCH'].includes(method)) {
    body = await request.arrayBuffer();
  }

  try {
    const upstream = await fetch(url, {
      method,
      headers: forwardHeaders,
      body,
      redirect: 'follow',
    });

    let data: unknown = null;
    const ct = upstream.headers.get('content-type') ?? '';
    if (ct.includes('application/json')) {
      data = await upstream.json().catch(() => null);
    } else {
      data = await upstream.text().catch(() => '');
    }

    const response = NextResponse.json(data, { status: upstream.status });

    const setCookie = upstream.headers.get('set-cookie');
    if (setCookie) {
      response.headers.set('set-cookie', setCookie);
    }

    return response;
  } catch (err) {
    console.error(`[proxy /api/v1] ${method} ${targetPath} error:`, err);
    return NextResponse.json(
      { success: false, message: 'Backend temporairement indisponible.' },
      { status: 503 },
    );
  }
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const OPTIONS = proxy;
