export const revalidate = 300;

import { ThemeInjector } from '@/components/theme-injector';
import { AppBootstrap } from '@/components/app/app-bootstrap';
import { UrlSync } from '@/components/app/url-sync';
import { HydrateStore } from '@/components/app/hydrate-store';
import { Suspense } from 'react';
import { fetchStoresCached } from '@/lib/server-fetchers';

// initialUser is intentionally NOT fetched here: reading the session cookie
// via next/headers cookies() forces this whole route into dynamic rendering.
export default async function Page() {
  const initialStores = await fetchStoresCached();

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
