import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";

export function useAdlists() {
  return useQuery({
    queryKey: ["adlists"],
    queryFn: () => api.getAdlists(),
    refetchInterval: 5000, // Poll for update status
  });
}

export function useUpdateBlocklists() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/adlists/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to start update");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["adlists"] });
      queryClient.invalidateQueries({ queryKey: ["stats"] });
    },
  });
}

export function useBlocklistUpdateStatus() {
  return useQuery<{
    status: string;
    domainsAdded?: number;
    error?: string;
    completedAt?: number;
  }>({
    queryKey: ["blocklist-update-status"],
    queryFn: async () => {
      const response = await fetch("/api/adlists/update-status");
      if (!response.ok) throw new Error("Failed to fetch update status");
      return response.json();
    },
    refetchInterval: (query) => {
      // Poll every 2 seconds if update is running
      const data = query.state.data;
      return data?.status === "running" ? 2000 : false;
    },
  });
}

export function useAddAdlist() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (url: string) => api.addAdlist(url),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["adlists"] });
      queryClient.invalidateQueries({ queryKey: ["stats"] });
    },
  });
}

export function useRemoveAdlist() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (url: string) => api.removeAdlist(url),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["adlists"] });
      queryClient.invalidateQueries({ queryKey: ["stats"] });
    },
  });
}
