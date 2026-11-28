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
  fetchStoresCached,
  getAppBaseUrl,
} from '@/lib/server-fetchers';
import { StorePageShell } from '@/components/storefront/store-page-shell';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  return buildStoreMetadata(slug);
}

export default async function Page({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const stores = await fetchStoresCached();
  const activeStore = stores.find((s) => s.slug === slug);

  if (stores.length > 0 && !activeStore && !RESERVED_APP_SLUGS.has(slug)) {
    notFound();
  }

  const metaAdsConfig = activeStore ? await fetchMetaPublicConfigCached(activeStore.id) : null;
  const baseUrl = getAppBaseUrl();
  const canonicalUrl = activeStore ? `${baseUrl}/${activeStore.slug}` : `${baseUrl}/${slug}`;

  return (
    <StorePageShell
      slug={slug}
      activeStore={activeStore}
      initialStores={activeStore ? [activeStore] : stores}
      metaAdsConfig={metaAdsConfig}
      canonicalUrl={canonicalUrl}
    />
  );
}
