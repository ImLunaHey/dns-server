import { describe, it, expect, beforeEach } from 'vitest';
import { dbTSIGKeys, dbZones, dbZoneRecords } from '../src/db';
import db from '../src/db';

describe('Dynamic DNS (DDNS) Support', () => {
  beforeEach(() => {
    // Clear test data
    const clearTSIG = db.prepare('DELETE FROM tsig_keys WHERE name LIKE ?');
    clearTSIG.run('test-%');
    const clearZones = db.prepare('DELETE FROM zones WHERE domain LIKE ?');
    clearZones.run('test-ddns%');
  });

  describe('TSIG Key Management', () => {
    it('should create TSIG key', () => {
      const keyId = dbTSIGKeys.create('test-key', 'hmac-sha256', 'test-secret');
      expect(keyId).toBeGreaterThan(0);

      const key = dbTSIGKeys.getByName('test-key');
      expect(key).not.toBeNull();
      expect(key?.name).toBe('test-key');
      expect(key?.algorithm).toBe('hmac-sha256');
      expect(key?.secret).toBe('test-secret');
    });

    it('should retrieve TSIG key by name', () => {
      dbTSIGKeys.create('test-key', 'hmac-sha256', 'test-secret');

      const key = dbTSIGKeys.getByName('test-key');
      expect(key).not.toBeNull();
      expect(key?.name).toBe('test-key');
    });

    it('should not retrieve disabled TSIG keys', () => {
      const keyId = dbTSIGKeys.create('test-key', 'hmac-sha256', 'test-secret');
      dbTSIGKeys.setEnabled(keyId, false);

      const key = dbTSIGKeys.getByName('test-key');
      expect(key).toBeNull();
    });

    it('should get all TSIG keys', () => {
      dbTSIGKeys.create('test-key1', 'hmac-sha256', 'secret1');
      dbTSIGKeys.create('test-key2', 'hmac-sha1', 'secret2');

      const keys = dbTSIGKeys.getAll();
      expect(keys.length).toBeGreaterThanOrEqual(2);
      const testKeys = keys.filter((k) => k.name.startsWith('test-'));
      expect(testKeys.length).toBe(2);
    });

    it('should enable/disable TSIG keys', () => {
      const keyId = dbTSIGKeys.create('test-key', 'hmac-sha256', 'test-secret');

      dbTSIGKeys.setEnabled(keyId, false);
      expect(dbTSIGKeys.getByName('test-key')).toBeNull();

      dbTSIGKeys.setEnabled(keyId, true);
      expect(dbTSIGKeys.getByName('test-key')).not.toBeNull();
    });

    it('should delete TSIG keys', () => {
      const keyId = dbTSIGKeys.create('test-key', 'hmac-sha256', 'test-secret');

      dbTSIGKeys.delete(keyId);

      const key = dbTSIGKeys.getByName('test-key');
      expect(key).toBeNull();
    });
  });

  describe('DDNS Integration', () => {
    it('should have TSIG key database functions', () => {
      expect(typeof dbTSIGKeys.create).toBe('function');
      expect(typeof dbTSIGKeys.getByName).toBe('function');
      expect(typeof dbTSIGKeys.getAll).toBe('function');
      expect(typeof dbTSIGKeys.setEnabled).toBe('function');
      expect(typeof dbTSIGKeys.delete).toBe('function');
    });

    it('should support multiple TSIG algorithms', () => {
      dbTSIGKeys.create('hmac-sha256-key', 'hmac-sha256', 'secret');
      dbTSIGKeys.create('hmac-sha1-key', 'hmac-sha1', 'secret');
      dbTSIGKeys.create('hmac-md5-key', 'hmac-md5', 'secret');

      expect(dbTSIGKeys.getByName('hmac-sha256-key')).not.toBeNull();
      expect(dbTSIGKeys.getByName('hmac-sha1-key')).not.toBeNull();
      expect(dbTSIGKeys.getByName('hmac-md5-key')).not.toBeNull();
    });
  });
});
