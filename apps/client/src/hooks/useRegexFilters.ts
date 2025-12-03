import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

export interface RegexFilter {
  id: number;
  pattern: string;
  type: 'block' | 'allow';
  enabled: number;
  addedAt: number;
  comment: string | null;
}

export function useRegexFilters() {
  return useQuery({
    queryKey: ['regex-filters'],
    queryFn: async (): Promise<RegexFilter[]> => {
      const response = await fetch('/api/regex-filters');
      if (!response.ok) throw new Error('Failed to fetch regex filters');
      return response.json();
    },
  });
}

export function useAddRegexFilter() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ pattern, type, comment }: { pattern: string; type: 'block' | 'allow'; comment?: string }) => {
      const response = await fetch('/api/regex-filters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pattern, type, comment }),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to add regex filter');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['regex-filters'] });
    },
  });
}

export function useRemoveRegexFilter() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const response = await fetch(`/api/regex-filters/${id}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to remove regex filter');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['regex-filters'] });
    },
  });
}

export function useToggleRegexFilter() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, enabled }: { id: number; enabled: boolean }) => {
      const response = await fetch(`/api/regex-filters/${id}/enable`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to toggle regex filter');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['regex-filters'] });
    },
  });
}

