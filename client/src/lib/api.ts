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
  cached?: boolean;
}

export interface ServerHealth {
  status: "healthy" | "degraded" | "unhealthy";
  startTime: string; // ISO timestamp
  queryCount: number;
  errorCount: number;
  errorRate: number;
  queriesPerSecond: number;
  lastQueryTime: string | null; // ISO timestamp
  servers: {
    udp: boolean;
    tcp: boolean;
    dot: boolean;
    doq: boolean;
    doh: boolean;
  };
}

export interface DNSStats {
  totalQueries: number;
  blockedQueries: number;
  allowedQueries: number;
  cachedQueries: number;
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
  performance?: {
    avgResponseTime: number | null;
    minResponseTime: number | null;
    maxResponseTime: number | null;
    p50: number | null;
    p95: number | null;
    p99: number | null;
    cacheHitRate: number;
  };
}

export const api = {
  async getStats(): Promise<DNSStats> {
    const response = await fetch(`${API_URL}/api/stats`);
    return response.json();
  },

  async exportStatsCSV(): Promise<Blob> {
    const response = await fetch(`${API_URL}/api/stats/export/csv`);
    if (!response.ok) {
      throw new Error(`Failed to export statistics: ${response.statusText}`);
    }
    return response.blob();
  },

  async exportStatsJSON(): Promise<Blob> {
    const response = await fetch(`${API_URL}/api/stats/export/json`);
    if (!response.ok) {
      throw new Error(`Failed to export statistics: ${response.statusText}`);
    }
    return response.blob();
  },

  async testDNSQuery(domain: string, type: string = 'A', dnssec: boolean = false): Promise<{
    success: boolean;
    domain: string;
    type: string;
    responseTime: number;
    response: unknown;
    rawResponse?: string;
    error?: string;
  }> {
    const response = await fetch(`${API_URL}/api/dns/test`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ domain, type, dnssec }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || `Failed to test DNS query: ${response.statusText}`);
    }

    return response.json();
  },

  async getHealth(): Promise<ServerHealth> {
    const response = await fetch(`${API_URL}/api/health`);
    if (!response.ok) {
      throw new Error(`Health check failed: ${response.statusText}`);
    }
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
      domainPattern?: string;
      cached?: boolean;
      blockReason?: string;
      minResponseTime?: number;
      maxResponseTime?: number;
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
    if (filters?.domainPattern) {
      params.append("domainPattern", filters.domainPattern);
    }
    if (filters?.cached !== undefined) {
      params.append("cached", filters.cached.toString());
    }
    if (filters?.blockReason) {
      params.append("blockReason", filters.blockReason);
    }
    if (filters?.minResponseTime !== undefined) {
      params.append("minResponseTime", filters.minResponseTime.toString());
    }
    if (filters?.maxResponseTime !== undefined) {
      params.append("maxResponseTime", filters.maxResponseTime.toString());
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
    upstreamDNSList?: string[];
    upstreamHealth?: Record<string, { failures: number; lastFailure: number; disabledUntil: number }>;
    dnsPort: number;
    queryRetentionDays: number;
    privacyMode: boolean;
    rateLimitEnabled: boolean;
    rateLimitMaxQueries: number;
    rateLimitWindowMs: number;
    cacheEnabled: boolean;
    cacheSize: number;
    blockPageEnabled: boolean;
    blockPageIP: IP | null;
    blockPageIPv6: IPv6 | null;
    dotEnabled?: boolean;
    dotPort?: number;
    dotCertPath?: string;
    dotKeyPath?: string;
    doqEnabled?: boolean;
    doqPort?: number;
    doqCertPath?: string;
    doqKeyPath?: string;
    doqSupported?: boolean;
    nodeVersion?: string;
    dnssecValidation?: boolean;
    dnssecChainValidation?: boolean;
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
    blockPageEnabled?: boolean;
    blockPageIP?: IP;
    blockPageIPv6?: IPv6;
    dotEnabled?: boolean;
    dotPort?: number;
    dotCertPath?: string;
    dotKeyPath?: string;
    doqEnabled?: boolean;
    doqPort?: number;
    doqCertPath?: string;
    doqKeyPath?: string;
    dnssecValidation?: boolean;
    dnssecChainValidation?: boolean;
  }): Promise<void> {
    await fetch(`${API_URL}/api/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    });
  },

  async clearCache(): Promise<void> {
    const response = await fetch(`${API_URL}/api/cache/clear`, {
      method: "POST",
    });
    if (!response.ok) {
      throw new Error(`Failed to clear cache: ${response.statusText}`);
    }
  },

  async exportQueriesCSV(filters?: {
    clientIp?: string;
    type?: string;
    blocked?: boolean;
    startTime?: number;
    endTime?: number;
    domain?: string;
  }): Promise<Blob> {
    const params = new URLSearchParams();
    if (filters?.clientIp) params.append('clientIp', filters.clientIp);
    if (filters?.type) params.append('type', filters.type);
    if (filters?.blocked !== undefined) params.append('blocked', filters.blocked.toString());
    if (filters?.startTime) params.append('startTime', filters.startTime.toString());
    if (filters?.endTime) params.append('endTime', filters.endTime.toString());
    if (filters?.domain) params.append('domain', filters.domain);

    const response = await fetch(`${API_URL}/api/queries/export/csv?${params}`);
    if (!response.ok) {
      throw new Error(`Failed to export queries: ${response.statusText}`);
    }
    return response.blob();
  },

  async exportQueriesJSON(filters?: {
    clientIp?: string;
    type?: string;
    blocked?: boolean;
    startTime?: number;
    endTime?: number;
    domain?: string;
    domainPattern?: string;
    cached?: boolean;
    blockReason?: string;
    minResponseTime?: number;
    maxResponseTime?: number;
  }): Promise<Blob> {
    const params = new URLSearchParams();
    if (filters?.clientIp) params.append('clientIp', filters.clientIp);
    if (filters?.type) params.append('type', filters.type);
    if (filters?.blocked !== undefined) params.append('blocked', filters.blocked.toString());
    if (filters?.startTime) params.append('startTime', filters.startTime.toString());
    if (filters?.endTime) params.append('endTime', filters.endTime.toString());
    if (filters?.domain) params.append('domain', filters.domain);
    if (filters?.domainPattern) params.append('domainPattern', filters.domainPattern);
    if (filters?.cached !== undefined) params.append('cached', filters.cached.toString());
    if (filters?.blockReason) params.append('blockReason', filters.blockReason);
    if (filters?.minResponseTime !== undefined) params.append('minResponseTime', filters.minResponseTime.toString());
    if (filters?.maxResponseTime !== undefined) params.append('maxResponseTime', filters.maxResponseTime.toString());

    const response = await fetch(`${API_URL}/api/queries/export/json?${params}`);
    if (!response.ok) {
      throw new Error(`Failed to export queries: ${response.statusText}`);
    }
    return response.blob();
  },

  async getBlockReasons(): Promise<string[]> {
    const response = await fetch(`${API_URL}/api/queries/block-reasons`);
    return response.json();
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
    type: "A" | "AAAA" | "PTR" | "MX" | "TXT" | "CNAME" | "NS" | "SRV" | "SOA" = "A"
  ): Promise<{
    domain: string;
    type: string;
    addresses?: string[];
    hostnames?: string[];
    answers?: Array<{ name: string; type: number; data: string }>;
    authority?: Array<{ name: string; type: number; TTL: number; data: string }>;
    additional?: Array<{ name: string; type: number; TTL: number; data: string }>;
    status?: number;
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

  // Authoritative DNS Zones
  async getZones(): Promise<Array<{
    id: number;
    domain: string;
    enabled: number;
    soa_serial: number;
    soa_refresh: number;
    soa_retry: number;
    soa_expire: number;
    soa_minimum: number;
    soa_mname: string;
    soa_rname: string;
    createdAt: number;
    updatedAt: number;
  }>> {
    const response = await fetch(`${API_URL}/api/zones`);
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || "Failed to fetch zones");
    }
    return response.json();
  },

  async createZone(domain: string, soaMname: string, soaRname: string): Promise<{
    id: number;
    domain: string;
    enabled: number;
    soa_serial: number;
    soa_refresh: number;
    soa_retry: number;
    soa_expire: number;
    soa_minimum: number;
    soa_mname: string;
    soa_rname: string;
    createdAt: number;
    updatedAt: number;
  }> {
    const response = await fetch(`${API_URL}/api/zones`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ domain, soaMname, soaRname }),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || "Failed to create zone");
    }
    return response.json();
  },

  async updateZone(id: number, updates: {
    domain?: string;
    enabled?: boolean;
    soa_serial?: number;
    soa_refresh?: number;
    soa_retry?: number;
    soa_expire?: number;
    soa_minimum?: number;
    soa_mname?: string;
    soa_rname?: string;
  }): Promise<{
    id: number;
    domain: string;
    enabled: number;
    soa_serial: number;
    soa_refresh: number;
    soa_retry: number;
    soa_expire: number;
    soa_minimum: number;
    soa_mname: string;
    soa_rname: string;
    createdAt: number;
    updatedAt: number;
  }> {
    const response = await fetch(`${API_URL}/api/zones/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || "Failed to update zone");
    }
    return response.json();
  },

  async deleteZone(id: number): Promise<void> {
    const response = await fetch(`${API_URL}/api/zones/${id}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || "Failed to delete zone");
    }
  },

  async getZoneRecords(zoneId: number): Promise<Array<{
    id: number;
    zone_id: number;
    name: string;
    type: string;
    ttl: number;
    data: string;
    priority: number | null;
    enabled: number;
    createdAt: number;
    updatedAt: number;
  }>> {
    const response = await fetch(`${API_URL}/api/zones/${zoneId}/records`);
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || "Failed to fetch zone records");
    }
    return response.json();
  },

  async createZoneRecord(zoneId: number, name: string, type: string, ttl: number, data: string, priority?: number): Promise<{
    id: number;
    zone_id: number;
    name: string;
    type: string;
    ttl: number;
    data: string;
    priority: number | null;
    enabled: number;
    createdAt: number;
    updatedAt: number;
  }> {
    const response = await fetch(`${API_URL}/api/zones/${zoneId}/records`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, type, ttl, data, priority }),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || "Failed to create zone record");
    }
    return response.json();
  },

  async updateZoneRecord(id: number, updates: {
    name?: string;
    type?: string;
    ttl?: number;
    data?: string;
    priority?: number | null;
    enabled?: boolean;
  }): Promise<{
    id: number;
    zone_id: number;
    name: string;
    type: string;
    ttl: number;
    data: string;
    priority: number | null;
    enabled: number;
    createdAt: number;
    updatedAt: number;
  }> {
    const response = await fetch(`${API_URL}/api/zones/records/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || "Failed to update zone record");
    }
    return response.json();
  },

  async deleteZoneRecord(id: number): Promise<void> {
    const response = await fetch(`${API_URL}/api/zones/records/${id}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || "Failed to delete zone record");
    }
  },
};
