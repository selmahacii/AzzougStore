export const revalidate = 10;
import { ThemeInjector } from '@/components/theme-injector';
import { AppBootstrap } from '@/components/app/app-bootstrap';
import { UrlSync } from '@/components/app/url-sync';
import { HydrateStore } from '@/components/app/hydrate-store';
import { Suspense } from 'react';
import { getBackendUrl } from '@/lib/utils';
import type { Store } from '@/lib/types';

// initialUser is intentionally NOT fetched here: reading the session cookie
// via next/headers cookies() forces this whole route into fully dynamic
// (per-request) rendering in the App Router, no matter what `revalidate` is
// set to — which silently defeated ISR for every visitor, logged-in or not.
// AppBootstrap already fetches /api/v1/auth/me client-side whenever
// HydrateStore didn't seed a user, so auth still resolves — just off the
// server-render critical path, letting the store/product shell stay cached.
async function fetchInitialData() {
  const backendUrl = getBackendUrl();

  let initialStores: Store[] = [];

  try {
    const res = await fetch(`${backendUrl}/api/v1/stores`, { next: { revalidate: 10 } });
    if (res.ok) {
      const json = await res.json();
      initialStores = (json.data ?? json ?? []) as Store[];
    }
  } catch {
    // backend not reachable — client will load stores via React Query
  }

  return { initialStores };
}

export default async function Page() {
  const { initialStores } = await fetchInitialData();

  return (
    <>
      <ThemeInjector />
      <HydrateStore initialUser={null} initialStores={initialStores} />
      <Suspense fallback={null}>
        <UrlSync />
      </Suspense>
      <AppBootstrap />
    </>
  );
}
