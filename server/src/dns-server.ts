import dgram from 'dgram';
import {
  dbQueries,
  dbLocalDNS,
  dbSettings,
  dbAllowlist,
  dbRegexFilters,
  dbClientBlockingRules,
  dbGroupBlockingRules,
  dbClientAllowlist,
  dbClientBlocklist,
  dbGroupAllowlist,
  dbGroupBlocklist,
  dbClientGroups,
  dbManualBlocklist,
  dbConditionalForwarding,
  dbClientUpstreamDNS,
  dbRateLimits,
} from './db.js';

export interface DNSQuery {
  id: string;
  domain: string;
  type: string;
  blocked: boolean;
  timestamp: number;
  responseTime?: number;
  clientIp?: string;
  blockReason?: string; // e.g., "blocklist", "regex", "client-blocklist", "group-blocklist"
}

export interface DNSStats {
  totalQueries: number;
  blockedQueries: number;
  allowedQueries: number;
  topDomains: Map<string, number>;
  topBlocked: Map<string, number>;
  topClients: Map<string, number>;
}

interface CachedDNSResponse {
  response: Buffer;
  expiresAt: number;
  domain: string;
  type: number;
}

export class DNSServer {
  private server: dgram.Socket;
  private blocklist: Set<string> = new Set();
  private blocklistUrls: string[] = [];
  private blockingEnabled: boolean = true;
  private blockingDisabledUntil: number | null = null;
  private upstreamDNS: string;
  private port: number;
  private rateLimitEnabled: boolean = false;
  private rateLimitMaxQueries: number = 1000;
  private rateLimitWindowMs: number = 60000; // 1 minute
  private cache: Map<string, CachedDNSResponse> = new Map();
  private cacheEnabled: boolean = true;
  private cacheTTL: number = 300; // 5 minutes default
  private blockPageEnabled: boolean = false;
  private blockPageIP: string = '0.0.0.0'; // Default block IP

  constructor() {
    this.server = dgram.createSocket('udp4');
    this.upstreamDNS = dbSettings.get('upstreamDNS', '1.1.1.1');
    this.port = parseInt(dbSettings.get('dnsPort', '53'), 10);
    this.rateLimitEnabled = dbSettings.get('rateLimitEnabled', 'false') === 'true';
    this.rateLimitMaxQueries = parseInt(dbSettings.get('rateLimitMaxQueries', '1000'), 10);
    this.rateLimitWindowMs = parseInt(dbSettings.get('rateLimitWindowMs', '60000'), 10);
    this.cacheEnabled = dbSettings.get('cacheEnabled', 'true') === 'true';
    this.cacheTTL = parseInt(dbSettings.get('cacheTTL', '300'), 10);
    this.blockPageEnabled = dbSettings.get('blockPageEnabled', 'false') === 'true';
    this.blockPageIP = dbSettings.get('blockPageIP', '0.0.0.0');

    // Cleanup old rate limit windows periodically
    setInterval(() => {
      dbRateLimits.cleanupOldWindows(this.rateLimitWindowMs);
    }, 60000); // Every minute

    // Cleanup expired cache entries periodically
    setInterval(() => {
      this.cleanupCache();
    }, 60000); // Every minute
  }

  private getCacheKey(domain: string, type: number): string {
    return `${domain.toLowerCase()}:${type}`;
  }

  private getCachedResponse(domain: string, type: number): Buffer | null {
    if (!this.cacheEnabled) return null;

    const key = this.getCacheKey(domain, type);
    const cached = this.cache.get(key);

    if (!cached) return null;

    if (Date.now() > cached.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return cached.response;
  }

  private setCachedResponse(domain: string, type: number, response: Buffer) {
    if (!this.cacheEnabled) return;

    const key = this.getCacheKey(domain, type);
    const expiresAt = Date.now() + this.cacheTTL * 1000;

    this.cache.set(key, {
      response,
      expiresAt,
      domain: domain.toLowerCase(),
      type,
    });
  }

  private cleanupCache() {
    const now = Date.now();
    for (const [key, cached] of this.cache.entries()) {
      if (now > cached.expiresAt) {
        this.cache.delete(key);
      }
    }
  }

  clearCache() {
    this.cache.clear();
  }

  getCacheStats() {
    return {
      size: this.cache.size,
      enabled: this.cacheEnabled,
      ttl: this.cacheTTL,
    };
  }

  setCacheEnabled(enabled: boolean) {
    this.cacheEnabled = enabled;
    dbSettings.set('cacheEnabled', enabled.toString());
    if (!enabled) {
      this.cache.clear();
    }
  }

  setCacheTTL(ttl: number) {
    this.cacheTTL = ttl;
    dbSettings.set('cacheTTL', ttl.toString());
  }

  getBlockPageIPv6(): string {
    return dbSettings.get('blockPageIPv6', '::');
  }

  setBlockPageEnabled(enabled: boolean) {
    this.blockPageEnabled = enabled;
    dbSettings.set('blockPageEnabled', enabled.toString());
  }

  setBlockPageIP(ip: string) {
    this.blockPageIP = ip;
    dbSettings.set('blockPageIP', ip);
  }

  setBlockPageIPv6(ip: string) {
    dbSettings.set('blockPageIPv6', ip);
  }

  getBlockPageStatus() {
    return {
      enabled: this.blockPageEnabled,
      ipv4: this.blockPageIP,
      ipv6: this.getBlockPageIPv6(),
    };
  }

  async loadBlocklist(urls: string[]) {
    console.log('Loading blocklists...');
    this.blocklistUrls = urls;
    // Clear existing blocklist before loading new ones
    this.blocklist.clear();

    // Load manually added domains first
    const manualDomains = dbManualBlocklist.getDomains();
    manualDomains.forEach((domain) => this.blocklist.add(domain));
    console.log(`Loaded ${manualDomains.size} manually added domains`);

    // Load domains from adlists
    for (const url of urls) {
      try {
        const response = await fetch(url);
        const text = await response.text();
        const domains = this.parseBlocklist(text);
        domains.forEach((domain) => this.blocklist.add(domain));
        console.log(`Loaded ${domains.length} domains from ${url}`);
      } catch (error) {
        console.error(`Failed to load blocklist from ${url}:`, error);
      }
    }
    console.log(`Total blocked domains: ${this.blocklist.size}`);
  }

  getBlocklistUrls(): string[] {
    return this.blocklistUrls;
  }

  getBlocklistSize(): number {
    return this.blocklist.size;
  }

  async reloadBlocklist() {
    await this.loadBlocklist(this.blocklistUrls);
  }

  private parseBlocklist(content: string): string[] {
    const domains: string[] = [];
    const lines = content.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();

      // Skip comments and empty lines
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('!')) {
        continue;
      }

      // Parse hosts file format (0.0.0.0 domain.com or 127.0.0.1 domain.com)
      if (trimmed.startsWith('0.0.0.0') || trimmed.startsWith('127.0.0.1')) {
        const parts = trimmed.split(/\s+/);
        if (parts[1]) {
          domains.push(parts[1].toLowerCase());
        }
      }
      // Parse plain domain list
      else if (trimmed.includes('.')) {
        domains.push(trimmed.toLowerCase());
      }
    }

    return domains;
  }

  private isBlocked(domain: string, clientIp?: string): { blocked: boolean; reason?: string } {
    const lower = domain.toLowerCase();

    // Get client's groups
    let clientGroups: number[] = [];
    if (clientIp) {
      clientGroups = dbClientGroups.getGroupsForClient(clientIp);
    }

    // Check if blocking is disabled globally
    if (!this.blockingEnabled) {
      return { blocked: false };
    }

    // Check if blocking is temporarily disabled
    if (this.blockingDisabledUntil && Date.now() < this.blockingDisabledUntil) {
      return { blocked: false };
    }

    // Reset temporary disable if time has passed
    if (this.blockingDisabledUntil && Date.now() >= this.blockingDisabledUntil) {
      this.blockingDisabledUntil = null;
    }

    // Check per-client blocking rules
    if (clientIp && !dbClientBlockingRules.getBlockingEnabled(clientIp)) {
      return { blocked: false };
    }

    // Check per-group blocking rules
    for (const groupId of clientGroups) {
      if (!dbGroupBlockingRules.getBlockingEnabled(groupId)) {
        return { blocked: false };
      }
    }

    // Check global allowlist first - if domain is in allowlist, never block it
    if (dbAllowlist.isAllowed(lower)) {
      return { blocked: false };
    }

    // Check per-client allowlist
    if (clientIp && dbClientAllowlist.isAllowed(clientIp, lower)) {
      return { blocked: false };
    }

    // Check per-group allowlist
    for (const groupId of clientGroups) {
      if (dbGroupAllowlist.isAllowed(groupId, lower)) {
        return { blocked: false };
      }
    }

    // Check regex allow filters first
    const regexAllowFilters = dbRegexFilters.getEnabled().filter((f) => f.type === 'allow');
    for (const filter of regexAllowFilters) {
      try {
        const regex = new RegExp(filter.pattern);
        if (regex.test(lower)) {
          return { blocked: false }; // Domain matches allow regex, don't block
        }
      } catch {
        // Invalid regex, skip
      }
    }

    // Check regex block filters
    const regexBlockFilters = dbRegexFilters.getEnabled().filter((f) => f.type === 'block');
    for (const filter of regexBlockFilters) {
      try {
        const regex = new RegExp(filter.pattern);
        if (regex.test(lower)) {
          return { blocked: true, reason: 'regex-filter' }; // Domain matches block regex, block it
        }
      } catch {
        // Invalid regex, skip
      }
    }

    // Check per-client blocklist (takes precedence over global)
    if (clientIp && dbClientBlocklist.isBlocked(clientIp, lower)) {
      return { blocked: true, reason: 'client-blocklist' };
    }

    // Check per-group blocklist
    for (const groupId of clientGroups) {
      if (dbGroupBlocklist.isBlocked(groupId, lower)) {
        return { blocked: true, reason: 'group-blocklist' };
      }
    }

    // Check exact match in global blocklist
    if (this.blocklist.has(lower)) {
      return { blocked: true, reason: 'blocklist' };
    }

    // Check subdomains in global blocklist
    const parts = lower.split('.');
    for (let i = 0; i < parts.length - 1; i++) {
      const subdomain = parts.slice(i).join('.');
      if (this.blocklist.has(subdomain)) {
        return { blocked: true, reason: 'blocklist' };
      }
    }

    return { blocked: false };
  }

  private parseDNSQuery(msg: Buffer): { id: number; domain: string; type: number } | null {
    try {
      if (msg.length < 12) return null;

      const id = msg.readUInt16BE(0);
      const flags = msg.readUInt16BE(2);

      // Check if it's a query (QR bit = 0)
      if ((flags & 0x8000) !== 0) return null;

      let offset = 12;
      let domain = '';

      while (offset < msg.length) {
        const length = msg[offset];
        if (length === 0) {
          offset++;
          break;
        }

        if (domain.length > 0) domain += '.';
        domain += msg.toString('utf8', offset + 1, offset + 1 + length);
        offset += length + 1;
      }

      const type = msg.readUInt16BE(offset);

      return { id, domain, type };
    } catch (error) {
      console.error('Error parsing DNS query:', error);
      return null;
    }
  }

  private createDNSResponse(queryMsg: Buffer, blocked: boolean): Buffer {
    const response = Buffer.from(queryMsg);

    // Set QR bit (response) and AA bit (authoritative)
    const flags = response.readUInt16BE(2);
    response.writeUInt16BE(flags | 0x8400, 2);

    if (blocked) {
      // NXDOMAIN response
      response.writeUInt16BE(response.readUInt16BE(2) | 0x0003, 2);
      response.writeUInt16BE(0, 6); // Answer count = 0
    }

    return response;
  }

  private createDNSResponseWithIP(queryMsg: Buffer, ip: string, type: number): Buffer {
    const response = Buffer.alloc(512);
    queryMsg.copy(response, 0, 0, 12);

    // Set QR bit (response), AA bit (authoritative), and RA bit
    const flags = response.readUInt16BE(2);
    response.writeUInt16BE(flags | 0x8580, 2);

    // Set answer count to 1
    response.writeUInt16BE(1, 6);

    // Copy question section
    let offset = 12;
    while (offset < queryMsg.length && queryMsg[offset] !== 0) {
      const length = queryMsg[offset];
      response[offset] = length;
      queryMsg.copy(response, offset + 1, offset + 1, offset + 1 + length);
      offset += length + 1;
    }
    // Copy null terminator and QTYPE, QCLASS
    response[offset] = 0;
    response.writeUInt16BE(queryMsg.readUInt16BE(offset + 1), offset + 1);
    response.writeUInt16BE(queryMsg.readUInt16BE(offset + 3), offset + 3);
    offset += 5;

    // Answer section
    // Name pointer to question
    response.writeUInt16BE(0xc00c, offset);
    offset += 2;

    // Type (A = 1, AAAA = 28)
    response.writeUInt16BE(type, offset);
    offset += 2;

    // Class (IN = 1)
    response.writeUInt16BE(1, offset);
    offset += 2;

    // TTL (3600 seconds)
    response.writeUInt32BE(3600, offset);
    offset += 4;

    // Data length
    const ipBytes = type === 1 ? this.ipv4ToBytes(ip) : this.ipv6ToBytes(ip);
    response.writeUInt16BE(ipBytes.length, offset);
    offset += 2;

    // IP address
    ipBytes.copy(response, offset);

    return response.slice(0, offset + ipBytes.length);
  }

  private ipv4ToBytes(ip: string): Buffer {
    const parts = ip.split('.').map(Number);
    return Buffer.from(parts);
  }

  private ipv6ToBytes(ip: string): Buffer {
    // Simplified IPv6 parsing - for full support, use a proper library
    const parts = ip.split(':');
    const bytes = Buffer.alloc(16);
    let byteIndex = 0;
    for (const part of parts) {
      if (part === '') continue;
      const num = parseInt(part, 16);
      bytes[byteIndex++] = (num >> 8) & 0xff;
      bytes[byteIndex++] = num & 0xff;
    }
    return bytes;
  }

  private async forwardQuery(msg: Buffer, domain: string, clientIp?: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      // Priority: client-specific DNS > conditional forwarding > default upstream
      let targetDNS = this.upstreamDNS;

      if (clientIp) {
        const clientDNS = dbClientUpstreamDNS.get(clientIp);
        if (clientDNS) {
          targetDNS = clientDNS;
        }
      }

      // Check conditional forwarding if no client-specific DNS
      if (targetDNS === this.upstreamDNS) {
        const conditionalDNS = dbConditionalForwarding.findUpstreamDNS(domain);
        if (conditionalDNS) {
          targetDNS = conditionalDNS;
        }
      }

      // Detect if upstream DNS is IPv6 or IPv4
      const isIPv6 = targetDNS.includes(':');
      const socketType = isIPv6 ? 'udp6' : 'udp4';
      const client = dgram.createSocket(socketType);
      const timeout = setTimeout(() => {
        client.close();
        reject(new Error('DNS query timeout'));
      }, 5000);

      client.on('message', (response) => {
        clearTimeout(timeout);
        client.close();
        resolve(response);
      });

      client.on('error', (err) => {
        clearTimeout(timeout);
        client.close();
        reject(err);
      });

      client.send(msg, 53, targetDNS, (err) => {
        if (err) {
          clearTimeout(timeout);
          client.close();
          reject(err);
        }
      });
    });
  }

  private addQuery(query: DNSQuery) {
    try {
      dbQueries.insert(query);
    } catch (error) {
      console.error('Failed to save query to database:', error);
    }
  }

  getQueries(
    limit = 100,
    clientIp?: string,
    filters?: {
      type?: string;
      blocked?: boolean;
      startTime?: number;
      endTime?: number;
      domain?: string;
      offset?: number;
    },
  ): DNSQuery[] {
    if (clientIp || filters) {
      return dbQueries.getFiltered({
        limit,
        offset: filters?.offset,
        clientIp,
        type: filters?.type,
        blocked: filters?.blocked,
        startTime: filters?.startTime,
        endTime: filters?.endTime,
        domain: filters?.domain,
      });
    }
    return dbQueries.getRecent(limit);
  }

  getQueriesCount(
    clientIp?: string,
    filters?: {
      type?: string;
      blocked?: boolean;
      startTime?: number;
      endTime?: number;
      domain?: string;
    },
  ): number {
    if (clientIp || filters) {
      return dbQueries.getFilteredCount({
        clientIp,
        type: filters?.type,
        blocked: filters?.blocked,
        startTime: filters?.startTime,
        endTime: filters?.endTime,
        domain: filters?.domain,
      });
    }
    return dbQueries.getTotalCount();
  }

  getStats(): DNSStats & {
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
  } {
    // Get all stats from database (persistent)
    const dbStats = dbQueries.getStats();
    const dbClients = dbQueries.getClients(50);
    const queryTypeBreakdown = dbQueries.getQueryTypeBreakdown();
    const blockPercentageOverTime = dbQueries.getBlockPercentageOverTime(30);
    const topAdvertisers = dbQueries.getTopAdvertisers(20);

    return {
      totalQueries: dbStats.totalQueries,
      blockedQueries: dbStats.blockedQueries,
      allowedQueries: dbStats.allowedQueries,
      topDomains: new Map(), // Not used, kept for interface compatibility
      topBlocked: new Map(), // Not used, kept for interface compatibility
      topClients: new Map(), // Not used, kept for interface compatibility
      blocklistSize: this.blocklist.size,
      topDomainsArray: dbStats.topDomains,
      topBlockedArray: dbStats.topBlocked,
      topClientsArray: dbClients,
      queryTypeBreakdown,
      blockPercentageOverTime,
      topAdvertisers,
    };
  }

  addToBlocklist(domain: string) {
    const lower = domain.toLowerCase();
    this.blocklist.add(lower);
    // Persist to database
    dbManualBlocklist.add(lower);
  }

  removeFromBlocklist(domain: string) {
    const lower = domain.toLowerCase();
    this.blocklist.delete(lower);
    // Remove from database
    dbManualBlocklist.remove(lower);
  }

  setBlockingEnabled(enabled: boolean) {
    this.blockingEnabled = enabled;
    if (enabled) {
      this.blockingDisabledUntil = null;
    }
  }

  setBlockingDisabledFor(seconds: number) {
    this.blockingEnabled = false;
    this.blockingDisabledUntil = Date.now() + seconds * 1000;
  }

  getBlockingStatus() {
    return {
      enabled: this.blockingEnabled,
      disabledUntil: this.blockingDisabledUntil,
      isTemporarilyDisabled: this.blockingDisabledUntil !== null && Date.now() < this.blockingDisabledUntil,
    };
  }

  setUpstreamDNS(dns: string) {
    this.upstreamDNS = dns;
    dbSettings.set('upstreamDNS', dns);
  }

  getUpstreamDNS(): string {
    return this.upstreamDNS;
  }

  getPort(): number {
    return this.port;
  }

  setRateLimitEnabled(enabled: boolean) {
    this.rateLimitEnabled = enabled;
    dbSettings.set('rateLimitEnabled', enabled.toString());
  }

  setRateLimitMaxQueries(maxQueries: number) {
    this.rateLimitMaxQueries = maxQueries;
    dbSettings.set('rateLimitMaxQueries', maxQueries.toString());
  }

  setRateLimitWindowMs(windowMs: number) {
    this.rateLimitWindowMs = windowMs;
    dbSettings.set('rateLimitWindowMs', windowMs.toString());
  }

  unblockRateLimitedClient(clientIp: string) {
    dbRateLimits.unblock(clientIp);
  }

  async start() {
    this.server.on('message', async (msg, rinfo) => {
      const startTime = Date.now();
      const parsed = this.parseDNSQuery(msg);

      if (!parsed) {
        console.error('Failed to parse DNS query');
        return;
      }

      const { id, domain, type } = parsed;
      const clientIp = rinfo.address;

      // Check rate limiting first
      if (this.rateLimitEnabled && clientIp) {
        const rateLimitResult = dbRateLimits.checkRateLimit(clientIp, this.rateLimitMaxQueries, this.rateLimitWindowMs);
        if (!rateLimitResult.allowed) {
          // Rate limited - return NXDOMAIN
          const response = this.createDNSResponse(msg, true);
          this.server.send(response, rinfo.port, rinfo.address);
          console.log(`⏱️ Rate limited: ${clientIp}`);
          return;
        }
      }

      // Check local DNS first
      const localDNS = dbLocalDNS.getByDomain(domain);
      const blockResult = this.isBlocked(domain, clientIp);
      const blocked = blockResult.blocked;

      const queryId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const query: DNSQuery = {
        id: queryId,
        domain,
        type: type === 1 ? 'A' : type === 28 ? 'AAAA' : `TYPE${type}`,
        blocked,
        timestamp: Date.now(),
        clientIp,
        blockReason: blockResult.reason,
      };

      try {
        let response: Buffer;

        if (blocked) {
          if (this.blockPageEnabled && (type === 1 || type === 28)) {
            // Return block page IP instead of NXDOMAIN
            const blockIP = type === 1 ? this.blockPageIP : this.getBlockPageIPv6();
            response = this.createDNSResponseWithIP(msg, blockIP, type);
            console.log(`🚫 Blocked (block page): ${domain} -> ${blockIP}`);
          } else {
            response = this.createDNSResponse(msg, true);
            console.log(`🚫 Blocked: ${domain}`);
          }
        } else if (localDNS && (type === 1 || type === 28)) {
          // Check if local DNS type matches query type
          const localType = localDNS.type === 'A' ? 1 : 28;
          if (localType === type) {
            response = this.createDNSResponseWithIP(msg, localDNS.ip, type);
            console.log(`🏠 Local DNS: ${domain} -> ${localDNS.ip}`);
          } else {
            // Type mismatch, check cache first
            const cached = this.getCachedResponse(domain, type);
            if (cached) {
              response = cached;
              console.log(`💾 Cached: ${domain}`);
            } else {
              response = await this.forwardQuery(msg, domain, clientIp);
              this.setCachedResponse(domain, type, response);
              console.log(`✅ Allowed: ${domain}`);
            }
          }
        } else {
          // Check cache first
          const cached = this.getCachedResponse(domain, type);
          if (cached) {
            response = cached;
            console.log(`💾 Cached: ${domain}`);
          } else {
            response = await this.forwardQuery(msg, domain, clientIp);
            this.setCachedResponse(domain, type, response);
            console.log(`✅ Allowed: ${domain}`);
          }
        }

        query.responseTime = Date.now() - startTime;
        this.addQuery(query);
        // Stats are now calculated from database, no need to update in-memory stats

        this.server.send(response, rinfo.port, rinfo.address);
      } catch (error) {
        console.error(`Error handling query for ${domain}:`, error);
        const errorResponse = this.createDNSResponse(msg, true);
        this.server.send(errorResponse, rinfo.port, rinfo.address);
      }
    });

    this.server.on('error', (err) => {
      console.error('DNS server error:', err);
    });

    return new Promise<void>((resolve) => {
      this.server.bind(this.port, () => {
        console.log(`🚀 DNS server running on port ${this.port}`);
        resolve();
      });
    });
  }

  stop() {
    this.server.close();
  }
}
