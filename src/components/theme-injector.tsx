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
    const radius = currentTheme.borderRadius || '12px';
    const primary = currentTheme.primaryColor || '#4b7bec';
    const accent = currentTheme.accentColor || '#3867d6';
    const bg = currentTheme.backgroundColor || '#FFFFFF';
    const text = currentTheme.textColor || '#0F172A';
    const font = currentTheme.fontFamily || 'Inter';

    const vars: Record<string, string> = {
      '--store-primary': primary,
      '--store-primary-foreground': currentTheme.primaryForeground || '#FFFFFF',
      '--store-accent': accent,
      '--store-bg': bg,
      '--store-text': text,
      '--store-font': font,
      '--store-radius': radius,
      '--radius': radius,
    };

    Object.entries(vars).forEach(([key, value]) => {
      root.style.setProperty(key, value);
    });

    // Apply custom font-family to document body
    if (font) {
      document.body.style.fontFamily = `"${font}", var(--font-inter), system-ui, -apple-system, sans-serif`;
    }

    // Dynamic Google Fonts Loader
    if (font) {
      const fontName = font.split(',')[0].replace(/['"]/g, '').trim();
      const linkId = `gfont-${fontName.toLowerCase().replace(/\s+/g, '-')}`;
      const defaultFonts = ['Inter', 'system-ui', 'ui-sans-serif', 'sans-serif'];
      if (!document.getElementById(linkId) && !defaultFonts.includes(fontName)) {
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
      document.body.style.removeProperty('font-family');
    };
  }, [currentTheme]);

  return null;
}
