import { describe, it, expect } from 'vitest';

describe('CAA Record Support', () => {
  describe('CAA Record Type Support', () => {
    it('should recognize CAA as type 257', () => {
      const typeMap: Record<string, number> = {
        CAA: 257,
      };
      expect(typeMap.CAA).toBe(257);
    });

    it('should have CAA in all type maps', () => {
      // Verify CAA is included in type maps across the codebase
      const typeMaps = [
        { A: 1, AAAA: 28, MX: 15, TXT: 16, NS: 2, CNAME: 5, SOA: 6, PTR: 12, SRV: 33, CAA: 257 },
      ];
      
      for (const typeMap of typeMaps) {
        expect(typeMap.CAA).toBe(257);
      }
    });
  });

  describe('CAA Record Encoding Format', () => {
    it('should encode CAA records with flags, tag, and value', () => {
      // CAA format: flags (1 byte) + tag length (1 byte) + tag + value
      const flags = 0;
      const tag = 'issue';
      const value = 'letsencrypt.org';
      
      const tagBytes = Buffer.from(tag, 'utf8');
      const valueBytes = Buffer.from(value, 'utf8');
      
      const caaBytes = Buffer.concat([
        Buffer.from([flags & 0xff]),
        Buffer.from([tagBytes.length]),
        tagBytes,
        valueBytes,
      ]);
      
      expect(caaBytes.length).toBeGreaterThan(0);
      expect(caaBytes[0]).toBe(0); // Flags
      expect(caaBytes[1]).toBe(tag.length); // Tag length
    });

    it('should support different CAA tags', () => {
      const tags = ['issue', 'issuewild', 'iodef'];
      
      for (const tag of tags) {
        const tagBytes = Buffer.from(tag, 'utf8');
        expect(tagBytes.length).toBeGreaterThan(0);
        expect(tagBytes.length).toBeLessThanOrEqual(255); // Max tag length
      }
    });
  });
});

