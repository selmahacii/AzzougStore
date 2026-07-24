'use client';

import { useEffect } from 'react';
import Script from 'next/script';
import { setMetaPixelId, trackMetaEvent } from '@/lib/meta-tracking';
import { captureAttribution } from '@/lib/attribution';

export function StorefrontIntegrations({ config }: { config: any }) {
  const pixelId = config?.pixel_id;

  let domainContent = config?.domain_verification_tag;
  if (domainContent && domainContent.includes('content="')) {
    const match = domainContent.match(/content="([^"]+)"/);
    if (match) domainContent = match[1];
  }

  useEffect(() => {
    if (typeof window === 'undefined') return;
    // Mounted on EVERY storefront page (not just landing pages) — a visitor
    // can also land on a plain product/category page from an ad. First
    // touch wins internally (captureAttribution no-ops once real utm_*
    // signal is already stored), so calling this here too is safe and
    // covers the non-LP entry path that landing-page-renderer.tsx's own
    // capture call can't.
    captureAttribution();
    setMetaPixelId(pixelId, config?.store_id, config?.currency, config?.exchange_rate);

    // Funnel Tracking must fire regardless of whether this store has a Meta
    // Pixel configured — trackMetaEvent() itself only builds/sends the
    // Pixel+CAPI payload when pixelId is present, but the funnel rollup
    // (store_id/event_name/lp_id/campaign_id/...) always goes out.
    const initialize = async () => {
      try {
        await trackMetaEvent('PageView', {
          content_type: 'product',
          content_name: 'Storefront PageView',
        }, {
          pixelId,
          eventId: `pageview-${pixelId || config?.store_id}-${Date.now()}`,
          shouldSendToServer: true,
        });
      } catch {
        // ignore tracking failures
      }
    };

    void initialize();
  }, [config?.pixel_id, config?.store_id]);

  return (
    <>
      {domainContent && (
        <meta name="facebook-domain-verification" content={domainContent} />
      )}

      {pixelId && (
        <Script id="meta-pixel" strategy="afterInteractive">
          {`
            !function(f,b,e,v,n,t,s)
            {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
            n.callMethod.apply(n,arguments):n.queue.push(arguments)};
            if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
            n.queue=[];t=b.createElement(e);t.async=!0;
            t.src=v;s=b.getElementsByTagName(e)[0];
            s.parentNode.insertBefore(t,s)}(window, document,'script',
            'https://connect.facebook.net/en_US/fbevents.js');
            window.__metaPixelId = '${pixelId}';
            // Init only — no 'track PageView' here. The single PageView of
            // record is fired by trackMetaEvent() below (via 'trackSingle',
            // with a proper event_id for CAPI dedup and the funnel/CAPI
            // server relay); firing it here too would double-count it in
            // Meta's own reporting for every store with a Pixel configured.
            if (window.fbq) {
              window.fbq('init', '${pixelId}');
            }
          `}
        </Script>
      )}
    </>
  );
}
