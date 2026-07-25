export const revalidate = 10;
import { ThemeInjector } from '@/components/theme-injector';
import { AppBootstrap } from '@/components/app/app-bootstrap';
import { UrlSync } from '@/components/app/url-sync';
import { HydrateStore } from '@/components/app/hydrate-store';
import { StorefrontIntegrations } from '@/components/storefront/store-integrations';
import { Suspense } from 'react';
import { getBackendUrl } from '@/lib/utils';
import { ServerSeo } from '@/components/storefront/server-seo';
import type { Metadata } from 'next';
import type { Store } from '@/lib/types';

// initialUser is intentionally NOT fetched here — see src/app/page.tsx for
// why (reading the session cookie forces per-request dynamic rendering and
// duplicates the auth call AppBootstrap already makes client-side).
async function fetchInitialData(slug: string) {
  const backendUrl = getBackendUrl();

  let initialStores: Store[] = [];
  let metaAdsConfig: any = null;

  try {
    const res = await fetch(`${backendUrl}/api/v1/stores`, { next: { revalidate: 10 } });
    if (res.ok) {
      const json = await res.json();
      initialStores = (json.data ?? json ?? []) as Store[];
    }
  } catch {
    // backend not reachable — client will load stores via React Query
  }

  const activeStore = initialStores.find(s => s.slug === slug);
  if (activeStore) {
    try {
      // /public-config, not the admin /config — this SSR has no user session
      // to attach and /config always 401s here (see lp/[slug]/page.tsx for
      // the full finding).
      const res = await fetch(`${backendUrl}/api/v1/meta-ads/public-config?store_id=${activeStore.id}`, { next: { revalidate: 10 } });
      if (res.ok) {
        const json = await res.json();
        metaAdsConfig = json.data;
      }
    } catch {
      // meta ads config check failed gracefully
    }
  }
  
  // Force a dummy pixel ID for testing (removed)

  return { initialStores, metaAdsConfig };
}

function getAppBaseUrl() {
  return process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'http://localhost:3000';
}

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const sp = await searchParams;
  const backendUrl = getBackendUrl();
  const baseUrl = getAppBaseUrl();
  let title = 'AzzougShop Storefront';
  let description = 'Boutique en ligne AzzougShop';
  let image: string | null = null;
  let canonicalUrl = `${baseUrl}/${slug}`;

  let activeStore: Store | undefined;
  try {
    const res = await fetch(`${backendUrl}/api/v1/stores`, { next: { revalidate: 10 } });
    if (res.ok) {
      const json = await res.json();
      const stores = (json.data ?? json ?? []) as Store[];
      activeStore = stores.find(s => s.slug === slug);
      if (activeStore) {
        title = activeStore.name;
        description = activeStore.description || `Bienvenue sur la boutique ${activeStore.name}`;
        image = activeStore.logo_url || activeStore.logo || null;
        canonicalUrl = `${baseUrl}/${activeStore.slug}`;
      }
    }
  } catch {}

  const productSlug = typeof sp.product === 'string' ? sp.product : undefined;
  if (activeStore && productSlug) {
    try {
      const res = await fetch(
        `${backendUrl}/api/v1/products?store_id=${activeStore.id}&slug=${encodeURIComponent(productSlug)}`,
        { next: { revalidate: 10 } }
      );
      if (res.ok) {
        const json = await res.json();
        const products = (json.data ?? json ?? []) as Array<{
          name: string; description?: string; main_image?: string; images?: string[]; price?: number;
        }>;
        const product = products[0];
        if (product) {
          title = `${product.name} - ${activeStore.name}`;
          description = (product.description
            ? product.description.replace(/<[^>]+>/g, ' ').trim()
            : `${product.name} disponible sur ${activeStore.name}`) || title;
          image = product.main_image || (product.images && product.images[0]) || image;
          canonicalUrl = `${canonicalUrl}?product=${encodeURIComponent(productSlug)}`;
        }
      }
    } catch {}
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

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const { initialStores, metaAdsConfig } = await fetchInitialData(slug);
  const activeStore = initialStores.find(s => s.slug === slug);
  const baseUrl = getAppBaseUrl();
  let canonicalUrl = activeStore ? `${baseUrl}/${activeStore.slug}` : `${baseUrl}/${slug}`;

  let productSchema: {
    name: string; description: string; image: string; sku?: string;
    price?: number | string; currency?: string; availability?: string; brand?: string;
  } | undefined;

  const productSlug = typeof sp.product === 'string' ? sp.product : undefined;
  if (activeStore && productSlug) {
    try {
      const backendUrl = getBackendUrl();
      const res = await fetch(
        `${backendUrl}/api/v1/products?store_id=${activeStore.id}&slug=${encodeURIComponent(productSlug)}`,
        { next: { revalidate: 10 } }
      );
      if (res.ok) {
        const json = await res.json();
        const products = (json.data ?? json ?? []) as Array<{
          name: string; description?: string; main_image?: string; images?: string[];
          sku?: string; price?: number; stock?: number; brand?: string;
        }>;
        const product = products[0];
        if (product) {
          canonicalUrl = `${canonicalUrl}?product=${encodeURIComponent(productSlug)}`;
          productSchema = {
            name: product.name,
            description: (product.description || '').replace(/<[^>]+>/g, ' ').trim() || product.name,
            image: product.main_image || (product.images && product.images[0]) || '',
            sku: product.sku,
            price: product.price,
            availability: (product.stock || 0) > 0 ? 'in stock' : 'out of stock',
            brand: product.brand || activeStore.name,
          };
        }
      }
    } catch {}
  }

  return (
    <>
      <ServerSeo
        title={activeStore?.name || 'AzzougShop Storefront'}
        description={activeStore?.description || 'Boutique en ligne AzzougShop'}
        image={activeStore?.logo_url || activeStore?.logo || null}
        url={canonicalUrl}
        productSchema={productSchema}
      />
      <StorefrontIntegrations config={metaAdsConfig} />
      <ThemeInjector />
      <HydrateStore initialUser={null} initialStores={initialStores} activeStoreSlug={slug} />
      <Suspense fallback={null}>
        <UrlSync />
      </Suspense>
      <AppBootstrap />
    </>
  );
}
