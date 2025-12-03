import { useQuery } from '@tanstack/react-query';
import { api, DNSStats } from '../lib/api';

export function useStats() {
  return useQuery<DNSStats>({
    queryKey: ['stats'],
    queryFn: () => api.getStats(),
    refetchInterval: 2000,
  });
}

