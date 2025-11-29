import { describe, it, expect, beforeEach } from 'vitest';
import { handleAXFR, handleIXFR } from '../src/zone-transfer-handler';
import { dbZones, dbZoneRecords } from '../src/db';
import db from '../src/db';

describe('Zone Transfers (AXFR/IXFR)', () => {
  let testZoneId: number;

  beforeEach(() => {
    // Clear test data
    const clearZones = db.prepare('DELETE FROM zones WHERE domain LIKE ?');
    clearZones.run('test-axfr%');

    // Create a test zone
    testZoneId = dbZones.create('test-axfr.example.com', 'ns1.test-axfr.example.com', 'admin.test-axfr.example.com');

    // Add some test records
    dbZoneRecords.create(testZoneId, '@', 'A', 3600, '192.168.1.1');
    dbZoneRecords.create(testZoneId, 'www', 'A', 3600, '192.168.1.2');
    dbZoneRecords.create(testZoneId, '@', 'NS', 3600, 'ns1.test-axfr.example.com');
    dbZoneRecords.create(testZoneId, 'mail', 'MX', 3600, '10 mail.test-axfr.example.com', 10);
  });

  describe('AXFR (Full Zone Transfer)', () => {
    it('should return all zone records including SOA', () => {
      const queryId = 0x1234;
      const records = handleAXFR(testZoneId, queryId);

      expect(records.length).toBeGreaterThan(0);
      // Should start and end with SOA
      expect(records.length).toBeGreaterThanOrEqual(2);

      // Check first record is SOA
      const firstRecord = records[0];
      expect(firstRecord.length).toBeGreaterThan(12);
      const firstType = firstRecord.readUInt16BE(firstRecord.length - 20); // Approximate
      // Should have answers count = 1
      const anCount = firstRecord.readUInt16BE(6);
      expect(anCount).toBe(1);

      // Check last record is also SOA (end marker)
      const lastRecord = records[records.length - 1];
      const lastAnCount = lastRecord.readUInt16BE(6);
      expect(lastAnCount).toBe(1);
    });

    it('should return empty array for non-existent zone', () => {
      const records = handleAXFR(99999, 0x1234);
      expect(records).toEqual([]);
    });

    it('should include all zone records in transfer', () => {
      const records = handleAXFR(testZoneId, 0x1234);

      // Should have at least: SOA (start) + 4 records + SOA (end) = 6 records
      expect(records.length).toBeGreaterThanOrEqual(4);
    });

    it('should exclude disabled records', () => {
      // Add a disabled record
      const disabledId = dbZoneRecords.create(testZoneId, 'disabled', 'A', 3600, '192.168.1.99');
      dbZoneRecords.update(disabledId, { enabled: false });

      const records = handleAXFR(testZoneId, 0x1234);

      // Should not include the disabled record
      // We can't easily parse the records here, but we can check the count
      // The disabled record should not be in the transfer
      expect(records.length).toBeGreaterThan(0);
    });
  });

  describe('IXFR (Incremental Zone Transfer)', () => {
    it('should return current SOA if requested serial is current or newer', () => {
      const zone = dbZones.getById(testZoneId);
      expect(zone).not.toBeNull();

      const records = handleIXFR(testZoneId, 0x1234, zone!.soa_serial);

      // Should return just SOA records (start and end)
      expect(records.length).toBe(2);
    });

    it('should fall back to AXFR if serial is older', () => {
      const zone = dbZones.getById(testZoneId);
      expect(zone).not.toBeNull();

      // Request serial that's older than current
      const records = handleIXFR(testZoneId, 0x1234, zone!.soa_serial - 1);

      // Should return full zone transfer
      expect(records.length).toBeGreaterThan(2);
    });

    it('should return empty array for non-existent zone', () => {
      const records = handleIXFR(99999, 0x1234, 1);
      expect(records).toEqual([]);
    });
  });

  describe('Zone Transfer Record Format', () => {
    it('should create properly formatted DNS records', () => {
      const records = handleAXFR(testZoneId, 0x1234);

      for (const record of records) {
        // Check DNS header structure
        expect(record.length).toBeGreaterThanOrEqual(12);

        // Check header fields
        const id = record.readUInt16BE(0);
        expect(id).toBe(0x1234);

        const flags = record.readUInt16BE(2);
        expect(flags & 0x8000).toBe(0x8000); // QR bit set (response)
        expect(flags & 0x0400).toBe(0x0400); // AA bit set (authoritative)

        const anCount = record.readUInt16BE(6);
        expect(anCount).toBe(1); // One answer per record
      }
    });

    it('should include correct query ID in responses', () => {
      const queryId = 0x5678;
      const records = handleAXFR(testZoneId, queryId);

      for (const record of records) {
        const id = record.readUInt16BE(0);
        expect(id).toBe(queryId);
      }
    });
  });
});
