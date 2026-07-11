'use client';

import Script from 'next/script';

export function StorefrontIntegrations({ config, tiktokConfig }: { config: any; tiktokConfig?: any }) {
  let domainContent = config?.domain_verification_tag;
  if (domainContent && domainContent.includes('content="')) {
    const match = domainContent.match(/content="([^"]+)"/);
    if (match) domainContent = match[1];
  }

  return (
    <>
      {domainContent && (
        <meta name="facebook-domain-verification" content={domainContent} />
      )}

      {config?.pixel_id && (
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
            fbq('init', '${config.pixel_id}');
            fbq('track', 'PageView');
          `}
        </Script>
      )}

      {/* TikTok base pixel — PageView only (client-side). Server-side event
          forwarding (AddToCart/InitiateCheckout/Purchase via meta-ads/events)
          exists for Meta but not yet for TikTok; this is the first piece,
          matching TikTok's official base pixel code. */}
      {tiktokConfig?.pixel_id && (
        <Script id="tiktok-pixel" strategy="afterInteractive">
          {`
            !function (w, d, t) {
              w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie","holdConsent","revokeConsent","grantConsent"],ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);ttq.instance=function(t){for(var e=ttq._i[t]||[],n=0;n<e.length;n++)ttq.setAndDefer(e,e[n]);return e},ttq.load=function(e,n){var r="https://analytics.tiktok.com/i18n/pixel/events.js",o=n&&n.partner;ttq._i=ttq._i||{},ttq._i[e]=[],ttq._i[e]._u=r,ttq._t=ttq._t||{},ttq._t[e]=+new Date,ttq._o=ttq._o||{},ttq._o[e]=n||{};n=document.createElement("script");n.type="text/javascript",n.async=!0,n.src=r+"?sdkid="+e+"&lib="+t;e=document.getElementsByTagName("script")[0];e.parentNode.insertBefore(n,e)};

              ttq.load('${tiktokConfig.pixel_id}');
              ttq.page();
            }(window, document, 'ttq');
          `}
        </Script>
      )}
    </>
  );
}
