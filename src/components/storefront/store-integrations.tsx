'use client';

import { useEffect } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { setMetaPixelId, trackMetaEvent } from '@/lib/meta-tracking';
import { captureAttribution } from '@/lib/attribution';

export function StorefrontIntegrations({ config, lpId }: { config: any, lpId?: string }) {
  const pixelId = config?.pixel_id;
  const pathname = usePathname();
  const searchParams = useSearchParams();

  let domainContent = config?.domain_verification_tag;
  if (domainContent && domainContent.includes('content="')) {
    const match = domainContent.match(/content="([^"]+)"/);
    if (match) domainContent = match[1];
  }

  useEffect(() => {
    if (typeof window === 'undefined') return;
    
    captureAttribution();
    setMetaPixelId(pixelId, config?.store_id, config?.currency, config?.exchange_rate);

    if (pixelId && typeof (window as any).fbq === 'undefined') {
      // Fix race condition: manually initialize fbq stub synchronously
      // before trackMetaEvent is called.
      const f = window as any;
      if (!f.fbq) {
        const n: any = f.fbq = function() {
          n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
        };
        if (!f._fbq) f._fbq = n;
        n.push = n;
        n.loaded = !0;
        n.version = '2.0';
        n.queue = [];
        const t = document.createElement('script');
        t.async = !0;
        t.src = 'https://connect.facebook.net/en_US/fbevents.js';
        const s = document.getElementsByTagName('script')[0];
        if (s && s.parentNode) {
          s.parentNode.insertBefore(t, s);
        }
      }
      
      (window as any).__metaPixelId = pixelId;
      if ((window as any).fbq) {
        (window as any).fbq('init', pixelId);
      }
    }

    const initialize = async () => {
      try {
        await trackMetaEvent('PageView', {
          content_type: 'product',
          content_name: 'Storefront PageView',
        }, {
          pixelId,
          lpId,
          eventId: `pageview-${pixelId || config?.store_id}-${Date.now()}`,
          shouldSendToServer: true,
        });
      } catch {
        // ignore tracking failures
      }
    };

    void initialize();
  }, [config?.pixel_id, config?.store_id, pathname, searchParams]);

  return (
    <>
      {domainContent && (
        <meta name="facebook-domain-verification" content={domainContent} />
      )}
    </>
  );
}
