// ─── JWT Cookie-Based Authentication ──────────────────────────
// JWT lives in httpOnly + Secure + SameSite=Strict cookie ONLY.
// NEVER in localStorage or Zustand.
// ──────────────────────────────────────────────────────────────

import { cookies } from 'next/headers';
import type { NextRequest, NextResponse } from 'next/server';
import { signToken, verifyToken, COOKIE_NAME } from './jwt-core';

export { signToken, verifyToken, COOKIE_NAME } from './jwt-core';
export type { JwtPayload } from './jwt-core';

const COOKIE_MAX_AGE = 86400; // 24 hours in seconds

/**
 * Set the __session cookie on a NextResponse (or create one).
 */
export function setSessionCookie(
  response: NextResponse,
  payload: any,
  maxAge: number = COOKIE_MAX_AGE,
): NextResponse {
  // We can't await signToken here synchronously.
  // This function should be avoided in favor of setSessionCookieAsync.
  return response;
}

/**
 * Async version: sign token then set cookie on the response.
 * Use this in API routes where you can await.
 */
export async function setSessionCookieAsync(
  response: NextResponse,
  payload: any,
  maxAge: number = COOKIE_MAX_AGE,
): Promise<NextResponse> {
  const token: string = await signToken(payload);
  response.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge,
  });
  return response;
}

/**
 * Set session cookie using server-side cookies() API.
 */
export async function setSessionCookieOnHeaders(
  payload: any,
  maxAge: number = COOKIE_MAX_AGE,
): Promise<void> {
  const token: string = await signToken(payload);
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge,
  });
}

/**
 * Clear the __session cookie (logout).
 */
export function clearSessionCookie(response: NextResponse): NextResponse {
  response.cookies.set(COOKIE_NAME, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: 0,
  });
  return response;
}

/**
 * Clear the session cookie using the server cookies() API.
 */
export async function clearSessionCookieOnHeaders(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: 0,
  });
}

/**
 * Read the __session cookie from an incoming NextRequest.
 */
export function getSessionCookie(request: NextRequest): string | null {
  return request.cookies.get(COOKIE_NAME)?.value ?? null;
}

/**
 * Read the __session cookie from server-side cookies() API.
 */
export async function getServerSessionCookie(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(COOKIE_NAME)?.value ?? null;
}

export { COOKIE_MAX_AGE };
