'use client';

import { useEffect } from 'react';
import { useAppStore } from '@/store/app-store';

/**
 * Injects the active store's theme as CSS variables onto :root.
 * This allows Tailwind + shadcn/ui components to react to per-store branding.
 */
export function ThemeInjector() {
  const currentTheme = useAppStore((s) => s.currentTheme);

  useEffect(() => {
    if (!currentTheme) return;

    const root = document.documentElement;
    const vars = {
      '--store-primary': currentTheme.primaryColor,
      '--store-primary-foreground': currentTheme.primaryForeground,
      '--store-accent': currentTheme.accentColor,
      '--store-font': currentTheme.fontFamily,
      '--store-radius': currentTheme.borderRadius,
    };

    Object.entries(vars).forEach(([key, value]) => {
      root.style.setProperty(key, value ?? null);
    });

    // Dynamic Google Fonts Loader
    if (currentTheme.fontFamily) {
      const fontName = currentTheme.fontFamily.split(',')[0].replace(/['"]/g, '').trim();
      const linkId = `gfont-${fontName.toLowerCase().replace(/\s+/g, '-')}`;
      if (!document.getElementById(linkId) && fontName !== 'Inter' && fontName !== 'system-ui') {
        const link = document.createElement('link');
        link.id = linkId;
        link.rel = 'stylesheet';
        link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(fontName)}:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,300;1,400&display=swap`;
        document.head.appendChild(link);
      }
    }

    return () => {
      Object.keys(vars).forEach((key) => {
        root.style.removeProperty(key);
      });
    };
  }, [currentTheme]);

  return null;
}
