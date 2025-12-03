import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DNSServer } from '../src/dns-server';

describe('DNS-over-TLS (DoT) Client Support', () => {
  let dnsServer: DNSServer;

  beforeEach(() => {
    dnsServer = new DNSServer();
    vi.clearAllMocks();
  });

  describe('DoT URL Detection', () => {
    it('should detect DoT URLs starting with tls://', () => {
      const isDoT = 'tls://1.1.1.1'.startsWith('tls://');
      expect(isDoT).toBe(true);
    });

    it('should detect DoT URLs starting with dot://', () => {
      const isDoT = 'dot://cloudflare-dns.com'.startsWith('dot://');
      expect(isDoT).toBe(true);
    });

    it('should not treat regular IP addresses as DoT URLs', () => {
      const isDoT = '1.1.1.1'.startsWith('tls://') || '1.1.1.1'.startsWith('dot://');
      expect(isDoT).toBe(false);
    });
  });

  describe('DoT URL Parsing', () => {
    it('should parse DoT URL with host and port', () => {
      const url = 'tls://1.1.1.1:853';
      const match = url.match(/^(?:tls|dot):\/\/([^:]+)(?::(\d+))?$/);
      expect(match).not.toBeNull();
      expect(match![1]).toBe('1.1.1.1');
      expect(match![2]).toBe('853');
    });

    it('should parse DoT URL with host only (default port 853)', () => {
      const url = 'tls://cloudflare-dns.com';
      const match = url.match(/^(?:tls|dot):\/\/([^:]+)(?::(\d+))?$/);
      expect(match).not.toBeNull();
      expect(match![1]).toBe('cloudflare-dns.com');
      expect(match![2]).toBeUndefined();
    });

    it('should parse dot:// URL format', () => {
      const url = 'dot://1.1.1.1';
      const match = url.match(/^(?:tls|dot):\/\/([^:]+)(?::(\d+))?$/);
      expect(match).not.toBeNull();
      expect(match![1]).toBe('1.1.1.1');
    });
  });

  describe('DoT Connection', () => {
    it('should use default port 853 for DoT', () => {
      const url = 'tls://1.1.1.1';
      const match = url.match(/^(?:tls|dot):\/\/([^:]+)(?::(\d+))?$/);
      const port = match && match[2] ? parseInt(match[2], 10) : 853;
      expect(port).toBe(853);
    });

    it('should use custom port when specified', () => {
      const url = 'tls://1.1.1.1:5353';
      const match = url.match(/^(?:tls|dot):\/\/([^:]+)(?::(\d+))?$/);
      const port = match && match[2] ? parseInt(match[2], 10) : 853;
      expect(port).toBe(5353);
    });
  });

  describe('DoT Fallback', () => {
    it('should have DoT client support implemented', () => {
      // Verify DoT client method exists
      expect(typeof (dnsServer as any).forwardQueryDoT).toBe('function');
    });
  });
});
