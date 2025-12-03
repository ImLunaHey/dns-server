import { useQuery } from '@tanstack/react-query';
import { api, DNSQuery } from '../lib/api';

interface UseQueriesOptions {
  limit?: number;
  clientIp?: string;
  filters?: {
    type?: string;
    blocked?: boolean;
    startTime?: number;
    endTime?: number;
    domain?: string;
    domainPattern?: string;
    cached?: boolean;
    blockReason?: string;
    minResponseTime?: number;
    maxResponseTime?: number;
  };
  refetchInterval?: number | false;
  enabled?: boolean;
}

export function useQueries(options: UseQueriesOptions = {}) {
  const { limit = 100, clientIp, filters, refetchInterval = 2000, enabled = true } = options;

  return useQuery<DNSQuery[]>({
    queryKey: ['queries', limit, clientIp, filters],
    queryFn: () => api.getQueries(limit, clientIp, filters),
    refetchInterval,
    enabled,
  });
}

