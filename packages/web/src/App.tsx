import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import type * as React from 'react';

import { TooltipProvider } from '@/components/ui/tooltip';
import { router } from '@/router';

export function buildQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        refetchOnWindowFocus: false,
        retry: (failureCount, error) => {
          if (error instanceof Error && error.name === 'ApiError') return false;
          return failureCount < 2;
        },
      },
    },
  });
}

export function App({
  queryClient = buildQueryClient(),
}: {
  queryClient?: QueryClient;
} = {}): React.ReactElement {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={200}>
        <RouterProvider router={router} />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
