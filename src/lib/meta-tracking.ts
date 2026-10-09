export type MetaEventName =
  | 'PageView'
  | 'ViewContent'
  | 'Search'
  | 'ViewCategory'
  | 'AddToWishlist'
  | 'AddToCart'
  | 'InitiateCheckout'
  | 'AddPaymentInfo'
  | 'Purchase'
  | 'Lead'
  | 'Contact'
  | 'CompleteRegistration';

export interface MetaUserDataInput {
  email?: string;
  phone?: string;
  first_name?: string;
  last_name?: string;
  city?: string;
  wilaya?: string;
  country?: string;
  postal_code?: string;
}

export interface MetaTrackingOptions {
  pixelId?: string;
  storeId?: string;
  eventId?: string;
  orderId?: string;
  userData?: MetaUserDataInput;
  externalId?: string;
  value?: number;
  currency?: string;
  contents?: Array<{ id: string; quantity?: number }>;
  contentName?: string;
  contentCategory?: string;
  contentType?: string;
  clientIpAddress?: string;
  clientUserAgent?: string;
  eventSourceUrl?: string;
  fbp?: string;
  fbc?: string;
  shouldSendToServer?: boolean;
  /** Landing page id — powers the lightweight funnel-bottleneck rollup
   * (app/services/funnel_tracking.py). Optional: events without it are
   * still tracked, just without a per-LP breakdown. */
  lpId?: string;
  skipBrowserPixel?: boolean;
}

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
    __metaPixelId?: string;
    __metaTrackingConfig?: { pixelId?: string; storeId?: string; currency?: string; exchangeRate?: number };
  }
}

const DEDUP_STORAGE_KEY = 'azzougshop_meta_event_ids';
const DEDUP_TTL_MS = 1000 * 60 * 60 * 24 * 7;

function readStorage(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(DEDUP_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Array<{ ts: number; id: string }>;
    const now = Date.now();
    return parsed.filter(item => now - item.ts < DEDUP_TTL_MS).map(item => item.id);
  } catch {
    return [];
  }
}

function writeStorage(ids: string[]) {
  if (typeof window === 'undefined') return;
  try {
    const now = Date.now();
    const payload = ids.map(id => ({ id, ts: now }));
    window.localStorage.setItem(DEDUP_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // ignore storage failures
  }
}

const CURRENT_LP_KEY = 'azg_current_lp_id';

/**
 * "Last landing page viewed this tab" — deliberately sessionStorage, not the
 * 30-day localStorage attribution.ts uses for campaign first-touch: this is
 * "which LP was the shopper just on", not "which ad first brought them here".
 * Lets AddToCart (cart-store.ts) and InitiateCheckout (checkout-form.tsx)
 * inherit lp_id automatically without threading it through every call site —
 * neither currently accepts an lp_id parameter, and without this fallback
 * their events carry lp_id=null forever, which the /funnel/bottlenecks
 * by_landing_page waterfall (group_col.isnot(None)) silently excludes —
 * those two stages would never appear under any landing page, no matter how
 * much real traffic flows through the fix that made funnel events fire.
 */
export function setCurrentLpId(lpId?: string): void {
  if (typeof window === 'undefined' || !lpId) return;
  try {
    const payload = { id: lpId, ts: Date.now() };
    window.localStorage.setItem(CURRENT_LP_KEY, JSON.stringify(payload));
  } catch {
    // ignore storage failures
  }
}

function getCurrentLpId(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    const raw = window.localStorage.getItem(CURRENT_LP_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw);
    const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
    if (Date.now() - parsed.ts < SEVEN_DAYS) {
      return parsed.id;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

const CHECKOUT_ATTEMPT_KEY = 'azg_checkout_attempt_id';

/**
 * One id per real checkout attempt — replaces both the earlier Date.now()
 * scheme (defeated dedup entirely, real duplicates on every fee recalc) and
 * the 15-minute time bucket that followed it (an arbitrary proxy that both
 * false-merged a slow single attempt spanning a bucket boundary AND
 * false-split concurrent attempts sharing a cart across two tabs).
 *
 * Deliberately sessionStorage, NOT localStorage: the cart itself
 * (cart-store.ts, zustand `persist`) already lives in localStorage and
 * survives days/tab-closes on its own — an attempt id there would inherit
 * that same long life and never reset. sessionStorage's native lifetime
 * (per tab, cleared on close) IS the attempt boundary: same tab, refresh,
 * back/forward, fee recalculation, address edits → same id (read-if-present
 * below). New tab, or the same tab reopened after being closed → no
 * existing key → a fresh id, even with the identical cart (this is what a
 * pure cart-content signature could never do).
 *
 * Cleared only by clearCheckoutAttemptId() — called from checkout-form.tsx's
 * single order-submission success branch, which already covers both a
 * freshly created order AND the backend's 15-minute duplicate-basket guard
 * returning an existing order (orders.py) identically, so one call site is
 * enough for both "ended the attempt" cases.
 */
const SUBMITTED_PHONE_ATTEMPTS_KEY = 'azg_submitted_phone_attempts';

export function getOrCreateCheckoutAttemptId(phone?: string): string | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    const cleanPhone = phone ? phone.replace(/\D/g, '') : '';
    if (cleanPhone) {
      const raw = window.localStorage.getItem(SUBMITTED_PHONE_ATTEMPTS_KEY);
      if (raw) {
        const attempts = JSON.parse(raw) as Record<string, { id: string; ts: number }>;
        const existing = attempts[cleanPhone];
        if (existing && (Date.now() - existing.ts < 30 * 60 * 1000)) {
          return existing.id;
        }
      }
    }

    const existing = window.sessionStorage.getItem(CHECKOUT_ATTEMPT_KEY);
    if (existing) return existing;

    const id = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    window.sessionStorage.setItem(CHECKOUT_ATTEMPT_KEY, id);

    if (cleanPhone) {
      recordSubmittedPhoneAttempt(cleanPhone, id);
    }
    return id;
  } catch {
    return undefined;
  }
}

export function recordSubmittedPhoneAttempt(phone: string, attemptId: string): void {
  if (typeof window === 'undefined' || !phone) return;
  try {
    const cleanPhone = phone.replace(/\D/g, '');
    if (!cleanPhone) return;
    const raw = window.localStorage.getItem(SUBMITTED_PHONE_ATTEMPTS_KEY);
    const attempts = raw ? JSON.parse(raw) : {};
    const now = Date.now();
    
    const filtered: Record<string, { id: string; ts: number }> = {};
    for (const [p, data] of Object.entries(attempts as Record<string, { id: string; ts: number }>)) {
      if (now - data.ts < 30 * 60 * 1000) {
        filtered[p] = data;
      }
    }
    filtered[cleanPhone] = { id: attemptId, ts: now };
    window.localStorage.setItem(SUBMITTED_PHONE_ATTEMPTS_KEY, JSON.stringify(filtered));
  } catch {
    // ignore
  }
}

export function clearCheckoutAttemptId(): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(CHECKOUT_ATTEMPT_KEY);
  } catch {
    // ignore storage failures
  }
}

function isConsentEnabled(): boolean {
  if (typeof window === 'undefined') return true;
  const stored = window.localStorage.getItem('meta-tracking-consent') || window.localStorage.getItem('consent');
  if (!stored) return true;
  return stored === 'granted' || stored === 'true' || stored === '1';
}

function pickCookie(name: string): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : undefined;
}

function normalizeString(value?: string | null): string | undefined {
  if (!value) return undefined;
  const cleaned = value.trim();
  return cleaned ? cleaned : undefined;
}

function normalizeEmail(value?: string | null): string | undefined {
  const normalized = normalizeString(value)?.toLowerCase().replace(/\s/g, '');
  return normalized ? normalized : undefined;
}

function normalizePhone(value?: string | null): string | undefined {
  let normalized = normalizeString(value)?.replace(/\D/g, '');
  if (!normalized) return undefined;
  if (normalized.startsWith('0') && normalized.length === 10) {
    normalized = '213' + normalized.slice(1);
  }
  if (normalized.length === 9 && (normalized.startsWith('5') || normalized.startsWith('6') || normalized.startsWith('7'))) {
    normalized = '213' + normalized;
  }
  return normalized;
}

function normalizeName(value?: string | null): string | undefined {
  const normalized = normalizeString(value)?.toLowerCase().replace(/[^a-z0-9]/g, '');
  return normalized ? normalized : undefined;
}

function normalizeLocation(value?: string | null): string | undefined {
  const normalized = normalizeString(value)?.toLowerCase().trim();
  return normalized ? normalized : undefined;
}

function normalizeCountry(value?: string | null): string | undefined {
  const cleaned = normalizeString(value)?.toLowerCase().trim();
  if (!cleaned) return undefined;
  if (cleaned.includes('alger') || cleaned === 'dz' || cleaned === 'dza') {
    return 'dz';
  }
  return cleaned.slice(0, 2);
}

async function hashValue(value?: string): Promise<string | undefined> {
  const normalized = normalizeString(value);
  if (!normalized) return undefined;
  const bytes = new TextEncoder().encode(normalized);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function buildMetaUserData(input?: MetaUserDataInput): Promise<Record<string, string[]>> {
  const userData: Record<string, string[]> = {};
  const email = normalizeEmail(input?.email);
  const phone = normalizePhone(input?.phone);
  const firstName = normalizeName(input?.first_name);
  const lastName = normalizeName(input?.last_name);
  const city = normalizeLocation(input?.city);
  const wilaya = normalizeLocation(input?.wilaya);
  const country = normalizeCountry(input?.country);
  const postalCode = normalizeString(input?.postal_code)?.toLowerCase().replace(/\s/g, '');

  if (email) userData.em = [await hashValue(email) as string];
  if (phone) userData.ph = [await hashValue(phone) as string];
  if (firstName) userData.fn = [await hashValue(firstName) as string];
  if (lastName) userData.ln = [await hashValue(lastName) as string];
  if (city) userData.ct = [await hashValue(city) as string];
  if (wilaya) userData.st = [await hashValue(wilaya) as string];
  if (country) userData.co = [await hashValue(country) as string];
  if (postalCode) userData.zp = [await hashValue(postalCode) as string];

  return userData;
}

export async function trackMetaEvent(eventName: MetaEventName, payload: Record<string, unknown> = {}, options: MetaTrackingOptions = {}) {
  if (typeof window === 'undefined' || !isConsentEnabled()) return;

  // Real Meta-provided dynamic URL params only (campaign_id/adset_id/ad_id) —
  // never inferred/guessed, see attribution.ts's own "fabricating data" note.
  const { getAttribution } = await import('./attribution');
  const attribution = getAttribution();

  const pixelId = options.pixelId || window.__metaPixelId || window.__metaTrackingConfig?.pixelId;
  const storeId = options.storeId || window.__metaTrackingConfig?.storeId;
  const eventId = options.eventId || `${eventName}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const dedupIds = readStorage();
  if (dedupIds.includes(eventId)) return;

  // The ad account's OWN configured currency (meta_ads_configs.currency, e.g.
  // "USD" for azconfort) — never hardcode "DZD": Meta Pixel logged
  // "Parameter 'currency' is invalid for event 'Purchase'" for exactly this
  // account, because it's actually billed/reported in USD. `value` callers
  // pass is always in DZD (the ERP's native currency); convert it here using
  // the same DZD-per-unit rate meta_ads.py already uses for campaign spend,
  // so Pixel and CAPI never disagree on currency for the same event_id.
  const adCurrency = (window.__metaTrackingConfig?.currency || 'DZD').toUpperCase();
  const adRate = window.__metaTrackingConfig?.exchangeRate || 1;
  const rawValue = options.value ?? payload.value;
  const convertedValue = typeof rawValue === 'number' && adCurrency !== 'DZD'
    ? Math.round((rawValue / adRate) * 100) / 100
    : rawValue;

  const contentPayload = {
    content_name: options.contentName || payload.content_name,
    content_category: options.contentCategory || payload.content_category,
    content_type: options.contentType || payload.content_type || 'product',
    contents: options.contents || payload.contents,
    ...payload,
    currency: adCurrency,
    value: convertedValue,
  };

  // Pixel: only ever touched when this store has a Pixel configured — no
  // pixelId means no fbq() call, matching the fact that the Pixel <script>
  // itself (store-integrations.tsx) also only loads when pixelId is set.
  if (pixelId && typeof window.fbq === 'function' && !options.skipBrowserPixel) {
    try {
      (window.fbq as (...args: unknown[]) => void)('trackSingle', pixelId, eventName, contentPayload, { eventID: eventId });
    } catch {
      (window.fbq as (...args: unknown[]) => void)('track', eventName, contentPayload, { eventID: eventId });
    }
  }

  // Funnel Tracking fields — always sent, independent of Meta. This is the
  // only part of the payload a store without a Pixel ever needs; it feeds
  // record_funnel_event() (app/services/funnel_tracking.py) which the
  // backend already treats as independent of Meta CAPI config.
  //
  // The "last LP viewed" sessionStorage fallback is deliberately NEVER used
  // for PageView: PageView fires on every storefront page (store-integrations.tsx),
  // not just landing pages, so once a shopper had visited any LP earlier in
  // the tab session, every later PageView on an unrelated page (home, another
  // product...) would inherit that stale lp_id and pollute the
  // by_landing_page.pageviews count with visits that never happened on that
  // LP. Only ViewContent/AddToCart/InitiateCheckout — genuine funnel steps
  // that make sense to attribute to "the LP the shopper was just on" — use it.
  const lpId = options.lpId || (eventName !== 'PageView' ? getCurrentLpId() : undefined);
  const eventPayload: Record<string, unknown> = {
    store_id: storeId,
    event_name: eventName,
    event_time: Math.floor(Date.now() / 1000),
    event_id: eventId,
    event_source_url: options.eventSourceUrl || window.location.href,
    lp_id: lpId,
    campaign_id: attribution.campaign_id,
    adset_id: attribution.adset_id,
    ad_id: attribution.ad_id,
  };

  // Pixel/CAPI-only fields — only built and attached when a Pixel is
  // configured, so a store without Meta Ads never generates or transmits
  // hashed PII / CAPI-specific payload for events with no CAPI destination.
  if (pixelId) {
    // user_data DOIT être un objet plat (MetaEventUserData côté backend :
    // em/ph/fn/ln/ct/st/zp/fbp/fbc/client_ip_address/client_user_agent en
    // Optional[str]) — buildMetaUserData() renvoyait un objet {em: [hash],
    // ct: [hash], co: [hash], ...} au format Graph API (listes pré-hashées,
    // "co" au lieu de "country"), donc Pydantic ignorait silencieusement ces
    // champs (mauvais type/mauvaise clé) ET fbp/fbc/client_ip_address/
    // client_user_agent/external_id étaient envoyés au niveau racine
    // d'eventPayload au lieu d'être nichés dans user_data comme le schéma
    // l'exige — perdus avant même d'atteindre build_user_data côté serveur.
    // Envoyer les valeurs BRUTES ici et laisser le serveur normaliser/hasher
    // via build_user_data (déjà utilisé par le chemin commande) élimine le
    // double-traitement et garantit une seule implémentation de hachage.
    eventPayload.pixel_id = pixelId;
    eventPayload.order_id = options.orderId;
    eventPayload.user_data = {
      em: options.userData?.email || undefined,
      ph: options.userData?.phone || undefined,
      fn: options.userData?.first_name || undefined,
      ln: options.userData?.last_name || undefined,
      ct: options.userData?.city || undefined,
      st: options.userData?.wilaya || undefined,
      zp: options.userData?.postal_code || undefined,
      external_id: options.externalId,
      client_ip_address: options.clientIpAddress,
      client_user_agent: options.clientUserAgent || window.navigator.userAgent,
      fbp: options.fbp || pickCookie('_fbp'),
      fbc: options.fbc || pickCookie('_fbc'),
    };
    // MUST be named custom_data — MetaEventPayload (meta_ads.py) has no
    // "event_data" field, and Pydantic silently drops unrecognized keys by
    // default. This was named event_data, so custom_data was always None
    // server-side: send_meta_event never crashed (nothing to prove it was
    // broken), but Meta never received value/currency/content_ids through
    // this relay for ANY event, on top of the keepalive issue above.
    eventPayload.custom_data = contentPayload;
    eventPayload.pixel_event_fired = true;
  }

  if (options.shouldSendToServer !== false && storeId) {
    const body = JSON.stringify(eventPayload);
    // sendBeacon is purpose-built for exactly this — "fire this request even
    // if the page is about to unload" — and the browser guarantees delivery
    // attempts survive navigation, unlike fetch+keepalive which is still a
    // best-effort promise some browsers cancel under load. A JSON-typed Blob
    // preserves the Content-Type FastAPI needs to parse the body correctly.
    // Falls back to fetch+keepalive only when sendBeacon is unavailable or
    // refuses to queue the request (e.g. payload over its ~64KB cap).
    const beaconOk = typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function'
      && navigator.sendBeacon('/api/v1/meta-ads/events', new Blob([body], { type: 'application/json' }));
    if (!beaconOk) {
      try {
        await fetch('/api/v1/meta-ads/events', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          keepalive: true,
        });
      } catch {
        // ignore server failures for tracking
      }
    }
  }

  const nextIds = [...dedupIds, eventId].slice(-50);
  writeStorage(nextIds);
}

export function setMetaPixelId(pixelId?: string, storeId?: string, currency?: string, exchangeRate?: number) {
  if (typeof window === 'undefined') return;
  window.__metaPixelId = pixelId;
  window.__metaTrackingConfig = { pixelId, storeId, currency, exchangeRate };
}
