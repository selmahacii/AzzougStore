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
  // LIVREUR was missing here entirely: an authenticated livreur fell through
  // to <AdminAuthPage/> below forever, as if never logged in — the actual
  // root cause of "le livreur ne peut pas accéder à son interface", upstream
  // of the admin-app.tsx routing fix (which only matters once staff access
  // is granted in the first place).
  const isStaff = user && ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'CONFIRMATEUR', 'LIVREUR', 'AGENT', 'MARKETER'].includes(user.role);

  const initialize = useCallback(async (signal?: AbortSignal) => {
    try {
      // 1. Restore current user session FIRST if not present
      let currentUser = useAppStore.getState().user;
      if (!currentUser) {
        try {
          console.log('[AppBootstrap] Restoring session via /api/v1/auth/me...');
          const meRes = await fetch('/api/v1/auth/me', {
            signal,
            credentials: 'include',
            headers: { 'X-Requested-With': 'XMLHttpRequest' },
          });
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

      // 2. Fetch stores WITH credentials so backend scopes stores by authenticated user
      console.log('[AppBootstrap] Fetching /api/v1/stores...');
      const storesRes = await fetch('/api/v1/stores', {
        signal,
        credentials: 'include',
        headers: { 'X-Requested-With': 'XMLHttpRequest' }
      });
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
        
        // Determine which store to activate
        const currentCachedStore = useAppStore.getState().activeStore;
        const isValidCached = currentCachedStore && stores.some(s => s.id === currentCachedStore.id);
        
        let defaultStore = stores[0];
        const userAssignedStoreId = currentUser?.employee_store_id || (currentUser?.assigned_store_ids && currentUser.assigned_store_ids[0]);
        if (currentUser && userAssignedStoreId) {
           const assignedStore = stores.find(s => s.id === userAssignedStoreId);
           if (assignedStore) defaultStore = assignedStore;
        }

        if (!isValidCached) {
          setActiveStore(defaultStore);
        } else if (currentUser && userAssignedStoreId) {
           // For any user with assigned store(s), force them into an accessible store initially
           if (stores.length === 1 && currentCachedStore.id !== stores[0].id) {
               setActiveStore(stores[0]);
           } else if (!stores.some(s => s.id === currentCachedStore.id)) {
               const assignedStore = stores.find(s => s.id === userAssignedStoreId) || stores[0];
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
