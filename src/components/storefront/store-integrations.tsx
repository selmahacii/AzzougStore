'use client';

import { useEffect } from 'react';
import Script from 'next/script';
import { setMetaPixelId, trackMetaEvent } from '@/lib/meta-tracking';

export function StorefrontIntegrations({ config }: { config: any }) {
  const pixelId = config?.pixel_id;

  let domainContent = config?.domain_verification_tag;
  if (domainContent && domainContent.includes('content="')) {
    const match = domainContent.match(/content="([^"]+)"/);
    if (match) domainContent = match[1];
  }

  useEffect(() => {
    if (typeof window === 'undefined') return;
    setMetaPixelId(pixelId, config?.store_id);
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
