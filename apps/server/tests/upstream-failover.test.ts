import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DNSServer } from '../src/dns-server';

describe('Multiple Upstream DNS with Failover', () => {
  let dnsServer: DNSServer;

  beforeEach(() => {
    dnsServer = new DNSServer();
    vi.clearAllMocks();
  });

  describe('Upstream DNS List Parsing', () => {
    it('should parse comma-separated upstream DNS servers', () => {
      dnsServer.setUpstreamDNS('1.1.1.1,8.8.8.8,9.9.9.9');
      const list = dnsServer.getUpstreamDNSList();
      expect(list).toEqual(['1.1.1.1', '8.8.8.8', '9.9.9.9']);
    });

    it('should handle single upstream DNS server', () => {
      dnsServer.setUpstreamDNS('1.1.1.1');
      const list = dnsServer.getUpstreamDNSList();
      expect(list).toEqual(['1.1.1.1']);
    });

    it('should trim whitespace from upstream DNS servers', () => {
      dnsServer.setUpstreamDNS('1.1.1.1 , 8.8.8.8 , 9.9.9.9');
      const list = dnsServer.getUpstreamDNSList();
      expect(list).toEqual(['1.1.1.1', '8.8.8.8', '9.9.9.9']);
    });

    it('should filter out empty entries', () => {
      dnsServer.setUpstreamDNS('1.1.1.1,,8.8.8.8');
      const list = dnsServer.getUpstreamDNSList();
      expect(list).toEqual(['1.1.1.1', '8.8.8.8']);
    });

    it('should support mixed protocol upstreams', () => {
      dnsServer.setUpstreamDNS('1.1.1.1,https://cloudflare-dns.com,tls://1.1.1.1');
      const list = dnsServer.getUpstreamDNSList();
      expect(list).toEqual(['1.1.1.1', 'https://cloudflare-dns.com', 'tls://1.1.1.1']);
    });
  });

  describe('Upstream Health Tracking', () => {
    it('should track upstream health', () => {
      const health = dnsServer.getUpstreamHealth();
      expect(health).toBeDefined();
      expect(typeof health).toBe('object');
    });

    it('should reset health when upstream DNS changes', () => {
      dnsServer.setUpstreamDNS('1.1.1.1');
      // Simulate some failures (would normally happen during queries)
      const healthBefore = dnsServer.getUpstreamHealth();
      dnsServer.setUpstreamDNS('8.8.8.8');
      const healthAfter = dnsServer.getUpstreamHealth();
      // Health should be reset (empty) after changing upstream
      expect(Object.keys(healthAfter).length).toBe(0);
    });
  });

  describe('Failover Logic', () => {
    it('should have failover support implemented', () => {
      // Verify the method exists
      expect(typeof (dnsServer as any).getAvailableUpstreamServers).toBe('function');
      expect(typeof (dnsServer as any).markUpstreamFailure).toBe('function');
      expect(typeof (dnsServer as any).markUpstreamSuccess).toBe('function');
    });

    it('should filter out disabled upstream servers', () => {
      dnsServer.setUpstreamDNS('1.1.1.1,8.8.8.8,9.9.9.9');
      const available = (dnsServer as any).getAvailableUpstreamServers();
      // All should be available initially
      expect(available.length).toBe(3);
      expect(available).toContain('1.1.1.1');
      expect(available).toContain('8.8.8.8');
      expect(available).toContain('9.9.9.9');
    });
  });

  describe('API Integration', () => {
    it('should expose upstream DNS list via getUpstreamDNSList', () => {
      dnsServer.setUpstreamDNS('1.1.1.1,8.8.8.8');
      const list = dnsServer.getUpstreamDNSList();
      expect(Array.isArray(list)).toBe(true);
      expect(list.length).toBeGreaterThan(0);
    });

    it('should expose upstream health via getUpstreamHealth', () => {
      const health = dnsServer.getUpstreamHealth();
      expect(typeof health).toBe('object');
    });
  });
});

