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
      root.style.setProperty(key, value);
    });

    return () => {
      Object.keys(vars).forEach((key) => {
        root.style.removeProperty(key);
      });
    };
  }, [currentTheme]);

  return null;
}
