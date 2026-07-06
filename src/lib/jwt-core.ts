import { SignJWT, jwtVerify } from 'jose';

/**
 * Senior Architect Note: JWT Core Logic.
 * This file is purposefully decoupled from "next/headers" to remain compatible
 * with the Edge Runtime (Middleware).
 */

const COOKIE_NAME = '__session';
const JWT_ISSUER = 'multistore-platform';
const JWT_EXPIRATION = '24h';

// Use SECRET_KEY (same as FastAPI backend) with JWT_SECRET as fallback
const _jwtSecretRaw = process.env.SECRET_KEY || process.env.JWT_SECRET;
const JWT_SECRET = new TextEncoder().encode(
  _jwtSecretRaw || 'dev-only-fallback-secret-that-should-be-replaced-in-prod'
);

export interface JwtPayload {
  userId: string;
  email: string;
  role: string;
  storeId?: string | null;
}

/**
 * Sign a JWT token (Core).
 */
export async function signToken(payload: JwtPayload): Promise<string> {
  return await new SignJWT(payload as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(payload.userId)
    .setIssuedAt()
    .setIssuer(JWT_ISSUER)
    .setExpirationTime(JWT_EXPIRATION)
    .sign(JWT_SECRET);
}

/**
 * Verify a JWT token (Core).
 */
export async function verifyToken(token: string): Promise<JwtPayload | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET, {
      issuer: JWT_ISSUER,
    });
    return {
      userId: (payload.sub as string) || (payload.userId as string),
      email: payload.email as string,
      role: payload.role as string,
      storeId: (payload.storeId as string | null | undefined) ?? null,
    };
  } catch {
    return null;
  }
}

export { COOKIE_NAME };
