'use client';

import { useEffect, useCallback, useState } from 'react';
import { useAppStore } from '@/store/app-store';
import { captureAttribution } from '@/lib/attribution';
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
  const isStaff = user && ['SUPER_ADMIN', 'MANAGER', 'CONFIRMATEUR', 'LIVREUR'].includes(user.role);

  const initialize = useCallback(async (signal?: AbortSignal) => {
    try {
      console.log('[AppBootstrap] Fetching /api/v1/stores...');
      const storesRes = await fetch('/api/v1/stores', { signal });
      console.log(`[AppBootstrap] /api/v1/stores response status: ${storesRes.status}`);
      
      if (!storesRes.ok) {
        let errorText = '';
        try {
          errorText = await storesRes.text();
        } catch {}
        console.error(`[AppBootstrap] /api/v1/stores failed: ${storesRes.status} ${storesRes.statusText}\nBody:`, errorText);
        throw new Error(`API error ${storesRes.status}`);
      }
      
      const storesData = await storesRes.json();
      console.log('[AppBootstrap] /api/v1/stores success data:', storesData);

      // API returns either { success, data } or a plain array
      const stores: Store[] = Array.isArray(storesData)
        ? storesData
        : (storesData.data ?? []);

      if (stores.length > 0) {
        setAllStores(stores);
        
        // Final check for user if not hydrated
        let currentUser = useAppStore.getState().user;
        if (!currentUser) {
          try {
            console.log('[AppBootstrap] Fetching current user /api/v1/auth/me...');
            const meRes = await fetch('/api/v1/auth/me', {
              signal,
              credentials: 'include',
              headers: { 'X-Requested-With': 'XMLHttpRequest' },
            });
            console.log(`[AppBootstrap] /api/v1/auth/me response status: ${meRes.status}`);
            if (meRes.ok) {
              const meData = await meRes.json();
              if (meData.success && meData.data) {
                setUser(meData.data as User);
                currentUser = meData.data as User;
              }
            }
          } catch (meError) {
            console.warn('[AppBootstrap] Auth restore failed (optional):', meError);
          }
        }

        // Determine which store to activate
        const currentCachedStore = useAppStore.getState().activeStore;
        const isValidCached = currentCachedStore && stores.some(s => s.id === currentCachedStore.id);
        
        // Prioritize employee_store_id if they are an employee (CONFIRMATEUR, MANAGER, etc)
        // This prevents an employee from getting stuck in a store they shouldn't focus on
        // just because the admin previously had it cached in the browser.
        let defaultStore = stores[0];
        if (currentUser && currentUser.employee_store_id) {
           const assignedStore = stores.find(s => s.id === currentUser!.employee_store_id);
           if (assignedStore) defaultStore = assignedStore;
        }

        if (!isValidCached) {
          setActiveStore(defaultStore);
        } else if (currentUser && currentUser.role !== 'SUPER_ADMIN' && currentUser.employee_store_id) {
           // For non-super-admins, force them into their assigned store initially to avoid confusion
           // if the cached store is from a different session
           if (currentCachedStore.id !== currentUser.employee_store_id) {
               const assignedStore = stores.find(s => s.id === currentUser!.employee_store_id);
               if (assignedStore) setActiveStore(assignedStore);
           }
        }
      }

      setIsReady(true);
    } catch (error: any) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      console.error('[AppBootstrap] Initialization error details:', error);
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

  // First-touch campaign attribution (utm_*, fbclid, referrer) — see lib/attribution
  useEffect(() => {
    captureAttribution();
  }, []);

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
