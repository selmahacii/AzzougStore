'use client';

import { useEffect, useRef } from 'react';
import { useAppStore } from '@/store/app-store';
import type { User, Store } from '@/lib/types';

interface HydrateStoreProps {
  initialUser: User | null;
  initialStores: Store[];
  activeStoreSlug?: string | null;
}

/**
 * Senior Architect Note: Instant Hydration Pattern.
 * Prevents UI flicker by seeding the Zustand store with data already fetched on the server.
 * This runs before the main app components render.
 */
export function HydrateStore({ initialUser, initialStores, activeStoreSlug }: HydrateStoreProps) {
  const initialized = useRef(false);

  // ── Synchronous pre-render seed ──────────────────────────────
  if (!initialized.current) {
    if (initialUser) {
      useAppStore.setState({ user: initialUser, isAuthenticated: true });
    }
    if (initialStores.length > 0) {
      useAppStore.setState({ allStores: initialStores });

      if (activeStoreSlug) {
        // Storefront: find store by slug in URL
        const targetStore = initialStores.find(s => s.slug === activeStoreSlug);
        if (targetStore) {
          useAppStore.setState({ activeStore: targetStore, currentTheme: targetStore.theme_config ?? null, appView: 'storefront' });
        } else {
          useAppStore.setState({ activeStore: initialStores[0], currentTheme: initialStores[0]?.theme_config ?? null });
        }
      } else {
        // Admin: validate the persisted activeStore against fresh list
        const persisted = useAppStore.getState().activeStore;
        const isPersistedValid = persisted && initialStores.some(s => s.id === persisted.id);
        if (!isPersistedValid) {
          // Persisted store is stale or null — auto-select the first available store
          const first = initialStores[0];
          console.log('[HydrateStore] Resetting activeStore to:', first?.name, first?.id);
          useAppStore.setState({ activeStore: first, currentTheme: first?.theme_config ?? null });
        } else {
          // Keep persisted store but refresh its data from server
          const freshStore = initialStores.find(s => s.id === persisted!.id) || persisted;
          useAppStore.setState({ activeStore: freshStore, currentTheme: freshStore?.theme_config ?? null });
        }
      }
    }
    if (typeof window !== 'undefined') {
      const host = window.location.hostname;
      if (host === 'azghub.com' || host === 'www.azghub.com') {
        useAppStore.setState({ appView: 'admin' });
      }
    }
    initialized.current = true;
  }

  // ── Post-mount sync (defeats Zustand persist middleware overwrite) ──────────
  useEffect(() => {
    if (initialUser) {
      useAppStore.setState({ user: initialUser, isAuthenticated: true });
    }
    if (initialStores.length > 0) {
      useAppStore.setState({ allStores: initialStores });

      if (activeStoreSlug) {
        const targetStore = initialStores.find(s => s.slug === activeStoreSlug);
        if (targetStore) {
          useAppStore.setState({ activeStore: targetStore, currentTheme: targetStore.theme_config ?? null, appView: 'storefront' });
        }
      } else {
        // After mount, re-validate that activeStore is still in the fresh list
        const current = useAppStore.getState().activeStore;
        const isValid = current && initialStores.some(s => s.id === current.id);
        if (!isValid) {
          const first = initialStores[0];
          console.warn('[HydrateStore] post-mount: activeStore invalid, switching to:', first?.name, first?.id);
          useAppStore.setState({ activeStore: first, currentTheme: first?.theme_config ?? null });
        } else {
          // Refresh data from server
          const fresh = initialStores.find(s => s.id === current!.id) || current;
          useAppStore.setState({ activeStore: fresh, currentTheme: fresh?.theme_config ?? null });
        }
      }
    }
    const host = window.location.hostname;
    if (host === 'azghub.com' || host === 'www.azghub.com') {
      useAppStore.setState({ appView: 'admin' });
    }
  }, [initialUser, initialStores, activeStoreSlug]);

  return null;
}
