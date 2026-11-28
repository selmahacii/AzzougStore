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
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ store?: string; store_id?: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const sp = await searchParams;
  return buildLpMetadata(slug, {
    storeId: sp.store_id,
    storeSlug: sp.store,
    revalidateSeconds: 0,
  });
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

  const stores = await fetchStoresCached();
  const { storeId, matchedStore } = await resolveStoreForLp(stores, {
    storeId: sp.store_id,
    storeSlug: sp.store,
  });

  if (!storeId) {
    return notFound();
  }

  const [lp, metaAdsConfig] = await Promise.all([
    fetchLandingPageCached(slug, storeId, 0),
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
