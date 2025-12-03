import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

interface GroupBlockingData {
  enabled: boolean;
  allowlist: Array<{
    id: number;
    groupId: number;
    domain: string;
    addedAt: number;
  }>;
  blocklist: Array<{
    id: number;
    groupId: number;
    domain: string;
    addedAt: number;
  }>;
}

export function useGroupBlocking(groupId: number) {
  return useQuery<GroupBlockingData>({
    queryKey: ['group-blocking', groupId],
    queryFn: async () => {
      const response = await fetch(`/api/groups/${groupId}/blocking`);
      if (!response.ok) throw new Error('Failed to fetch group blocking rules');
      return response.json();
    },
  });
}

export function useUpdateGroupBlocking() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ groupId, enabled }: { groupId: number; enabled: boolean }) => {
      const response = await fetch(`/api/groups/${groupId}/blocking`, {
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
      queryClient.invalidateQueries({ queryKey: ['group-blocking', variables.groupId] });
    },
  });
}

export function useAddGroupAllowlist() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ groupId, domain }: { groupId: number; domain: string }) => {
      const response = await fetch(`/api/groups/${groupId}/allowlist`, {
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
      queryClient.invalidateQueries({ queryKey: ['group-blocking', variables.groupId] });
    },
  });
}

export function useRemoveGroupAllowlist() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ groupId, domain }: { groupId: number; domain: string }) => {
      const response = await fetch(`/api/groups/${groupId}/allowlist/${encodeURIComponent(domain)}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to remove from allowlist');
      }
      return response.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['group-blocking', variables.groupId] });
    },
  });
}

export function useAddGroupBlocklist() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ groupId, domain }: { groupId: number; domain: string }) => {
      const response = await fetch(`/api/groups/${groupId}/blocklist`, {
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
      queryClient.invalidateQueries({ queryKey: ['group-blocking', variables.groupId] });
    },
  });
}

export function useRemoveGroupBlocklist() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ groupId, domain }: { groupId: number; domain: string }) => {
      const response = await fetch(`/api/groups/${groupId}/blocklist/${encodeURIComponent(domain)}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to remove from blocklist');
      }
      return response.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['group-blocking', variables.groupId] });
    },
  });
}

