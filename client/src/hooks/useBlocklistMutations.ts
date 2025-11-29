import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';

export function useBlockDomain() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (domain: string) => api.addToBlocklist(domain),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stats'] });
      queryClient.invalidateQueries({ queryKey: ['queries'] });
    },
  });
}

export function useAllowDomain() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (domain: string) => api.removeFromBlocklist(domain),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stats'] });
      queryClient.invalidateQueries({ queryKey: ['queries'] });
    },
  });
}

