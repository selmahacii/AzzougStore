import { Suspense } from 'react';
import { ThemeInjector } from '@/components/theme-injector';
import { AppBootstrap } from '@/components/app/app-bootstrap';
import { UrlSync } from '@/components/app/url-sync';
import { HydrateStore } from '@/components/app/hydrate-store';
import { StorefrontIntegrations } from '@/components/storefront/store-integrations';
import { ServerSeo } from '@/components/storefront/server-seo';
import type { Store } from '@/lib/types';

interface StorePageShellProps {
  slug: string;
  activeStore: Store | undefined;
  initialStores?: Store[];
  metaAdsConfig: any;
  canonicalUrl: string;
  product?: any;
}

/**
 * Shared server shell for storefront routes (/[slug] and /[slug]/p/[productSlug]).
 * Hydrates only the resolved tenant store when matched, reducing RSC payload and SSR CPU.
 */
export function StorePageShell({
  slug,
  activeStore,
  initialStores,
  metaAdsConfig,
  canonicalUrl,
  product,
}: StorePageShellProps) {
  const productSchema = product
    ? {
        name: product.name,
        description: (product.description || '').replace(/<[^>]+>/g, ' ').trim() || product.name,
        image: product.main_image || (product.images && product.images[0]) || '',
        sku: product.sku,
        price: product.price,
        availability: (product.stock || 0) > 0 ? 'in stock' : 'out of stock',
        brand: product.brand || activeStore?.name,
      }
    : undefined;

  const storesToHydrate = initialStores ?? (activeStore ? [activeStore] : []);

  return (
    <>
      <ServerSeo
        title={activeStore?.name || 'AzzougShop Storefront'}
        description={activeStore?.description || 'Boutique en ligne AzzougShop'}
        image={activeStore?.logo_url || activeStore?.logo || null}
        url={canonicalUrl}
        productSchema={productSchema}
      />
      <StorefrontIntegrations config={metaAdsConfig} />
      <ThemeInjector />
      <HydrateStore
        initialUser={null}
        initialStores={storesToHydrate}
        activeStoreSlug={activeStore ? slug : undefined}
      />
      <Suspense fallback={null}>
        <UrlSync />
      </Suspense>
      <AppBootstrap />
    </>
  );
}
