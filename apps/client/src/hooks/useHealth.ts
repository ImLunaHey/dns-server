import { useQuery } from '@tanstack/react-query';
import { api, ServerHealth } from '../lib/api';

export function useHealth() {
  return useQuery<ServerHealth>({
    queryKey: ['health'],
    queryFn: () => api.getHealth(),
    refetchInterval: 2000,
  });
}

