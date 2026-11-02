import { notFound } from 'next/navigation';
import LandingPageRenderer from '@/components/storefront/landing-page-renderer';
import DzCodRenderer from '@/components/storefront/dz-cod-renderer';
import { StorefrontIntegrations } from '@/components/storefront/store-integrations';
import { HydrateStore } from '@/components/app/hydrate-store';
import { ServerSeo } from '@/components/storefront/server-seo';
import { getBackendUrl } from '@/lib/utils';
import type { Metadata } from 'next';

interface LpData {
  id: string;
  store_id: string;
  slug: string;
  headline: string;
  subtitle: string;
  badge_text: string;
  cta_label: string;
  cta2_label: string;
  image_url: string | null;
  video_url: string | null;
  cta_headline: string | null;
  cta_subtitle: string | null;
  product_name: string | null;
  product_desc: string | null;
  price: number | null;
  compare_price: number | null;
  primary_color: string;
  template: string;
  benefits: { icon: string; title: string; desc: string }[];
  testimonials: { name: string; location: string; text: string; stars: number; avatar?: string }[];
  steps: { step: string; title: string; desc: string }[];
  stats: { value: number; suffix: string; label: string }[];
  faq: { question: string; answer: string }[];
  gallery: string[];
  phone: string | null;
  views: number;
  orders: number;
  product: {
    id: string; name: string; slug: string;
    price: number; compare_price: number | null;
    main_image: string | null; images: string[];
    description: string;
    variants: any[] | null;
    stock: number;
  } | null;
}

function getAppBaseUrl() {
  return process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'http://localhost:3000';
}

async function fetchLandingPage(slug: string, storeId?: string): Promise<LpData | null> {
  const backendUrl = getBackendUrl();
  const encodedSlug = encodeURIComponent(slug);
  const query = storeId ? `?store_id=${encodeURIComponent(storeId)}` : '';
  console.log(`[fetchLandingPage] Starting fetch for slug: ${slug}, storeId: ${storeId} using backendUrl: ${backendUrl}`);
  try {
    const res = await fetch(
      `${backendUrl}/api/v1/landing-pages/slug/${encodedSlug}${query}`,
      { next: { revalidate: 0 } }
    );
    if (!res.ok) {
      if (storeId) {
        // Fallback: search by slug globally
        const fallbackRes = await fetch(
          `${backendUrl}/api/v1/landing-pages/slug/${encodedSlug}`,
          { next: { revalidate: 0 } }
        );
        if (fallbackRes.ok) {
          const json = await fallbackRes.json();
          return json.data ?? null;
        }
      }
      console.error(`[fetchLandingPage] Failed to fetch. Status: ${res.status} ${res.statusText}`);
      return null;
    }
    const json = await res.json();
    console.log(`[fetchLandingPage] Successfully fetched. Data present: ${!!json.data}`);
    return json.data ?? null;
  } catch (err) {
    console.error(`[fetchLandingPage] Exception during fetch:`, err);
    return null;
  }
}


export async function generateMetadata({ params, searchParams }: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ store?: string; store_id?: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const sp = await searchParams;
  const backendUrl = getBackendUrl();
  const baseUrl = getAppBaseUrl();
  let storeId = sp.store_id || '';
  let storeName = 'AzzougShop Landing Page';
  let description = 'Landing page AzzougShop';
  let image: string | null = null;
  let canonicalUrl = `${baseUrl}/lp/${slug}`;

  try {
    const lp = await fetchLandingPage(slug, storeId);
    if (lp) {
      description = lp.headline || lp.subtitle || description;
      image = lp.image_url || lp.product?.main_image || image;
      if (lp.store_id) storeId = lp.store_id;
    }

    const storeRes = await fetch(`${backendUrl}/api/v1/stores`, { next: { revalidate: 10 } });
    if (storeRes.ok) {
      const storeJson = await storeRes.json();
      const stores = storeJson.data ?? storeJson ?? [];
      const matchedStore = storeId
        ? stores.find((s: any) => s.id === storeId)
        : stores.find((s: any) => s.slug === sp.store) || stores[0];
      if (matchedStore) {
        storeName = matchedStore.name;
        description = matchedStore.description || description;
        image = matchedStore.logo_url || matchedStore.image_url || image;
        canonicalUrl = `${baseUrl}/lp/${slug}`;
      }
    }
  } catch {}

  return {
    metadataBase: new URL(baseUrl),
    title: `${storeName} | ${slug}`,
    description,
    alternates: { canonical: canonicalUrl },
    openGraph: {
      title: `${storeName} | ${slug}`,
      description,
      type: 'website',
      locale: 'fr_FR',
      url: canonicalUrl,
      images: image ? [{ url: image }] : undefined,
    },
    twitter: {
      card: 'summary_large_image',
      title: `${storeName} | ${slug}`,
      description,
      images: image ? [image] : undefined,
    },
  };
}

export default async function LpPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ store?: string; store_id?: string }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;

  const backendUrl = getBackendUrl();

  console.log(`[LpPage] Rendering LP page for slug: "${slug}"`);
  console.log(`[LpPage] Incoming searchParams:`, sp);

  // ── Store Resolution with strict tenant isolation ──────────────────────
  let storeId = sp.store_id || '';
  let stores: any[] = [];
  let matchedStore: any = null;
  
  try {
    const res = await fetch(`${backendUrl}/api/v1/stores`, { next: { revalidate: 10 } });
    if (res.ok) {
      const json = await res.json();
      stores = json.data ?? json ?? [];
      console.log(`[LpPage] Fetched ${stores.length} stores from backend`);

      if (storeId) {
        matchedStore = stores.find((s) => s.id === storeId) ?? null;
      } else if (sp.store) {
        const storeSlug = sp.store;
        matchedStore = stores.find((s) => s.slug === storeSlug) ?? null;
        if (matchedStore) storeId = matchedStore.id;
      }
    } else {
      console.error(`[LpPage] Failed to fetch stores from backend, status: ${res.status}`);
    }
  } catch (err) {
    console.error(`[LpPage] Exception fetching stores:`, err);
  }

  const lp = await fetchLandingPage(slug, storeId);
  if (!lp) {
    console.warn(`[LpPage] No landing page found for slug "${slug}". Returning 404.`);
    return notFound();
  }

  // Authoritatively use the LP's registered store_id
  if (lp.store_id) {
    storeId = lp.store_id;
    matchedStore = stores.find((s) => s.id === storeId) ?? matchedStore;
  }

  // Fetch Meta Ads Config for the store — the unauthenticated /public-config
  // variant, NOT the admin /config endpoint: this SSR has no user session to
  // attach, and /config requires one (always 401s here otherwise, silently
  // leaving window.__metaTrackingConfig empty for every store — confirmed by
  // real end-to-end testing, not assumed).
  let metaAdsConfig = null;
  try {
    const res = await fetch(`${backendUrl}/api/v1/meta-ads/public-config?store_id=${storeId}`, { next: { revalidate: 10 } });
    if (res.ok) {
      const json = await res.json();
      metaAdsConfig = json.data;
    }
  } catch { /* ignore */ }

  return (
    <>
      <ServerSeo
        title={matchedStore?.name || 'AzzougShop Landing Page'}
        description={lp?.headline || lp?.subtitle || 'Landing page AzzougShop'}
        image={lp?.image_url || lp?.product?.main_image || matchedStore?.logo_url || matchedStore?.image_url || null}
        url={`${getAppBaseUrl()}/lp/${slug}`}
      />
      <HydrateStore initialUser={null} initialStores={stores} activeStoreSlug={matchedStore?.slug} />
      <StorefrontIntegrations config={metaAdsConfig} lpId={lp.id} />
      {lp.template === 'dz_cod' ? (
        <DzCodRenderer data={lp} />
      ) : (
        <LandingPageRenderer data={lp} />
      )}
    </>
  );
}
