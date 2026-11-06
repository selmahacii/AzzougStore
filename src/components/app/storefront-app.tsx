'use client';

import { useEffect, useRef } from 'react';
import { useAppStore } from '@/store/app-store';
import { useTranslation } from '@/hooks/use-translation';

// Storefront components
import { StorefrontHeader } from '@/components/storefront/storefront-header';
import { HeroSection } from '@/components/storefront/hero-section';
import { ProductGrid } from '@/components/storefront/product-grid';
import { ProductDetail } from '@/components/storefront/product-detail';
import { CartDrawer } from '@/components/storefront/cart-drawer';
import { CheckoutForm } from '@/components/storefront/checkout-form';
import { OrderTracking } from '@/components/storefront/order-tracking';
import { WishlistView } from '@/components/storefront/wishlist-view';
import { StorefrontFooter } from './storefront-footer';

import { HomeSections } from '@/components/storefront/home-sections';
import { VisitorCapture } from '@/components/storefront/visitor-capture';
import { LandingPage } from '@/components/storefront/landing-page';

export function StorefrontApp() {
  const storefrontView = useAppStore((s) => s.storefrontView);
  const activeStore = useAppStore((s) => s.activeStore);
  const prevView = useRef(storefrontView);
  const { dir } = useTranslation();
  
  // A store is a landing page if template_id is 'landing' OR if useLandingPage is enabled in theme_config
  const isLanding = activeStore?.template_id === 'landing' || activeStore?.theme_config?.useLandingPage === true;

  const setLocale = useAppStore((s) => (s as any).setLocale);
  const setStorefrontView = useAppStore((s) => s.setStorefrontView);

  // Synchronize storefrontView with browser history (back button)
  useEffect(() => {
    // Initialize history state on mount
    if (typeof window !== 'undefined' && !window.history.state) {
      window.history.replaceState({ view: storefrontView }, '');
    }

    const handlePopState = (event: PopStateEvent) => {
      if (event.state && event.state.view) {
        setStorefrontView(event.state.view);
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [storefrontView, setStorefrontView]);

  useEffect(() => {
    if (prevView.current !== storefrontView) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      prevView.current = storefrontView;

      // Push state only if it differs from current history state to avoid loops
      if (typeof window !== 'undefined' && window.history.state?.view !== storefrontView) {
        window.history.pushState({ view: storefrontView }, '');
      }
    }
  }, [storefrontView]);

  useEffect(() => {
    if (isLanding) {
      setLocale('ar');
    } else {
      setLocale('fr');
    }
  }, [isLanding, setLocale]);

  return (
    <div className="min-h-screen flex flex-col bg-white" dir={dir}>
      {/* Hide standard header if we are on the home view of a landing page */}
      {!(isLanding && storefrontView === 'home') && <StorefrontHeader />}
      
      <main className="flex-1">
        {storefrontView === 'home' && (
          isLanding ? <LandingPage /> : (
            <>
              <HeroSection />
              <HomeSections />
            </>
          )
        )}
        {storefrontView === 'shop' && <ProductGrid />}
        {storefrontView === 'product' && <ProductDetail />}
        {storefrontView === 'checkout' && <CheckoutForm />}
        {storefrontView === 'order-tracking' && <OrderTracking />}
        {storefrontView === 'wishlist' && <WishlistView />}
      </main>
      <StorefrontFooter />
      <CartDrawer />
      <VisitorCapture />
    </div>
  );
}
