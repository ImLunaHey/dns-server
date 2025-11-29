import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

export interface AllowlistEntry {
  id: number;
  domain: string;
  addedAt: number;
  comment: string | null;
}

export function useAllowlist() {
  return useQuery({
    queryKey: ['allowlist'],
    queryFn: async (): Promise<AllowlistEntry[]> => {
      const response = await fetch('/api/allowlist');
      if (!response.ok) throw new Error('Failed to fetch allowlist');
      return response.json();
    },
  });
}

export function useAddToAllowlist() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ domain, comment }: { domain: string; comment?: string }) => {
      const response = await fetch('/api/allowlist/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain, comment }),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to add to allowlist');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['allowlist'] });
    },
  });
}

export function useRemoveFromAllowlist() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (domain: string) => {
      const response = await fetch('/api/allowlist/remove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain }),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to remove from allowlist');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['allowlist'] });
    },
  });
}

