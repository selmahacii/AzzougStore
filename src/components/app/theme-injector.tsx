'use client';

import { useEffect } from 'react';
import { useAppStore } from '@/store/app-store';

export function ThemeInjector() {
  const activeStore = useAppStore((s) => s.activeStore);

  useEffect(() => {
    if (!activeStore) return;

    let config = {
      primaryColor: '#CF9474',
      accentColor: '#1A1A1A',
      borderRadius: '2px',
      fontFamily: 'Inter'
    };

    try {
      if (typeof activeStore.theme_config === 'string') {
        config = { ...config, ...JSON.parse(activeStore.theme_config) };
      } else if (activeStore.theme_config) {
        config = { ...config, ...activeStore.theme_config };
      }
    } catch (e) {
      console.error('Theme parse error:', e);
    }

    const root = document.documentElement;
    root.style.setProperty('--ekster-whiskey', config.primaryColor);
    root.style.setProperty('--ekster-carbon', config.accentColor);
    root.style.setProperty('--radius', config.borderRadius);

    // Mettre à jour la police principale si configurée
    if (config.fontFamily) {
      document.body.style.fontFamily = `"${config.fontFamily}", system-ui, sans-serif`;
    }

    // Mettre à jour le titre de l'onglet et le favicon
    if (activeStore.name) {
      document.title = activeStore.name;
    }
    if (activeStore.logo_url) {
      let link = document.querySelector("link[rel~='icon']") as HTMLLinkElement;
      if (!link) {
        link = document.createElement('link');
        link.rel = 'icon';
        document.getElementsByTagName('head')[0].appendChild(link);
      }
      link.href = activeStore.logo_url;
    }
  }, [activeStore]);

  return null;
}
