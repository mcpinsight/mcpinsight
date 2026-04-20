import { useQuery } from '@tanstack/react-query';

import { api } from '../client';

/**
 * Fetch the Health Score for one server. Disabled when `name` is empty so a
 * route in transition (e.g. params not yet resolved) doesn't fire a garbage
 * request.
 */
export function useHealthScore(name: string) {
  return useQuery({
    queryKey: ['health-score', name],
    queryFn: () => api.healthScore(name),
    enabled: name.length > 0,
  });
}
