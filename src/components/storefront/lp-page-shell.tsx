import LandingPageRenderer from '@/components/storefront/landing-page-renderer';
import DzCodRenderer from '@/components/storefront/dz-cod-renderer';
import { StorefrontIntegrations } from '@/components/storefront/store-integrations';
import { HydrateStore } from '@/components/app/hydrate-store';
import { ServerSeo } from '@/components/storefront/server-seo';
import { getAppBaseUrl, type LpData } from '@/lib/server-fetchers';
import type { Store } from '@/lib/types';

interface LpPageShellProps {
  lp: LpData;
  matchedStore: Store | null;
  metaAdsConfig: any;
  slug: string;
}

/**
 * Shared server shell for landing page routes (/lp/[slug] and ISR-cached /lp/[storeSlug]/[slug]).
 */
export function LpPageShell({ lp, matchedStore, metaAdsConfig, slug }: LpPageShellProps) {
  return (
    <>
      <ServerSeo
        title={matchedStore?.name || 'AzzougShop Landing Page'}
        description={lp.headline || lp.subtitle || 'Landing page AzzougShop'}
        image={lp.image_url || lp.product?.main_image || matchedStore?.logo_url || (matchedStore as any)?.image_url || null}
        url={`${getAppBaseUrl()}/lp/${slug}`}
      />
      <HydrateStore
        initialUser={null}
        initialStores={matchedStore ? [matchedStore] : []}
        activeStoreSlug={matchedStore?.slug}
      />
      <StorefrontIntegrations config={metaAdsConfig} lpId={lp.id} />
      {lp.template === 'dz_cod' ? (
        <DzCodRenderer data={lp} />
      ) : (
        <LandingPageRenderer data={lp} />
      )}
    </>
  );
}
