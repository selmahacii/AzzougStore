/**
 * Campaign attribution — first-touch capture on the storefront.
 *
 * On the first page load we persist utm_* / fbclid / referrer / landing URL
 * in sessionStorage; the checkout attaches them to the order payload so the
 * admin can trace campaign → order → revenue, and the server-side CAPI
 * Purchase carries fbp/fbc for maximum Event Match Quality.
 *
 * Meta URL parameter template to configure on ads:
 *   utm_source=facebook&utm_medium=paid&utm_campaign={{campaign.name}}
 *   &utm_content={{ad.name}}&campaign_id={{campaign.id}}
 *   &adset_id={{adset.id}}&ad_id={{ad.id}}
 */

const KEY = 'azg_attribution_v1';

export interface Attribution {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
  campaign_id?: string;
  adset_id?: string;
  ad_id?: string;
  fbclid?: string;
  referrer?: string;
  landing_url?: string;
  captured_at?: string;
}

const PARAM_KEYS: (keyof Attribution)[] = [
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
  'campaign_id', 'adset_id', 'ad_id', 'fbclid',
];

/** Capture attribution from the current URL (first touch wins). */
export function captureAttribution(): void {
  if (typeof window === 'undefined') return;
  try {
    const params = new URLSearchParams(window.location.search);
    const fresh: Attribution = {};
    let hasSignal = false;
    for (const key of PARAM_KEYS) {
      const v = params.get(key);
      if (v) { fresh[key] = v; hasSignal = true; }
    }
    const existing = getAttribution();
    // First touch wins — only overwrite when the new visit carries ad signals
    if (hasSignal || !existing.captured_at) {
      const merged: Attribution = {
        ...(hasSignal ? fresh : {}),
        referrer: document.referrer || existing.referrer || undefined,
        landing_url: window.location.href.slice(0, 500),
        captured_at: new Date().toISOString(),
      };
      sessionStorage.setItem(KEY, JSON.stringify(hasSignal ? merged : { ...existing, ...merged }));
    }
  } catch { /* storage unavailable — never break the storefront */ }
}

export function getAttribution(): Attribution {
  if (typeof window === 'undefined') return {};
  try {
    return JSON.parse(sessionStorage.getItem(KEY) || '{}');
  } catch {
    return {};
  }
}

function readCookie(name: string): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const match = document.cookie.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  return match ? decodeURIComponent(match[1]) : undefined;
}

/** Meta browser id cookie (set by the Pixel). */
export function getFbp(): string | undefined {
  return readCookie('_fbp');
}

/** Meta click id cookie, or rebuilt from a captured fbclid. */
export function getFbc(): string | undefined {
  const cookie = readCookie('_fbc');
  if (cookie) return cookie;
  const { fbclid } = getAttribution();
  if (fbclid) return `fb.1.${Date.now()}.${fbclid}`;
  return undefined;
}

/** Everything the order payload needs, ready to spread. */
export function attributionPayload(): Record<string, string | undefined> {
  const a = getAttribution();
  return {
    utm_source: a.utm_source,
    utm_medium: a.utm_medium,
    utm_campaign: a.utm_campaign,
    utm_content: a.utm_content,
    utm_term: a.utm_term,
    campaign_id: a.campaign_id,
    adset_id: a.adset_id,
    ad_id: a.ad_id,
    fbclid: a.fbclid,
    fbp: getFbp(),
    fbc: getFbc(),
    referrer: a.referrer,
    event_source_url: typeof window !== 'undefined' ? window.location.href.slice(0, 500) : undefined,
  };
}
