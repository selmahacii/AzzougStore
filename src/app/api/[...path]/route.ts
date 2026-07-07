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

    const response = await fetch(targetUrl, fetchOptions);

    // Build the proxied response headers
    const resHeaders = new Headers();
    response.headers.forEach((value, key) => {
      const lk = key.toLowerCase();
      // fetch() auto-decompresses gzip — strip encoding headers so the browser
      // doesn't try to decompress already-decompressed bytes (ERR_CONTENT_DECODING_FAILED)
      if (lk === 'content-encoding' || lk === 'transfer-encoding') return;
      resHeaders.set(key, value);
    });

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
