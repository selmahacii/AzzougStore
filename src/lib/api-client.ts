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

type RefreshOutcome = 'ok' | 'invalid' | 'unavailable';
let _refreshPromise: Promise<RefreshOutcome> | null = null;

// ─── Global in-flight concurrency gate ─────────────────────────────────────
// Dashboard pages fire 15-20 independent GETs in parallel on mount (each
// react-query hook fires the instant its `enabled` condition is true, with
// no built-in stagger). Against the backend's 2-vCPU free-tier container,
// bursts that size can take long enough to drain that HF's own front-door
// gateway times out the tail of the queue with a bare 500/502/503 — before
// our request even reaches the app (confirmed: the app's own access/error
// logs show zero trace for these, see production incident 2026-07-19).
// Capping how many requests this tab has in flight at once doesn't fix the
// backend's capacity, but it means we no longer fire the exact burst size
// that trips the gateway's own limit.
const MAX_CONCURRENT_REQUESTS = 6;
let _activeRequests = 0;
const _requestQueue: Array<() => void> = [];

function _acquireSlot(): Promise<void> {
  if (_activeRequests < MAX_CONCURRENT_REQUESTS) {
    _activeRequests++;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    _requestQueue.push(() => {
      _activeRequests++;
      resolve();
    });
  });
}

function _releaseSlot(): void {
  _activeRequests--;
  const next = _requestQueue.shift();
  if (next) next();
}

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

  await _acquireSlot();
  try {
    return await _apiFetchInner<T>(path, { skipCsrf, silent, allStores, headers: customHeaders, ...rest });
  } finally {
    _releaseSlot();
  }
}

async function _apiFetchInner<T = unknown>(
  path: string,
  options: ApiClientOptions = {},
): Promise<T> {
  const { skipCsrf = false, silent = false, allStores = false, headers: customHeaders, ...rest } = options;

  const headers = new Headers(customHeaders);

  // CSRF protection for mutating methods
  if (!skipCsrf) {
    headers.set('X-Requested-With', 'XMLHttpRequest');
  }

  // Tenant context — send store ID to FastAPI's TenantMiddleware
  if (allStores) {
    headers.set('X-Store-Id', 'SUPER_ADMIN_MODE');
  } else {
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

  // HF Space's free-tier gateway intermittently returns a bare 500/502/503/504
  // (HTML, not our JSON) before the request ever reaches the app — confirmed
  // repeatedly (see production incident 2026-07-19: RAWENTRY/RAWEXIT logging
  // added at the outermost ASGI layer proved every request that reaches our
  // process succeeds; the browser-visible 500/503s never arrive at all).
  // GET is always safe to retry blindly (no side effects). PATCH/PUT/DELETE
  // against a single resource (e.g. PATCH /orders/{id} — every status
  // change, NRP mark, note a confirmatrice makes) are REST-idempotent: they
  // set fields to absolute values, so replaying one that silently died at
  // the gateway reaches the same end state, never a duplicate. POST stays
  // excluded in general (e.g. creating an order) since replaying it could
  // double-create — EXCEPT login (POST /api/v1/auth), which has no such
  // risk (authenticating twice just issues a new session) and was reported
  // hard-failing on repeat gateway 500s with no fallback.
  const httpMethod = (rest.method ?? 'GET').toUpperCase();
  const isLogin = httpMethod === 'POST' && path === '/api/v1/auth';
  const isRetryable = httpMethod === 'GET' || httpMethod === 'PATCH' || httpMethod === 'PUT' || httpMethod === 'DELETE' || isLogin;
  const maxAttempts = isRetryable ? 3 : 1;
  let response: Response;
  let attempt = 0;
  for (;;) {
    attempt++;
    try {
      response = await fetch(path, {
        ...rest,
        headers,
        credentials: 'include', // Always send __session cookie
      });
    } catch (networkErr) {
      // The connection itself was dropped (not even a response) — the same
      // gateway flakiness can manifest this way, not just as a bare 500.
      if (isRetryable && attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 400 * attempt));
        continue;
      }
      throw networkErr;
    }
    const isGatewayError = [500, 502, 503, 504].includes(response.status);
    if (isRetryable && isGatewayError && attempt < maxAttempts) {
      await new Promise((r) => setTimeout(r, 400 * attempt));
      continue;
    }
    break;
  }

  // ── Silent token refresh on 401 ─────────────────────────────────────────
  if (response.status === 401) {
    // Prevent infinite refresh loops
    if (path.includes('/auth/refresh') || path.includes('/auth/login')) {
      _clearSession(silent);
      throw new ApiClientError('Session expirée', 401, 'TOKEN_EXPIRED');
    }

    if (_refreshPromise) {
      const outcome = await _refreshPromise;
      if (outcome === 'ok') {
        // Call the inner fetcher directly, not apiFetch() — this call already
      // holds a concurrency slot (acquired by the outer apiFetch), and
      // re-entering apiFetch() would try to acquire a second one while
      // still holding the first. Harmless normally, but if MAX_CONCURRENT
      // requests all hit 401 at once (e.g. session genuinely expired while
      // a dashboard's queries are in flight), every one of them would block
      // waiting for a free slot that only frees once ITS retry completes —
      // a deadlock.
      return _apiFetchInner<T>(path, options);
      }
      if (outcome === 'unavailable') {
        throw new ApiClientError(
          'Service temporairement indisponible. Réessayez.',
          503,
          'REFRESH_UNAVAILABLE',
        );
      }
      _clearSession(silent);
      throw new ApiClientError('Session expirée', 401, 'SESSION_EXPIRED');
    }

    // 'invalid' = server explicitly said the refresh token itself is bad
    // (401/403) — genuinely log out. 'ok' = refresh succeeded. Anything else
    // (a 500/502/503/504 gateway blip, or the request not completing at all)
    // must NOT log the user out — was previously treated as "refresh
    // failed" -> _clearSession(), so a single transient gateway hiccup
    // during a routine token refresh force-logged-out a confirmatrice mid-
    // shift even though her session was perfectly valid. Retries first
    // (same gateway flakiness GETs already retry for); only gives up as
    // "infra unavailable" (not logout) if every attempt fails that way.
    _refreshPromise = (async () => {
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const refreshRes = await fetch('/api/v1/auth/refresh', {
            method: 'POST',
            credentials: 'include',
            headers: { 'X-Requested-With': 'XMLHttpRequest' },
          });
          if (refreshRes.ok) return 'ok' as const;
          if (refreshRes.status === 401 || refreshRes.status === 403) return 'invalid' as const;
          // Gateway-class error — retry before giving up.
        } catch {
          // Network-level failure — same retry treatment as a gateway error.
        }
        if (attempt < 3) await new Promise((r) => setTimeout(r, 400 * attempt));
      }
      return 'unavailable' as const;
    })();

    const refreshOutcome = await _refreshPromise;
    _refreshPromise = null;

    if (refreshOutcome === 'ok') {
      // Call the inner fetcher directly, not apiFetch() — this call already
      // holds a concurrency slot (acquired by the outer apiFetch), and
      // re-entering apiFetch() would try to acquire a second one while
      // still holding the first. Harmless normally, but if MAX_CONCURRENT
      // requests all hit 401 at once (e.g. session genuinely expired while
      // a dashboard's queries are in flight), every one of them would block
      // waiting for a free slot that only frees once ITS retry completes —
      // a deadlock.
      return _apiFetchInner<T>(path, options);
    }

    if (refreshOutcome === 'unavailable') {
      // Do NOT clear the session — the user is very likely still logged in,
      // the gateway just couldn't confirm it right now. Surface a distinct,
      // non-logout error so callers can show "réessayez" instead of a
      // session-expired prompt.
      throw new ApiClientError(
        'Service temporairement indisponible. Réessayez.',
        503,
        'REFRESH_UNAVAILABLE',
      );
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

    // 500/502/503/504 after retries are exhausted are, in practice, the HF
    // free-tier gateway dying under load — not a genuine app/business error
    // (confirmed via RAWENTRY/RAWEXIT tracing: requests that reach our
    // process succeed). Surfacing every one as an intrusive toast trained
    // users to see "erreur 500" as a constant, when it's really transient
    // infra noise most of the time already retried away. Still fully logged
    // to the console and still thrown (callers can show inline state) —
    // just not a popup.
    const isGatewayNoise = [500, 502, 503, 504].includes(response.status);
    if (isGatewayNoise) {
      console.error(`[API] ${path} → ${response.status} (gateway, not shown to user):`, message);
    } else if (!silent) {
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
