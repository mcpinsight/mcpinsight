import { useQuery } from '@tanstack/react-query';

import { api } from '../client';

export function useClients(days = 30) {
  return useQuery({
    queryKey: ['clients', days],
    queryFn: () => api.clients({ days }),
  });
}
