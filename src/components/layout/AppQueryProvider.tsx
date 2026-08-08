'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';

const QUERY_STALE_TIME_MS = 5_000;
const QUERY_GC_TIME_MS = 5 * 60 * 1000;

export function AppQueryProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () => new QueryClient({
      defaultOptions: {
        queries: {
          staleTime: QUERY_STALE_TIME_MS,
          gcTime: QUERY_GC_TIME_MS,
          refetchOnWindowFocus: true,
          refetchOnReconnect: true,
          retry: 1,
        },
      },
    }),
  );

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
