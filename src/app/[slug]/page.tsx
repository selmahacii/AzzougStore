export const dynamic = 'force-dynamic';
import { ThemeInjector } from '@/components/theme-injector';
import { AppBootstrap } from '@/components/app/app-bootstrap';
import { UrlSync } from '@/components/app/url-sync';
import { HydrateStore } from '@/components/app/hydrate-store';
import { Suspense } from 'react';
import { getServerSessionCookie, verifyToken } from '@/lib/jwt';
import type { User, Store } from '@/lib/types';

async function fetchInitialData(slug: string) {
  const backendUrl = process.env.BACKEND_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8003';

  let initialStores: Store[] = [];
  let initialUser: User | null = null;

  try {
    const res = await fetch(`${backendUrl}/api/v1/stores`, { cache: 'no-store' });
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

  return { initialStores, initialUser };
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { initialStores, initialUser } = await fetchInitialData(slug);

  return (
    <>
      <ThemeInjector />
      <HydrateStore initialUser={initialUser} initialStores={initialStores} activeStoreSlug={slug} />
      <Suspense fallback={null}>
        <UrlSync />
      </Suspense>
      <AppBootstrap />
    </>
  );
}
