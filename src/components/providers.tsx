'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from 'next-themes';
import { useState, useEffect } from 'react';

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Most lists (stores, products, orders) don't change second-to-second —
            // pages that need fresher data (e.g. the orders list) already set their
            // own shorter staleTime/refetchInterval. Raising the default means
            // navigating back to an already-visited page renders instantly from
            // cache instead of re-fetching and showing a spinner.
            staleTime: 2 * 60 * 1000,
            gcTime: 10 * 60 * 1000,
            retry: (failureCount, error: any) => {
              if (error?.statusCode === 401 || (error?.name === 'ApiClientError' && error.statusCode === 401)) {
                return false;
              }
              return failureCount < 1;
            },
            refetchOnWindowFocus: false,
          },
        },
      })
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      // Silence extension or non-Error event rejections that trigger [object Event] false positives
      if (
        !reason || 
        reason instanceof Event || 
        (reason.message && (reason.message.includes('Extension') || reason.message.includes('extension'))) ||
        (reason.stack && (reason.stack.includes('extension') || reason.stack.includes('chrome-extension')))
      ) {
        event.preventDefault();
        console.warn('Silenced browser/extension promise rejection:', reason);
      }
    };

    const handleGlobalError = (event: ErrorEvent) => {
      // Silence cross-origin scripts or extension load errors
      if (
        event.filename?.includes('extension') || 
        event.message?.includes('Extension') || 
        event.message?.includes('Script error')
      ) {
        event.preventDefault();
        console.warn('Silenced browser/extension script error:', event.message);
      }
    };

    window.addEventListener('unhandledrejection', handleUnhandledRejection);
    window.addEventListener('error', handleGlobalError);

    return () => {
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
      window.removeEventListener('error', handleGlobalError);
    };
  }, []);

  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="light"
      enableSystem
      disableTransitionOnChange
    >
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </ThemeProvider>
  );
}

