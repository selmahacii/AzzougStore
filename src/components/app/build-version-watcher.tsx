'use client';

import { useEffect, useRef } from 'react';
import { toast } from 'sonner';

const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 min

/**
 * Detects when a newer deployment has gone live while this tab stayed open,
 * and prompts a refresh instead of letting staff silently keep working on a
 * stale JS bundle. Repeatedly diagnosed as the real cause behind "elle ne
 * voit pas ses commandes" reports: a confirmatrice's tab left open for hours
 * keeps running the code from before a fix, sending the old request shape
 * to the backend — the backend logs prove it works correctly the moment a
 * fresh page load happens. This closes that gap without depending on anyone
 * remembering to hard-refresh.
 */
export function BuildVersionWatcher() {
  const initialBuildId = useRef<string | null>(null);
  const notified = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function check() {
      try {
        const res = await fetch('/api/build-info', { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;

        if (!initialBuildId.current) {
          initialBuildId.current = data.buildId;
          return;
        }

        if (data.buildId !== initialBuildId.current && !notified.current) {
          notified.current = true;
          toast.info('Une nouvelle version est disponible', {
            description: 'Actualisez pour obtenir les dernières corrections.',
            duration: Infinity,
            action: {
              label: 'Actualiser',
              onClick: () => window.location.reload(),
            },
          });
        }
      } catch {
        // Network hiccup — never let this break the app, just skip this tick.
      }
    }

    check();
    const interval = setInterval(check, CHECK_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return null;
}
