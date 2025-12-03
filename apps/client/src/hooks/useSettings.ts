import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';

export function useSettings() {
  return useQuery({
    queryKey: ['settings'],
    queryFn: () => api.getSettings(),
  });
}

export function useUpdateSettings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (settings: Parameters<typeof api.updateSettings>[0]) =>
      api.updateSettings(settings),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
  });
}

export function useClearCache() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => api.clearCache(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
  });
}

