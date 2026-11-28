export const revalidate = 300;
export const dynamicParams = true;

export async function generateStaticParams() {
  return [];
}

import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import {
  RESERVED_APP_SLUGS,
  buildStoreMetadata,
  fetchMetaPublicConfigCached,
  fetchProductBySlugCached,
  fetchStoresCached,
  getAppBaseUrl,
} from '@/lib/server-fetchers';
import { StorePageShell } from '@/components/storefront/store-page-shell';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string; productSlug: string }>;
}): Promise<Metadata> {
  const { slug, productSlug } = await params;
  return buildStoreMetadata(slug, decodeURIComponent(productSlug));
}

export default async function ProductPage({
  params,
}: {
  params: Promise<{ slug: string; productSlug: string }>;
}) {
  const { slug, productSlug } = await params;
  const decodedProductSlug = decodeURIComponent(productSlug);
  const stores = await fetchStoresCached();
  const activeStore = stores.find((s) => s.slug === slug);

  if (stores.length > 0 && !activeStore && !RESERVED_APP_SLUGS.has(slug)) {
    notFound();
  }

  const [metaAdsConfig, product] = activeStore
    ? await Promise.all([
        fetchMetaPublicConfigCached(activeStore.id),
        fetchProductBySlugCached(activeStore.id, decodedProductSlug),
      ])
    : [null, null];

  const baseUrl = getAppBaseUrl();
  const baseCanonical = activeStore ? `${baseUrl}/${activeStore.slug}` : `${baseUrl}/${slug}`;
  const canonicalUrl = product
    ? `${baseCanonical}?product=${encodeURIComponent(decodedProductSlug)}`
    : baseCanonical;

  return (
    <StorePageShell
      slug={slug}
      activeStore={activeStore}
      initialStores={activeStore ? [activeStore] : stores}
      metaAdsConfig={metaAdsConfig}
      canonicalUrl={canonicalUrl}
      product={product}
    />
  );
}
