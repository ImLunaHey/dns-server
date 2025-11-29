import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { apiKey } from "../lib/auth";

export interface ApiKey {
  id: string;
  name: string | null;
  start?: string;
  prefix?: string;
  enabled: boolean;
  createdAt: string;
  expiresAt: string | null;
  lastRequest: string | null;
}

export function useApiKeys() {
  return useQuery<{ data: ApiKey[] }>({
    queryKey: ["apiKeys"],
    queryFn: async () => {
      const response = await fetch("/api/auth/api-key/list", {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to fetch API keys");
      return response.json();
    },
  });
}

export function useCreateApiKey() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      name,
      expiresIn,
    }: {
      name: string;
      expiresIn?: number;
    }) => {
      const result = await apiKey.create({
        name,
        expiresIn,
      });
      if (result.error) {
        throw new Error(result.error.message || "Failed to create API key");
      }
      return result.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["apiKeys"] });
    },
  });
}

export function useDeleteApiKey() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ keyId }: { keyId: string }) => {
      const result = await apiKey.delete({ keyId });
      if (result.error) {
        throw new Error(result.error.message || "Failed to delete API key");
      }
      return result.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["apiKeys"] });
    },
  });
}
