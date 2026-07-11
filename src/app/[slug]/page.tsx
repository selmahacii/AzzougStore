export const dynamic = 'force-dynamic';
import { ThemeInjector } from '@/components/theme-injector';
import { AppBootstrap } from '@/components/app/app-bootstrap';
import { UrlSync } from '@/components/app/url-sync';
import { HydrateStore } from '@/components/app/hydrate-store';
import { StorefrontIntegrations } from '@/components/storefront/store-integrations';
import { Suspense } from 'react';
import { getServerSessionCookie, verifyToken } from '@/lib/jwt';
import { getBackendUrl } from '@/lib/utils';
import type { User, Store } from '@/lib/types';

async function fetchInitialData(slug: string) {
  const backendUrl = getBackendUrl();

  let initialStores: Store[] = [];
  let initialUser: User | null = null;
  let metaAdsConfig: any = null;
  let tiktokAdsConfig: any = null;

  try {
    const res = await fetch(`${backendUrl}/api/v1/stores`, { next: { revalidate: 10 } });
    if (res.ok) {
      const json = await res.json();
      initialStores = (json.data ?? json ?? []) as Store[];
    }
  } catch {
    // backend not reachable — client will load stores via React Query
  }

  try {
    const token = await getServerSessionCookie();
    if (token) {
      const payload = await verifyToken(token);
      if (payload) {
        const res = await fetch(`${backendUrl}/api/v1/users/${payload.userId}`, {
          cache: 'no-store',
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          initialUser = await res.json() as User;
        }
      }
    }
  } catch {
    // auth check failed gracefully
  }

  const activeStore = initialStores.find(s => s.slug === slug);
  if (activeStore) {
    try {
      const res = await fetch(`${backendUrl}/api/v1/meta-ads/config?store_id=${activeStore.id}`, { next: { revalidate: 10 } });
      if (res.ok) {
        const json = await res.json();
        metaAdsConfig = json.data;
      }
    } catch {
      // meta ads config check failed gracefully
    }
    try {
      const res = await fetch(`${backendUrl}/api/v1/tiktok-ads/config?store_id=${activeStore.id}`, { next: { revalidate: 10 } });
      if (res.ok) {
        const json = await res.json();
        tiktokAdsConfig = json.data;
      }
    } catch {
      // tiktok ads config check failed gracefully
    }
  }

  return { initialStores, initialUser, metaAdsConfig, tiktokAdsConfig };
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { initialStores, initialUser, metaAdsConfig, tiktokAdsConfig } = await fetchInitialData(slug);

  return (
    <>
      <StorefrontIntegrations config={metaAdsConfig} tiktokConfig={tiktokAdsConfig} />
      <ThemeInjector />
      <HydrateStore initialUser={initialUser} initialStores={initialStores} activeStoreSlug={slug} />
      <Suspense fallback={null}>
        <UrlSync />
      </Suspense>
      <AppBootstrap />
    </>
  );
}
