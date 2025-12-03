import { describe, it, expect, beforeEach } from 'vitest';
import { DNSServer } from '../src/dns-server';
import { dbCache, dbQueries } from '../src/db';
import db from '../src/db';

describe('DNS Cache Features', () => {
  let dnsServer: DNSServer;

  beforeEach(() => {
    // Clear cache and queries before each test
    dbCache.clear();
    // Clear queries table
    const clearQueries = db.prepare('DELETE FROM queries');
    clearQueries.run();

    dnsServer = new DNSServer();
  });

  describe('Serve Stale Cache', () => {
    it('should return stale cache entry when enabled and entry is expired but within max age', () => {
      dnsServer.setServeStaleEnabled(true);
      dnsServer.setServeStaleMaxAge(604800); // 7 days

      const domain = 'example.com';
      const type = 1; // A record
      const response = Buffer.from([
        0x12, 0x34, 0x81, 0x80, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x07, 0x65, 0x78, 0x61, 0x6d, 0x70, 0x6c,
        0x65, 0x03, 0x63, 0x6f, 0x6d, 0x00, 0x00, 0x01, 0x00, 0x01, 0xc0, 0x0c, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x04, 0x93, 0x18, 0x4d, 0x12,
      ]);

      // Store expired cache entry (expired 1 hour ago, but within 7 day max age)
      const expiredAt = Date.now() - 60 * 60 * 1000;
      dbCache.set(domain, type, response, expiredAt);

      // getCachedResponse with allowStale=true should return the expired entry
      const cached = (dnsServer as any).getCachedResponse(domain, type, true);
      expect(cached).not.toBeNull();
      expect(Buffer.isBuffer(cached)).toBe(true);
      expect(cached.length).toBeGreaterThan(0);
    });

    it('should not return stale cache entry when disabled', () => {
      dnsServer.setServeStaleEnabled(false);

      const domain = 'example.com';
      const type = 1;
      const response = Buffer.from([0x12, 0x34, 0x81, 0x80]);
      const expiredAt = Date.now() - 1000;
      dbCache.set(domain, type, response, expiredAt);

      // getCachedResponse with allowStale=false should not return expired entry
      const cached = (dnsServer as any).getCachedResponse(domain, type, false);
      expect(cached).toBeNull();
    });

    it('should not return stale cache entry beyond max age', () => {
      dnsServer.setServeStaleEnabled(true);
      dnsServer.setServeStaleMaxAge(3600); // 1 hour max age

      const domain = 'example.com';
      const type = 1;
      const response = Buffer.from([0x12, 0x34, 0x81, 0x80]);

      // Expired 2 hours ago (beyond max age)
      const expiredAt = Date.now() - 2 * 60 * 60 * 1000;
      dbCache.set(domain, type, response, expiredAt);

      // Should not return entry that's too old
      const cached = (dnsServer as any).getCachedResponse(domain, type, true);
      expect(cached).toBeNull();
    });

    it('should return valid (non-expired) cache entries normally', () => {
      const domain = 'example.com';
      const type = 1;
      const response = Buffer.from([0x12, 0x34, 0x81, 0x80]);

      // Not expired yet (expires in 1 hour)
      const expiresAt = Date.now() + 60 * 60 * 1000;
      dbCache.set(domain, type, response, expiresAt);

      // Should return valid cache entry
      const cached = (dnsServer as any).getCachedResponse(domain, type, false);
      expect(cached).not.toBeNull();
      expect(Buffer.isBuffer(cached)).toBe(true);
    });
  });

  describe('Prefetch Popular Domains', () => {
    it('should identify popular domains for prefetching', () => {
      // Add query history
      const now = Date.now();
      const oneDayAgo = now - 24 * 60 * 60 * 1000;

      // Create multiple queries for a domain to make it popular
      for (let i = 0; i < 15; i++) {
        dbQueries.insert({
          id: `test-${i}`,
          domain: 'popular.example.com',
          type: 'A',
          blocked: false,
          timestamp: oneDayAgo + i * 1000,
          clientIp: '127.0.0.1',
          cached: false,
        });
      }

      // Get popular domains with threshold of 10
      const popularDomains = dbQueries.getPopularDomains(oneDayAgo, 10);

      // Should find our popular domain
      const popularDomain = popularDomains.find((d) => d.domain === 'popular.example.com');
      expect(popularDomain).toBeDefined();
      expect(popularDomain?.count).toBeGreaterThanOrEqual(10);
      expect(popularDomain?.type).toBe(1); // A record
    });

    it('should not identify domains below minimum query threshold', () => {
      const now = Date.now();
      const oneDayAgo = now - 24 * 60 * 60 * 1000;

      // Create only a few queries (below threshold)
      for (let i = 0; i < 5; i++) {
        dbQueries.insert({
          id: `test-${i}`,
          domain: 'unpopular.example.com',
          type: 'A',
          blocked: false,
          timestamp: oneDayAgo + i * 1000,
          clientIp: '127.0.0.1',
          cached: false,
        });
      }

      // Get popular domains with threshold of 10
      const popularDomains = dbQueries.getPopularDomains(oneDayAgo, 10);

      // Should not find our unpopular domain
      const unpopularDomain = popularDomains.find((d) => d.domain === 'unpopular.example.com');
      expect(unpopularDomain).toBeUndefined();
    });

    it('should handle different query types in popular domains', () => {
      const now = Date.now();
      const oneDayAgo = now - 24 * 60 * 60 * 1000;

      // Add AAAA queries
      for (let i = 0; i < 12; i++) {
        dbQueries.insert({
          id: `test-aaaa-${i}`,
          domain: 'ipv6.example.com',
          type: 'AAAA',
          blocked: false,
          timestamp: oneDayAgo + i * 1000,
          clientIp: '127.0.0.1',
          cached: false,
        });
      }

      const popularDomains = dbQueries.getPopularDomains(oneDayAgo, 10);
      const ipv6Domain = popularDomains.find((d) => d.domain === 'ipv6.example.com' && d.type === 28);
      expect(ipv6Domain).toBeDefined();
      expect(ipv6Domain?.type).toBe(28); // AAAA record
    });
  });

  describe('Cache Settings', () => {
    it('should update and persist serve stale settings', () => {
      dnsServer.setServeStaleEnabled(true);
      dnsServer.setServeStaleMaxAge(86400);

      const stats = dnsServer.getCacheStats();
      expect(stats.serveStaleEnabled).toBe(true);
      expect(stats.serveStaleMaxAge).toBe(86400);
    });

    it('should update and persist prefetch settings', () => {
      dnsServer.setPrefetchEnabled(true);
      dnsServer.setPrefetchThreshold(0.9);
      dnsServer.setPrefetchMinQueries(20);

      const stats = dnsServer.getCacheStats();
      expect(stats.prefetchEnabled).toBe(true);
      expect(stats.prefetchThreshold).toBe(0.9);
      expect(stats.prefetchMinQueries).toBe(20);
    });
  });
});
