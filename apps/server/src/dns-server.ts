import dgram from 'dgram';
import net from 'net';
import tls from 'tls';
import { resolve, basename } from 'path';
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
  dbZones,
  dbZoneRecords,
  dbZoneKeys,
  dbUpstreamMetrics,
} from './db.js';
import { logger } from './logger.js';
import { validateDNSSEC } from './dnssec-validator.js';
import { signRRset, generateDNSKEYRecord } from './dnssec-signer.js';
import { handleDNSUpdate } from './ddns-handler.js';
import { handleAXFR, handleIXFR } from './zone-transfer-handler.js';
import { recordDNSQuery, recordCacheMetrics, recordUpstreamMetrics, recordRateLimitMetrics } from './otel-metrics.js';

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
  rcode?: number; // DNS response code: 0=NOERROR, 1=FORMERR, 2=SERVFAIL, 3=NXDOMAIN, etc.
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
  // @ts-ignore - QUIC is experimental in Node.js
  private doqServer: any | null = null;
  private blocklist: Set<string> = new Set();
  private blocklistUrls: string[] = [];
  private blockingEnabled: boolean = true;
  private blockingDisabledUntil: number | null = null;
  private upstreamDNS: string;
  private upstreamDNSList: string[] = [];
  private upstreamHealth: Map<string, { failures: number; lastFailure: number; disabledUntil: number }> = new Map();
  private upstreamMaxFailures: number = 3;
  private upstreamFailureWindow: number = 60000; // 1 minute
  private upstreamDisableDuration: number = 300000; // 5 minutes
  private port: number;
  private dotPort: number;
  private doqPort: number;
  private bindAddress: string;
  private rateLimitEnabled: boolean = false;
  private rateLimitMaxQueries: number = 1000;
  private rateLimitWindowMs: number = 60000; // 1 minute
  private cache: Map<string, CachedDNSResponse> = new Map();
  private cacheEnabled: boolean = true;
  private _cacheTTL: number = 300; // 5 minutes default
  private serveStaleEnabled: boolean = false;
  private serveStaleMaxAge: number = 604800; // 7 days in seconds
  private prefetchEnabled: boolean = false;
  private prefetchThreshold: number = 0.8; // Prefetch when 80% of TTL has passed
  private prefetchMinQueries: number = 10; // Minimum queries to be eligible for prefetching
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
    this.doqPort = parseInt(dbSettings.get('doqPort', '853'), 10);
    this.upstreamDNS = dbSettings.get('upstreamDNS', '1.1.1.1');
    // Parse multiple upstream DNS servers (comma-separated)
    const upstreamDNSStr = dbSettings.get('upstreamDNS', '1.1.1.1');
    this.upstreamDNSList = upstreamDNSStr
      .split(',')
      .map((dns) => dns.trim())
      .filter((dns) => dns.length > 0);
    if (this.upstreamDNSList.length === 0) {
      this.upstreamDNSList = ['1.1.1.1'];
    }
    this.port = parseInt(dbSettings.get('dnsPort', '53'), 10);
    // Check environment variable first, then database setting, then default to localhost for safety
    this.bindAddress = process.env.DNS_BIND_ADDRESS || dbSettings.get('dnsBindAddress', '127.0.0.1');
    this.rateLimitEnabled = dbSettings.get('rateLimitEnabled', 'false') === 'true';
    this.rateLimitMaxQueries = parseInt(dbSettings.get('rateLimitMaxQueries', '1000'), 10);
    this.rateLimitWindowMs = parseInt(dbSettings.get('rateLimitWindowMs', '60000'), 10);
    this.cacheEnabled = dbSettings.get('cacheEnabled', 'true') === 'true';
    this.serveStaleEnabled = dbSettings.get('serveStaleEnabled', 'false') === 'true';
    this.serveStaleMaxAge = parseInt(dbSettings.get('serveStaleMaxAge', '604800'), 10); // 7 days default
    this.prefetchEnabled = dbSettings.get('prefetchEnabled', 'false') === 'true';
    this.prefetchThreshold = parseFloat(dbSettings.get('prefetchThreshold', '0.8')); // 80% of TTL
    this.prefetchMinQueries = parseInt(dbSettings.get('prefetchMinQueries', '10'), 10);
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

    // Prefetch popular domains periodically
    if (this.prefetchEnabled) {
      setInterval(() => {
        this.prefetchPopularDomains().catch((error) => {
          logger.error('Error prefetching domains', {
            error: error instanceof Error ? error : new Error(String(error)),
          });
        });
      }, 300000); // Every 5 minutes
    }

    // Load cache from database on startup
    if (this.cacheEnabled) {
      this.loadCacheFromDB();
    }
  }

  private getCacheKey(domain: string, type: number): string {
    return `${domain.toLowerCase()}:${type}`;
  }

  private getCachedResponse(domain: string, type: number, allowStale: boolean = false): Buffer | null {
    if (!this.cacheEnabled) return null;

    const key = this.getCacheKey(domain, type);
    const now = Date.now();

    // First check in-memory cache
    const cached = this.cache.get(key);
    if (cached) {
      if (now > cached.expiresAt) {
        // Entry expired
        if (allowStale && this.serveStaleEnabled) {
          // Check if stale entry is within max age
          const ageSeconds = (now - cached.expiresAt) / 1000;
          if (ageSeconds <= this.serveStaleMaxAge) {
            logger.debug('Serving stale cache entry', { domain, type, ageSeconds: Math.floor(ageSeconds) });
            return cached.response;
          }
        }
        // Too old or serve stale disabled, delete it
        this.cache.delete(key);
        dbCache.delete(domain, type);
        return null;
      }
      return cached.response;
    }

    // If not in memory, check database
    // For stale entries, we need to query directly since dbCache.get() filters expired entries
    if (allowStale && this.serveStaleEnabled) {
      const dbCached = dbCache.getAll().find((c) => c.domain === domain.toLowerCase() && c.type === type);
      if (dbCached) {
        if (now > dbCached.expiresAt) {
          // Entry expired - check if within max age
          const ageSeconds = (now - dbCached.expiresAt) / 1000;
          if (ageSeconds <= this.serveStaleMaxAge) {
            logger.debug('Serving stale cache entry from database', { domain, type, ageSeconds: Math.floor(ageSeconds) });
            // Load into memory for faster access
            this.cache.set(key, {
              response: dbCached.response,
              expiresAt: dbCached.expiresAt,
              domain: domain.toLowerCase(),
              type,
            });
            return dbCached.response;
          }
          // Too old, delete it
          dbCache.delete(domain, type);
          return null;
        }
        // Still valid, load into memory
        this.cache.set(key, {
          response: dbCached.response,
          expiresAt: dbCached.expiresAt,
          domain: domain.toLowerCase(),
          type,
        });
        return dbCached.response;
      }
    } else {
      // Normal lookup - check database for non-expired entries
      const dbCached = dbCache.getAll().find((c) => c.domain === domain.toLowerCase() && c.type === type);
      if (dbCached) {
        if (now > dbCached.expiresAt) {
          // Expired, delete it
          dbCache.delete(domain, type);
          return null;
        }
        // Still valid, load into memory and return
        logger.debug('Loading cache from database into memory', {
          domain,
          type,
          expiresAt: new Date(dbCached.expiresAt).toISOString(),
        });
        this.cache.set(key, {
          response: dbCached.response,
          expiresAt: dbCached.expiresAt,
          domain: domain.toLowerCase(),
          type,
        });
        return dbCached.response;
      }
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

      if (minTTL === null) {
        logger.debug('No TTL found in response (no answers)', { responseLength: response.length });
      }
      return minTTL;
    } catch (error) {
      logger.error('Error extracting TTL from response', {
        error: error instanceof Error ? error : new Error(String(error)),
        responseLength: response.length,
      });
      return null;
    }
  }

  private setCachedResponse(domain: string, type: number, response: Buffer, customTTL?: number) {
    if (!this.cacheEnabled) {
      logger.debug('Cache disabled, not storing response', { domain, type });
      return;
    }

    const key = this.getCacheKey(domain, type);

    // Extract TTL from DNS response, or fall back to default (5 minutes)
    // Use custom TTL if provided (e.g., for local DNS entries)
    let ttl: number;
    if (customTTL !== undefined) {
      ttl = customTTL;
    } else {
      const responseTTL = this.extractTTLFromResponse(response);
      const DEFAULT_TTL = 300; // 5 minutes fallback if TTL extraction fails
      ttl = responseTTL !== null ? responseTTL : DEFAULT_TTL;
    }

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

    logger.debug('Cached response', { domain, type, ttl, expiresAt: new Date(expiresAt).toISOString() });
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
      logger.error('Error loading cache from database', {
        error: error instanceof Error ? error : new Error(String(error)),
      });
    }
  }

  getCacheStats() {
    // Calculate total memory usage of cache (approximate)
    let totalSize = 0;
    for (const [key, value] of this.cache.entries()) {
      totalSize += key.length; // Key size
      totalSize += value.response.length; // Response buffer size
      totalSize += 8; // expiresAt (number)
      totalSize += value.domain.length; // domain string
      totalSize += 4; // type (number)
    }

    return {
      size: this.cache.size,
      enabled: this.cacheEnabled,
      serveStaleEnabled: this.serveStaleEnabled,
      serveStaleMaxAge: this.serveStaleMaxAge,
      prefetchEnabled: this.prefetchEnabled,
      prefetchThreshold: this.prefetchThreshold,
      prefetchMinQueries: this.prefetchMinQueries,
      memoryUsageBytes: totalSize,
      memoryUsageMB: Math.round((totalSize / (1024 * 1024)) * 100) / 100,
    };
  }

  setCacheEnabled(enabled: boolean) {
    this.cacheEnabled = enabled;
    dbSettings.set('cacheEnabled', enabled.toString());
    if (!enabled) {
      this.cache.clear();
    }
  }

  setServeStaleEnabled(enabled: boolean) {
    this.serveStaleEnabled = enabled;
    dbSettings.set('serveStaleEnabled', enabled.toString());
  }

  setServeStaleMaxAge(maxAgeSeconds: number) {
    this.serveStaleMaxAge = maxAgeSeconds;
    dbSettings.set('serveStaleMaxAge', maxAgeSeconds.toString());
  }

  setPrefetchEnabled(enabled: boolean) {
    this.prefetchEnabled = enabled;
    dbSettings.set('prefetchEnabled', enabled.toString());
  }

  setPrefetchThreshold(threshold: number) {
    this.prefetchThreshold = threshold;
    dbSettings.set('prefetchThreshold', threshold.toString());
  }

  setPrefetchMinQueries(minQueries: number) {
    this.prefetchMinQueries = minQueries;
    dbSettings.set('prefetchMinQueries', minQueries.toString());
  }

  /**
   * Prefetch popular domains that are close to expiring
   */
  private async prefetchPopularDomains(): Promise<void> {
    if (!this.prefetchEnabled || !this.cacheEnabled) {
      return;
    }

    try {
      // Get popular domains from query log (last 24 hours)
      const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
      const popularDomains = dbQueries.getPopularDomains(oneDayAgo, this.prefetchMinQueries);

      let prefetched = 0;
      const now = Date.now();

      for (const { domain, type, count } of popularDomains) {
        const key = this.getCacheKey(domain, type);
        const cached = this.cache.get(key);

        if (!cached) {
          // Not in memory cache, check database
          const dbCached = dbCache.getAll().find((c) => c.domain === domain.toLowerCase() && c.type === type);
          if (!dbCached) continue;

          // Check if close to expiring
          const age = (now - dbCached.expiresAt) / 1000;
          if (age >= 0) continue; // Already expired
          const ttl = -age; // Time until expiration
          const originalTTL = ttl / (1 - this.prefetchThreshold);
          const agePercent = Math.abs(age) / originalTTL;
          if (agePercent < this.prefetchThreshold) {
            continue; // Not close enough to expiring
          }
        } else {
          // Check if close to expiring
          const age = (now - cached.expiresAt) / 1000;
          if (age >= 0) {
            // Already expired, skip
            continue;
          }
          const ttl = -age; // Time until expiration
          const originalTTL = ttl / (1 - this.prefetchThreshold);
          const agePercent = Math.abs(age) / originalTTL;
          if (agePercent < this.prefetchThreshold) {
            continue; // Not close enough to expiring
          }
        }

        // Prefetch this domain
        try {
          const query = this.createDNSQuery(domain, type === 1 ? 'A' : type === 28 ? 'AAAA' : 'A');
          const response = await this.forwardQuery(query, domain);
          this.setCachedResponse(domain, type, response);
          prefetched++;
          logger.debug('Prefetched domain', { domain, type, count });
        } catch (error) {
          // Silently fail prefetch - don't log errors for background tasks
        }
      }

      if (prefetched > 0) {
        logger.info('Prefetched domains', { count: prefetched });
      }
    } catch (error) {
      logger.error('Error in prefetch task', {
        error: error instanceof Error ? error : new Error(String(error)),
      });
    }
  }

  /**
   * Create a DNS query buffer from domain and type
   */
  private createDNSQuery(domain: string, type: string): Buffer {
    const typeMap: Record<string, number> = {
      A: 1,
      AAAA: 28,
      MX: 15,
      TXT: 16,
      NS: 2,
      CNAME: 5,
    };

    const queryType = typeMap[type.toUpperCase()] || 1;

    const header = Buffer.alloc(12);
    header.writeUInt16BE(Math.floor(Math.random() * 65535), 0);
    header.writeUInt16BE(0x0100, 2);
    header.writeUInt16BE(0x0001, 4);
    header.writeUInt16BE(0x0000, 6);
    header.writeUInt16BE(0x0000, 8);
    header.writeUInt16BE(0x0000, 10);

    const parts = domain.split('.');
    const domainBuffer = Buffer.alloc(domain.length + 2);
    let offset = 0;
    for (const part of parts) {
      domainBuffer[offset++] = part.length;
      Buffer.from(part).copy(domainBuffer, offset);
      offset += part.length;
    }
    domainBuffer[offset++] = 0;

    const question = Buffer.alloc(4);
    question.writeUInt16BE(queryType, 0);
    question.writeUInt16BE(1, 2);

    return Buffer.concat([header, domainBuffer.slice(0, offset), question]);
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
        logger.error('Failed to load blocklist', {
          error: error instanceof Error ? error : new Error(String(error)),
          url,
        });
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

  private parseDNSQuery(msg: Buffer): { id: number; domain: string; type: number; wantsDNSSEC: boolean } | null {
    try {
      if (msg.length < 12) return null;

      const _id = msg.readUInt16BE(0);
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
      offset += 4; // Skip QTYPE and QCLASS

      // Check for EDNS(0) OPT record in additional section
      let wantsDNSSEC = false;
      const arCount = msg.readUInt16BE(10);
      if (arCount > 0 && offset < msg.length) {
        // Look for OPT record (type 41)
        // OPT record name is root (0x00), so check if next byte is 0
        if (msg[offset] === 0 && offset + 11 <= msg.length) {
          const optType = msg.readUInt16BE(offset + 1);
          if (optType === 41) {
            // OPT record found, check DO bit (bit 15 of flags at offset + 5)
            const optFlags = msg.readUInt16BE(offset + 5);
            wantsDNSSEC = (optFlags & 0x8000) !== 0;
          }
        }
      }

      return { id: _id, domain, type, wantsDNSSEC };
    } catch (error) {
      logger.error('Error parsing DNS query', {
        error: error instanceof Error ? error : new Error(String(error)),
      });
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

  private handleAuthoritativeQuery(
    queryMsg: Buffer,
    domain: string,
    queryType: number,
    zone: {
      id: number;
      domain: string;
      soa_serial: number;
      soa_refresh: number;
      soa_retry: number;
      soa_expire: number;
      soa_minimum: number;
      soa_mname: string;
      soa_rname: string;
    },
  ): Buffer | null {
    const zoneRecords = dbZoneRecords.getByZone(zone.id);
    const domainLower = domain.toLowerCase();
    const zoneDomainLower = zone.domain.toLowerCase();

    // Find records matching the query
    // Check exact match first, then check if it's a subdomain of the zone
    let matchingRecords = zoneRecords.filter((record) => {
      const recordName = record.name.toLowerCase();
      // Exact match
      if (recordName === domainLower) return true;
      // Subdomain match (e.g., record "www" matches "www.example.com" when zone is "example.com")
      if (recordName === '@' && domainLower === zoneDomainLower) return true;
      // Relative name match (e.g., record "www" in zone "example.com" matches "www.example.com")
      if (domainLower.endsWith('.' + zoneDomainLower) || domainLower === zoneDomainLower) {
        const relativeName = domainLower === zoneDomainLower ? '@' : domainLower.slice(0, -(zoneDomainLower.length + 1));
        return recordName === relativeName || recordName === '@';
      }
      return false;
    });

    // Filter by query type (or CNAME if exists)
    const typeMap: Record<string, number> = {
      A: 1,
      AAAA: 28,
      MX: 15,
      TXT: 16,
      NS: 2,
      CNAME: 5,
      SOA: 6,
      PTR: 12,
      SRV: 33,
      CAA: 257,
    };

    const typeName = Object.keys(typeMap).find((k) => typeMap[k] === queryType) || 'A';
    let answers = matchingRecords.filter((r) => r.type === typeName);

    // If no direct match, check for CNAME
    if (answers.length === 0) {
      const cnameRecords = matchingRecords.filter((r) => r.type === 'CNAME');
      if (cnameRecords.length > 0) {
        answers = cnameRecords;
      }
    }

    // Build response (allocate enough space)
    const response = Buffer.alloc(4096);
    queryMsg.copy(response, 0, 0, 12);

    // Set QR bit (response), AA bit (authoritative), and RA bit
    const flags = response.readUInt16BE(2);
    response.writeUInt16BE(flags | 0x8580, 2);

    let offset = 12;
    // Copy question section (handle compression pointers)
    while (offset < queryMsg.length) {
      const byte = queryMsg[offset];
      if (byte === 0) {
        // Null terminator
        response[offset] = 0;
        offset++;
        break;
      }
      if ((byte & 0xc0) === 0xc0) {
        // Compression pointer (2 bytes)
        response.writeUInt16BE(queryMsg.readUInt16BE(offset), offset);
        offset += 2;
        break;
      }
      // Regular label
      const length = byte;
      response[offset] = length;
      queryMsg.copy(response, offset + 1, offset + 1, offset + 1 + length);
      offset += length + 1;
    }
    // Copy QTYPE and QCLASS
    response.writeUInt16BE(queryMsg.readUInt16BE(offset), offset);
    response.writeUInt16BE(queryMsg.readUInt16BE(offset + 2), offset + 2);
    const questionEnd = offset + 4;

    let answerCount = 0;
    let authorityCount = 0;

    // Add answers
    // Question name starts at offset 12 (after header)
    const questionNameStart = 12;
    if (answers.length > 0) {
      for (const record of answers) {
        logger.debug('Adding answer record', { offset, questionNameStart, type: record.type, domain });
        offset = this.addResourceRecord(
          response,
          offset,
          questionNameStart,
          domain,
          record.type,
          record.ttl,
          record.data,
          record.priority,
        );
        answerCount++;
      }
    } else {
      // NXDOMAIN - no records found, include SOA in authority section
      response.writeUInt16BE(flags | 0x8583, 2); // Set NXDOMAIN (RCODE = 3)
      const soaData = `${zone.soa_mname} ${zone.soa_rname} ${zone.soa_serial} ${zone.soa_refresh} ${zone.soa_retry} ${zone.soa_expire} ${zone.soa_minimum}`;
      offset = this.addResourceRecord(
        response,
        questionEnd,
        questionNameStart,
        zone.domain,
        'SOA',
        zone.soa_minimum,
        soaData,
      );
      authorityCount = 1;
    }

    // Add DNSSEC signatures if enabled for zone
    let additionalCount = 0;
    const zoneKeys = dbZoneKeys.getByZone(zone.id, true);
    if (zoneKeys.length > 0 && answers.length > 0) {
      // Get ZSK (Zone Signing Key) for signing
      const zsk = zoneKeys.find((k) => k.flags === 256) || zoneKeys[0];

      // Build resource records for signing
      const recordsToSign: Array<{ name: string; type: number; ttl: number; data: Buffer }> = [];
      for (const record of answers) {
        const typeMap: Record<string, number> = {
          A: 1,
          AAAA: 28,
          MX: 15,
          TXT: 16,
          NS: 2,
          CNAME: 5,
          SOA: 6,
          PTR: 12,
          SRV: 33,
          CAA: 257,
        };
        const recordType = typeMap[record.type] || 1;

        // Convert record data to Buffer
        let recordData: Buffer;
        if (record.type === 'A') {
          recordData = this.ipv4ToBytes(record.data);
        } else if (record.type === 'AAAA') {
          recordData = this.ipv6ToBytes(record.data);
        } else if (record.type === 'TXT') {
          const txtData = Buffer.from(record.data, 'utf8');
          recordData = Buffer.concat([Buffer.from([txtData.length]), txtData]);
        } else {
          recordData = this.domainToBytes(record.data);
        }

        recordsToSign.push({
          name: domain,
          type: recordType,
          ttl: record.ttl,
          data: recordData,
        });
      }

      // Sign the RRset
      if (recordsToSign.length > 0) {
        const rrsig = signRRset(recordsToSign, zone.domain, zsk, answers[0].ttl);
        if (rrsig) {
          // Add RRSIG record to additional section
          const rrsigPointer = 0xc000 | questionNameStart;
          response.writeUInt16BE(rrsigPointer, offset);
          offset += 2;
          response.writeUInt16BE(46, offset); // RRSIG type
          offset += 2;
          response.writeUInt16BE(1, offset); // Class IN
          offset += 2;
          response.writeUInt32BE(answers[0].ttl, offset); // TTL
          offset += 4;
          response.writeUInt16BE(rrsig.length, offset); // RDLENGTH
          offset += 2;
          rrsig.copy(response, offset);
          offset += rrsig.length;
          additionalCount++;
        }
      }

      // Add DNSKEY records if requested (type 48)
      if (queryType === 48) {
        for (const key of zoneKeys) {
          const dnskeyRecord = generateDNSKEYRecord(key);
          const dnskeyPointer = 0xc000 | questionNameStart;
          response.writeUInt16BE(dnskeyPointer, offset);
          offset += 2;
          response.writeUInt16BE(48, offset); // DNSKEY type
          offset += 2;
          response.writeUInt16BE(1, offset); // Class IN
          offset += 2;
          response.writeUInt32BE(3600, offset); // TTL
          offset += 4;
          response.writeUInt16BE(dnskeyRecord.length, offset); // RDLENGTH
          offset += 2;
          dnskeyRecord.copy(response, offset);
          offset += dnskeyRecord.length;
          answerCount++;
        }
      }
    }

    // Update counts
    response.writeUInt16BE(answerCount, 6);
    response.writeUInt16BE(authorityCount, 8);
    response.writeUInt16BE(additionalCount, 10); // Additional count

    return response.slice(0, offset);
  }

  private addResourceRecord(
    response: Buffer,
    offset: number,
    questionNameStart: number,
    name: string,
    type: string,
    ttl: number,
    data: string,
    priority?: number | null,
  ): number {
    // Use compression pointer to point to the question name
    // Compression pointer format: 11xxxxxx xxxxxxxx (first 2 bits = 11, remaining 14 bits = offset)
    // Must point to a valid location in the message (0-16383)
    // Question name always starts at offset 12 (after 12-byte header)
    if (questionNameStart >= 0 && questionNameStart < 16384) {
      const pointer = 0xc000 | questionNameStart;
      logger.debug('Writing compression pointer', { offset, pointer: pointer.toString(16), questionNameStart });
      response.writeUInt16BE(pointer, offset);
      offset += 2;
    } else {
      // Fallback: encode the name directly (shouldn't happen for normal queries)
      const nameBytes = this.domainToBytes(name);
      if (offset + nameBytes.length > response.length) {
        throw new Error('Response buffer too small');
      }
      nameBytes.copy(response, offset);
      offset += nameBytes.length;
    }

    // Type
    const typeMap: Record<string, number> = {
      A: 1,
      AAAA: 28,
      MX: 15,
      TXT: 16,
      NS: 2,
      CNAME: 5,
      SOA: 6,
      PTR: 12,
      SRV: 33,
      CAA: 257,
      NAPTR: 35,
      SSHFP: 44,
      TLSA: 52,
      SVCB: 64,
      HTTPS: 65,
    };
    response.writeUInt16BE(typeMap[type.toUpperCase()] || 1, offset);
    offset += 2;

    // Class (IN = 1)
    response.writeUInt16BE(1, offset);
    offset += 2;

    // TTL
    response.writeUInt32BE(ttl, offset);
    offset += 4;

    // Data length and data
    let dataBytes: Buffer;
    if (type === 'A') {
      dataBytes = this.ipv4ToBytes(data);
    } else if (type === 'AAAA') {
      dataBytes = this.ipv6ToBytes(data);
    } else if (type === 'MX') {
      const parts = data.split(' ');
      const mxPriority = priority ?? parseInt(parts[0], 10);
      const mxDomain = parts.length > 1 ? parts.slice(1).join(' ') : parts[0];
      const domainBytes = this.domainToBytes(mxDomain);
      dataBytes = Buffer.concat([Buffer.from([(mxPriority >> 8) & 0xff, mxPriority & 0xff]), domainBytes]);
    } else if (type === 'TXT') {
      const txtData = Buffer.from(data, 'utf8');
      dataBytes = Buffer.concat([Buffer.from([txtData.length]), txtData]);
    } else if (type === 'NS' || type === 'CNAME') {
      dataBytes = this.domainToBytes(data);
    } else if (type === 'SOA') {
      const parts = data.split(' ');
      if (parts.length >= 7) {
        const mname = this.domainToBytes(parts[0]);
        const rname = this.domainToBytes(parts[1]);
        const serial = parseInt(parts[2], 10);
        const refresh = parseInt(parts[3], 10);
        const retry = parseInt(parts[4], 10);
        const expire = parseInt(parts[5], 10);
        const minimum = parseInt(parts[6], 10);
        dataBytes = Buffer.concat([
          mname,
          rname,
          Buffer.from([
            (serial >> 24) & 0xff,
            (serial >> 16) & 0xff,
            (serial >> 8) & 0xff,
            serial & 0xff,
            (refresh >> 24) & 0xff,
            (refresh >> 16) & 0xff,
            (refresh >> 8) & 0xff,
            refresh & 0xff,
            (retry >> 24) & 0xff,
            (retry >> 16) & 0xff,
            (retry >> 8) & 0xff,
            retry & 0xff,
            (expire >> 24) & 0xff,
            (expire >> 16) & 0xff,
            (expire >> 8) & 0xff,
            expire & 0xff,
            (minimum >> 24) & 0xff,
            (minimum >> 16) & 0xff,
            (minimum >> 8) & 0xff,
            minimum & 0xff,
          ]),
        ]);
      } else {
        dataBytes = Buffer.from(data, 'utf8');
      }
    } else if (type === 'CAA') {
      // CAA record format: flags (1 byte) + tag length (1 byte) + tag + value
      // Data format: "flags tag value" or "0 issue letsencrypt.org"
      const parts = data.split(' ');
      if (parts.length >= 3) {
        const flags = parseInt(parts[0], 10) || 0;
        const tag = parts[1];
        const value = parts.slice(2).join(' ');
        const tagBytes = Buffer.from(tag, 'utf8');
        const valueBytes = Buffer.from(value, 'utf8');
        dataBytes = Buffer.concat([Buffer.from([flags & 0xff]), Buffer.from([tagBytes.length]), tagBytes, valueBytes]);
      } else {
        // Fallback: treat as raw data
        dataBytes = Buffer.from(data, 'utf8');
      }
    } else if (type === 'NAPTR') {
      // NAPTR: order (2) + preference (2) + flags (length-prefixed) + service (length-prefixed) + regexp (length-prefixed) + replacement (domain)
      // Data format: "order preference flags service regexp replacement" or "10 10 \"u\" \"sip+E2U\" \"!^.*$!sip:customer@example.com!\" ."
      const parts = data.match(/(\d+)\s+(\d+)\s+"([^"]*)"\s+"([^"]*)"\s+"([^"]*)"\s+(.+)/);
      if (parts && parts.length >= 7) {
        const order = parseInt(parts[1], 10);
        const preference = parseInt(parts[2], 10);
        const flags = Buffer.from(parts[3], 'utf8');
        const service = Buffer.from(parts[4], 'utf8');
        const regexp = Buffer.from(parts[5], 'utf8');
        const replacement = this.domainToBytes(parts[6].trim());
        dataBytes = Buffer.concat([
          Buffer.from([(order >> 8) & 0xff, order & 0xff]),
          Buffer.from([(preference >> 8) & 0xff, preference & 0xff]),
          Buffer.from([flags.length]),
          flags,
          Buffer.from([service.length]),
          service,
          Buffer.from([regexp.length]),
          regexp,
          replacement,
        ]);
      } else {
        // Fallback: treat as raw data
        dataBytes = Buffer.from(data, 'utf8');
      }
    } else if (type === 'SSHFP') {
      // SSHFP: algorithm (1) + fp_type (1) + fingerprint (hex)
      // Data format: "algorithm fp_type fingerprint" or "1 1 abc123..."
      const parts = data.split(' ');
      if (parts.length >= 3) {
        const algorithm = parseInt(parts[0], 10);
        const fpType = parseInt(parts[1], 10);
        const fingerprint = Buffer.from(parts[2].replace(/:/g, ''), 'hex');
        dataBytes = Buffer.concat([Buffer.from([algorithm & 0xff, fpType & 0xff]), fingerprint]);
      } else {
        // Fallback: treat as raw data
        dataBytes = Buffer.from(data, 'utf8');
      }
    } else if (type === 'TLSA') {
      // TLSA: usage (1) + selector (1) + matching_type (1) + certificate_association_data (hex)
      // Data format: "usage selector matching_type hexdata" or "3 1 1 abc123..."
      const parts = data.split(' ');
      if (parts.length >= 4) {
        const usage = parseInt(parts[0], 10);
        const selector = parseInt(parts[1], 10);
        const matchingType = parseInt(parts[2], 10);
        const certData = Buffer.from(parts[3].replace(/:/g, ''), 'hex');
        dataBytes = Buffer.concat([Buffer.from([usage & 0xff, selector & 0xff, matchingType & 0xff]), certData]);
      } else {
        // Fallback: treat as raw data
        dataBytes = Buffer.from(data, 'utf8');
      }
    } else if (type === 'SVCB' || type === 'HTTPS') {
      // SVCB/HTTPS: SvcPriority (2) + TargetName (domain, can be ".") + SvcParams (key-value pairs)
      // Data format: "priority targetname key=value key=value" or "1 . alpn=h2,h3" or "16 example.com ipv4hint=1.2.3.4"
      const parts = data.split(' ');
      if (parts.length >= 2) {
        const priority = parseInt(parts[0], 10);
        const targetName = parts[1] === '.' ? Buffer.from([0]) : this.domainToBytes(parts[1]);
        const svcParams: Buffer[] = [];
        // Parse SvcParams (key=value pairs)
        for (let i = 2; i < parts.length; i++) {
          const param = parts[i];
          const eqIndex = param.indexOf('=');
          if (eqIndex > 0) {
            const key = param.substring(0, eqIndex);
            const value = param.substring(eqIndex + 1);
            const keyBytes = Buffer.from(key, 'utf8');
            const valueBytes = Buffer.from(value, 'utf8');
            // SvcParam: key (length-prefixed) + value (length-prefixed)
            svcParams.push(
              Buffer.concat([Buffer.from([keyBytes.length]), keyBytes, Buffer.from([valueBytes.length]), valueBytes]),
            );
          }
        }
        dataBytes = Buffer.concat([Buffer.from([(priority >> 8) & 0xff, priority & 0xff]), targetName, ...svcParams]);
      } else {
        // Fallback: treat as raw data
        dataBytes = Buffer.from(data, 'utf8');
      }
    } else {
      dataBytes = Buffer.from(data, 'utf8');
    }

    response.writeUInt16BE(dataBytes.length, offset);
    offset += 2;
    dataBytes.copy(response, offset);
    offset += dataBytes.length;

    return offset;
  }

  private domainToBytes(domain: string): Buffer {
    if (!domain.endsWith('.')) {
      domain += '.';
    }
    const parts = domain.split('.');
    const buffers: Buffer[] = [];
    for (const part of parts) {
      if (part === '') continue;
      buffers.push(Buffer.from([part.length]));
      buffers.push(Buffer.from(part, 'utf8'));
    }
    buffers.push(Buffer.from([0])); // Null terminator
    return Buffer.concat(buffers);
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

  /**
   * Get list of upstream DNS servers to try, filtering out disabled ones
   */
  private getAvailableUpstreamServers(): string[] {
    const now = Date.now();
    return this.upstreamDNSList.filter((dns) => {
      const health = this.upstreamHealth.get(dns);
      if (!health) return true;
      // Check if server is disabled
      if (now < health.disabledUntil) return false;
      // Reset failures if enough time has passed
      if (now - health.lastFailure > this.upstreamFailureWindow) {
        this.upstreamHealth.delete(dns);
        return true;
      }
      return true;
    });
  }

  /**
   * Mark an upstream DNS server as failed
   */
  private markUpstreamFailure(dns: string) {
    const health = this.upstreamHealth.get(dns) || { failures: 0, lastFailure: 0, disabledUntil: 0 };
    health.failures += 1;
    health.lastFailure = Date.now();
    if (health.failures >= this.upstreamMaxFailures) {
      health.disabledUntil = Date.now() + this.upstreamDisableDuration;
      logger.warn('Upstream DNS disabled due to failures', { dns, failures: health.failures });
    }
    this.upstreamHealth.set(dns, health);
  }

  /**
   * Mark an upstream DNS server as successful (reset failure count)
   */
  private markUpstreamSuccess(dns: string) {
    this.upstreamHealth.delete(dns);
  }

  private async forwardQuery(msg: Buffer, domain: string, clientIp?: string, useTcp: boolean = false): Promise<Buffer> {
    // Priority: client-specific DNS > conditional forwarding > default upstream
    let targetDNSList: string[] = [];

    if (clientIp) {
      const clientDNS = dbClientUpstreamDNS.get(clientIp);
      if (clientDNS) {
        // Client-specific DNS can be comma-separated
        targetDNSList = clientDNS
          .split(',')
          .map((dns) => dns.trim())
          .filter((dns) => dns.length > 0);
      }
    }

    // Check conditional forwarding if no client-specific DNS
    if (targetDNSList.length === 0) {
      const conditionalDNS = dbConditionalForwarding.findUpstreamDNS(domain);
      if (conditionalDNS) {
        // Conditional forwarding can be comma-separated
        targetDNSList = conditionalDNS
          .split(',')
          .map((dns) => dns.trim())
          .filter((dns) => dns.length > 0);
      }
    }

    // Use default upstream list if no specific DNS found
    if (targetDNSList.length === 0) {
      targetDNSList = this.getAvailableUpstreamServers();
    }

    // Extract query type from message for metrics
    const queryType = msg.length >= 4 ? this.getQueryType(msg) : undefined;

    // Try each upstream DNS server in order until one succeeds
    const errors: Error[] = [];
    for (const targetDNS of targetDNSList) {
      const startTime = Date.now();
      try {
        // Check if targetDNS is a DoH URL (https://)
        if (targetDNS.startsWith('https://')) {
          try {
            const dohResponse = await this.forwardQueryDoH(msg, targetDNS);
            const responseTime = Date.now() - startTime;
            this.markUpstreamSuccess(targetDNS);
            dbUpstreamMetrics.insert(targetDNS, responseTime, true, queryType);
            recordUpstreamMetrics({
              upstream: targetDNS,
              success: true,
              responseTime,
              queryType,
            });
            return dohResponse;
          } catch (error) {
            const responseTime = Date.now() - startTime;
            errors.push(error instanceof Error ? error : new Error(String(error)));
            this.markUpstreamFailure(targetDNS);
            dbUpstreamMetrics.insert(targetDNS, responseTime, false, queryType);
            recordUpstreamMetrics({
              upstream: targetDNS,
              success: false,
              responseTime,
              queryType,
            });
            logger.debug('DoH query failed, trying next upstream', {
              error: error instanceof Error ? error : new Error(String(error)),
              targetDNS,
            });
            continue; // Try next upstream
          }
        }

        // Check if targetDNS is a DoT URL (tls:// or dot://)
        if (targetDNS.startsWith('tls://') || targetDNS.startsWith('dot://')) {
          try {
            const dotResponse = await this.forwardQueryDoT(msg, targetDNS);
            const responseTime = Date.now() - startTime;
            this.markUpstreamSuccess(targetDNS);
            dbUpstreamMetrics.insert(targetDNS, responseTime, true, queryType);
            recordUpstreamMetrics({
              upstream: targetDNS,
              success: true,
              responseTime,
              queryType,
            });
            return dotResponse;
          } catch (error) {
            const responseTime = Date.now() - startTime;
            errors.push(error instanceof Error ? error : new Error(String(error)));
            this.markUpstreamFailure(targetDNS);
            dbUpstreamMetrics.insert(targetDNS, responseTime, false, queryType);
            recordUpstreamMetrics({
              upstream: targetDNS,
              success: false,
              responseTime,
              queryType,
            });
            logger.debug('DoT query failed, trying next upstream', {
              error: error instanceof Error ? error : new Error(String(error)),
              targetDNS,
            });
            continue; // Try next upstream
          }
        }

        // Try UDP/TCP
        try {
          const response = await this.forwardQueryUDPTCP(msg, targetDNS, useTcp);
          const responseTime = Date.now() - startTime;
          this.markUpstreamSuccess(targetDNS);
          dbUpstreamMetrics.insert(targetDNS, responseTime, true, queryType);
          recordUpstreamMetrics({
            upstream: targetDNS,
            success: true,
            responseTime,
            queryType,
          });
          return response;
        } catch (error) {
          const responseTime = Date.now() - startTime;
          errors.push(error instanceof Error ? error : new Error(String(error)));
          this.markUpstreamFailure(targetDNS);
          dbUpstreamMetrics.insert(targetDNS, responseTime, false, queryType);
          recordUpstreamMetrics({
            upstream: targetDNS,
            success: false,
            responseTime,
            queryType,
          });
          logger.debug('UDP/TCP query failed, trying next upstream', {
            error: error instanceof Error ? error : new Error(String(error)),
            targetDNS,
          });
          continue; // Try next upstream
        }
      } catch (error) {
        const responseTime = Date.now() - startTime;
        errors.push(error instanceof Error ? error : new Error(String(error)));
        this.markUpstreamFailure(targetDNS);
        dbUpstreamMetrics.insert(targetDNS, responseTime, false, queryType);
        continue;
      }
    }

    // All upstreams failed
    throw new Error(`All upstream DNS servers failed: ${errors.map((e) => e.message).join(', ')}`);
  }

  /**
   * Extract query type from DNS message
   */
  private getQueryType(msg: Buffer): string | undefined {
    if (msg.length < 12) return undefined;

    // Skip header (12 bytes) and question name
    let offset = 12;
    while (offset < msg.length && msg[offset] !== 0) {
      const length = msg[offset];
      offset += length + 1;
    }

    // Skip null terminator
    if (offset >= msg.length) return undefined;
    offset++;

    // Read QTYPE (2 bytes)
    if (offset + 2 > msg.length) return undefined;
    const qtype = msg.readUInt16BE(offset);

    // Map numeric type to string
    const typeMap: Record<number, string> = {
      1: 'A',
      2: 'NS',
      5: 'CNAME',
      6: 'SOA',
      15: 'MX',
      16: 'TXT',
      28: 'AAAA',
      33: 'SRV',
      35: 'NAPTR',
      44: 'SSHFP',
      52: 'TLSA',
      64: 'SVCB',
      65: 'HTTPS',
      257: 'CAA',
    };

    return typeMap[qtype] || `TYPE${qtype}`;
  }

  /**
   * Forward query over UDP or TCP
   */
  private async forwardQueryUDPTCP(msg: Buffer, targetDNS: string, useTcp: boolean): Promise<Buffer> {
    return new Promise((resolve, reject) => {
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
        // Forward over UDP
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

  /**
   * Forward DNS query using DNS-over-HTTPS (DoH) - RFC 8484
   */
  private async forwardQueryDoH(msg: Buffer, dohUrl: string): Promise<Buffer> {
    try {
      // Ensure URL ends with /dns-query if no path specified
      let url = dohUrl;
      if (!url.includes('/dns-query') && !url.match(/\/[^\/]+$/)) {
        url = url.endsWith('/') ? `${url}dns-query` : `${url}/dns-query`;
      }

      // Try binary format first (application/dns-message)
      try {
        const postResponse = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/dns-message',
            Accept: 'application/dns-message',
          },
          body: msg,
        });

        if (!postResponse || !postResponse.ok) {
          throw new Error(
            `DoH request failed: ${postResponse?.status || 'unknown'} ${postResponse?.statusText || 'unknown'}`,
          );
        }

        const contentType = postResponse.headers.get('content-type') || '';
        if (contentType.includes('application/dns-message')) {
          const arrayBuffer = await postResponse.arrayBuffer();
          return Buffer.from(arrayBuffer);
        }

        // Fall back to JSON format if binary not available
        if (contentType.includes('application/dns-json') || contentType.includes('application/json')) {
          const jsonData = await postResponse.json();
          return this.convertDoHJSONToDNSMessage(jsonData, msg);
        }

        throw new Error(`Unsupported DoH content type: ${contentType}`);
      } catch (error) {
        // If POST fails, try GET with base64url encoding
        const base64Query = msg.toString('base64url');
        const getUrl = `${url}?dns=${base64Query}`;

        const getResponse = await fetch(getUrl, {
          method: 'GET',
          headers: {
            Accept: 'application/dns-message, application/dns-json',
          },
        });

        if (!getResponse || !getResponse.ok) {
          throw new Error(
            `DoH GET request failed: ${getResponse?.status || 'unknown'} ${getResponse?.statusText || 'unknown'}`,
          );
        }

        const contentType = getResponse.headers.get('content-type') || '';
        if (contentType.includes('application/dns-message')) {
          const arrayBuffer = await getResponse.arrayBuffer();
          return Buffer.from(arrayBuffer);
        }

        if (contentType.includes('application/dns-json') || contentType.includes('application/json')) {
          const jsonData = await getResponse.json();
          return this.convertDoHJSONToDNSMessage(jsonData, msg);
        }

        throw new Error(`Unsupported DoH content type: ${contentType}`);
      }
    } catch (error) {
      logger.error('Error forwarding query via DoH', {
        error: error instanceof Error ? error : new Error(String(error)),
        dohUrl,
      });
      throw error;
    }
  }

  /**
   * Forward DNS query using DNS-over-TLS (DoT) - RFC 7858
   */
  private async forwardQueryDoT(msg: Buffer, dotUrl: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      try {
        // Parse DoT URL: tls://host:port or dot://host:port
        // Default port is 853 for DoT
        const urlMatch = dotUrl.match(/^(?:tls|dot):\/\/([^:]+)(?::(\d+))?$/);
        if (!urlMatch) {
          throw new Error(`Invalid DoT URL format: ${dotUrl}`);
        }

        const host = urlMatch[1];
        const port = urlMatch[2] ? parseInt(urlMatch[2], 10) : 853;

        // Create TLS connection
        const socket = tls.connect(
          {
            host,
            port,
            rejectUnauthorized: true, // Verify server certificate
            servername: host, // SNI
          },
          () => {
            // Connection established, send DNS query with length prefix
            const lengthPrefix = Buffer.allocUnsafe(2);
            lengthPrefix.writeUInt16BE(msg.length, 0);
            socket.write(Buffer.concat([lengthPrefix, msg]));
          },
        );

        const timeout = setTimeout(() => {
          socket.destroy();
          reject(new Error('DoT query timeout'));
        }, 10000); // 10 second timeout

        let responseLength: number | null = null;
        let responseBuffer = Buffer.alloc(0);

        socket.on('data', (data: Buffer) => {
          responseBuffer = Buffer.concat([responseBuffer, data]);

          // DNS over TLS uses a 2-byte length prefix (same as TCP)
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

        socket.on('close', () => {
          clearTimeout(timeout);
          if (responseLength === null || responseBuffer.length < responseLength + 2) {
            reject(new Error('DoT connection closed before response received'));
          }
        });
      } catch (error) {
        logger.error('Error forwarding query via DoT', {
          error: error instanceof Error ? error : new Error(String(error)),
          dotUrl,
        });
        reject(error);
      }
    });
  }

  /**
   * Convert DoH JSON response to DNS message format
   */
  private convertDoHJSONToDNSMessage(jsonData: any, originalQuery: Buffer): Buffer {
    try {
      const queryId = originalQuery.readUInt16BE(0);
      const response = Buffer.alloc(4096);
      let offset = 0;

      // Header
      response.writeUInt16BE(queryId, offset);
      offset += 2;
      response.writeUInt16BE(0x8180, offset); // QR=1, AA=0, RD=1, RA=1
      offset += 2;
      response.writeUInt16BE(1, offset); // Questions: 1
      offset += 2;

      // Copy question section from original query
      let qOffset = 12;
      while (qOffset < originalQuery.length && originalQuery[qOffset] !== 0) {
        const length = originalQuery[qOffset];
        if ((length & 0xc0) === 0xc0) {
          response.writeUInt16BE(originalQuery.readUInt16BE(qOffset), offset);
          offset += 2;
          qOffset += 2;
          break;
        }
        response[offset++] = length;
        qOffset++;
        if (qOffset + length > originalQuery.length) break;
        originalQuery.copy(response, offset, qOffset, qOffset + length);
        offset += length;
        qOffset += length;
      }
      if (originalQuery[qOffset] === 0) {
        response[offset++] = 0;
        qOffset++;
      }
      if (qOffset + 4 <= originalQuery.length) {
        originalQuery.copy(response, offset, qOffset, qOffset + 4);
        offset += 4;
      }

      // Answers
      const answers = jsonData.Answer || [];
      response.writeUInt16BE(answers.length, 6);
      response.writeUInt16BE(0, 8); // Authority
      response.writeUInt16BE(0, 10); // Additional

      // Add answer records
      for (const answer of answers) {
        // Name (use compression pointer to question)
        const namePointer = 0xc000 | 12;
        response.writeUInt16BE(namePointer, offset);
        offset += 2;

        // Type
        const typeMap: Record<string, number> = {
          A: 1,
          AAAA: 28,
          MX: 15,
          TXT: 16,
          NS: 2,
          CNAME: 5,
          SOA: 6,
          PTR: 12,
        };
        const type = typeMap[answer.type] || 1;
        response.writeUInt16BE(type, offset);
        offset += 2;

        // Class (IN = 1)
        response.writeUInt16BE(1, offset);
        offset += 2;

        // TTL
        response.writeUInt32BE(answer.TTL || 300, offset);
        offset += 4;

        // Data
        const dataStart = offset;
        offset += 2; // Reserve for length

        if (type === 1) {
          // A record
          const parts = answer.data.split('.');
          response[offset++] = parseInt(parts[0], 10);
          response[offset++] = parseInt(parts[1], 10);
          response[offset++] = parseInt(parts[2], 10);
          response[offset++] = parseInt(parts[3], 10);
        } else if (type === 28) {
          // AAAA record
          const parts = answer.data.split(':');
          for (let i = 0; i < 8; i++) {
            const num = parseInt(parts[i] || '0', 16);
            response.writeUInt16BE(num, offset);
            offset += 2;
          }
        } else {
          // Other types - simplified
          const dataBytes = Buffer.from(answer.data, 'utf8');
          dataBytes.copy(response, offset);
          offset += dataBytes.length;
        }

        // Write data length
        const dataLength = offset - dataStart - 2;
        response.writeUInt16BE(dataLength, dataStart);
      }

      return response.slice(0, offset);
    } catch (error) {
      logger.error('Error converting DoH JSON to DNS message', {
        error: error instanceof Error ? error : new Error(String(error)),
      });
      throw error;
    }
  }

  private addQuery(query: DNSQuery) {
    try {
      dbQueries.insert(query);
    } catch (error) {
      logger.error('Failed to save query to database', {
        error: error instanceof Error ? error : new Error(String(error)),
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
      doq: boolean;
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
        doq: this.doqServer !== null,
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
    cacheStats: {
      size: number;
      enabled: boolean;
      memoryUsageMB: number;
    };
  } {
    // Get all stats from database (persistent)
    const dbStats = dbQueries.getStats();
    const dbClients = dbQueries.getClients(50);
    const queryTypeBreakdown = dbQueries.getQueryTypeBreakdown();
    const blockPercentageOverTime = dbQueries.getBlockPercentageOverTime(30);
    const topAdvertisers = dbQueries.getTopAdvertisers(20);
    const cacheStats = this.getCacheStats();

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
      cacheStats: {
        size: cacheStats.size,
        enabled: cacheStats.enabled,
        memoryUsageMB: cacheStats.memoryUsageMB,
      },
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
    // Parse multiple upstream DNS servers (comma-separated)
    this.upstreamDNSList = dns
      .split(',')
      .map((d) => d.trim())
      .filter((d) => d.length > 0);
    if (this.upstreamDNSList.length === 0) {
      this.upstreamDNSList = ['1.1.1.1'];
    }
    dbSettings.set('upstreamDNS', dns);
    // Reset health tracking when upstream DNS changes
    this.upstreamHealth.clear();
  }

  getUpstreamDNS(): string {
    return this.upstreamDNS;
  }

  getUpstreamDNSList(): string[] {
    return [...this.upstreamDNSList];
  }

  getUpstreamHealth(): Record<string, { failures: number; lastFailure: number; disabledUntil: number }> {
    const health: Record<string, { failures: number; lastFailure: number; disabledUntil: number }> = {};
    this.upstreamHealth.forEach((value, key) => {
      health[key] = { ...value };
    });
    return health;
  }

  getPort(): number {
    return this.port;
  }

  getBindAddress(): string {
    // Always check environment variable first, then return current value (defaults to 127.0.0.1)
    return process.env.DNS_BIND_ADDRESS || this.bindAddress || '127.0.0.1';
  }

  setBindAddress(address: string) {
    // Only update if not set via environment variable
    if (process.env.DNS_BIND_ADDRESS) {
      logger.warn('DNS_BIND_ADDRESS is set via environment variable, cannot update via API', {
        envValue: process.env.DNS_BIND_ADDRESS,
        requestedValue: address,
      });
      return;
    }
    this.bindAddress = address;
    dbSettings.set('dnsBindAddress', address);
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

    // Check if it's a DNS UPDATE request (OPCODE 5)
    if (msg.length >= 12) {
      const flags = msg.readUInt16BE(2);
      const opcode = (flags >> 11) & 0xf;
      if (opcode === 5) {
        // DNS UPDATE request
        const updateResponse = handleDNSUpdate(msg, clientIp);
        if (updateResponse) {
          return updateResponse;
        }
      }
    }

    const parsed = this.parseDNSQuery(msg);

    if (!parsed) {
      this.errorCount++;
      throw new Error('Failed to parse DNS query');
    }

    const { id: _id, domain, type, wantsDNSSEC } = parsed;

    // Zone transfers (AXFR/IXFR) are handled in TCP socket handler, not here
    // Check rate limiting first
    if (this.rateLimitEnabled && clientIp) {
      const rateLimitResult = dbRateLimits.checkRateLimit(clientIp, this.rateLimitMaxQueries, this.rateLimitWindowMs);
      if (!rateLimitResult.allowed) {
        // Rate limited - return NXDOMAIN
        logger.warn('Rate limited', { clientIp });
        recordRateLimitMetrics(clientIp, true);
        return this.createDNSResponse(msg, true);
      }
      recordRateLimitMetrics(clientIp, false);
    }

    // Check authoritative zones first
    const zone = dbZones.findZoneForDomain(domain);
    if (zone) {
      logger.debug('Authoritative zone found', { domain, zone: zone.domain, queryType: type });
      // Check cache first for authoritative queries
      const cached = this.getCachedResponse(domain, type);
      if (cached) {
        // Update the query ID in cached response to match the current query
        const queryId = msg.readUInt16BE(0);
        const cachedResponse = Buffer.from(cached);
        cachedResponse.writeUInt16BE(queryId, 0);
        const queryIdStr = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const responseTime = Date.now() - startTime;
        const query: DNSQuery = {
          id: queryIdStr,
          domain,
          type: type === 1 ? 'A' : type === 28 ? 'AAAA' : `TYPE${type}`,
          blocked: false,
          timestamp: Date.now(),
          clientIp,
          responseTime,
          cached: true,
        };
        this.addQuery(query);
        recordDNSQuery({
          domain,
          type: query.type,
          blocked: false,
          cached: true,
          responseTime,
          clientIp,
        });
        recordCacheMetrics('hit', domain, query.type);
        logger.debug('Cached (authoritative)', { domain, type, zone: zone.domain });
        return cachedResponse;
      }
      const authResponse = this.handleAuthoritativeQuery(msg, domain, type, zone);
      if (authResponse) {
        // Cache authoritative responses
        this.setCachedResponse(domain, type, authResponse);
        const queryId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const responseTime = Date.now() - startTime;
        const queryType = type === 1 ? 'A' : type === 28 ? 'AAAA' : `TYPE${type}`;
        const query: DNSQuery = {
          id: queryId,
          domain,
          type: queryType,
          blocked: false,
          timestamp: Date.now(),
          clientIp,
          responseTime,
          cached: false,
        };
        this.addQuery(query);
        recordDNSQuery({
          domain,
          type: queryType,
          blocked: false,
          cached: false,
          responseTime,
          clientIp,
        });
        recordCacheMetrics('set', domain, queryType);
        logger.debug('Authoritative response', { domain, type, zone: zone.domain });
        return authResponse;
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
        // Check cache first for local DNS (in case it was cached from a previous upstream query)
        const cached = this.getCachedResponse(domain, type);
        if (cached) {
          // Update the query ID in cached response to match the current query
          const queryId = msg.readUInt16BE(0);
          response = Buffer.from(cached);
          response.writeUInt16BE(queryId, 0);
          isCached = true;
          logger.debug('Cached (local DNS)', { domain, type });
        } else {
          response = this.createDNSResponseWithIP(msg, localDNS.ip, type);
          // Cache local DNS responses with a reasonable TTL (1 hour = 3600 seconds)
          this.setCachedResponse(domain, type, response, 3600);
          logger.debug('Local DNS', { domain, ip: localDNS.ip, type });
        }
      } else {
        // Type mismatch, check cache first
        const cached = this.getCachedResponse(domain, type);
        if (cached) {
          // Update the query ID in cached response to match the current query
          const queryId = msg.readUInt16BE(0);
          response = Buffer.from(cached);
          response.writeUInt16BE(queryId, 0);
          isCached = true;
          logger.debug('Cached', { domain, type });
        } else {
          try {
            response = await this.forwardQuery(msg, domain, clientIp, useTcp);
            // Validate DNSSEC if requested
            if (wantsDNSSEC && dbSettings.get('dnssecValidation', 'false') === 'true') {
              const validation = validateDNSSEC(response, domain, type);
              if (!validation.valid) {
                logger.warn('DNSSEC validation failed', { domain, type, reason: validation.reason });
              } else {
                logger.debug('DNSSEC validation passed', { domain, type, validatedRecords: validation.validatedRecords });
              }
            }
            this.setCachedResponse(domain, type, response);
            logger.debug('Allowed', { domain, type });
          } catch (error) {
            this.errorCount++;
            // Try to serve stale cache if upstream fails
            const staleResponse = this.getCachedResponse(domain, type, true);
            if (staleResponse) {
              logger.info('Upstream query failed, serving stale cache', { domain, type });
              // Update the query ID in stale response to match the current query
              const queryId = msg.readUInt16BE(0);
              response = Buffer.from(staleResponse);
              response.writeUInt16BE(queryId, 0);
              isCached = true;
            } else {
              throw error;
            }
          }
        }
      }
    } else {
      // Check cache first
      const cached = this.getCachedResponse(domain, type);
      if (cached) {
        // Update the query ID in cached response to match the current query
        const queryId = msg.readUInt16BE(0);
        response = Buffer.from(cached);
        response.writeUInt16BE(queryId, 0);
        isCached = true;
        logger.debug('Cached', { domain, type });
      } else {
        try {
          response = await this.forwardQuery(msg, domain, clientIp, useTcp);
          // Validate DNSSEC if requested
          if (wantsDNSSEC && dbSettings.get('dnssecValidation', 'false') === 'true') {
            const validation = validateDNSSEC(response, domain, type);
            if (!validation.valid) {
              logger.warn('DNSSEC validation failed', { domain, type, reason: validation.reason });
            } else {
              logger.debug('DNSSEC validation passed', { domain, type, validatedRecords: validation.validatedRecords });

              // Optionally validate chain of trust if enabled
              // This is expensive as it requires additional DNS queries, so it's optional
              if (dbSettings.get('dnssecChainValidation', 'false') === 'true') {
                // Chain of trust validation would be done here if DNSKEY records are present
                // For now, we'll log that it's enabled but not yet fully integrated
                // Full integration would require extracting DNSKEY from response and validating chain
                logger.debug('DNSSEC chain of trust validation enabled (requires DNSKEY in response)', { domain });
              }
            }
          }
          this.setCachedResponse(domain, type, response);
          logger.debug('Allowed', { domain, type });
        } catch (error) {
          this.errorCount++;
          // Try to serve stale cache if upstream fails
          const staleResponse = this.getCachedResponse(domain, type, true);
          if (staleResponse) {
            logger.info('Upstream query failed, serving stale cache', { domain, type });
            // Update the query ID in stale response to match the current query
            const queryId = msg.readUInt16BE(0);
            response = Buffer.from(staleResponse);
            response.writeUInt16BE(queryId, 0);
            isCached = true;
          } else {
            throw error;
          }
        }
      }
    }

    // Extract rcode from response (lower 4 bits of flags field)
    const responseFlags = response.readUInt16BE(2);
    const rcode = responseFlags & 0x0f;

    const responseTime = Date.now() - startTime;
    const queryType = type === 1 ? 'A' : type === 28 ? 'AAAA' : `TYPE${type}`;
    const query: DNSQuery = {
      id: queryId,
      domain,
      type: queryType,
      blocked,
      timestamp: Date.now(),
      clientIp,
      blockReason: blockResult.reason,
      cached: isCached,
      responseTime,
      rcode,
    };

    this.addQuery(query);

    // Record OpenTelemetry metrics
    recordDNSQuery({
      domain,
      type: queryType,
      blocked,
      cached: isCached,
      blockReason: blockResult.reason,
      rcode,
      responseTime,
      clientIp,
    });

    if (isCached) {
      recordCacheMetrics('hit', domain, queryType);
    }

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
            // Check if it's a zone transfer request (AXFR/IXFR)
            if (dnsMsg.length >= 12) {
              const flags = dnsMsg.readUInt16BE(2);
              const isQuery = (flags & 0x8000) === 0;

              if (isQuery) {
                // Parse query to get domain and type
                let offset = 12;
                const domainParts: string[] = [];
                while (offset < dnsMsg.length && dnsMsg[offset] !== 0) {
                  const length = dnsMsg[offset];
                  if ((length & 0xc0) === 0xc0) {
                    offset += 2;
                    break;
                  }
                  offset++;
                  if (offset + length > dnsMsg.length) break;
                  domainParts.push(dnsMsg.toString('utf8', offset, offset + length));
                  offset += length;
                }
                offset++; // Skip null terminator

                if (offset + 4 <= dnsMsg.length) {
                  const queryType = dnsMsg.readUInt16BE(offset);
                  const domain = domainParts.join('.');

                  // Handle zone transfers (AXFR=252, IXFR=251)
                  if (queryType === 252 || queryType === 251) {
                    const zone = dbZones.findZoneForDomain(domain);
                    if (zone) {
                      const queryId = dnsMsg.readUInt16BE(0);
                      let requestedSerial = 0;

                      // For IXFR, try to parse requested serial from authority section
                      if (queryType === 251) {
                        // IXFR queries may include SOA in authority section
                        // For now, use current serial - 1 to trigger full transfer
                        requestedSerial = zone.soa_serial - 1;
                      }

                      const transferRecords =
                        queryType === 252 ? handleAXFR(zone.id, queryId) : handleIXFR(zone.id, queryId, requestedSerial);

                      // Send each record with TCP length prefix
                      for (const record of transferRecords) {
                        const lengthPrefix = Buffer.alloc(2);
                        lengthPrefix.writeUInt16BE(record.length, 0);
                        socket.write(Buffer.concat([lengthPrefix, record]));
                      }

                      socket.end();
                      return;
                    }
                  }
                }
              }
            }

            // Handle normal DNS query
            const response = await this.handleDNSQuery(dnsMsg, clientIp, true);

            // Send response with length prefix
            const responseLength = Buffer.allocUnsafe(2);
            responseLength.writeUInt16BE(response.length, 0);
            socket.write(Buffer.concat([responseLength, response]));
          } catch (error) {
            logger.error('Error handling DNS query', {
              error: error instanceof Error ? error : new Error(String(error)),
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
      logger.error('Connection error', {
        error: err instanceof Error ? err : new Error(String(err)),
      });
    });

    socket.on('close', () => {
      // Connection closed
    });
  }

  private async startUDP(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let udpServerStarted = false;
      this.server.on('message', async (msg, rinfo) => {
        try {
          const response = await this.handleDNSQuery(msg, rinfo.address, false);
          this.server.send(response, rinfo.port, rinfo.address, (err) => {
            if (err) {
              logger.error('Error sending UDP response', {
                error: err instanceof Error ? err : new Error(String(err)),
                clientIp: rinfo.address,
              });
            }
          });
        } catch (error) {
          logger.error('Error handling UDP query', {
            error: error instanceof Error ? error : new Error(String(error)),
            clientIp: rinfo.address,
            stack: error instanceof Error ? error.stack : undefined,
          });
          try {
            const errorResponse = this.createDNSResponse(msg, true);
            this.server.send(errorResponse, rinfo.port, rinfo.address, (err) => {
              if (err) {
                logger.error('Error sending UDP error response', {
                  error: err instanceof Error ? err : new Error(String(err)),
                });
              }
            });
          } catch (sendError) {
            logger.error('Failed to send error response', {
              error: sendError instanceof Error ? sendError : new Error(String(sendError)),
            });
          }
        }
      });

      this.server.on('error', (err) => {
        logger.error('UDP DNS server error', {
          error: err instanceof Error ? err : new Error(String(err)),
        });
        // Only reject if we haven't started yet (binding phase)
        // After binding, errors should be logged but not crash the server
        if (udpServerStarted) {
          logger.warn('UDP server error after startup - attempting to continue', {
            error: err instanceof Error ? err.message : String(err),
          });
        } else {
          reject(err);
        }
      });

      this.server.bind(this.port, this.bindAddress, () => {
        udpServerStarted = true;
        logger.info('DNS server (UDP) running', { port: this.port, address: this.bindAddress });
        resolve();
      });
    });
  }

  private async startTCP(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.tcpServer.on('connection', (socket) => {
        this.setupTCPSocket(socket);
      });

      let tcpServerStarted = false;
      this.tcpServer.on('error', (err) => {
        logger.error('TCP DNS server error', {
          error: err instanceof Error ? err : new Error(String(err)),
        });
        // Only reject if we haven't started yet (listening phase)
        // After listening, errors should be logged but not crash the server
        if (tcpServerStarted) {
          logger.warn('TCP server error after startup - attempting to continue', {
            error: err instanceof Error ? err.message : String(err),
          });
        } else {
          reject(err);
        }
      });

      this.tcpServer.listen(this.port, this.bindAddress, () => {
        tcpServerStarted = true;
        logger.info('DNS server (TCP) running', { port: this.port, address: this.bindAddress });
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
        logger.error('Certificate file not found', {
          error: new Error(`Certificate file not found: ${certPath}`),
          certPath,
          originalPath: dbSettings.get('dotCertPath', ''),
          projectRoot,
        });
        throw new Error(`Certificate file not found: ${certPath}`);
      }
      if (!existsSync(keyPath)) {
        logger.error('Private key file not found', {
          error: new Error(`Private key file not found: ${keyPath}`),
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
          logger.error('DoT server error', {
            error: err instanceof Error ? err : new Error(String(err)),
          });
          reject(err);
        });

        this.dotServer.listen(this.dotPort, this.bindAddress, () => {
          logger.info('DNS server (DoT) running', { port: this.dotPort, address: this.bindAddress });
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

    // Start DoQ if enabled (optional, requires Node.js 25+)
    servers.push(this.startDoQ());

    // Wait for all servers to start (or fail gracefully)
    await Promise.allSettled(servers);
  }

  stop() {
    this.server.close();
    this.tcpServer.close();
    if (this.dotServer) {
      this.dotServer.close();
    }
    if (this.doqServer) {
      this.doqServer.close();
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

  private async startDoQ(): Promise<void> {
    const doqEnabled = dbSettings.get('doqEnabled', 'false') === 'true';
    if (!doqEnabled) {
      return Promise.resolve();
    }

    try {
      // Check if QUIC is available (Node.js 25+)
      // QUIC support is experimental and may not be available
      let createQuicSocket: any;
      try {
        // @ts-ignore - QUIC is experimental
        const netModule = await import('net');
        // @ts-ignore - QUIC is experimental
        createQuicSocket = netModule.createQuicSocket;
      } catch {
        // QUIC not available
      }

      if (!createQuicSocket) {
        logger.warn('DoQ server disabled - QUIC not available', {
          note: 'DoQ requires Node.js 25+',
        });
        return Promise.resolve();
      }

      const doqPort = parseInt(dbSettings.get('doqPort', '853'), 10);
      const certPath = dbSettings.get('doqCertPath', dbSettings.get('dotCertPath', ''));
      const keyPath = dbSettings.get('doqKeyPath', dbSettings.get('dotKeyPath', ''));

      if (!certPath || !keyPath) {
        logger.warn('DoQ server disabled - certificates not configured', {
          note: 'DoQ requires TLS certificates (can reuse DoT certificates)',
        });
        return Promise.resolve();
      }

      const fs = await import('fs');
      const { existsSync } = fs;
      const { resolve, basename } = await import('path');

      // Resolve certificate paths (similar to DoT)
      let resolvedCertPath = certPath;
      let resolvedKeyPath = keyPath;

      if (certPath.startsWith('./')) {
        resolvedCertPath = certPath.substring(2);
      }
      if (keyPath.startsWith('./')) {
        resolvedKeyPath = keyPath.substring(2);
      }

      // Find project root
      let projectRoot = process.cwd();
      let currentDir = projectRoot;
      let found = false;

      for (let i = 0; i < 5; i++) {
        const serverDir = resolve(currentDir, 'server');
        const clientDir = resolve(currentDir, 'client');
        if (existsSync(serverDir) && existsSync(clientDir)) {
          projectRoot = currentDir;
          found = true;
          break;
        }
        const parent = resolve(currentDir, '..');
        if (parent === currentDir) break;
        currentDir = parent;
      }

      if (!found && basename(projectRoot) === 'server') {
        projectRoot = resolve(projectRoot, '..');
      }

      if (!resolvedCertPath.startsWith('/')) {
        resolvedCertPath = resolve(projectRoot, resolvedCertPath);
      }
      if (!resolvedKeyPath.startsWith('/')) {
        resolvedKeyPath = resolve(projectRoot, resolvedKeyPath);
      }

      if (!existsSync(resolvedCertPath) || !existsSync(resolvedKeyPath)) {
        logger.warn('DoQ server disabled - certificate files not found', {
          certPath: resolvedCertPath,
          keyPath: resolvedKeyPath,
        });
        return Promise.resolve();
      }

      logger.debug('Starting DoQ server', { port: doqPort });

      return new Promise<void>((resolve, reject) => {
        try {
          // Create QUIC socket for DoQ (RFC 9250)
          // DoQ uses the "doq" ALPN protocol identifier
          // Check environment variable first, then database setting, then default to localhost for safety
          const bindAddress = process.env.DNS_BIND_ADDRESS || dbSettings.get('dnsBindAddress', '127.0.0.1');
          this.doqServer = createQuicSocket({
            endpoint: {
              address: bindAddress,
              port: doqPort,
            },
            server: {
              key: fs.readFileSync(resolvedKeyPath),
              cert: fs.readFileSync(resolvedCertPath),
              alpn: 'doq', // DNS-over-QUIC ALPN identifier
            },
          });

          this.doqServer.on('session', (session: any) => {
            // Handle new QUIC session
            session.on('stream', (stream: any) => {
              // DoQ uses QUIC streams to send DNS messages
              // Each DNS message is sent as a stream
              const clientIp = session.remote?.address || 'unknown';
              let buffer = Buffer.alloc(0);

              stream.on('data', async (data: Buffer) => {
                buffer = Buffer.concat([buffer, data]);
              });

              stream.on('end', async () => {
                if (buffer.length > 0) {
                  try {
                    const response = await this.handleDNSQuery(buffer, clientIp, false);
                    stream.write(response);
                    stream.end();
                  } catch (error) {
                    logger.error('Error handling DoQ query', {
                      error: error instanceof Error ? error : new Error(String(error)),
                      clientIp,
                    });
                    stream.end();
                  }
                }
              });

              stream.on('error', (err: Error) => {
                logger.error('DoQ stream error', {
                  error: err instanceof Error ? err : new Error(String(err)),
                  clientIp,
                });
              });
            });

            session.on('error', (err: Error) => {
              logger.error('DoQ session error', {
                error: err instanceof Error ? err : new Error(String(err)),
              });
            });
          });

          this.doqServer.on('error', (err: Error) => {
            logger.error('DoQ server error', {
              error: err instanceof Error ? err : new Error(String(err)),
            });
            reject(err);
          });

          this.doqServer.on('ready', () => {
            logger.info('DNS server (DoQ) running', { port: doqPort, address: bindAddress });
            resolve();
          });

          this.doqServer.listen();
        } catch (error) {
          logger.warn('DoQ server disabled', {
            error: error instanceof Error ? error.message : 'Unknown error',
            note: 'DoQ requires Node.js 25+',
          });
          resolve(); // Don't fail startup if DoQ can't start
        }
      });
    } catch (error) {
      logger.warn('DoQ server disabled', {
        error: error instanceof Error ? error.message : 'Unknown error',
        note: 'DoQ requires Node.js 20+ with --experimental-quic flag',
      });
      return Promise.resolve();
    }
  }

  async stopDoQ(): Promise<void> {
    if (this.doqServer) {
      return new Promise<void>((resolve) => {
        this.doqServer!.close(() => {
          logger.info('DNS server (DoQ) stopped');
          this.doqServer = null;
          resolve();
        });
      });
    }
    return Promise.resolve();
  }

  async restartDoQ(): Promise<void> {
    logger.info('Restarting DoQ server...');
    await this.stopDoQ();
    const doqEnabled = dbSettings.get('doqEnabled', 'false') === 'true';
    if (doqEnabled) {
      this.doqPort = parseInt(dbSettings.get('doqPort', '853'), 10);
      await this.startDoQ();
    }
  }
}
