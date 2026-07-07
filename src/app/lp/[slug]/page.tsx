import { notFound } from 'next/navigation';
import LandingPageRenderer from '@/components/storefront/landing-page-renderer';
import DzCodRenderer from '@/components/storefront/dz-cod-renderer';
import { StorefrontIntegrations } from '@/components/storefront/store-integrations';
import { HydrateStore } from '@/components/app/hydrate-store';
import { getBackendUrl } from '@/lib/utils';

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

async function fetchLandingPage(slug: string, storeId: string): Promise<LpData | null> {
  const backendUrl = getBackendUrl();
  console.log(`[fetchLandingPage] Starting fetch for slug: ${slug}, storeId: ${storeId} using backendUrl: ${backendUrl}`);
  try {
    const res = await fetch(
      `${backendUrl}/api/v1/landing-pages/slug/${slug}?store_id=${storeId}`,
      { next: { revalidate: 10 } }
    );
    if (!res.ok) {
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
  // Priority order:
  //   1. store_id (UUID) — injected by middleware from domain lookup (most authoritative)
  //   2. store slug — only used as fallback (e.g. localhost direct URL)
  // We NEVER let a user-provided ?store= override the domain-resolved tenant.
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
        // store_id was already set by middleware from domain resolution — trust it.
        // Still find the matchedStore for hydration but do NOT override storeId.
        matchedStore = stores.find((s) => s.id === storeId) ?? null;
        console.log(`[LpPage] Using domain-resolved storeId: ${storeId} (${matchedStore?.name || 'Unknown Store'})`);
      } else {
        // Localhost fallback: resolve from ?store= slug
        const storeSlug = sp.store || '';
        matchedStore = storeSlug
          ? (stores.find((s) => s.slug === storeSlug) ?? stores[0])
          : stores[0];
        if (matchedStore) storeId = matchedStore.id;
        console.log(`[LpPage] Resolved storeId from slug "${storeSlug}": ${storeId} (${matchedStore?.name || 'Unknown Store'})`);
      }
    } else {
      console.error(`[LpPage] Failed to fetch stores from backend, status: ${res.status}`);
    }
  } catch (err) {
    console.error(`[LpPage] Exception fetching stores:`, err);
  }

  if (!storeId) {
    console.warn(`[LpPage] No storeId resolved. Returning 404.`);
    return notFound();
  }

  const lp = await fetchLandingPage(slug, storeId);
  if (!lp) {
    console.warn(`[LpPage] No landing page found for slug "${slug}" and storeId "${storeId}". Returning 404.`);
    return notFound();
  }

  // Fetch Meta Ads Config for the store
  let metaAdsConfig = null;
  try {
    const res = await fetch(`${backendUrl}/api/v1/meta-ads/config?store_id=${storeId}`, { next: { revalidate: 10 } });
    if (res.ok) {
      const json = await res.json();
      metaAdsConfig = json.data;
    }
  } catch { /* ignore */ }

  return (
    <>
      <HydrateStore initialUser={null} initialStores={stores} activeStoreSlug={matchedStore?.slug} />
      <StorefrontIntegrations config={metaAdsConfig} />
      {lp.template === 'dz_cod' ? (
        <DzCodRenderer data={lp} />
      ) : (
        <LandingPageRenderer data={lp} />
      )}
    </>
  );
}
