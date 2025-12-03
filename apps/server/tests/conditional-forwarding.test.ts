import { describe, it, expect, beforeEach } from 'vitest';
import { dbConditionalForwarding } from '../src/db';
import db from '../src/db';

describe('Conditional Forwarding Improvements', () => {
  beforeEach(() => {
    // Clear conditional forwarding rules
    const clearStmt = db.prepare('DELETE FROM conditional_forwarding');
    clearStmt.run();
  });

  describe('Priority Ordering', () => {
    it('should order rules by priority (higher first)', () => {
      dbConditionalForwarding.add('example.com', '1.1.1.1', 'Low priority', 0);
      dbConditionalForwarding.add('test.com', '8.8.8.8', 'High priority', 10);
      dbConditionalForwarding.add('demo.com', '9.9.9.9', 'Medium priority', 5);

      const rules = dbConditionalForwarding.getAll();
      expect(rules[0].domain).toBe('test.com');
      expect(rules[0].priority).toBe(10);
      expect(rules[1].domain).toBe('demo.com');
      expect(rules[1].priority).toBe(5);
      expect(rules[2].domain).toBe('example.com');
      expect(rules[2].priority).toBe(0);
    });

    it('should use priority in matching when domain lengths are equal', () => {
      dbConditionalForwarding.add('sub.example.com', '1.1.1.1', 'Low priority', 0);
      dbConditionalForwarding.add('sub.example.com', '8.8.8.8', 'High priority', 10);

      // Should match the higher priority one (though exact match should take first exact)
      const upstream = dbConditionalForwarding.findUpstreamDNS('sub.example.com');
      expect(upstream).toBe('8.8.8.8');
    });
  });

  describe('Wildcard Matching', () => {
    it('should match wildcard patterns', () => {
      dbConditionalForwarding.add('*.local', '127.0.0.1', 'Local wildcard');
      dbConditionalForwarding.add('*.internal', '10.0.0.1', 'Internal wildcard');

      expect(dbConditionalForwarding.findUpstreamDNS('server.local')).toBe('127.0.0.1');
      expect(dbConditionalForwarding.findUpstreamDNS('www.local')).toBe('127.0.0.1');
      expect(dbConditionalForwarding.findUpstreamDNS('app.internal')).toBe('10.0.0.1');
      expect(dbConditionalForwarding.findUpstreamDNS('local')).toBe('127.0.0.1'); // Exact match to pattern
    });

    it('should not match non-matching wildcards', () => {
      dbConditionalForwarding.add('*.local', '127.0.0.1', 'Local wildcard');

      expect(dbConditionalForwarding.findUpstreamDNS('example.com')).toBeNull();
      expect(dbConditionalForwarding.findUpstreamDNS('local.example.com')).toBeNull();
    });
  });

  describe('Longest Match Wins', () => {
    it('should prefer longer domain matches', () => {
      dbConditionalForwarding.add('example.com', '1.1.1.1', 'Base domain');
      dbConditionalForwarding.add('sub.example.com', '8.8.8.8', 'Subdomain');

      // Longer match should win
      expect(dbConditionalForwarding.findUpstreamDNS('sub.example.com')).toBe('8.8.8.8');
      expect(dbConditionalForwarding.findUpstreamDNS('www.sub.example.com')).toBe('8.8.8.8');
      expect(dbConditionalForwarding.findUpstreamDNS('other.example.com')).toBe('1.1.1.1');
    });

    it('should prefer longer wildcard matches', () => {
      dbConditionalForwarding.add('*.com', '1.1.1.1', 'Generic com');
      dbConditionalForwarding.add('*.example.com', '8.8.8.8', 'Example com');

      // Longer match should win
      expect(dbConditionalForwarding.findUpstreamDNS('www.example.com')).toBe('8.8.8.8');
      expect(dbConditionalForwarding.findUpstreamDNS('test.example.com')).toBe('8.8.8.8');
      expect(dbConditionalForwarding.findUpstreamDNS('other.com')).toBe('1.1.1.1');
    });

    it('should prefer longer match even with lower priority', () => {
      dbConditionalForwarding.add('example.com', '1.1.1.1', 'Base', 10);
      dbConditionalForwarding.add('sub.example.com', '8.8.8.8', 'Sub', 0);

      // Longer match should win despite lower priority
      expect(dbConditionalForwarding.findUpstreamDNS('sub.example.com')).toBe('8.8.8.8');
    });
  });

  describe('Priority Tie-Breaking', () => {
    it('should use priority when match lengths are equal', () => {
      dbConditionalForwarding.add('test.example.com', '1.1.1.1', 'Low priority', 0);
      dbConditionalForwarding.add('test.example.com', '8.8.8.8', 'High priority', 10);

      // Both match same length, higher priority should win
      const upstream = dbConditionalForwarding.findUpstreamDNS('test.example.com');
      expect(upstream).toBe('8.8.8.8');
    });
  });

  describe('API Integration', () => {
    it('should support priority in add function', () => {
      dbConditionalForwarding.add('example.com', '1.1.1.1', 'Test', 5);
      const rules = dbConditionalForwarding.getAll();
      expect(rules[0].priority).toBe(5);
    });

    it('should support priority in update function', () => {
      const id = dbConditionalForwarding.add('example.com', '1.1.1.1', 'Test', 0);
      dbConditionalForwarding.update(id, 'example.com', '1.1.1.1', 'Test', 10);
      const rules = dbConditionalForwarding.getAll();
      expect(rules[0].priority).toBe(10);
    });
  });

  describe('Backward Compatibility', () => {
    it('should work with existing rules without priority', () => {
      // Add rule without priority (should default to 0)
      const stmt = db.prepare(`
        INSERT INTO conditional_forwarding (domain, upstreamDNS, enabled, comment, createdAt, updatedAt)
        VALUES (?, ?, 1, ?, ?, ?)
      `);
      stmt.run('example.com', '1.1.1.1', 'Test', Date.now(), Date.now());

      const upstream = dbConditionalForwarding.findUpstreamDNS('example.com');
      expect(upstream).toBe('1.1.1.1');
    });

    it('should handle missing priority field gracefully', () => {
      dbConditionalForwarding.add('example.com', '1.1.1.1');
      const rules = dbConditionalForwarding.getAll();
      expect(rules[0].priority).toBeDefined();
      expect(typeof rules[0].priority).toBe('number');
    });
  });
});
