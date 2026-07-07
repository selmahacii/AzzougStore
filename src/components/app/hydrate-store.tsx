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

  // Set initial data before first render
  if (!initialized.current) {
    if (initialUser) {
      useAppStore.setState({ user: initialUser, isAuthenticated: true });
    }
    if (initialStores.length > 0) {
      useAppStore.setState({ allStores: initialStores });
      
      // If a slug is provided, find that store and force storefront view.
      if (activeStoreSlug) {
        const targetStore = initialStores.find(s => s.slug === activeStoreSlug);
        if (targetStore) {
          useAppStore.setState({ activeStore: targetStore, currentTheme: targetStore.theme_config ?? null, appView: 'storefront' });
        } else {
          useAppStore.setState({ activeStore: initialStores[0], currentTheme: initialStores[0]?.theme_config ?? null });
        }
      } else if (!useAppStore.getState().activeStore) {
        const first = initialStores[0];
        useAppStore.setState({ activeStore: first, currentTheme: first?.theme_config ?? null });
      }
    }
    initialized.current = true;
  }

  return null;
}
