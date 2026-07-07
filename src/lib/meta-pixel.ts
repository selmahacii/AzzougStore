/**
 * Meta Pixel + Conversions API — unified tracking helper.
 *
 * Every event goes out twice with the SAME event_id:
 *  1. browser Pixel  (fbq('track', …, { eventID }))  — note: the correct key
 *     of the 4th argument is `eventID`, NOT `event_id`;
 *  2. server CAPI relay (/api/v1/meta-ads/events)   — normalized + hashed
 *     server-side, sent in a background task (zero latency).
 * Meta deduplicates the pair, keeping the best-matched signal.
 *
 * The Purchase browser event pairs with the CAPI Purchase emitted by the
 * backend on order creation via the shared id `purchase-{order.id}`.
 */

import { getAttribution, getFbp, getFbc } from './attribution';

type Fbq = (...args: any[]) => void;

function fbq(): Fbq | null {
  if (typeof window === 'undefined') return null;
  return (window as any).fbq ?? null;
}

function uuid(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

export interface PixelCustomData {
  value?: number;
  currency?: string;
  content_ids?: string[];
  content_type?: string;
  content_name?: string;
  content_category?: string;
  contents?: { id: string; quantity: number; item_price?: number }[];
  num_items?: number;
}

export interface PixelUserData {
  ph?: string;   // raw phone — hashed server-side
  fn?: string;
  ln?: string;
  ct?: string;   // city / commune
  st?: string;   // state / wilaya
  em?: string;
  external_id?: string;
}

/** Guard: only fire once per (event, key) per page session. */
const fired = new Set<string>();
export function onceKey(event: string, key: string): boolean {
  const k = `${event}:${key}`;
  if (fired.has(k)) return false;
  fired.add(k);
  return true;
}

/**
 * Fire a standard Meta event on Pixel + CAPI with a shared event_id.
 * `mirrorToCapi: false` keeps it browser-only (used for Purchase, whose CAPI
 * half is emitted by the backend on order creation).
 */
export function trackMetaEvent(
  eventName: string,
  customData: PixelCustomData = {},
  options: {
    storeId?: string;
    eventId?: string;
    userData?: PixelUserData;
    mirrorToCapi?: boolean;
  } = {}
): string {
  const eventId = options.eventId || `${eventName.toLowerCase()}-${uuid()}`;
  const f = fbq();
  if (f) {
    try {
      f('track', eventName, customData, { eventID: eventId });
    } catch { /* never break the storefront */ }
  }

  if (options.mirrorToCapi !== false && options.storeId) {
    try {
      const attribution = getAttribution();
      const body = JSON.stringify({
        store_id: options.storeId,
        event_name: eventName,
        event_id: eventId,
        event_source_url: typeof window !== 'undefined' ? window.location.href.slice(0, 500) : undefined,
        action_source: 'website',
        user_data: {
          ...(options.userData ?? {}),
          fbp: getFbp(),
          fbc: getFbc(),
          fbclid: attribution.fbclid,
        },
        custom_data: customData,
      });
      // keepalive: survives navigation right after the event (checkout, etc.)
      fetch('/api/v1/meta-ads/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true,
      }).catch(() => { /* fire-and-forget */ });
    } catch { /* fire-and-forget */ }
  }
  return eventId;
}
