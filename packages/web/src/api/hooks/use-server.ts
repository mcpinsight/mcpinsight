import { useQuery } from '@tanstack/react-query';

import { api } from '../client';

export function useServer(name: string, days = 7) {
  return useQuery({
    queryKey: ['server', name, days],
    queryFn: () => api.server(name, { days }),
    enabled: name.length > 0,
  });
}
