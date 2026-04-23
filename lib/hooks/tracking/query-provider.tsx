'use client';

import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * TanStack Query provider scoped to the tracking dashboard.
 *
 * Creates a single client lazily on the client (not re-created between renders
 * thanks to `useState(() => ...)`) so React Strict Mode double-mounts do not
 * flush the cache.
 */
export function TrackingQueryProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [client] = React.useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000,
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      })
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
