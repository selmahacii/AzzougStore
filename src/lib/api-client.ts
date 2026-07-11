/**
 * ═══════════════════════════════════════════════════════════════
 * AzzougShop — API Client (Refactored for FastAPI-only Backend)
 * ─────────────────────────────────────────────────────────────
 * Next.js is now STRICTLY a frontend. All data comes from FastAPI.
 *
 * This client:
 *   - Sends the __session httpOnly cookie automatically
 *   - Injects X-Requested-With for CSRF protection
 *   - Injects X-Store-Id tenant header from Zustand store
 *   - Performs silent token refresh on 401
 *   - Provides structured error objects with error_code
 * ═══════════════════════════════════════════════════════════════
 */
'use client';

import { useAppStore } from '@/store/app-store';
import { toast } from 'sonner';

// ─── Error Types ──────────────────────────────────────────────────────────────

export class ApiClientError extends Error {
  public statusCode: number;
  public errorCode: string;
  public data: unknown;

  constructor(message: string, statusCode: number, errorCode = 'UNKNOWN', data?: unknown) {
    super(message);
    this.name = 'ApiClientError';
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.data = data;
  }
}

// ─── Request Options ──────────────────────────────────────────────────────────

interface ApiClientOptions extends RequestInit {
  /** Skip CSRF header (for public GET requests) */
  skipCsrf?: boolean;
  /** Skip automatic toast on error */
  silent?: boolean;
  /** Bypass tenant isolation — fetches across all stores (admin only) */
  allStores?: boolean;
}

// ─── Core fetch wrapper ───────────────────────────────────────────────────────

let _refreshPromise: Promise<boolean> | null = null;

/**
 * apiFetch<T> — typed fetch wrapper.
 *
 * All requests go directly to FastAPI via Next.js rewrites.
 * The JWT lives exclusively in the __session httpOnly cookie set by FastAPI.
 * Zustand only holds non-sensitive user profile data (id, role, name).
 */
export async function apiFetch<T = unknown>(
  path: string,
  options: ApiClientOptions = {},
): Promise<T> {
  const { skipCsrf = false, silent = false, allStores = false, headers: customHeaders, ...rest } = options;

  console.log(`[API] ${rest.method ?? 'GET'} ${path}`);

  const headers = new Headers(customHeaders);

  // CSRF protection for mutating methods
  if (!skipCsrf) {
    headers.set('X-Requested-With', 'XMLHttpRequest');
  }

  // Tenant context — send store ID to FastAPI's TenantMiddleware.
  // A caller-provided X-Store-Id wins: cross-store screens (agent multi-boutique)
  // must target the ORDER's store, not whatever store happens to be active.
  if (allStores) {
    headers.set('X-Store-Id', 'SUPER_ADMIN_MODE');
  } else if (!headers.has('X-Store-Id')) {
    const activeStore = useAppStore.getState().activeStore;
    if (activeStore?.id) {
      headers.set('X-Store-Id', activeStore.id);
    }
  }

  // Auto Content-Type for JSON bodies
  const method = (rest.method ?? 'GET').toUpperCase();
  if (['POST', 'PATCH', 'PUT'].includes(method) && !headers.has('Content-Type') && rest.body) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(path, {
    ...rest,
    headers,
    credentials: 'include', // Always send __session cookie
  });

  // ── Silent token refresh on 401 ─────────────────────────────────────────
  if (response.status === 401) {
    // Prevent infinite refresh loops
    if (path.includes('/auth/refresh') || path.includes('/auth/login')) {
      _clearSession(silent);
      throw new ApiClientError('Session expirée', 401, 'TOKEN_EXPIRED');
    }

    if (_refreshPromise) {
      const refreshed = await _refreshPromise;
      if (refreshed) {
        return apiFetch<T>(path, options);
      }
      _clearSession(silent);
      throw new ApiClientError('Session expirée', 401, 'SESSION_EXPIRED');
    }

    _refreshPromise = (async () => {
      try {
        const refreshRes = await fetch('/api/v1/auth/refresh', {
          method: 'POST',
          credentials: 'include',
          headers: { 'X-Requested-With': 'XMLHttpRequest' },
        });
        return refreshRes.ok;
      } catch {
        return false;
      }
    })();

    const refreshed = await _refreshPromise;
    _refreshPromise = null;

    if (refreshed) {
      return apiFetch<T>(path, options);
    }

    _clearSession(silent);
    throw new ApiClientError('Session expirée', 401, 'SESSION_EXPIRED');
  }

  // ── Parse response ────────────────────────────────────────────────────────
  let json: unknown = null;
  try {
    json = await response.json();
  } catch {
    // Non-JSON response (e.g., 204 No Content)
  }

  if (!response.ok) {
    const body = json as Record<string, unknown> | null;
    // FastAPI AppException format: { error_code, message, detail }
    const errorCode = (body?.error_code as string) ?? 'UNKNOWN';
    const message =
      (body?.message as string) ??
      (typeof body?.detail === 'string'
        ? body.detail
        : Array.isArray(body?.detail)
          ? (body.detail as any[]).map((e) => e.message ?? e.msg ?? String(e)).join('; ')
          : `Erreur serveur (${response.status})`);

    if (!silent) {
      toast.error(message);
    }
    throw new ApiClientError(message, response.status, errorCode, json);
  }

  return json as T;
}

function _clearSession(silent: boolean): void {
  useAppStore.getState().logout();
  if (!silent) {
    toast.error('Session expirée', { 
      id: 'session-expired',
      description: 'Veuillez vous reconnecter.' 
    });
  }
}

// ─── Convenience wrappers ─────────────────────────────────────────────────────

export const api = {
  get: <T>(path: string, opts?: ApiClientOptions) =>
    apiFetch<T>(path, { method: 'GET', skipCsrf: true, ...opts }),

  post: <T>(path: string, body: unknown, opts?: ApiClientOptions) =>
    apiFetch<T>(path, { method: 'POST', body: JSON.stringify(body), ...opts }),

  patch: <T>(path: string, body: unknown, opts?: ApiClientOptions) =>
    apiFetch<T>(path, { method: 'PATCH', body: JSON.stringify(body), ...opts }),

  put: <T>(path: string, body: unknown, opts?: ApiClientOptions) =>
    apiFetch<T>(path, { method: 'PUT', body: JSON.stringify(body), ...opts }),

  delete: <T>(path: string, opts?: ApiClientOptions) =>
    apiFetch<T>(path, { method: 'DELETE', ...opts }),
};
