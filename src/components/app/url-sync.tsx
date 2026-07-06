'use client';

import { useEffect, useRef } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { useAppStore } from '@/store/app-store';
import type { AppView, StorefrontView, AdminView } from '@/lib/types';

/**
 * Senior Architect Note: Deep Linking Synchronizer.
 * Provides SPA speed with URL persistence. Syncs Zustand state with URL search params.
 * This allows browser back button support and deep-linking to specific products/views.
 */
export function UrlSync() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isInitialMount = useRef(true);

  // Store state
  const appView = useAppStore((s) => s.appView);
  const storefrontView = useAppStore((s) => s.storefrontView);
  const adminView = useAppStore((s) => s.adminView);
  const selectedProductSlug = useAppStore((s) => s.selectedProductSlug);
  const selectedOrderId = useAppStore((s) => s.selectedOrderId);
  
  // Store setters
  const setAppView = useAppStore((s) => s.setAppView);
  const setStorefrontView = useAppStore((s) => s.setStorefrontView);
  const setAdminView = useAppStore((s) => s.setAdminView);
  const setSelectedProductSlug = useAppStore((s) => s.setSelectedProductSlug);
  const setSelectedOrderId = useAppStore((s) => s.setSelectedOrderId);

  // 1. Initial Load: Sync URL -> Store
  useEffect(() => {
    if (!isInitialMount.current) return;
    
    const vApp = searchParams.get('app') as AppView;
    const vStore = searchParams.get('view') as StorefrontView;
    const vAdmin = searchParams.get('admin') as AdminView;
    const vProduct = searchParams.get('product');
    const vOrder = searchParams.get('order');

    if (vApp && ['storefront', 'admin'].includes(vApp)) {
      setAppView(vApp);
    }
    if (vStore) {
      setStorefrontView(vStore);
    }
    if (vAdmin) {
      setAdminView(vAdmin);
    }
    if (vProduct) {
      setSelectedProductSlug(vProduct);
    }
    if (vOrder) {
      setSelectedOrderId(vOrder);
    }

    isInitialMount.current = false;
  }, [searchParams, setAppView, setStorefrontView, setAdminView, setSelectedProductSlug, setSelectedOrderId]);

  // 2. State Change: Sync Store -> URL
  useEffect(() => {
    if (isInitialMount.current) return;

    const params = new URLSearchParams(searchParams.toString());
    
    // Set params
    params.set('app', appView);
    
    if (appView === 'storefront') {
      params.set('view', storefrontView);
      params.delete('admin');
      
      if (storefrontView === 'product' && selectedProductSlug) {
        params.set('product', selectedProductSlug);
      } else {
        params.delete('product');
      }
    } else {
      params.set('admin', adminView);
      params.delete('view');
      params.delete('product');
      
      if (selectedOrderId) {
        params.set('order', selectedOrderId);
      } else {
        params.delete('order');
      }
    }

    const newUrl = `${pathname}?${params.toString()}`;
    
    // Use replaceState to avoid cluttering history while typing/navigating internally
    // but keep URL clean for sharing.
    window.history.replaceState(null, '', newUrl);
    
  }, [appView, storefrontView, adminView, selectedProductSlug, selectedOrderId, pathname, searchParams]);

  return null;
}
