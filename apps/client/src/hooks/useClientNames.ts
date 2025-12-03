import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';

export function useClientNames() {
  return useQuery({
    queryKey: ['clientNames'],
    queryFn: () => api.getClientNames(),
  });
}

export function useSetClientName() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ clientIp, name }: { clientIp: string; name: string }) =>
      api.setClientName(clientIp, name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clientNames'] });
    },
  });
}

export function useDeleteClientName() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (clientIp: string) => api.deleteClientName(clientIp),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clientNames'] });
    },
  });
}

