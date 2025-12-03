import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';

export function useLocalDNS() {
  return useQuery({
    queryKey: ['localDNS'],
    queryFn: () => api.getLocalDNS(),
    refetchInterval: 5000,
  });
}

export function useAddLocalDNS() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ domain, ip, type }: { domain: string; ip: string; type?: string }) =>
      api.addLocalDNS(domain, ip, type),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['localDNS'] });
    },
  });
}

export function useRemoveLocalDNS() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (domain: string) => api.removeLocalDNS(domain),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['localDNS'] });
    },
  });
}

export function useSetLocalDNSEnabled() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ domain, enabled }: { domain: string; enabled: boolean }) =>
      api.setLocalDNSEnabled(domain, enabled),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['localDNS'] });
    },
  });
}

