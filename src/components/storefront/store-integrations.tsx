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
    if (!pixelId) return;

    const initialize = async () => {
      try {
        await trackMetaEvent('PageView', {
          content_type: 'product',
          content_name: 'Storefront PageView',
        }, {
          pixelId,
          eventId: `pageview-${pixelId}-${Date.now()}`,
          shouldSendToServer: true,
        });
      } catch {
        // ignore tracking failures
      }
    };

    void initialize();
  }, [config?.pixel_id]);

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
            if (window.fbq) {
              window.fbq('init', '${pixelId}');
              window.fbq('track', 'PageView');
            }
          `}
        </Script>
      )}
    </>
  );
}
