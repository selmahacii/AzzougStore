'use client';

import { useEffect } from 'react';

const FONTS_URL =
  'https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800;900&family=Inter:wght@300;400;500;600;700&family=Playfair+Display:ital,wght@0,400;0,600;1,400&family=Cairo:wght@300;400;500;600;700;800;900&family=Tajawal:wght@300;400;500;700;800;900&display=swap';

const LINK_ID = 'gfont-base-families';

/**
 * Loads the app's base Google Font families (Outfit, Inter, Playfair Display,
 * Cairo, Tajawal) the same way a plain CSS @import would, but WITHOUT
 * blocking rendering: preload the stylesheet, then flip it to an active
 * stylesheet only once it has actually loaded. font-display: swap (already
 * in the URL) means visible text renders immediately with the fallback font
 * and swaps in place — same visual result, just no more render-blocking.
 *
 * This replaces a plain `@import url(...)` that used to sit at the top of
 * globals.css — a CSS @import is always render-blocking by spec, which is
 * exactly what Lighthouse's "Requêtes de blocage du rendu" flagged.
 */
export function GoogleFontsLoader() {
  useEffect(() => {
    if (document.getElementById(LINK_ID)) return;
    const link = document.createElement('link');
    link.id = LINK_ID;
    link.href = FONTS_URL;
    link.rel = 'preload';
    link.as = 'style';
    link.onload = function () {
      (this as HTMLLinkElement).onload = null;
      (this as HTMLLinkElement).rel = 'stylesheet';
    };
    document.head.appendChild(link);
  }, []);

  return null;
}
