import dgram from 'dgram';
import net from 'net';
import tls from 'tls';
import { join, resolve, dirname, basename } from 'path';
import { fileURLToPath } from 'url';
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
  dbCache,
} from './db.js';
import { logger } from './logger.js';

export interface DNSQuery {
  id: string;
  domain: string;
  type: string;
  blocked: boolean;
  timestamp: number;
  responseTime?: number;
  clientIp?: string;
  blockReason?: string; // e.g., "blocklist", "regex", "client-blocklist", "group-blocklist"
  cached?: boolean; // Whether this query was served from cache
}

export interface DNSStats {
  totalQueries: number;
  blockedQueries: number;
  allowedQueries: number;
  cachedQueries: number;
  topDomains: Map<string, number>;
  topBlocked: Map<string, number>;
  topClients: Map<string, number>;
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

interface CachedDNSResponse {
  response: Buffer;
  expiresAt: number;
  domain: string;
  type: number;
}

export class DNSServer {
  private server: dgram.Socket;
  private tcpServer: net.Server;
  private dotServer: tls.Server | null = null;
  private blocklist: Set<string> = new Set();
  private blocklistUrls: string[] = [];
  private blockingEnabled: boolean = true;
  private blockingDisabledUntil: number | null = null;
  private upstreamDNS: string;
  private port: number;
  private dotPort: number;
  private rateLimitEnabled: boolean = false;
  private rateLimitMaxQueries: number = 1000;
  private rateLimitWindowMs: number = 60000; // 1 minute
  private cache: Map<string, CachedDNSResponse> = new Map();
  private cacheEnabled: boolean = true;
  private cacheTTL: number = 300; // 5 minutes default
  private blockPageEnabled: boolean = false;
  private blockPageIP: string = '0.0.0.0'; // Default block IP
  private startTime: number = Date.now();
  private queryCount: number = 0;
  private errorCount: number = 0;
  private lastQueryTime: number = 0;
  private queryRateHistory: number[] = []; // Queries per second for last 60 seconds

  constructor() {
    this.server = dgram.createSocket('udp4');
    this.tcpServer = net.createServer();
    this.dotPort = parseInt(dbSettings.get('dotPort', '853'), 10);
    this.upstreamDNS = dbSettings.get('upstreamDNS', '1.1.1.1');
    this.port = parseInt(dbSettings.get('dnsPort', '53'), 10);
    this.rateLimitEnabled = dbSettings.get('rateLimitEnabled', 'false') === 'true';
    this.rateLimitMaxQueries = parseInt(dbSettings.get('rateLimitMaxQueries', '1000'), 10);
    this.rateLimitWindowMs = parseInt(dbSettings.get('rateLimitWindowMs', '60000'), 10);
    this.cacheEnabled = dbSettings.get('cacheEnabled', 'true') === 'true';
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

    // Load cache from database on startup
    if (this.cacheEnabled) {
      this.loadCacheFromDB();
    }
  }

  private getCacheKey(domain: string, type: number): string {
    return `${domain.toLowerCase()}:${type}`;
  }

  private getCachedResponse(domain: string, type: number): Buffer | null {
    if (!this.cacheEnabled) return null;

    const key = this.getCacheKey(domain, type);

    // First check in-memory cache
    const cached = this.cache.get(key);
    if (cached) {
      if (Date.now() > cached.expiresAt) {
        this.cache.delete(key);
        dbCache.delete(domain, type);
        return null;
      }
      return cached.response;
    }

    // If not in memory, check database
    const dbResponse = dbCache.get(domain, type);
    if (dbResponse) {
      // Load into memory cache for faster access
      const dbCached = dbCache.getAll().find((c) => c.domain === domain.toLowerCase() && c.type === type);
      if (dbCached) {
        this.cache.set(key, {
          response: dbResponse,
          expiresAt: dbCached.expiresAt,
          domain: domain.toLowerCase(),
          type,
        });
      }
      return dbResponse;
    }

    return null;
  }

  /**
   * Extract the minimum TTL from a DNS response.
   * Returns the minimum TTL found in answer records, or null if parsing fails.
   */
  private extractTTLFromResponse(response: Buffer): number | null {
    try {
      if (response.length < 12) return null;

      const anCount = response.readUInt16BE(6);
      if (anCount === 0) return null;

      let offset = 12;
      // Skip question section
      while (offset < response.length && response[offset] !== 0) {
        const length = response[offset];
        offset += length + 1;
      }
      if (offset + 4 > response.length) return null;
      offset += 5; // Skip null terminator and QTYPE/QCLASS

      let minTTL: number | null = null;

      // Parse answer section to find minimum TTL
      for (let i = 0; i < anCount && offset < response.length; i++) {
        // Parse domain name (can be compressed)
        while (offset < response.length) {
          const labelLen = response[offset];
          if (labelLen === 0) {
            offset += 1;
            break;
          } else if ((labelLen & 0xc0) === 0xc0) {
            // Compression pointer
            offset += 2;
            break;
          } else {
            offset += labelLen + 1;
          }
        }

        if (offset + 10 > response.length) break;

        // Read TTL (4 bytes at offset + 4)
        const ttl = response.readUInt32BE(offset + 4);
        if (minTTL === null || ttl < minTTL) {
          minTTL = ttl;
        }

        // Skip TYPE, CLASS, TTL, and DATA LENGTH
        const dataLength = response.readUInt16BE(offset + 8);
        offset += 10 + dataLength;
      }

      return minTTL;
    } catch (error) {
      logger.error('Error extracting TTL from response', error instanceof Error ? error : new Error(String(error)));
      return null;
    }
  }

  private setCachedResponse(domain: string, type: number, response: Buffer) {
    if (!this.cacheEnabled) return;

    const key = this.getCacheKey(domain, type);

    // Extract TTL from DNS response, or fall back to default (5 minutes)
    const responseTTL = this.extractTTLFromResponse(response);
    const DEFAULT_TTL = 300; // 5 minutes fallback if TTL extraction fails
    const ttl = responseTTL !== null ? responseTTL : DEFAULT_TTL;

    const expiresAt = Date.now() + ttl * 1000;

    // Store in memory cache
    this.cache.set(key, {
      response,
      expiresAt,
      domain: domain.toLowerCase(),
      type,
    });

    // Persist to database
    dbCache.set(domain.toLowerCase(), type, response, expiresAt);
  }

  private cleanupCache() {
    const now = Date.now();
    for (const [key, cached] of this.cache.entries()) {
      if (now > cached.expiresAt) {
        this.cache.delete(key);
        dbCache.delete(cached.domain, cached.type);
      }
    }

    // Also cleanup expired entries from database
    dbCache.cleanupExpired();
  }

  clearCache() {
    this.cache.clear();
    dbCache.clear();
  }

  /**
   * Load cache entries from database on startup.
   * Only loads entries that haven't expired.
   */
  private loadCacheFromDB() {
    try {
      const cachedEntries = dbCache.getAll();
      const now = Date.now();
      let loaded = 0;
      let expired = 0;

      for (const entry of cachedEntries) {
        if (now > entry.expiresAt) {
          // Entry expired, delete it
          dbCache.delete(entry.domain, entry.type);
          expired++;
        } else {
          // Entry still valid, load into memory
          const key = this.getCacheKey(entry.domain, entry.type);
          this.cache.set(key, {
            response: entry.response,
            expiresAt: entry.expiresAt,
            domain: entry.domain,
            type: entry.type,
          });
          loaded++;
        }
      }

      if (loaded > 0 || expired > 0) {
        logger.info('Loaded cache entries from database', { loaded, expired });
      }
    } catch (error) {
      logger.error('Error loading cache from database', error instanceof Error ? error : new Error(String(error)));
    }
  }

  getCacheStats() {
    return {
      size: this.cache.size,
      enabled: this.cacheEnabled,
    };
  }

  setCacheEnabled(enabled: boolean) {
    this.cacheEnabled = enabled;
    dbSettings.set('cacheEnabled', enabled.toString());
    if (!enabled) {
      this.cache.clear();
    }
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
    logger.info('Loading blocklists...');
    this.blocklistUrls = urls;
    // Clear existing blocklist before loading new ones
    this.blocklist.clear();

    // Load manually added domains first
    const manualDomains = dbManualBlocklist.getDomains();
    manualDomains.forEach((domain) => this.blocklist.add(domain));
    logger.info('Loaded manually added domains', { count: manualDomains.size });

    // Load domains from adlists
    for (const url of urls) {
      try {
        const response = await fetch(url);
        const text = await response.text();
        const domains = this.parseBlocklist(text);
        domains.forEach((domain) => this.blocklist.add(domain));
        logger.info('Loaded domains from blocklist', { count: domains.length, url });
      } catch (error) {
        logger.error('Failed to load blocklist', error instanceof Error ? error : new Error(String(error)), { url });
      }
    }
    logger.info('Total blocked domains', { count: this.blocklist.size });
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

      // Parse domain name with proper bounds checking
      while (offset < msg.length) {
        const length = msg[offset];

        // Check for end of domain name
        if (length === 0) {
          offset++;
          break;
        }

        // Check for compression pointer (starts with 11 in high bits)
        if ((length & 0xc0) === 0xc0) {
          // Compression pointer - skip it and break
          offset += 2;
          break;
        }

        // Validate we have enough bytes for this label
        if (offset + 1 + length > msg.length) {
          return null; // Malformed: label extends beyond buffer
        }

        if (domain.length > 0) domain += '.';
        domain += msg.toString('utf8', offset + 1, offset + 1 + length);
        offset += length + 1;

        // Safety check: prevent infinite loops
        if (offset > msg.length || domain.length > 255) {
          return null;
        }
      }

      // Validate we have enough bytes for QTYPE and QCLASS (4 bytes total)
      if (offset + 4 > msg.length) {
        return null; // Malformed: not enough bytes for QTYPE/QCLASS
      }

      const type = msg.readUInt16BE(offset);

      return { id, domain, type };
    } catch (error) {
      logger.error('Error parsing DNS query', error instanceof Error ? error : new Error(String(error)));
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

  private async forwardQuery(msg: Buffer, domain: string, clientIp?: string, useTcp: boolean = false): Promise<Buffer> {
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

      if (useTcp) {
        // Forward over TCP
        const isIPv6 = targetDNS.includes(':');
        const socket = net.createConnection({ host: targetDNS, port: 53, family: isIPv6 ? 6 : 4 });

        const timeout = setTimeout(() => {
          socket.destroy();
          reject(new Error('DNS query timeout'));
        }, 5000);

        // TCP DNS messages have a 2-byte length prefix
        const lengthPrefix = Buffer.allocUnsafe(2);
        lengthPrefix.writeUInt16BE(msg.length, 0);
        const tcpMsg = Buffer.concat([lengthPrefix, msg]);

        let responseLength: number | null = null;
        let responseBuffer = Buffer.alloc(0);

        socket.on('data', (data: Buffer) => {
          responseBuffer = Buffer.concat([responseBuffer, data]);

          if (responseLength === null && responseBuffer.length >= 2) {
            responseLength = responseBuffer.readUInt16BE(0);
          }

          if (responseLength !== null && responseBuffer.length >= responseLength + 2) {
            clearTimeout(timeout);
            socket.destroy();
            // Extract the DNS message (skip the 2-byte length prefix)
            const dnsResponse = responseBuffer.slice(2, responseLength + 2);
            resolve(dnsResponse);
          }
        });

        socket.on('error', (err) => {
          clearTimeout(timeout);
          socket.destroy();
          reject(err);
        });

        socket.on('connect', () => {
          socket.write(tcpMsg);
        });
      } else {
        // Forward over UDP (existing logic)
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
      }
    });
  }

  private addQuery(query: DNSQuery) {
    try {
      dbQueries.insert(query);
    } catch (error) {
      logger.error('Failed to save query to database', error instanceof Error ? error : new Error(String(error)), {
        queryId: query.id,
        domain: query.domain,
      });
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
      domainPattern?: string;
      cached?: boolean;
      blockReason?: string;
      minResponseTime?: number;
      maxResponseTime?: number;
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
        domainPattern: filters?.domainPattern,
        cached: filters?.cached,
        blockReason: filters?.blockReason,
        minResponseTime: filters?.minResponseTime,
        maxResponseTime: filters?.maxResponseTime,
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
      domainPattern?: string;
      cached?: boolean;
      blockReason?: string;
      minResponseTime?: number;
      maxResponseTime?: number;
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
        domainPattern: filters?.domainPattern,
        cached: filters?.cached,
        blockReason: filters?.blockReason,
        minResponseTime: filters?.minResponseTime,
        maxResponseTime: filters?.maxResponseTime,
      });
    }
    return dbQueries.getTotalCount();
  }

  getHealth(): {
    status: 'healthy' | 'degraded' | 'unhealthy';
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
      doh: boolean;
    };
  } {
    const errorRate = this.queryCount > 0 ? (this.errorCount / this.queryCount) * 100 : 0;
    const queriesPerSecond = this.queryRateHistory.length;
    const uptimeMinutesTotal = Math.floor((Date.now() - this.startTime) / 60000);

    // Determine health status
    // Server is healthy if:
    // - Error rate is low (< 5%)
    // - OR if no queries yet but server just started (< 10 minutes) - this is normal
    // Server is degraded if:
    // - Error rate is moderate (5-10%)
    // - OR no queries received but server has been up for a while (could indicate network issues)
    // Server is unhealthy if:
    // - Error rate is high (> 10%) AND we've received queries (indicates actual problems)
    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';

    if (this.queryCount > 0) {
      // We have query data, use error rate to determine health
      if (errorRate > 10) {
        status = 'unhealthy';
      } else if (errorRate > 5) {
        status = 'degraded';
      }
    } else {
      // No queries yet - check if this is normal (just started) or concerning (been up a while)
      if (uptimeMinutesTotal > 10) {
        // Server has been up for more than 10 minutes with no queries - might indicate network issues
        status = 'degraded';
      }
      // Otherwise, server is healthy (just started, waiting for queries)
    }

    return {
      status,
      startTime: new Date(this.startTime).toISOString(),
      queryCount: this.queryCount,
      errorCount: this.errorCount,
      errorRate: Math.round(errorRate * 100) / 100,
      queriesPerSecond,
      lastQueryTime: this.lastQueryTime ? new Date(this.lastQueryTime).toISOString() : null,
      servers: {
        udp: this.port > 0, // UDP server is considered running if port is set
        tcp: this.tcpServer.listening,
        dot: this.dotServer !== null,
        doh: true, // DoH is handled by HTTP server, always available if HTTP server is running
      },
    };
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
      cachedQueries: dbStats.cachedQueries,
      topDomains: new Map(), // Not used, kept for interface compatibility
      topBlocked: new Map(), // Not used, kept for interface compatibility
      topClients: new Map(), // Not used, kept for interface compatibility
      performance: dbStats.performance,
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

  async handleDNSQuery(msg: Buffer, clientIp: string, useTcp: boolean = false): Promise<Buffer> {
    const startTime = Date.now();
    this.queryCount++;
    this.lastQueryTime = startTime;

    // Update query rate history (keep last 60 seconds)
    const now = Date.now();
    this.queryRateHistory = this.queryRateHistory.filter((time) => now - time < 60000);
    this.queryRateHistory.push(now);

    const parsed = this.parseDNSQuery(msg);

    if (!parsed) {
      this.errorCount++;
      throw new Error('Failed to parse DNS query');
    }

    const { id, domain, type } = parsed;

    // Check rate limiting first
    if (this.rateLimitEnabled && clientIp) {
      const rateLimitResult = dbRateLimits.checkRateLimit(clientIp, this.rateLimitMaxQueries, this.rateLimitWindowMs);
      if (!rateLimitResult.allowed) {
        // Rate limited - return NXDOMAIN
        logger.warn('Rate limited', { clientIp });
        return this.createDNSResponse(msg, true);
      }
    }

    // Check local DNS first
    const localDNS = dbLocalDNS.getByDomain(domain);
    const blockResult = this.isBlocked(domain, clientIp);
    const blocked = blockResult.blocked;

    const queryId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    let isCached = false;

    let response: Buffer;

    if (blocked) {
      if (this.blockPageEnabled && (type === 1 || type === 28)) {
        // Return block page IP instead of NXDOMAIN
        const blockIP = type === 1 ? this.blockPageIP : this.getBlockPageIPv6();
        response = this.createDNSResponseWithIP(msg, blockIP, type);
        logger.info('Blocked (block page)', { domain, blockIP, type });
      } else {
        response = this.createDNSResponse(msg, true);
        logger.info('Blocked', { domain, blockReason: blockResult.reason });
      }
    } else if (localDNS && (type === 1 || type === 28)) {
      // Check if local DNS type matches query type
      const localType = localDNS.type === 'A' ? 1 : 28;
      if (localType === type) {
        response = this.createDNSResponseWithIP(msg, localDNS.ip, type);
        logger.debug('Local DNS', { domain, ip: localDNS.ip, type });
      } else {
        // Type mismatch, check cache first
        const cached = this.getCachedResponse(domain, type);
        if (cached) {
          response = cached;
          isCached = true;
          logger.debug('Cached', { domain, type });
        } else {
          try {
            response = await this.forwardQuery(msg, domain, clientIp, useTcp);
            this.setCachedResponse(domain, type, response);
            logger.debug('Allowed', { domain, type });
          } catch (error) {
            this.errorCount++;
            throw error;
          }
        }
      }
    } else {
      // Check cache first
      const cached = this.getCachedResponse(domain, type);
      if (cached) {
        response = cached;
        isCached = true;
        logger.debug('Cached', { domain, type });
      } else {
        try {
          response = await this.forwardQuery(msg, domain, clientIp, useTcp);
          this.setCachedResponse(domain, type, response);
          logger.debug('Allowed', { domain, type });
        } catch (error) {
          this.errorCount++;
          throw error;
        }
      }
    }

    const query: DNSQuery = {
      id: queryId,
      domain,
      type: type === 1 ? 'A' : type === 28 ? 'AAAA' : `TYPE${type}`,
      blocked,
      timestamp: Date.now(),
      clientIp,
      blockReason: blockResult.reason,
      cached: isCached,
      responseTime: Date.now() - startTime,
    };

    this.addQuery(query);

    return response;
  }

  private setupTCPSocket(socket: net.Socket | tls.TLSSocket) {
    const clientIp = socket.remoteAddress || 'unknown';
    let buffer = Buffer.alloc(0);
    let expectedLength: number | null = null;

    socket.on('data', async (data: Buffer) => {
      buffer = Buffer.concat([buffer, data]);

      // TCP DNS messages have a 2-byte length prefix
      while (buffer.length >= 2) {
        if (expectedLength === null) {
          expectedLength = buffer.readUInt16BE(0);
        }

        // Check if we have the complete message (length prefix + message)
        if (buffer.length >= expectedLength + 2) {
          // Extract the DNS message (skip the 2-byte length prefix)
          const dnsMsg = buffer.slice(2, expectedLength + 2);
          // Remove processed data from buffer
          buffer = buffer.slice(expectedLength + 2);
          expectedLength = null;

          try {
            const response = await this.handleDNSQuery(dnsMsg, clientIp, true);

            // Send response with length prefix
            const responseLength = Buffer.allocUnsafe(2);
            responseLength.writeUInt16BE(response.length, 0);
            socket.write(Buffer.concat([responseLength, response]));
          } catch (error) {
            logger.error('Error handling DNS query', error instanceof Error ? error : new Error(String(error)), {
              clientIp,
              useTcp: true,
            });
            const errorResponse = this.createDNSResponse(dnsMsg, true);
            const errorLength = Buffer.allocUnsafe(2);
            errorLength.writeUInt16BE(errorResponse.length, 0);
            socket.write(Buffer.concat([errorLength, errorResponse]));
          }
        } else {
          // Wait for more data
          break;
        }
      }
    });

    socket.on('error', (err) => {
      logger.error('Connection error', err instanceof Error ? err : new Error(String(err)));
    });

    socket.on('close', () => {
      // Connection closed
    });
  }

  private async startUDP(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.server.on('message', async (msg, rinfo) => {
        try {
          const response = await this.handleDNSQuery(msg, rinfo.address, false);
          this.server.send(response, rinfo.port, rinfo.address);
        } catch (error) {
          logger.error('Error handling UDP query', error instanceof Error ? error : new Error(String(error)), {
            clientIp: rinfo.address,
          });
          const errorResponse = this.createDNSResponse(msg, true);
          this.server.send(errorResponse, rinfo.port, rinfo.address);
        }
      });

      this.server.on('error', (err) => {
        logger.error('UDP DNS server error', err instanceof Error ? err : new Error(String(err)));
        reject(err);
      });

      this.server.bind(this.port, () => {
        logger.info('DNS server (UDP) running', { port: this.port });
        resolve();
      });
    });
  }

  private async startTCP(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.tcpServer.on('connection', (socket) => {
        this.setupTCPSocket(socket);
      });

      this.tcpServer.on('error', (err) => {
        logger.error('TCP DNS server error', err instanceof Error ? err : new Error(String(err)));
        reject(err);
      });

      this.tcpServer.listen(this.port, () => {
        logger.info('DNS server (TCP) running', { port: this.port });
        resolve();
      });
    });
  }

  private async startDoT(): Promise<void> {
    const dotEnabled = dbSettings.get('dotEnabled', 'false') === 'true';
    if (!dotEnabled) {
      return Promise.resolve();
    }

    try {
      let certPath = dbSettings.get('dotCertPath', '').trim();
      let keyPath = dbSettings.get('dotKeyPath', '').trim();

      if (!certPath || !keyPath) {
        logger.warn('DoT server disabled: TLS certificates not configured', {
          certPath: certPath || 'not set',
          keyPath: keyPath || 'not set',
        });
        return Promise.resolve();
      }

      // Normalize paths (remove ./ prefix if present)
      if (certPath.startsWith('./')) {
        certPath = certPath.substring(2);
      }
      if (keyPath.startsWith('./')) {
        keyPath = keyPath.substring(2);
      }

      const fs = await import('fs');
      const { existsSync } = fs;

      // Find project root by walking up from current directory
      // Look for a directory that contains both server/ and client/ directories
      let projectRoot = process.cwd();
      let currentDir = projectRoot;
      let found = false;

      // Walk up to find project root (contains server/ and client/ directories)
      for (let i = 0; i < 5; i++) {
        const serverDir = resolve(currentDir, 'server');
        const clientDir = resolve(currentDir, 'client');
        if (existsSync(serverDir) && existsSync(clientDir)) {
          projectRoot = currentDir;
          found = true;
          break;
        }
        const parent = resolve(currentDir, '..');
        if (parent === currentDir) break; // Reached filesystem root
        currentDir = parent;
      }

      // If not found, check if current directory is 'server', then go up one level
      if (!found) {
        const currentBasename = basename(projectRoot);
        if (currentBasename === 'server') {
          projectRoot = resolve(projectRoot, '..');
          found = true;
        }
      }

      logger.debug('Detected project root', { projectRoot, cwd: process.cwd() });

      // Resolve paths relative to project root
      // If path is already absolute, resolve() will return it as-is
      if (!certPath.startsWith('/')) {
        certPath = resolve(projectRoot, certPath);
      }
      if (!keyPath.startsWith('/')) {
        keyPath = resolve(projectRoot, keyPath);
      }

      // Check if files exist before trying to read them
      if (!existsSync(certPath)) {
        logger.error('Certificate file not found', new Error(`Certificate file not found: ${certPath}`), {
          certPath,
          originalPath: dbSettings.get('dotCertPath', ''),
          projectRoot,
        });
        throw new Error(`Certificate file not found: ${certPath}`);
      }
      if (!existsSync(keyPath)) {
        logger.error('Private key file not found', new Error(`Private key file not found: ${keyPath}`), {
          keyPath,
          originalPath: dbSettings.get('dotKeyPath', ''),
          projectRoot,
        });
        throw new Error(`Private key file not found: ${keyPath}`);
      }

      logger.debug('Using TLS certificates', { certPath, keyPath });

      const tlsOptions = {
        cert: fs.readFileSync(certPath),
        key: fs.readFileSync(keyPath),
        rejectUnauthorized: false, // Allow self-signed certs for now
      };

      return new Promise<void>((resolve, reject) => {
        this.dotServer = tls.createServer(tlsOptions, (socket) => {
          this.setupTCPSocket(socket);
        });

        this.dotServer.on('error', (err) => {
          logger.error('DoT server error', err instanceof Error ? err : new Error(String(err)));
          reject(err);
        });

        this.dotServer.listen(this.dotPort, () => {
          logger.info('DNS server (DoT) running', { port: this.dotPort });
          resolve();
        });
      });
    } catch (error) {
      logger.warn('DoT server disabled', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return Promise.resolve();
    }
  }

  async start() {
    // Start all servers independently
    const servers: Promise<void>[] = [];

    // Always start UDP (core DNS functionality)
    servers.push(this.startUDP());

    // Always start TCP (standard DNS over TCP)
    servers.push(this.startTCP());

    // Start DoT if enabled (optional)
    servers.push(this.startDoT());

    // Wait for all servers to start (or fail gracefully)
    await Promise.allSettled(servers);
  }

  stop() {
    this.server.close();
    this.tcpServer.close();
    if (this.dotServer) {
      this.dotServer.close();
    }
  }

  async stopDoT(): Promise<void> {
    if (this.dotServer) {
      return new Promise<void>((resolve) => {
        this.dotServer!.close(() => {
          logger.info('DNS server (DoT) stopped');
          this.dotServer = null;
          resolve();
        });
      });
    }
    return Promise.resolve();
  }

  async restartDoT(): Promise<void> {
    logger.info('Restarting DoT server...');

    // Stop existing DoT server if running
    await this.stopDoT();

    // Update dotPort from settings
    this.dotPort = parseInt(dbSettings.get('dotPort', '853'), 10);
    logger.debug('DoT port set', { port: this.dotPort });

    // Start DoT server if enabled
    const dotEnabled = dbSettings.get('dotEnabled', 'false') === 'true';
    logger.debug('DoT enabled', { enabled: dotEnabled });

    if (dotEnabled) {
      await this.startDoT();
    } else {
      logger.debug('DoT is disabled, not starting server');
    }
  }
}
