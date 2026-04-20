import { useQuery } from '@tanstack/react-query';

import type { Client } from '@mcpinsight/core/types';

import { api } from '../client';

export interface UseServersParams {
  client: Client | 'all';
  days: number;
}

/**
 * `GET /api/servers` wrapper. Key is the params object so a filter change
 * invalidates cleanly. TanStack Query's default staleTime (0 ms) is fine —
 * the user explicitly re-loads the dashboard after running `mcpinsight scan`.
 */
export function useServers(params: UseServersParams) {
  return useQuery({
    queryKey: ['servers', params],
    queryFn: () => api.servers(params),
  });
}
