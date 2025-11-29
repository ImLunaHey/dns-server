import { z } from "zod";

const API_URL = ""; // Use relative URL since we're proxying through Vite

// Zod IP validators return validated strings
type IPv4 = z.infer<ReturnType<typeof z.ipv4>>;
type IPv6 = z.infer<ReturnType<typeof z.ipv6>>;
type IP = IPv4 | IPv6;

export interface DNSQuery {
  id: string;
  domain: string;
  type: string;
  blocked: boolean;
  timestamp: number;
  responseTime?: number;
  clientIp?: string;
  blockReason?: string;
}

export interface DNSStats {
  totalQueries: number;
  blockedQueries: number;
  allowedQueries: number;
  blocklistSize: number;
  topDomainsArray: Array<{ domain: string; count: number }>;
  topBlockedArray: Array<{ domain: string; count: number }>;
  topClientsArray: Array<{ clientIp: string; count: number }>;
  queryTypeBreakdown: Array<{ type: string; count: number }>;
  blockPercentageOverTime: Array<{
    date: string;
    total: number;
    blocked: number;
    blockPercentage: number;
  }>;
  topAdvertisers: Array<{
    domain: string;
    blockedCount: number;
    totalCount: number;
    blockRate: number;
  }>;
}

export const api = {
  async getStats(): Promise<DNSStats> {
    const response = await fetch(`${API_URL}/api/stats`);
    return response.json();
  },

  async getQueries(
    limit = 100,
    clientIp?: string,
    filters?: {
      type?: string;
      blocked?: boolean;
      startTime?: number;
      endTime?: number;
      domain?: string;
    }
  ): Promise<DNSQuery[]> {
    const params = new URLSearchParams({ limit: limit.toString() });
    if (clientIp) {
      params.append("clientIp", clientIp);
    }
    if (filters?.type) {
      params.append("type", filters.type);
    }
    if (filters?.blocked !== undefined) {
      params.append("blocked", filters.blocked.toString());
    }
    if (filters?.startTime) {
      params.append("startTime", filters.startTime.toString());
    }
    if (filters?.endTime) {
      params.append("endTime", filters.endTime.toString());
    }
    if (filters?.domain) {
      params.append("domain", filters.domain);
    }
    const response = await fetch(`${API_URL}/api/queries?${params}`);
    return response.json();
  },

  async addToBlocklist(domain: string): Promise<void> {
    await fetch(`${API_URL}/api/blocklist/add`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ domain }),
    });
  },

  async removeFromBlocklist(domain: string): Promise<void> {
    await fetch(`${API_URL}/api/blocklist/remove`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ domain }),
    });
  },

  async getClientNames(): Promise<Record<string, string>> {
    const response = await fetch(`${API_URL}/api/clients/names`);
    return response.json();
  },

  async setClientName(clientIp: string, name: string): Promise<void> {
    await fetch(`${API_URL}/api/clients/name`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientIp, name }),
    });
  },

  async deleteClientName(clientIp: string): Promise<void> {
    await fetch(`${API_URL}/api/clients/name/${clientIp}`, {
      method: "DELETE",
    });
  },

  async getAdlists(): Promise<{
    adlists: Array<{
      id: number;
      url: string;
      enabled: boolean;
      domainCount: number | null;
      addedAt: number;
    }>;
    activeUrls: string[];
    latestUpdate?: {
      id: number;
      startedAt: number;
      completedAt: number | null;
      status: "running" | "completed" | "failed";
      domainsAdded: number;
      error: string | null;
    };
  }> {
    const response = await fetch(`${API_URL}/api/adlists`);
    return response.json();
  },

  async addAdlist(url: string): Promise<void> {
    await fetch(`${API_URL}/api/adlists`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
  },

  async removeAdlist(url: string): Promise<void> {
    await fetch(`${API_URL}/api/adlists`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
  },

  async getLocalDNS(): Promise<
    Array<{
      id: number;
      domain: string;
      ip: string;
      type: string;
      enabled: boolean;
      createdAt: number;
      updatedAt: number;
    }>
  > {
    const response = await fetch(`${API_URL}/api/local-dns`);
    return response.json();
  },

  async addLocalDNS(
    domain: string,
    ip: string,
    type: string = "A"
  ): Promise<void> {
    await fetch(`${API_URL}/api/local-dns`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ domain, ip, type }),
    });
  },

  async removeLocalDNS(domain: string): Promise<void> {
    await fetch(`${API_URL}/api/local-dns/${encodeURIComponent(domain)}`, {
      method: "DELETE",
    });
  },

  async setLocalDNSEnabled(domain: string, enabled: boolean): Promise<void> {
    await fetch(
      `${API_URL}/api/local-dns/${encodeURIComponent(domain)}/enable`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      }
    );
  },

  async getBlockingStatus(): Promise<{
    enabled: boolean;
    disabledUntil: number | null;
    isTemporarilyDisabled: boolean;
  }> {
    const response = await fetch(`${API_URL}/api/blocking/status`);
    return response.json();
  },

  async enableBlocking(): Promise<void> {
    await fetch(`${API_URL}/api/blocking/enable`, {
      method: "POST",
    });
  },

  async disableBlocking(seconds?: number): Promise<void> {
    await fetch(`${API_URL}/api/blocking/disable`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ seconds }),
    });
  },

  async getSettings(): Promise<{
    upstreamDNS: IP;
    dnsPort: number;
    queryRetentionDays: number;
    privacyMode: boolean;
    rateLimitEnabled: boolean;
    rateLimitMaxQueries: number;
    rateLimitWindowMs: number;
    cacheEnabled: boolean;
    cacheTTL: number;
    cacheSize: number;
    blockPageEnabled: boolean;
    blockPageIP: IP | null;
    blockPageIPv6: IPv6 | null;
  }> {
    const response = await fetch(`${API_URL}/api/settings`);
    return response.json();
  },

  async updateSettings(settings: {
    upstreamDNS?: IP;
    queryRetentionDays?: number;
    privacyMode?: boolean;
    rateLimitEnabled?: boolean;
    rateLimitMaxQueries?: number;
    rateLimitWindowMs?: number;
    cacheEnabled?: boolean;
    cacheTTL?: number;
    blockPageEnabled?: boolean;
    blockPageIP?: IP;
    blockPageIPv6?: IPv6;
  }): Promise<void> {
    await fetch(`${API_URL}/api/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    });
  },

  async getBlockPageSettings(): Promise<{
    id: number;
    title: string | null;
    message: string | null;
    backgroundColor: string | null;
    textColor: string | null;
    logoUrl: string | null;
    updatedAt: number;
  }> {
    const response = await fetch(`${API_URL}/api/block-page/settings`);
    return response.json();
  },

  async updateBlockPageSettings(settings: {
    title?: string;
    message?: string;
    backgroundColor?: string;
    textColor?: string;
    logoUrl?: string;
  }): Promise<void> {
    await fetch(`${API_URL}/api/block-page/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    });
  },

  async getClientStats(clientIp: string): Promise<{
    totalQueries: number;
    blockedQueries: number;
    blockPercentage: number;
    topDomains: Array<{ domain: string; count: number }>;
    topBlocked: Array<{ domain: string; count: number }>;
    queryTypes: Array<{ type: string; count: number }>;
    timeRange: { first: number; last: number };
  }> {
    const response = await fetch(
      `${API_URL}/api/stats/client/${encodeURIComponent(clientIp)}`
    );
    if (!response.ok) throw new Error("Failed to fetch client stats");
    return response.json();
  },

  async getQueryPatterns(hours: number = 24): Promise<
    Array<{
      hour: number;
      total: number;
      blocked: number;
      blockPercentage: number;
    }>
  > {
    const response = await fetch(
      `${API_URL}/api/stats/patterns?hours=${hours}`
    );
    if (!response.ok) throw new Error("Failed to fetch query patterns");
    return response.json();
  },

  async archiveQueries(
    daysToKeep: number = 7,
    compress: boolean = true
  ): Promise<{ success: boolean; archived: number }> {
    const response = await fetch(`${API_URL}/api/queries/archive`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ daysToKeep, compress }),
    });
    if (!response.ok) throw new Error("Failed to archive queries");
    return response.json();
  },

  async getLongTermData(days: number = 30): Promise<
    Array<{
      date: string;
      total: number;
      blocked: number;
    }>
  > {
    const response = await fetch(`${API_URL}/api/long-term?days=${days}`);
    if (!response.ok) throw new Error("Failed to fetch long-term data");
    return response.json();
  },

  async getGroups(): Promise<
    Array<{
      id: number;
      name: string;
      description: string | null;
      createdAt: number;
      updatedAt: number;
      memberCount: number;
    }>
  > {
    const response = await fetch(`${API_URL}/api/groups`);
    if (!response.ok) throw new Error("Failed to fetch groups");
    return response.json();
  },

  async createGroup(
    name: string,
    description?: string
  ): Promise<{ success: boolean; id: number }> {
    const response = await fetch(`${API_URL}/api/groups`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, description }),
    });
    if (!response.ok) throw new Error("Failed to create group");
    return response.json();
  },

  async updateGroup(
    id: number,
    name?: string,
    description?: string
  ): Promise<void> {
    const response = await fetch(`${API_URL}/api/groups/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, description }),
    });
    if (!response.ok) throw new Error("Failed to update group");
  },

  async deleteGroup(id: number): Promise<void> {
    const response = await fetch(`${API_URL}/api/groups/${id}`, {
      method: "DELETE",
    });
    if (!response.ok) throw new Error("Failed to delete group");
  },

  async addGroupMember(groupId: number, clientIp: string): Promise<void> {
    const response = await fetch(`${API_URL}/api/groups/${groupId}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientIp }),
    });
    if (!response.ok) throw new Error("Failed to add member");
  },

  async removeGroupMember(groupId: number, clientIp: string): Promise<void> {
    const response = await fetch(
      `${API_URL}/api/groups/${groupId}/members/${clientIp}`,
      {
        method: "DELETE",
      }
    );
    if (!response.ok) throw new Error("Failed to remove member");
  },

  async getGroupMembers(groupId: number): Promise<string[]> {
    const response = await fetch(`${API_URL}/api/groups/${groupId}/members`);
    if (!response.ok) throw new Error("Failed to fetch group members");
    return response.json();
  },

  async lookupDNS(
    domain: string,
    type: "A" | "AAAA" | "PTR" = "A"
  ): Promise<{
    domain: string;
    type: string;
    addresses?: string[];
    hostnames?: string[];
  }> {
    const response = await fetch(
      `${API_URL}/api/tools/lookup?domain=${encodeURIComponent(
        domain
      )}&type=${type}`
    );
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || "DNS lookup failed");
    }
    return response.json();
  },
};
