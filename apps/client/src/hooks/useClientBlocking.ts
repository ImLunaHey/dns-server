import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

interface ClientBlockingData {
  enabled: boolean;
  allowlist: Array<{
    id: number;
    clientIp: string;
    domain: string;
    addedAt: number;
  }>;
  blocklist: Array<{
    id: number;
    clientIp: string;
    domain: string;
    addedAt: number;
  }>;
}

export function useClientBlocking(clientIp: string) {
  return useQuery<ClientBlockingData>({
    queryKey: ['client-blocking', clientIp],
    queryFn: async () => {
      const response = await fetch(`/api/clients/${clientIp}/blocking`);
      if (!response.ok) throw new Error('Failed to fetch client blocking rules');
      return response.json();
    },
  });
}

export function useUpdateClientBlocking() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ clientIp, enabled }: { clientIp: string; enabled: boolean }) => {
      const response = await fetch(`/api/clients/${clientIp}/blocking`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to update blocking');
      }
      return response.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['client-blocking', variables.clientIp] });
    },
  });
}

export function useAddClientAllowlist() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ clientIp, domain }: { clientIp: string; domain: string }) => {
      const response = await fetch(`/api/clients/${clientIp}/allowlist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain }),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to add to allowlist');
      }
      return response.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['client-blocking', variables.clientIp] });
    },
  });
}

export function useRemoveClientAllowlist() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ clientIp, domain }: { clientIp: string; domain: string }) => {
      const response = await fetch(`/api/clients/${clientIp}/allowlist/${encodeURIComponent(domain)}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to remove from allowlist');
      }
      return response.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['client-blocking', variables.clientIp] });
    },
  });
}

export function useAddClientBlocklist() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ clientIp, domain }: { clientIp: string; domain: string }) => {
      const response = await fetch(`/api/clients/${clientIp}/blocklist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain }),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to add to blocklist');
      }
      return response.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['client-blocking', variables.clientIp] });
    },
  });
}

export function useRemoveClientBlocklist() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ clientIp, domain }: { clientIp: string; domain: string }) => {
      const response = await fetch(`/api/clients/${clientIp}/blocklist/${encodeURIComponent(domain)}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to remove from blocklist');
      }
      return response.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['client-blocking', variables.clientIp] });
    },
  });
}

