import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';

export function useBlockingStatus() {
  return useQuery({
    queryKey: ['blockingStatus'],
    queryFn: () => api.getBlockingStatus(),
    refetchInterval: 1000, // Check every second to update countdown
  });
}

export function useEnableBlocking() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => api.enableBlocking(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['blockingStatus'] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
    },
  });
}

export function useDisableBlocking() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (seconds?: number) => api.disableBlocking(seconds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['blockingStatus'] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
    },
  });
}

