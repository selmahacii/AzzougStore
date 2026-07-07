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
}

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
    __metaPixelId?: string;
    __metaTrackingConfig?: { pixelId?: string; storeId?: string };
  }
}

const DEDUP_STORAGE_KEY = 'azzougshop_meta_event_ids';
const DEDUP_TTL_MS = 1000 * 60 * 60 * 24 * 7;

function readStorage(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.sessionStorage.getItem(DEDUP_STORAGE_KEY);
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
    window.sessionStorage.setItem(DEDUP_STORAGE_KEY, JSON.stringify(payload));
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

  const pixelId = options.pixelId || window.__metaPixelId || window.__metaTrackingConfig?.pixelId;
  const storeId = options.storeId || window.__metaTrackingConfig?.storeId;
  const eventId = options.eventId || `${eventName}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const dedupIds = readStorage();
  if (dedupIds.includes(eventId)) return;

  const contentPayload = {
    content_name: options.contentName || payload.content_name,
    content_category: options.contentCategory || payload.content_category,
    content_type: options.contentType || payload.content_type || 'product',
    currency: options.currency || payload.currency || 'DZD',
    value: options.value ?? payload.value,
    contents: options.contents || payload.contents,
    ...payload,
  };

  if (typeof window.fbq === 'function' && pixelId) {
    try {
      (window.fbq as (...args: unknown[]) => void)('trackSingle', pixelId, eventName, contentPayload, { event_id: eventId });
    } catch {
      (window.fbq as (...args: unknown[]) => void)('track', eventName, contentPayload, { event_id: eventId });
    }
  } else if (typeof window.fbq === 'function') {
    try {
      (window.fbq as (...args: unknown[]) => void)('track', eventName, contentPayload, { event_id: eventId });
    } catch {
      // ignore pixel failures
    }
  }

  const userData = await buildMetaUserData(options.userData);
  const eventPayload = {
    pixel_id: pixelId,
    store_id: storeId,
    event_name: eventName,
    event_time: Math.floor(Date.now() / 1000),
    event_id: eventId,
    event_source_url: options.eventSourceUrl || window.location.href,
    user_data: userData,
    external_id: options.externalId,
    client_ip_address: options.clientIpAddress,
    client_user_agent: options.clientUserAgent || window.navigator.userAgent,
    fbp: options.fbp || pickCookie('_fbp'),
    fbc: options.fbc || pickCookie('_fbc'),
    event_data: contentPayload,
    pixel_event_fired: true,
  };

  if (options.shouldSendToServer !== false && pixelId) {
    try {
      await fetch('/api/v1/meta-ads/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(eventPayload),
      });
    } catch {
      // ignore server failures for tracking
    }
  }

  const nextIds = [...dedupIds, eventId].slice(-50);
  writeStorage(nextIds);
}

export function setMetaPixelId(pixelId?: string, storeId?: string) {
  if (typeof window === 'undefined') return;
  window.__metaPixelId = pixelId;
  window.__metaTrackingConfig = { pixelId, storeId };
}
