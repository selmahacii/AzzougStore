export const revalidate = 300;
export const dynamicParams = true;

export async function generateStaticParams() {
  return [];
}

import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import {
  buildLpMetadata,
  fetchLandingPageCached,
  fetchMetaPublicConfigCached,
  fetchStoresCached,
  resolveStoreForLp,
} from '@/lib/server-fetchers';
import { LpPageShell } from '@/components/storefront/lp-page-shell';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ storeSlug: string; slug: string }>;
}): Promise<Metadata> {
  const { storeSlug, slug } = await params;
  return buildLpMetadata(slug, { storeSlug, revalidateSeconds: 300 });
}

export default async function TenantLpPage({
  params,
}: {
  params: Promise<{ storeSlug: string; slug: string }>;
}) {
  const { storeSlug, slug } = await params;
  const stores = await fetchStoresCached();
  const { storeId, matchedStore } = await resolveStoreForLp(stores, { storeSlug });

  if (!storeId) {
    return notFound();
  }

  const [lp, metaAdsConfig] = await Promise.all([
    fetchLandingPageCached(slug, storeId, 300),
    fetchMetaPublicConfigCached(storeId),
  ]);

  if (!lp) {
    return notFound();
  }

  return (
    <LpPageShell
      lp={lp}
      matchedStore={matchedStore}
      metaAdsConfig={metaAdsConfig}
      slug={slug}
    />
  );
}
