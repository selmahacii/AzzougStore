import { notFound } from 'next/navigation';
import dynamic from 'next/dynamic';

const LandingPageRenderer = dynamic(() => import('@/components/storefront/landing-page-renderer'));
const DzCodRenderer = dynamic(() => import('@/components/storefront/dz-cod-renderer'));
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
  meta_ads_config?: {
    store_id: string;
    pixel_id: string | null;
    domain_verification_tag: string | null;
    exchange_rate: number;
    currency: string;
  } | null;
  delivery_partners?: any[];
  store?: {
    id: string;
    name: string;
    logo_url: string | null;
    slug: string;
    description?: string;
  } | null;
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

function normalizeSlug(slug: string): string {
  try {
    const decoded = decodeURIComponent(slug).toLowerCase().trim();
    const clean = decoded
      .replace(/saccoche/g, 'sacoche')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    if (clean.includes('sacoche') && clean.includes('main')) {
      return 'sacoche-a-main';
    }
    return clean;
  } catch {
    const fallback = slug.toLowerCase().replace(/saccoche/g, 'sacoche');
    if (fallback.includes('sacoche') && fallback.includes('main')) {
      return 'sacoche-a-main';
    }
    return fallback;
  }
}

async function fetchLandingPage(rawSlug: string, storeId?: string): Promise<LpData | null> {
  const backendUrl = getBackendUrl();
  const slug = normalizeSlug(rawSlug) || rawSlug;
  const encodedSlug = encodeURIComponent(slug);
  const query = storeId ? `?store_id=${encodeURIComponent(storeId)}` : '';
  console.log(`[fetchLandingPage] Starting fetch for slug: ${slug} (raw: ${rawSlug}), storeId: ${storeId} using backendUrl: ${backendUrl}`);
  try {
    const res = await fetch(
      `${backendUrl}/api/v1/landing-pages/slug/${encodedSlug}${query}`,
      { next: { revalidate: 0 } }
    );
    if (!res.ok) {
      if (storeId) {
        // Fallback: search by slug globally without store_id
        const fallbackRes = await fetch(
          `${backendUrl}/api/v1/landing-pages/slug/${encodedSlug}`,
          { next: { revalidate: 0 } }
        );
        if (fallbackRes.ok) {
          const json = await fallbackRes.json();
          return json.data ?? null;
        }
      }
      if (rawSlug !== slug) {
        const rawEncoded = encodeURIComponent(rawSlug);
        const rawRes = await fetch(
          `${backendUrl}/api/v1/landing-pages/slug/${rawEncoded}${query}`,
          { next: { revalidate: 0 } }
        );
        if (rawRes.ok) {
          const json = await rawRes.json();
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
  const baseUrl = getAppBaseUrl();
  const lp = await fetchLandingPage(slug, sp.store_id);
  const matchedStore = lp?.store;
  const storeName = matchedStore?.name || 'AzzougShop Landing Page';
  const description = lp?.headline || lp?.subtitle || 'Landing page AzzougShop';
  const heroImage = (lp?.gallery && lp.gallery.length > 0)
    ? lp.gallery[0]
    : (lp?.image_url || lp?.product?.main_image || matchedStore?.logo_url || null);
  const canonicalUrl = `${baseUrl}/lp/${slug}`;

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
      images: heroImage ? [{ url: heroImage }] : undefined,
    },
    twitter: {
      card: 'summary_large_image',
      title: `${storeName} | ${slug}`,
      description,
      images: heroImage ? [heroImage] : undefined,
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

  console.log(`[LpPage] Rendering LP page for slug: "${slug}"`);

  // Direct unified fetch: retrieves LP, store, meta_ads_config & delivery_partners in 1 shot
  const lp = await fetchLandingPage(slug, sp.store_id);
  if (!lp) {
    console.warn(`[LpPage] No landing page found for slug "${slug}". Returning 404.`);
    return notFound();
  }

  const matchedStore = lp.store || null;
  const metaAdsConfig = lp.meta_ads_config || null;
  const heroImage = (lp.gallery && lp.gallery.length > 0)
    ? lp.gallery[0]
    : (lp.image_url || lp.product?.main_image || (lp.product?.images && lp.product.images[0]) || null);

  return (
    <>
      {heroImage && (
        <link
          rel="preload"
          as="image"
          href={heroImage}
          // @ts-expect-error fetchPriority is standard in HTML5
          fetchPriority="high"
        />
      )}
      <ServerSeo
        title={matchedStore?.name || lp?.headline || 'AzzougShop Landing Page'}
        description={lp?.headline || lp?.subtitle || 'Landing page AzzougShop'}
        image={heroImage || matchedStore?.logo_url || null}
        url={`${getAppBaseUrl()}/lp/${slug}`}
        preloadImage={heroImage}
      />
      <HydrateStore initialUser={null} initialStores={matchedStore ? [matchedStore] : []} activeStoreSlug={matchedStore?.slug} />
      <StorefrontIntegrations config={metaAdsConfig} lpId={lp.id} />
      {lp.template === 'dz_cod' ? (
        <DzCodRenderer data={lp} />
      ) : (
        <LandingPageRenderer data={lp} />
      )}
    </>
  );
}
