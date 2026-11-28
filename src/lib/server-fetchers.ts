import { cache } from 'react';
import { getBackendUrl } from '@/lib/utils';
import type { Store } from '@/lib/types';
import type { Metadata } from 'next';

export interface LpData {
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
    id: string;
    name: string;
    slug: string;
    price: number;
    compare_price: number | null;
    main_image: string | null;
    images: string[];
    description: string;
    variants: any[] | null;
    stock: number;
  } | null;
}

export function getAppBaseUrl() {
  return process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'http://localhost:3000';
}

export const RESERVED_APP_SLUGS = new Set(['admin', 'login', 'register', 'dashboard']);

export const fetchStoresCached = cache(async (): Promise<Store[]> => {
  const backendUrl = getBackendUrl();
  try {
    const res = await fetch(`${backendUrl}/api/v1/stores`, {
      next: { revalidate: 300, tags: ['stores'] },
    });
    if (!res.ok) return [];
    const json = await res.json();
    return (json.data ?? json ?? []) as Store[];
  } catch {
    return [];
  }
});

export const fetchMetaPublicConfigCached = cache(async (storeId: string): Promise<any | null> => {
  if (!storeId) return null;
  const backendUrl = getBackendUrl();
  try {
    const res = await fetch(
      `${backendUrl}/api/v1/meta-ads/public-config?store_id=${encodeURIComponent(storeId)}`,
      { next: { revalidate: 300, tags: ['meta-config', `meta-config:${storeId}`] } }
    );
    if (!res.ok) return null;
    const json = await res.json();
    return json.data ?? null;
  } catch {
    return null;
  }
});

export const fetchProductBySlugCached = cache(async (storeId: string, productSlug: string): Promise<any | null> => {
  if (!storeId || !productSlug) return null;
  const backendUrl = getBackendUrl();
  try {
    const res = await fetch(
      `${backendUrl}/api/v1/products?store_id=${encodeURIComponent(storeId)}&slug=${encodeURIComponent(productSlug)}`,
      { next: { revalidate: 300, tags: ['products', `product:${storeId}:${productSlug}`] } }
    );
    if (!res.ok) return null;
    const json = await res.json();
    const products = (json.data ?? json ?? []) as any[];
    return products[0] ?? null;
  } catch {
    return null;
  }
});

export const fetchLandingPageCached = cache(async (
  slug: string,
  storeId: string,
  revalidateSeconds = 300,
): Promise<LpData | null> => {
  if (!slug) return null;
  const backendUrl = getBackendUrl();
  try {
    const res = await fetch(
      `${backendUrl}/api/v1/landing-pages/slug/${encodeURIComponent(slug)}?store_id=${encodeURIComponent(storeId)}`,
      revalidateSeconds === 0
        ? { next: { revalidate: 0 } }
        : { next: { revalidate: revalidateSeconds, tags: ['landing-pages', `lp:${storeId}:${slug}`] } }
    );
    if (!res.ok) return null;
    const json = await res.json();
    return (json.data ?? null) as LpData | null;
  } catch {
    return null;
  }
});

export async function buildStoreMetadata(slug: string, productSlug?: string): Promise<Metadata> {
  const baseUrl = getAppBaseUrl();
  const stores = await fetchStoresCached();
  const activeStore = stores.find((s) => s.slug === slug);

  let title = activeStore?.name || 'AzzougShop Storefront';
  let description = activeStore?.description || (activeStore ? `Bienvenue sur la boutique ${activeStore.name}` : 'Boutique en ligne AzzougShop');
  let image: string | null = activeStore?.logo_url || activeStore?.logo || null;
  let canonicalUrl = activeStore ? `${baseUrl}/${activeStore.slug}` : `${baseUrl}/${slug}`;

  if (activeStore && productSlug) {
    const product = await fetchProductBySlugCached(activeStore.id, productSlug);
    if (product) {
      title = `${product.name} - ${activeStore.name}`;
      description =
        (product.description
          ? String(product.description).replace(/<[^>]+>/g, ' ').trim()
          : `${product.name} disponible sur ${activeStore.name}`) || title;
      image = product.main_image || (product.images && product.images[0]) || image;
      canonicalUrl = `${canonicalUrl}?product=${encodeURIComponent(productSlug)}`;
    }
  }

  return {
    metadataBase: new URL(baseUrl),
    title,
    description,
    alternates: { canonical: canonicalUrl },
    openGraph: {
      title,
      description,
      type: 'website',
      locale: 'fr_FR',
      url: canonicalUrl,
      images: image ? [{ url: image }] : undefined,
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: image ? [image] : undefined,
    },
  };
}

export async function resolveStoreForLp(stores: Store[], hint: { storeId?: string; storeSlug?: string }) {
  if (hint.storeId) {
    const matched = stores.find((s) => s.id === hint.storeId) ?? null;
    return { storeId: hint.storeId, matchedStore: matched };
  }
  const matched = hint.storeSlug
    ? (stores.find((s) => s.slug === hint.storeSlug) ?? null)
    : (stores[0] ?? null);
  return { storeId: matched?.id ?? '', matchedStore: matched };
}

export async function buildLpMetadata(
  slug: string,
  hint: { storeId?: string; storeSlug?: string; revalidateSeconds?: number },
): Promise<Metadata> {
  const baseUrl = getAppBaseUrl();
  const stores = await fetchStoresCached();
  const { storeId, matchedStore } = await resolveStoreForLp(stores, hint);

  let storeName = matchedStore?.name || 'AzzougShop Landing Page';
  let description = matchedStore?.description || `Découvrez la landing page ${slug}`;
  let image: string | null = matchedStore?.logo_url || (matchedStore as any)?.image_url || null;
  const canonicalUrl = `${baseUrl}/lp/${slug}`;

  if (storeId) {
    const lp = await fetchLandingPageCached(slug, storeId, hint.revalidateSeconds ?? 300);
    if (lp) {
      description = lp.headline || lp.subtitle || description;
      image = lp.image_url || lp.product?.main_image || image;
    }
  }

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
