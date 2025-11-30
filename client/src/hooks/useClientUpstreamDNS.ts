import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';

export function useClientUpstreamDNS(clientIp: string) {
  return useQuery({
    queryKey: ['client-upstream-dns', clientIp],
    queryFn: () => api.getClientUpstreamDNS(clientIp),
  });
}

export function useSetClientUpstreamDNS() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ clientIp, upstreamDNS }: { clientIp: string; upstreamDNS: string }) => {
      await api.setClientUpstreamDNS(clientIp, upstreamDNS);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['client-upstream-dns', variables.clientIp] });
    },
  });
}

export function useDeleteClientUpstreamDNS() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ clientIp }: { clientIp: string }) => {
      await api.deleteClientUpstreamDNS(clientIp);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['client-upstream-dns', variables.clientIp] });
    },
  });
}

