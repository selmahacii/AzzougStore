// ─── Authentication Helpers ────────────────────────────────────
// Shared authentication functions for API routes.
// Supports both cookie-based JWT and middleware-injected headers.
// ──────────────────────────────────────────────────────────────

import { db } from '@/lib/db';
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import type { UserRole } from '@/lib/types';
import { verifyToken, getServerSessionCookie } from '@/lib/jwt';

// ═══════════════════════════════════════════════════════════════
// Role Hierarchy — Higher number = more privileges
// ═══════════════════════════════════════════════════════════════

const ROLE_HIERARCHY: Record<UserRole, number> = {
  SUPER_ADMIN: 100,
  ADMIN: 80,
  MANAGER: 50,
  CONFIRMATEUR: 10,
  MARKETER: 5,
  CUSTOMER: 0,
};

// ═══════════════════════════════════════════════════════════════
// Authenticated User Context
// ═══════════════════════════════════════════════════════════════

export interface AuthContext {
  userId: string;
  role: UserRole;
  storeId: string | null;
}

/**
 * Get the full authenticated user context (id, role, storeId).
 * Resolution order:
 *   1. Middleware-injected headers (x-user-id, x-user-role, x-user-store-id)
 *   2. Cookie-based JWT (__session httpOnly cookie)
 * Returns null if not authenticated (e.g., public GET requests).
 * 
 * SECURITY: No module-level caching — Next.js headers() is already
 * cached per-request at the framework level. Module-level caching
 * causes cross-request auth context leaks in concurrent environments.
 */
export async function getAuthContext(): Promise<AuthContext | null> {
  try {
    // 1. Try middleware-injected headers first
    const headersList = await headers();
    const headerUserId = headersList.get('x-user-id');
    if (headerUserId) {
      const role = (headersList.get('x-user-role') || 'CONFIRMATEUR') as UserRole;
      const storeId = headersList.get('x-user-store-id') || null;
      return { userId: headerUserId, role, storeId };
    }

    // 2. Fallback: cookie-based JWT
    const sessionToken = await getServerSessionCookie();
    if (sessionToken) {
      const payload = await verifyToken(sessionToken);
      if (payload) {
        return {
          userId: payload.userId,
          role: payload.role as UserRole,
          storeId: payload.storeId ?? null,
        };
      }
    }

    // 3. No auth found
    return null;
  } catch {
    return null;
  }
}

/**
 * Require authentication. Returns user context or throws 401.
 */
export async function requireAuth(): Promise<AuthContext> {
  const ctx = await getAuthContext();
  if (!ctx) {
    throw new AuthorizationError('Authentification requise', 401);
  }
  return ctx;
}

/**
 * Require a minimum role (by UserRole enum string).
 * SUPER_ADMIN > MANAGER > CONFIRMATEUR
 */
export async function requireRole(minRole: UserRole): Promise<AuthContext> {
  const ctx = await requireAuth();
  const userLevel: number = ROLE_HIERARCHY[ctx.role] ?? 0;
  const requiredLevel: number = ROLE_HIERARCHY[minRole] ?? 0;
  if (userLevel < requiredLevel) {
    throw new AuthorizationError(
      `Accès refusé : rôle '${ctx.role}' insuffisant (minimum: '${minRole}')`,
      403,
    );
  }
  return ctx;
}

/**
 * Require a minimum role level (numeric).
 * SUPER_ADMIN=100, MANAGER=50, CONFIRMATEUR=10.
 */
export async function requireRoleLevel(minLevel: number): Promise<AuthContext> {
  const ctx = await requireAuth();
  const userLevel: number = ROLE_HIERARCHY[ctx.role] ?? 0;
  if (userLevel < minLevel) {
    throw new AuthorizationError(
      `Accès refusé : niveau d'accès insuffisant (${userLevel} < ${minLevel})`,
      403,
    );
  }
  return ctx;
}

/**
 * Require that the authenticated user has access to a specific store.
 * SUPER_ADMIN can access any store.
 * MANAGER/CONFIRMATEUR can only access their assigned store.
 */
export async function requireStoreAccess(targetStoreId: string): Promise<AuthContext> {
  const ctx = await requireAuth();

  // SUPER_ADMIN has access to all stores
  if (ctx.role === 'SUPER_ADMIN') return ctx;

  // ADMINs may own stores via ownedStores — check DB
  const adminLevels: UserRole[] = ['ADMIN'];
  if (adminLevels.includes(ctx.role)) {
    const owned = await db.store.findFirst({
      where: {
        id: targetStoreId,
        OR: [
          { ownerId: ctx.userId },
          { employees: { some: { id: ctx.userId } } },
        ],
      },
      select: { id: true },
    });
    if (owned) return ctx;
  }

  // Other roles: storeId in JWT must match
  if (ctx.storeId && ctx.storeId === targetStoreId) return ctx;

  throw new AuthorizationError(
    `Accès refusé : vous n'avez pas accès à ce magasin`,
    403,
  );
}

/**
 * Custom error class for authorization failures.
 * API routes should catch this and return the appropriate response.
 */
export class AuthorizationError extends Error {
  public statusCode: number;
  constructor(message: string, statusCode: number = 403) {
    super(message);
    this.name = 'AuthorizationError';
    this.statusCode = statusCode;
  }
}

/**
 * Helper to handle AuthorizationError in API routes.
 * Usage: wrap your handler with this, or catch errors individually.
 */
export function handleAuthError(error: unknown): NextResponse | null {
  // Check instanceof AND name to guard against module boundary issues
  const isAuthErr = error instanceof AuthorizationError ||
    ((error as any)?.name === 'AuthorizationError' && typeof (error as any)?.statusCode === 'number');
  if (isAuthErr) {
    const e = error as AuthorizationError;
    return NextResponse.json(
      {
        success: false,
        message: e.message,
        code: e.statusCode === 401 ? 'AUTH_REQUIRED' : 'FORBIDDEN',
      },
      { status: e.statusCode },
    );
  }
  return null;
}

// Cache for system actor ID (shared across all routes)
let cachedSystemActorId: string | null = null;

/**
 * Get a valid system actor ID for audit logging.
 * Falls back to SUPER_ADMIN → any user → throws if DB empty.
 */
export async function getSystemActorId(): Promise<string> {
  if (cachedSystemActorId) return cachedSystemActorId;
  const superAdmin = await db.user.findFirst({
    where: { role: 'SUPER_ADMIN' },
    select: { id: true },
  });
  if (superAdmin) {
    cachedSystemActorId = superAdmin.id;
    return superAdmin.id;
  }
  const anyUser = await db.user.findFirst({ select: { id: true } });
  if (anyUser) {
    cachedSystemActorId = anyUser.id;
    return anyUser.id;
  }
  throw new Error('No users found in database');
}

/**
 * Resolve an actor ID from a potentially string 'system' or null value.
 * Returns the provided actorId if valid, otherwise falls back to getSystemActorId().
 */
export async function resolveActorId(actorId?: string | null): Promise<string> {
  if (actorId && actorId !== 'system') return actorId;
  return getSystemActorId();
}

/**
 * Get the current authenticated user ID from middleware headers.
 * This is set by the JWT middleware on write operations.
 * Returns null if no user is authenticated (e.g., GET requests or auth disabled).
 */
export async function getAuthenticatedUserId(): Promise<string | null> {
  try {
    const headersList = await headers();
    return headersList.get('x-user-id') || null;
  } catch {
    return null;
  }
}

/**
 * Get the current authenticated user's role from middleware headers.
 */
export async function getAuthenticatedUserRole(): Promise<string | null> {
  try {
    const headersList = await headers();
    return headersList.get('x-user-role') || null;
  } catch {
    return null;
  }
}

/**
 * Get the store ID associated with the current request.
 * This is set either by domain routing middleware or from query params.
 */
export async function getRequestStoreId(searchParams?: URLSearchParams): Promise<string | null> {
  try {
    // First check middleware header (domain routing)
    const headersList = await headers();
    const headerStoreId = headersList.get('x-user-store-id');
    if (headerStoreId) return headerStoreId;

    // Fallback to search params
    return searchParams?.get('storeId') || null;
  } catch {
    return searchParams?.get('storeId') || null;
  }
}

/**
 * Resolve the best actor ID for the current request context.
 * Priority: explicit actorId param > middleware user ID > system actor.
 */
export async function resolveRequestActorId(explicitActorId?: string | null): Promise<string> {
  if (explicitActorId && explicitActorId !== 'system') return explicitActorId;

  // Try middleware-injected user ID
  const middlewareUserId = await getAuthenticatedUserId();
  if (middlewareUserId) return middlewareUserId;

  // Fallback to system actor
  return getSystemActorId();
}
