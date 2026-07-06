'use client';

import { useEffect, useCallback, useState } from 'react';
import { useAppStore } from '@/store/app-store';
import type { Store, User } from '@/lib/types';
import { ErrorBoundary } from '@/components/error-boundary';
import { Button } from '@/components/ui/button';
import { StorefrontApp } from './storefront-app';
import { AdminApp } from './admin-app';
import { AdminAuthPage } from '@/components/admin/admin-auth-page';
import { ThemeInjector } from './theme-injector';

export function AppBootstrap() {
  const [isReady, setIsReady] = useState(false);
  const setActiveStore = useAppStore((s) => s.setActiveStore);
  const setAllStores = useAppStore((s) => s.setAllStores);
  const setUser = useAppStore((s) => s.setUser);
  const allStores = useAppStore((s) => s.allStores);
  const appView = useAppStore((s) => s.appView);
  const setAppView = useAppStore((s) => s.setAppView);
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);
  const user = useAppStore((s) => s.user);

  // Check if user has staff access
  const isStaff = user && ['SUPER_ADMIN', 'MANAGER', 'CONFIRMATEUR'].includes(user.role);

  const initialize = useCallback(async (signal?: AbortSignal) => {
    try {
      const storesRes = await fetch('/api/v1/stores', { signal });
      if (!storesRes.ok) throw new Error(`API error ${storesRes.status}`);
      const storesData = await storesRes.json();

      // API returns either { success, data } or a plain array
      const stores: Store[] = Array.isArray(storesData)
        ? storesData
        : (storesData.data ?? []);

      if (stores.length > 0) {
        setAllStores(stores);
        // Validate the cached activeStore is still in the server list.
        // After a backend restart or DB reset, the persisted store ID may no
        // longer exist — in that case reset to the first available store.
        const currentStore = useAppStore.getState().activeStore;
        const isValid = currentStore && stores.some(s => s.id === currentStore.id);
        if (!isValid) {
          setActiveStore(stores[0]);
        }
      }

      // Final check for user if not hydrated
      if (!useAppStore.getState().user) {
        try {
          const meRes = await fetch('/api/v1/auth/me', {
            signal,
            credentials: 'include',
            headers: { 'X-Requested-With': 'XMLHttpRequest' },
          });
          if (meRes.ok) {
            const meData = await meRes.json();
            if (meData.success && meData.data) {
              setUser(meData.data as User);
            }
          }
        } catch { /* Auth restore is optional */ }
      }

      setIsReady(true);
    } catch (error: any) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      // Backend unreachable — if we have cached stores, show the app anyway
      if (useAppStore.getState().allStores.length > 0) {
        setIsReady(true);
        return;
      }
      // No cached data — retry after 3s
      console.warn('Backend unreachable, retrying in 3s...', error?.message);
      setTimeout(() => {
        if (!signal?.aborted) initialize(signal);
      }, 3000);
    }
  }, [setActiveStore, setAllStores, setUser]);

  useEffect(() => {
    const controller = new AbortController();
    initialize(controller.signal);
    return () => controller.abort();
  }, [initialize]);

  // Loading screen
  if (!isReady) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="flex flex-col items-center gap-4">
          <div className="size-8 rounded-full border-2 border-gray-200 border-t-gray-600 animate-spin" />
          <p className="text-sm text-gray-400">Connexion au serveur...</p>
        </div>
      </div>
    );
  }

  // Error state - no stores (only block storefront, not admin access)
  if (allStores.length === 0 && isReady && appView === 'storefront') {
    return (
      <ErrorBoundary>
        <ThemeInjector />
        <div className="min-h-screen flex items-center justify-center bg-white">
          <div className="text-center space-y-4">
            <p className="text-sm text-gray-400">Aucun magasin disponible.</p>
            <div className="flex flex-col items-center gap-2">
              <Button onClick={() => initialize()} variant="outline" size="sm">Réessayer</Button>
              <Button onClick={() => setAppView('admin')} variant="ghost" size="sm" className="text-xs text-gray-400">
                Accès Admin
              </Button>
            </div>
          </div>
        </div>
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary>
      <ThemeInjector />
      {appView === 'storefront' ? (
        <StorefrontApp />
      ) : (
        (isAuthenticated && isStaff) ? <AdminApp /> : <AdminAuthPage />
      )}
    </ErrorBoundary>
  );
}
