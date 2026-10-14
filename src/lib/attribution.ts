/**
 * Campaign attribution — first-touch capture on the storefront.
 *
 * On the first page load we persist utm_* / fbclid / referrer / landing URL
 * in localStorage; the checkout attaches them to the order payload so the
 * admin can trace campaign → order → revenue, and the server-side CAPI
 * Purchase carries fbp/fbc for maximum Event Match Quality.
 *
 * localStorage, NOT sessionStorage: a Meta ad click almost always opens the
 * Facebook/Instagram in-app browser, not the phone's real browser. If the
 * customer backs out or closes that in-app view and comes back later to
 * finish checkout (very common — browsing on the bus, buying at home),
 * sessionStorage is already gone by then and the order ships with zero
 * attribution despite a correctly configured ad — this was confirmed live:
 * real orders on a properly UTM-tagged campaign still showed "Aucune donnée
 * UTM". localStorage survives across that gap; expires after 30 days so an
 * old capture can't wrongly attribute an unrelated later purchase.
 *
 * Meta URL parameter template to configure on ads:
 *   utm_source=facebook&utm_medium=paid&utm_campaign={{campaign.name}}
 *   &utm_content={{ad.name}}&campaign_id={{campaign.id}}
 *   &adset_id={{adset.id}}&ad_id={{ad.id}}
 *   &campaign_name={{campaign.name}}&adset_name={{adset.name}}&ad_name={{ad.name}}
 *   &placement={{placement}}&site_source_name={{site_source_name}}
 *
 * campaign_name/adset_name/ad_name/placement/site_source_name are Meta's
 * own real dynamic URL macros (verified: Meta ads support exactly 8 —
 * campaign.name/id, adset.name/id, ad.name/id, placement, site_source_name
 * — facebook.com/business/help/2360940870872492). Deliberately NOT
 * capturing "creative_id" or "device_platform": these are NOT real Meta
 * URL macros — Meta has no such dynamic parameter, so any code claiming to
 * capture them would be fabricating data. ad_id already identifies the
 * creative in the vast majority of real ad setups (1 ad = 1 creative).
 */

const KEY = 'azg_attribution_v1';
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface Attribution {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
  campaign_id?: string;
  adset_id?: string;
  ad_id?: string;
  campaign_name?: string;
  adset_name?: string;
  ad_name?: string;
  placement?: string;
  site_source_name?: string;
  fbclid?: string;
  referrer?: string;
  landing_url?: string;
  captured_at?: string;
  /** ms epoch of the page load that actually carried this fbclid — the real
   * click moment. Kept separate from `captured_at` (which is overwritten on
   * every later page load, incl. return visits with no fresh ad click) so a
   * fallback fbc built days later never embeds today's date as if it were
   * the click time — see getFbc() below. */
  fbclid_captured_at?: number;
}

type StringAttrKey = 'utm_source' | 'utm_medium' | 'utm_campaign' | 'utm_content' | 'utm_term'
  | 'campaign_id' | 'adset_id' | 'ad_id' | 'campaign_name' | 'adset_name' | 'ad_name'
  | 'placement' | 'site_source_name' | 'fbclid';
const PARAM_KEYS: StringAttrKey[] = [
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
  'campaign_id', 'adset_id', 'ad_id', 'campaign_name', 'adset_name', 'ad_name',
  'placement', 'site_source_name', 'fbclid',
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
        // Only stamped on a FRESH fbclid (this page load actually carried
        // one) — never touched on a later revisit with no new ad click, so
        // it stays pinned to the true click moment for as long as the
        // 30-day window keeps this fbclid alive.
        fbclid_captured_at: hasSignal && fresh.fbclid ? Date.now() : existing.fbclid_captured_at,
      };
      localStorage.setItem(KEY, JSON.stringify(hasSignal ? merged : { ...existing, ...merged }));
    }
  } catch { /* storage unavailable — never break the storefront */ }
}

export function getAttribution(): Attribution {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed: Attribution = JSON.parse(raw);
    if (parsed.captured_at) {
      const age = Date.now() - new Date(parsed.captured_at).getTime();
      if (age > MAX_AGE_MS) {
        localStorage.removeItem(KEY);
        return {};
      }
    }
    return parsed;
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

/**
 * Meta click id cookie, or rebuilt from a captured fbclid.
 *
 * BUG FIXED HERE: this used to stamp the fallback with `Date.now()` — the
 * moment getFbc() happens to run, not the moment of the actual ad click.
 * For a normal same-session checkout that's a few seconds off, harmless.
 * But for an ABANDONED CART recovered by a confirmatrice DAYS later, the
 * same stale fbclid gets replayed from localStorage (by design — 30-day
 * window) while the embedded timestamp silently jumps to "now". Meta's own
 * click record for that fbclid still has the REAL click time; a fbc that
 * claims the click happened days later than it did is a fabricated click
 * time that can push the event outside the ad set's attribution window and
 * make Meta quietly refuse to attribute an otherwise correctly-received
 * Purchase to the ad — exactly the "Events Manager shows it, Ads Manager
 * shows 0" symptom. Using the ORIGINAL capture time keeps the fbc anchored
 * to the true click regardless of how long a cart sits abandoned.
 */
export function getFbc(): string | undefined {
  const cookie = readCookie('_fbc');
  if (cookie) return cookie;
  const a = getAttribution();
  if (!a.fbclid) return undefined;
  const clickTime = a.fbclid_captured_at ?? (a.captured_at ? Date.parse(a.captured_at) : Date.now());
  return `fb.1.${clickTime}.${a.fbclid}`;
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
    campaign_name: a.campaign_name,
    adset_name: a.adset_name,
    ad_name: a.ad_name,
    placement: a.placement,
    site_source_name: a.site_source_name,
    fbclid: a.fbclid,
    fbp: getFbp(),
    fbc: getFbc(),
    referrer: a.referrer,
    event_source_url: typeof window !== 'undefined' ? window.location.href.slice(0, 500) : undefined,
  };
}
