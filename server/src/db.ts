import Database from 'better-sqlite3';
import { join } from 'path';
import { tmpdir } from 'os';
import { DNSQuery } from './dns-server.js';
import { logger } from './logger.js';

// Use temporary database for tests
const isTest = process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';
const dbPath = isTest
  ? join(tmpdir(), `dns-queries-test-${Date.now()}-${Math.random().toString(36).substring(7)}.db`)
  : join(process.cwd(), 'dns-queries.db');
const db = new Database(dbPath);

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS queries (
    id TEXT PRIMARY KEY,
    domain TEXT NOT NULL,
    type TEXT NOT NULL,
    blocked INTEGER NOT NULL,
    timestamp INTEGER NOT NULL,
    responseTime INTEGER,
    clientIp TEXT,
    blockReason TEXT,
    cached INTEGER DEFAULT 0,
    rcode INTEGER
  );

  CREATE TABLE IF NOT EXISTS client_names (
    clientIp TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    updatedAt INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS adlists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT NOT NULL UNIQUE,
    enabled INTEGER NOT NULL DEFAULT 1,
    domainCount INTEGER DEFAULT 0,
    addedAt INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS allowlist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    domain TEXT NOT NULL UNIQUE,
    addedAt INTEGER NOT NULL,
    comment TEXT
  );

  CREATE TABLE IF NOT EXISTS regex_filters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pattern TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL CHECK(type IN ('block', 'allow')),
    enabled INTEGER NOT NULL DEFAULT 1,
    addedAt INTEGER NOT NULL,
    comment TEXT
  );

  CREATE TABLE IF NOT EXISTS local_dns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    domain TEXT NOT NULL UNIQUE,
    ip TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'A',
    enabled INTEGER NOT NULL DEFAULT 1,
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updatedAt INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS blocklist_updates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    startedAt INTEGER NOT NULL,
    completedAt INTEGER,
    status TEXT NOT NULL CHECK(status IN ('running', 'completed', 'failed')),
    domainsAdded INTEGER DEFAULT 0,
    error TEXT
  );

  CREATE TABLE IF NOT EXISTS scheduled_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    taskType TEXT NOT NULL,
    schedule TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    lastRun INTEGER,
    nextRun INTEGER,
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS block_page_settings (
    id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    title TEXT,
    message TEXT,
    backgroundColor TEXT,
    textColor TEXT,
    logoUrl TEXT,
    updatedAt INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS client_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS client_group_members (
    groupId INTEGER NOT NULL,
    clientIp TEXT NOT NULL,
    PRIMARY KEY (groupId, clientIp),
    FOREIGN KEY (groupId) REFERENCES client_groups(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS client_blocking_rules (
    clientIp TEXT PRIMARY KEY,
    blockingEnabled INTEGER NOT NULL DEFAULT 1,
    updatedAt INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS group_blocking_rules (
    groupId INTEGER PRIMARY KEY,
    blockingEnabled INTEGER NOT NULL DEFAULT 1,
    updatedAt INTEGER NOT NULL,
    FOREIGN KEY (groupId) REFERENCES client_groups(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS client_allowlist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    clientIp TEXT NOT NULL,
    domain TEXT NOT NULL,
    addedAt INTEGER NOT NULL,
    UNIQUE(clientIp, domain)
  );

  CREATE TABLE IF NOT EXISTS client_blocklist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    clientIp TEXT NOT NULL,
    domain TEXT NOT NULL,
    addedAt INTEGER NOT NULL,
    UNIQUE(clientIp, domain)
  );

  CREATE TABLE IF NOT EXISTS group_allowlist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    groupId INTEGER NOT NULL,
    domain TEXT NOT NULL,
    addedAt INTEGER NOT NULL,
    UNIQUE(groupId, domain),
    FOREIGN KEY (groupId) REFERENCES client_groups(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS group_blocklist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    groupId INTEGER NOT NULL,
    domain TEXT NOT NULL,
    addedAt INTEGER NOT NULL,
    UNIQUE(groupId, domain),
    FOREIGN KEY (groupId) REFERENCES client_groups(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS manual_blocklist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    domain TEXT NOT NULL UNIQUE,
    addedAt INTEGER NOT NULL,
    comment TEXT
  );

  CREATE TABLE IF NOT EXISTS conditional_forwarding (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    domain TEXT NOT NULL,
    upstreamDNS TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    priority INTEGER NOT NULL DEFAULT 0,
    comment TEXT,
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS client_upstream_dns (
    clientIp TEXT PRIMARY KEY,
    upstreamDNS TEXT NOT NULL,
    updatedAt INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS rate_limits (
    clientIp TEXT PRIMARY KEY,
    queryCount INTEGER NOT NULL DEFAULT 0,
    windowStart INTEGER NOT NULL,
    blocked INTEGER NOT NULL DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_local_dns_domain ON local_dns(domain);
  CREATE INDEX IF NOT EXISTS idx_rate_limits_window ON rate_limits(windowStart);
  CREATE INDEX IF NOT EXISTS idx_conditional_forwarding_domain ON conditional_forwarding(domain);
  
  CREATE TABLE IF NOT EXISTS dns_cache (
    domain TEXT NOT NULL,
    type INTEGER NOT NULL,
    response BLOB NOT NULL,
    expiresAt INTEGER NOT NULL,
    PRIMARY KEY (domain, type)
  );

  CREATE INDEX IF NOT EXISTS idx_timestamp ON queries(timestamp DESC);
  CREATE INDEX IF NOT EXISTS idx_domain ON queries(domain);
  CREATE INDEX IF NOT EXISTS idx_clientIp ON queries(clientIp);
  CREATE INDEX IF NOT EXISTS idx_blocked ON queries(blocked);
  CREATE INDEX IF NOT EXISTS idx_cache_expires ON dns_cache(expiresAt);

  -- Authoritative DNS zones
  CREATE TABLE IF NOT EXISTS zones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    domain TEXT NOT NULL UNIQUE,
    enabled INTEGER NOT NULL DEFAULT 1,
    soa_serial INTEGER NOT NULL DEFAULT 1,
    soa_refresh INTEGER NOT NULL DEFAULT 3600,
    soa_retry INTEGER NOT NULL DEFAULT 600,
    soa_expire INTEGER NOT NULL DEFAULT 86400,
    soa_minimum INTEGER NOT NULL DEFAULT 3600,
    soa_mname TEXT NOT NULL,
    soa_rname TEXT NOT NULL,
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS zone_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    zone_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    ttl INTEGER NOT NULL DEFAULT 3600,
    data TEXT NOT NULL,
    priority INTEGER,
    enabled INTEGER NOT NULL DEFAULT 1,
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL,
    FOREIGN KEY (zone_id) REFERENCES zones(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_zones_domain ON zones(domain);
  CREATE INDEX IF NOT EXISTS idx_zone_records_zone_id ON zone_records(zone_id);
  CREATE INDEX IF NOT EXISTS idx_zone_records_name ON zone_records(name);
  CREATE INDEX IF NOT EXISTS idx_zone_records_type ON zone_records(type);

  -- DNSSEC zone keys
  CREATE TABLE IF NOT EXISTS zone_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    zone_id INTEGER NOT NULL,
    flags INTEGER NOT NULL DEFAULT 257, -- ZSK (256) or KSK (257)
    algorithm INTEGER NOT NULL DEFAULT 13, -- Ed25519
    private_key TEXT NOT NULL,
    public_key BLOB NOT NULL,
    key_tag INTEGER,
    active INTEGER NOT NULL DEFAULT 1,
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL,
    FOREIGN KEY (zone_id) REFERENCES zones(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_zone_keys_zone_id ON zone_keys(zone_id);
  CREATE INDEX IF NOT EXISTS idx_zone_keys_active ON zone_keys(active);

  -- TSIG keys for Dynamic DNS (RFC 2136/2845)
  CREATE TABLE IF NOT EXISTS tsig_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    algorithm TEXT NOT NULL DEFAULT 'hmac-sha256',
    secret TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_tsig_keys_name ON tsig_keys(name);
  CREATE INDEX IF NOT EXISTS idx_tsig_keys_enabled ON tsig_keys(enabled);

  -- Better-auth tables
  CREATE TABLE IF NOT EXISTS "user" (
    "id" text not null primary key,
    "name" text not null,
    "email" text not null unique,
    "emailVerified" integer not null,
    "image" text,
    "createdAt" date not null,
    "updatedAt" date not null
  );

  CREATE TABLE IF NOT EXISTS "session" (
    "id" text not null primary key,
    "expiresAt" date not null,
    "token" text not null unique,
    "createdAt" date not null,
    "updatedAt" date not null,
    "ipAddress" text,
    "userAgent" text,
    "userId" text not null references "user" ("id") on delete cascade
  );

  CREATE TABLE IF NOT EXISTS "account" (
    "id" text not null primary key,
    "accountId" text not null,
    "providerId" text not null,
    "userId" text not null references "user" ("id") on delete cascade,
    "accessToken" text,
    "refreshToken" text,
    "idToken" text,
    "accessTokenExpiresAt" date,
    "refreshTokenExpiresAt" date,
    "scope" text,
    "password" text,
    "createdAt" date not null,
    "updatedAt" date not null
  );

  CREATE TABLE IF NOT EXISTS "verification" (
    "id" text not null primary key,
    "identifier" text not null,
    "value" text not null,
    "expiresAt" date not null,
    "createdAt" date not null,
    "updatedAt" date not null
  );

  CREATE INDEX IF NOT EXISTS "session_userId_idx" on "session" ("userId");
  CREATE INDEX IF NOT EXISTS "account_userId_idx" on "account" ("userId");
  CREATE INDEX IF NOT EXISTS "verification_identifier_idx" on "verification" ("identifier");

  CREATE TABLE IF NOT EXISTS "apiKey" (
    "id" text not null primary key,
    "name" text,
    "start" text,
    "prefix" text,
    "key" text not null,
    "userId" text not null references "user" ("id") on delete cascade,
    "refillInterval" integer,
    "refillAmount" integer,
    "lastRefillAt" date,
    "enabled" integer not null default 1,
    "rateLimitEnabled" integer not null default 0,
    "rateLimitTimeWindow" integer,
    "rateLimitMax" integer,
    "requestCount" integer not null default 0,
    "remaining" integer,
    "lastRequest" date,
    "expiresAt" date,
    "createdAt" date not null,
    "updatedAt" date not null,
    "permissions" text,
    "metadata" text
  );

  CREATE INDEX IF NOT EXISTS "apiKey_userId_idx" on "apiKey" ("userId");
`);

// Migrations: Add missing columns to existing tables
try {
  // Migrate queries table
  const queriesTableInfo = db.prepare('PRAGMA table_info(queries)').all() as Array<{ name: string }>;
  const queriesColumnNames = queriesTableInfo.map((col) => col.name);

  if (!queriesColumnNames.includes('blockReason')) {
    logger.info('Adding blockReason column to queries table...');
    db.exec('ALTER TABLE queries ADD COLUMN blockReason TEXT');
  }

  if (!queriesColumnNames.includes('cached')) {
    logger.info('Adding cached column to queries table...');
    db.exec('ALTER TABLE queries ADD COLUMN cached INTEGER DEFAULT 0');
  }

  if (!queriesColumnNames.includes('rcode')) {
    logger.info('Adding rcode column to queries table...');
    db.exec('ALTER TABLE queries ADD COLUMN rcode INTEGER');
  }

  // Migrate conditional_forwarding table
  const conditionalForwardingTableInfo = db.prepare('PRAGMA table_info(conditional_forwarding)').all() as Array<{ name: string }>;
  const conditionalForwardingColumnNames = conditionalForwardingTableInfo.map((col) => col.name);

  if (!conditionalForwardingColumnNames.includes('priority')) {
    logger.info('Adding priority column to conditional_forwarding table...');
    db.exec('ALTER TABLE conditional_forwarding ADD COLUMN priority INTEGER NOT NULL DEFAULT 0');
  }
} catch (error) {
  logger.error('Error running migrations', {
    error: error instanceof Error ? error : new Error(String(error)),
  });
}

export const dbQueries = {
  insert(query: DNSQuery) {
    // Check privacy mode setting
    const privacyMode = dbSettings.get('privacyMode', 'false') === 'true';
    const clientIp = privacyMode ? null : query.clientIp ?? null;

    const stmt = db.prepare(`
      INSERT INTO queries (id, domain, type, blocked, timestamp, responseTime, clientIp, blockReason, cached, rcode)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      query.id,
      query.domain,
      query.type,
      query.blocked ? 1 : 0,
      query.timestamp,
      query.responseTime ?? null,
      clientIp,
      query.blockReason ?? null,
      query.cached ? 1 : 0,
      query.rcode ?? null,
    );
  },

  getRecent(limit: number = 100): DNSQuery[] {
    const stmt = db.prepare(`
      SELECT id, domain, type, blocked, timestamp, responseTime, clientIp, blockReason, cached, rcode
      FROM queries
      ORDER BY timestamp DESC
      LIMIT ?
    `);
    const rows = stmt.all(limit) as Array<{
      id: string;
      domain: string;
      type: string;
      blocked: number;
      timestamp: number;
      responseTime: number | null;
      clientIp: string | null;
      blockReason: string | null;
      cached: number;
      rcode: number | null;
    }>;

    const privacyMode = dbSettings.get('privacyMode', 'false') === 'true';

    return rows.map((row) => ({
      id: row.id,
      domain: row.domain,
      type: row.type,
      blocked: row.blocked === 1,
      timestamp: row.timestamp,
      responseTime: row.responseTime ?? undefined,
      clientIp: privacyMode ? undefined : row.clientIp ?? undefined,
      blockReason: row.blockReason ?? undefined,
      cached: row.cached === 1,
      rcode: row.rcode ?? undefined,
    }));
  },

  getByClient(clientIp: string, limit: number = 100): DNSQuery[] {
    const privacyMode = dbSettings.get('privacyMode', 'false') === 'true';
    if (privacyMode) {
      return []; // Don't allow client-specific queries in privacy mode
    }

    const stmt = db.prepare(`
      SELECT * FROM queries
      WHERE clientIp = ?
      ORDER BY timestamp DESC
      LIMIT ?
    `);
    const rows = stmt.all(clientIp, limit) as Array<{
      id: string;
      domain: string;
      type: string;
      blocked: number;
      timestamp: number;
      responseTime: number | null;
      clientIp: string | null;
      blockReason: string | null;
      cached: number;
      rcode: number | null;
    }>;

    return rows.map((row) => ({
      id: row.id,
      domain: row.domain,
      type: row.type,
      blocked: row.blocked === 1,
      timestamp: row.timestamp,
      responseTime: row.responseTime ?? undefined,
      clientIp: row.clientIp ?? undefined,
      blockReason: row.blockReason ?? undefined,
      cached: row.cached === 1,
      rcode: row.rcode ?? undefined,
    }));
  },

  getByTimeRange(startTime: number, endTime: number): DNSQuery[] {
    const stmt = db.prepare(`
      SELECT * FROM queries
      WHERE timestamp >= ? AND timestamp <= ?
      ORDER BY timestamp DESC
    `);
    const rows = stmt.all(startTime, endTime) as Array<{
      id: string;
      domain: string;
      type: string;
      blocked: number;
      timestamp: number;
      responseTime: number | null;
      clientIp: string | null;
      blockReason: string | null;
      cached: number;
      rcode: number | null;
    }>;

    const privacyMode = dbSettings.get('privacyMode', 'false') === 'true';

    return rows.map((row) => ({
      id: row.id,
      domain: row.domain,
      type: row.type,
      blocked: row.blocked === 1,
      timestamp: row.timestamp,
      responseTime: row.responseTime ?? undefined,
      clientIp: privacyMode ? undefined : row.clientIp ?? undefined,
      blockReason: row.blockReason ?? undefined,
      cached: row.cached === 1,
      rcode: row.rcode ?? undefined,
    }));
  },

  getFiltered(filters: {
    limit?: number;
    offset?: number;
    clientIp?: string;
    type?: string;
    blocked?: boolean;
    startTime?: number;
    endTime?: number;
    domain?: string;
    domainPattern?: string; // Supports wildcards like *.example.com
    cached?: boolean;
    blockReason?: string;
    minResponseTime?: number;
    maxResponseTime?: number;
  }): DNSQuery[] {
    const conditions: string[] = [];
    const values: unknown[] = [];

    if (filters.clientIp) {
      conditions.push('clientIp = ?');
      values.push(filters.clientIp);
    }

    if (filters.type) {
      conditions.push('type = ?');
      values.push(filters.type);
    }

    if (filters.blocked !== undefined) {
      conditions.push('blocked = ?');
      values.push(filters.blocked ? 1 : 0);
    }

    if (filters.startTime) {
      conditions.push('timestamp >= ?');
      values.push(filters.startTime);
    }

    if (filters.endTime) {
      conditions.push('timestamp <= ?');
      values.push(filters.endTime);
    }

    if (filters.domain) {
      // Simple LIKE search
      conditions.push('domain LIKE ?');
      values.push(`%${filters.domain.toLowerCase()}%`);
    } else if (filters.domainPattern) {
      // Pattern matching with wildcard support
      // Convert wildcards to SQL LIKE patterns
      // *.example.com -> %example.com
      // example.* -> example.%
      // *example* -> %example%
      let pattern = filters.domainPattern.toLowerCase();
      // Escape SQL wildcards
      pattern = pattern.replace(/%/g, '\\%').replace(/_/g, '\\_');
      // Convert * wildcards to SQL %
      pattern = pattern.replace(/\*/g, '%');
      conditions.push('domain LIKE ?');
      values.push(pattern);
    }

    if (filters.cached !== undefined) {
      conditions.push('cached = ?');
      values.push(filters.cached ? 1 : 0);
    }

    if (filters.blockReason) {
      conditions.push('blockReason = ?');
      values.push(filters.blockReason);
    }

    if (filters.minResponseTime !== undefined) {
      conditions.push('responseTime >= ?');
      values.push(filters.minResponseTime);
    }

    if (filters.maxResponseTime !== undefined) {
      conditions.push('responseTime <= ?');
      values.push(filters.maxResponseTime);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = filters.limit || 100;
    const offset = filters.offset || 0;

    const stmt = db.prepare(`
      SELECT * FROM queries
      ${whereClause}
      ORDER BY timestamp DESC
      LIMIT ? OFFSET ?
    `);

    const rows = stmt.all(...values, limit, offset) as Array<{
      id: string;
      domain: string;
      type: string;
      blocked: number;
      timestamp: number;
      responseTime: number | null;
      clientIp: string | null;
      blockReason: string | null;
      cached: number;
      rcode: number | null;
    }>;

    const privacyMode = dbSettings.get('privacyMode', 'false') === 'true';

    return rows.map((row) => ({
      id: row.id,
      domain: row.domain,
      type: row.type,
      blocked: row.blocked === 1,
      timestamp: row.timestamp,
      responseTime: row.responseTime ?? undefined,
      clientIp: privacyMode ? undefined : row.clientIp ?? undefined,
      blockReason: row.blockReason ?? undefined,
      cached: row.cached === 1,
      rcode: row.rcode ?? undefined,
    }));
  },

  getAllFiltered(filters: {
    clientIp?: string;
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
  }): DNSQuery[] {
    const conditions: string[] = [];
    const values: unknown[] = [];

    if (filters.clientIp) {
      conditions.push('clientIp = ?');
      values.push(filters.clientIp);
    }

    if (filters.type) {
      conditions.push('type = ?');
      values.push(filters.type);
    }

    if (filters.blocked !== undefined) {
      conditions.push('blocked = ?');
      values.push(filters.blocked ? 1 : 0);
    }

    if (filters.startTime) {
      conditions.push('timestamp >= ?');
      values.push(filters.startTime);
    }

    if (filters.endTime) {
      conditions.push('timestamp <= ?');
      values.push(filters.endTime);
    }

    if (filters.domain) {
      conditions.push('domain LIKE ?');
      values.push(`%${filters.domain.toLowerCase()}%`);
    } else if (filters.domainPattern) {
      let pattern = filters.domainPattern.toLowerCase();
      pattern = pattern.replace(/%/g, '\\%').replace(/_/g, '\\_');
      pattern = pattern.replace(/\*/g, '%');
      conditions.push('domain LIKE ?');
      values.push(pattern);
    }

    if (filters.cached !== undefined) {
      conditions.push('cached = ?');
      values.push(filters.cached ? 1 : 0);
    }

    if (filters.blockReason) {
      conditions.push('blockReason = ?');
      values.push(filters.blockReason);
    }

    if (filters.minResponseTime !== undefined) {
      conditions.push('responseTime >= ?');
      values.push(filters.minResponseTime);
    }

    if (filters.maxResponseTime !== undefined) {
      conditions.push('responseTime <= ?');
      values.push(filters.maxResponseTime);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const stmt = db.prepare(`
      SELECT * FROM queries
      ${whereClause}
      ORDER BY timestamp DESC
    `);

    const rows = stmt.all(...values) as Array<{
      id: string;
      domain: string;
      type: string;
      blocked: number;
      timestamp: number;
      responseTime: number | null;
      clientIp: string | null;
      blockReason: string | null;
      cached: number;
      rcode: number | null;
    }>;

    const privacyMode = dbSettings.get('privacyMode', 'false') === 'true';

    return rows.map((row) => ({
      id: row.id,
      domain: row.domain,
      type: row.type,
      blocked: row.blocked === 1,
      timestamp: row.timestamp,
      responseTime: row.responseTime ?? undefined,
      clientIp: privacyMode ? undefined : row.clientIp ?? undefined,
      blockReason: row.blockReason ?? undefined,
      cached: row.cached === 1,
      rcode: row.rcode ?? undefined,
    }));
  },

  getFilteredCount(filters: {
    clientIp?: string;
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
  }): number {
    const conditions: string[] = [];
    const values: unknown[] = [];

    if (filters.clientIp) {
      conditions.push('clientIp = ?');
      values.push(filters.clientIp);
    }

    if (filters.type) {
      conditions.push('type = ?');
      values.push(filters.type);
    }

    if (filters.blocked !== undefined) {
      conditions.push('blocked = ?');
      values.push(filters.blocked ? 1 : 0);
    }

    if (filters.startTime) {
      conditions.push('timestamp >= ?');
      values.push(filters.startTime);
    }

    if (filters.endTime) {
      conditions.push('timestamp <= ?');
      values.push(filters.endTime);
    }

    if (filters.domain) {
      conditions.push('domain LIKE ?');
      values.push(`%${filters.domain.toLowerCase()}%`);
    } else if (filters.domainPattern) {
      let pattern = filters.domainPattern.toLowerCase();
      pattern = pattern.replace(/%/g, '\\%').replace(/_/g, '\\_');
      pattern = pattern.replace(/\*/g, '%');
      conditions.push('domain LIKE ?');
      values.push(pattern);
    }

    if (filters.cached !== undefined) {
      conditions.push('cached = ?');
      values.push(filters.cached ? 1 : 0);
    }

    if (filters.blockReason) {
      conditions.push('blockReason = ?');
      values.push(filters.blockReason);
    }

    if (filters.minResponseTime !== undefined) {
      conditions.push('responseTime >= ?');
      values.push(filters.minResponseTime);
    }

    if (filters.maxResponseTime !== undefined) {
      conditions.push('responseTime <= ?');
      values.push(filters.maxResponseTime);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const stmt = db.prepare(`
      SELECT COUNT(*) as count FROM queries
      ${whereClause}
    `);

    const result = stmt.get(...values) as { count: number };
    return result.count;
  },

  getTotalCount(): number {
    const stmt = db.prepare('SELECT COUNT(*) as count FROM queries');
    const result = stmt.get() as { count: number };
    return result.count;
  },

  getUniqueBlockReasons(): string[] {
    const stmt = db.prepare('SELECT DISTINCT blockReason FROM queries WHERE blockReason IS NOT NULL ORDER BY blockReason');
    const rows = stmt.all() as Array<{ blockReason: string }>;
    return rows.map((row) => row.blockReason);
  },

  cleanupOldQueries(daysToKeep: number = 7) {
    const cutoffTime = Date.now() - daysToKeep * 24 * 60 * 60 * 1000;
    const stmt = db.prepare('DELETE FROM queries WHERE timestamp < ?');
    const result = stmt.run(cutoffTime);
    return result.changes;
  },

  archiveOldQueries(daysToKeep: number = 7, compress: boolean = true): number {
    const cutoffTime = Date.now() - daysToKeep * 24 * 60 * 60 * 1000;

    // Get old queries
    const stmt = db.prepare('SELECT * FROM queries WHERE timestamp < ?');
    const oldQueries = stmt.all(cutoffTime) as Array<{
      id: string;
      domain: string;
      type: string;
      blocked: number;
      timestamp: number;
      responseTime: number | null;
      clientIp: string | null;
      blockReason: string | null;
    }>;

    if (oldQueries.length === 0) {
      return 0;
    }

    // Store archived queries (in a simple JSON format, could be compressed)
    const archiveData = {
      archivedAt: Date.now(),
      count: oldQueries.length,
      queries: oldQueries,
    };

    // In a real implementation, you'd write this to a file or external storage
    // For now, we'll just delete them after "archiving"
    const deleteStmt = db.prepare('DELETE FROM queries WHERE timestamp < ?');
    const result = deleteStmt.run(cutoffTime);

    return result.changes;
  },

  getDailyStats(days: number = 30) {
    const startTime = Date.now() - days * 24 * 60 * 60 * 1000;
    const stmt = db.prepare(`
      SELECT 
        DATE(timestamp / 1000, 'unixepoch', 'localtime') as date,
        COUNT(*) as total,
        SUM(blocked) as blocked
      FROM queries
      WHERE timestamp >= ?
      GROUP BY date
      ORDER BY date ASC
    `);
    return stmt.all(startTime) as Array<{
      date: string;
      total: number;
      blocked: number;
    }>;
  },

  getClients(limit: number = 50): Array<{ clientIp: string; count: number }> {
    const privacyMode = dbSettings.get('privacyMode', 'false') === 'true';
    if (privacyMode) {
      return []; // Don't return client data in privacy mode
    }

    const stmt = db.prepare(`
      SELECT 
        clientIp,
        COUNT(*) as count
      FROM queries
      WHERE clientIp IS NOT NULL
      GROUP BY clientIp
      ORDER BY count DESC
      LIMIT ?
    `);
    return stmt.all(limit) as Array<{ clientIp: string; count: number }>;
  },

  getStats() {
    const totalStmt = db.prepare('SELECT COUNT(*) as count FROM queries');
    const totalQueries = (totalStmt.get() as { count: number }).count;

    const blockedStmt = db.prepare('SELECT COUNT(*) as count FROM queries WHERE blocked = 1');
    const blockedQueries = (blockedStmt.get() as { count: number }).count;

    const cachedStmt = db.prepare('SELECT COUNT(*) as count FROM queries WHERE cached = 1');
    const cachedQueries = (cachedStmt.get() as { count: number }).count;

    const allowedQueries = totalQueries - blockedQueries;

    const topDomainsStmt = db.prepare(`
      SELECT domain, COUNT(*) as count
      FROM queries
      GROUP BY domain
      ORDER BY count DESC
      LIMIT 10
    `);
    const topDomains = topDomainsStmt.all() as Array<{ domain: string; count: number }>;

    const topBlockedStmt = db.prepare(`
      SELECT domain, COUNT(*) as count
      FROM queries
      WHERE blocked = 1
      GROUP BY domain
      ORDER BY count DESC
      LIMIT 10
    `);
    const topBlocked = topBlockedStmt.all() as Array<{ domain: string; count: number }>;

    // Performance metrics
    const responseTimeStmt = db.prepare(`
      SELECT 
        AVG(responseTime) as avgResponseTime,
        MIN(responseTime) as minResponseTime,
        MAX(responseTime) as maxResponseTime,
        COUNT(*) as count
      FROM queries
      WHERE responseTime IS NOT NULL
    `);
    const responseTimeStats = responseTimeStmt.get() as {
      avgResponseTime: number | null;
      minResponseTime: number | null;
      maxResponseTime: number | null;
      count: number;
    };

    // Calculate percentiles (p50, p95, p99)
    let p50: number | null = null;
    let p95: number | null = null;
    let p99: number | null = null;

    if (responseTimeStats.count > 0) {
      const percentileStmt = db.prepare(`
        SELECT responseTime
        FROM queries
        WHERE responseTime IS NOT NULL
        ORDER BY responseTime
      `);
      const responseTimes = (percentileStmt.all() as Array<{ responseTime: number }>).map((r) => r.responseTime);

      if (responseTimes.length > 0) {
        const getPercentile = (percentile: number): number => {
          const index = Math.ceil((percentile / 100) * responseTimes.length) - 1;
          return responseTimes[Math.max(0, index)] ?? 0;
        };

        p50 = getPercentile(50);
        p95 = getPercentile(95);
        p99 = getPercentile(99);
      }
    }

    // Cache hit rate
    const cacheHitRate = totalQueries > 0 ? (cachedQueries / totalQueries) * 100 : 0;

    return {
      totalQueries,
      blockedQueries,
      allowedQueries,
      cachedQueries,
      topDomains,
      topBlocked,
      performance: {
        avgResponseTime: responseTimeStats.avgResponseTime
          ? Math.round(responseTimeStats.avgResponseTime * 100) / 100
          : null,
        minResponseTime: responseTimeStats.minResponseTime,
        maxResponseTime: responseTimeStats.maxResponseTime,
        p50,
        p95,
        p99,
        cacheHitRate: Math.round(cacheHitRate * 100) / 100,
      },
    };
  },

  getQueryTypeBreakdown() {
    const stmt = db.prepare(`
      SELECT type, COUNT(*) as count
      FROM queries
      GROUP BY type
      ORDER BY count DESC
    `);
    return stmt.all() as Array<{ type: string; count: number }>;
  },

  getBlockPercentageOverTime(days: number = 30) {
    const startTime = Date.now() - days * 24 * 60 * 60 * 1000;
    const stmt = db.prepare(`
      SELECT 
        DATE(timestamp / 1000, 'unixepoch', 'localtime') as date,
        COUNT(*) as total,
        SUM(blocked) as blocked,
        ROUND(CAST(SUM(blocked) AS FLOAT) / COUNT(*) * 100, 2) as blockPercentage
      FROM queries
      WHERE timestamp >= ?
      GROUP BY date
      ORDER BY date ASC
    `);
    return stmt.all(startTime) as Array<{
      date: string;
      total: number;
      blocked: number;
      blockPercentage: number;
    }>;
  },

  getPerClientStats(clientIp: string): {
    totalQueries: number;
    blockedQueries: number;
    blockPercentage: number;
    topDomains: Array<{ domain: string; count: number }>;
    topBlocked: Array<{ domain: string; count: number }>;
    queryTypes: Array<{ type: string; count: number }>;
    timeRange: { first: number; last: number };
  } | null {
    const privacyMode = dbSettings.get('privacyMode', 'false') === 'true';
    if (privacyMode) {
      return null;
    }

    const totalStmt = db.prepare('SELECT COUNT(*) as count FROM queries WHERE clientIp = ?');
    const totalResult = totalStmt.get(clientIp) as { count: number };

    const blockedStmt = db.prepare('SELECT COUNT(*) as count FROM queries WHERE clientIp = ? AND blocked = 1');
    const blockedResult = blockedStmt.get(clientIp) as { count: number };

    const topDomainsStmt = db.prepare(`
      SELECT domain, COUNT(*) as count
      FROM queries
      WHERE clientIp = ?
      GROUP BY domain
      ORDER BY count DESC
      LIMIT 10
    `);
    const topDomains = topDomainsStmt.all(clientIp) as Array<{ domain: string; count: number }>;

    const topBlockedStmt = db.prepare(`
      SELECT domain, COUNT(*) as count
      FROM queries
      WHERE clientIp = ? AND blocked = 1
      GROUP BY domain
      ORDER BY count DESC
      LIMIT 10
    `);
    const topBlocked = topBlockedStmt.all(clientIp) as Array<{ domain: string; count: number }>;

    const queryTypesStmt = db.prepare(`
      SELECT type, COUNT(*) as count
      FROM queries
      WHERE clientIp = ?
      GROUP BY type
      ORDER BY count DESC
    `);
    const queryTypes = queryTypesStmt.all(clientIp) as Array<{ type: string; count: number }>;

    const timeRangeStmt = db.prepare(`
      SELECT MIN(timestamp) as first, MAX(timestamp) as last
      FROM queries
      WHERE clientIp = ?
    `);
    const timeRange = timeRangeStmt.get(clientIp) as { first: number; last: number };

    const totalQueries = totalResult.count;
    const blockedQueries = blockedResult.count;
    const blockPercentage = totalQueries > 0 ? (blockedQueries / totalQueries) * 100 : 0;

    return {
      totalQueries,
      blockedQueries,
      blockPercentage,
      topDomains,
      topBlocked,
      queryTypes,
      timeRange: {
        first: timeRange.first || 0,
        last: timeRange.last || 0,
      },
    };
  },

  getQueryPatterns(hours: number = 24): Array<{
    hour: number;
    total: number;
    blocked: number;
    blockPercentage: number;
  }> {
    const startTime = Date.now() - hours * 60 * 60 * 1000;
    const stmt = db.prepare(`
      SELECT 
        CAST((timestamp - ?) / (60 * 60 * 1000) as INTEGER) as hour,
        COUNT(*) as total,
        SUM(blocked) as blocked
      FROM queries
      WHERE timestamp >= ?
      GROUP BY hour
      ORDER BY hour ASC
    `);
    const rows = stmt.all(startTime, startTime) as Array<{
      hour: number;
      total: number;
      blocked: number;
    }>;

    return rows.map((row) => ({
      hour: row.hour,
      total: row.total,
      blocked: row.blocked,
      blockPercentage: row.total > 0 ? (row.blocked / row.total) * 100 : 0,
    }));
  },

  getTopAdvertisers(limit: number = 20) {
    // Top advertisers are domains that are frequently blocked
    // We'll look for domains that appear in blocked queries more than a threshold
    const stmt = db.prepare(`
      SELECT 
        domain,
        COUNT(*) as blockedCount,
        (SELECT COUNT(*) FROM queries q2 WHERE q2.domain = q1.domain) as totalCount,
        ROUND(CAST(COUNT(*) AS FLOAT) / (SELECT COUNT(*) FROM queries q2 WHERE q2.domain = q1.domain) * 100, 2) as blockRate
      FROM queries q1
      WHERE blocked = 1
      GROUP BY domain
      HAVING blockedCount >= 5
      ORDER BY blockedCount DESC
      LIMIT ?
    `);
    return stmt.all(limit) as Array<{
      domain: string;
      blockedCount: number;
      totalCount: number;
      blockRate: number;
    }>;
  },

  getPopularDomains(
    sinceTimestamp: number,
    minQueries: number = 10,
  ): Array<{ domain: string; type: number; count: number }> {
    const stmt = db.prepare(`
      SELECT 
        domain,
        CASE 
          WHEN type = 'A' THEN 1
          WHEN type = 'AAAA' THEN 28
          WHEN type = 'MX' THEN 15
          WHEN type = 'TXT' THEN 16
          WHEN type = 'NS' THEN 2
          WHEN type = 'CNAME' THEN 5
          ELSE 1
        END as type,
        COUNT(*) as count
      FROM queries
      WHERE timestamp >= ? AND blocked = 0
      GROUP BY domain, type
      HAVING count >= ?
      ORDER BY count DESC
      LIMIT 100
    `);
    return stmt.all(sinceTimestamp, minQueries) as Array<{ domain: string; type: number; count: number }>;
  },
};

export const dbClientNames = {
  setName(clientIp: string, name: string) {
    const stmt = db.prepare(`
      INSERT INTO client_names (clientIp, name, updatedAt)
      VALUES (?, ?, ?)
      ON CONFLICT(clientIp) DO UPDATE SET name = ?, updatedAt = ?
    `);
    const now = Date.now();
    stmt.run(clientIp, name, now, name, now);
  },

  getName(clientIp: string): string | null {
    const stmt = db.prepare('SELECT name FROM client_names WHERE clientIp = ?');
    const row = stmt.get(clientIp) as { name: string } | undefined;
    return row?.name || null;
  },

  getAll(): Record<string, string> {
    const stmt = db.prepare('SELECT clientIp, name FROM client_names');
    const rows = stmt.all() as Array<{ clientIp: string; name: string }>;
    return rows.reduce((acc, row) => {
      acc[row.clientIp] = row.name;
      return acc;
    }, {} as Record<string, string>);
  },

  delete(clientIp: string) {
    const stmt = db.prepare('DELETE FROM client_names WHERE clientIp = ?');
    stmt.run(clientIp);
  },
};

export const dbAdlists = {
  add(url: string) {
    const stmt = db.prepare(`
      INSERT INTO adlists (url, enabled, addedAt)
      VALUES (?, 1, ?)
    `);
    stmt.run(url, Date.now());
  },

  remove(url: string) {
    const stmt = db.prepare('DELETE FROM adlists WHERE url = ?');
    stmt.run(url);
  },

  getAll() {
    const stmt = db.prepare('SELECT * FROM adlists ORDER BY addedAt DESC');
    return stmt.all() as Array<{
      id: number;
      url: string;
      enabled: number;
      domainCount: number | null;
      addedAt: number;
    }>;
  },

  setEnabled(url: string, enabled: boolean) {
    const stmt = db.prepare('UPDATE adlists SET enabled = ? WHERE url = ?');
    stmt.run(enabled ? 1 : 0, url);
  },
};

export const dbLocalDNS = {
  add(domain: string, ip: string, type: string = 'A') {
    const now = Date.now();
    const stmt = db.prepare(`
      INSERT INTO local_dns (domain, ip, type, enabled, createdAt, updatedAt)
      VALUES (?, ?, ?, 1, ?, ?)
      ON CONFLICT(domain) DO UPDATE SET ip = ?, type = ?, updatedAt = ?
    `);
    stmt.run(domain.toLowerCase(), ip, type, now, now, ip, type, now);
  },

  remove(domain: string) {
    const stmt = db.prepare('DELETE FROM local_dns WHERE domain = ?');
    stmt.run(domain.toLowerCase());
  },

  getAll() {
    const stmt = db.prepare('SELECT * FROM local_dns ORDER BY domain ASC');
    return stmt.all() as Array<{
      id: number;
      domain: string;
      ip: string;
      type: string;
      enabled: number;
      createdAt: number;
      updatedAt: number;
    }>;
  },

  getByDomain(domain: string) {
    const lower = domain.toLowerCase();

    // First try exact match
    const exactStmt = db.prepare('SELECT * FROM local_dns WHERE domain = ? AND enabled = 1');
    const exactRow = exactStmt.get(lower) as
      | {
          id: number;
          domain: string;
          ip: string;
          type: string;
          enabled: number;
        }
      | undefined;
    if (exactRow) {
      return exactRow;
    }

    // Then try wildcard match (e.g., *.local matches subdomain.local)
    const wildcardStmt = db.prepare('SELECT * FROM local_dns WHERE domain LIKE ? AND enabled = 1 ORDER BY domain DESC');
    const wildcardRows = wildcardStmt.all('*.' + lower.split('.').slice(-2).join('.')) as Array<{
      id: number;
      domain: string;
      ip: string;
      type: string;
      enabled: number;
    }>;

    // Check if any wildcard matches
    for (const row of wildcardRows) {
      if (row.domain.startsWith('*.')) {
        const wildcardPattern = row.domain.substring(2); // Remove '*.'
        if (lower.endsWith('.' + wildcardPattern) || lower === wildcardPattern) {
          return row;
        }
      }
    }

    return null;
  },

  setEnabled(domain: string, enabled: boolean) {
    const stmt = db.prepare('UPDATE local_dns SET enabled = ? WHERE domain = ?');
    stmt.run(enabled ? 1 : 0, domain.toLowerCase());
  },
};

export const dbSettings = {
  get(key: string, defaultValue: string): string {
    const stmt = db.prepare('SELECT value FROM settings WHERE key = ?');
    const row = stmt.get(key) as { value: string } | undefined;
    return row?.value || defaultValue;
  },

  set(key: string, value: string) {
    const stmt = db.prepare(`
      INSERT INTO settings (key, value, updatedAt)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = ?, updatedAt = ?
    `);
    const now = Date.now();
    stmt.run(key, value, now, value, now);
  },

  getAll(): Record<string, string> {
    const stmt = db.prepare('SELECT key, value FROM settings');
    const rows = stmt.all() as Array<{ key: string; value: string }>;
    return rows.reduce((acc, row) => {
      acc[row.key] = row.value;
      return acc;
    }, {} as Record<string, string>);
  },
};

// Initialize default settings
const defaultSettings = {
  upstreamDNS: '1.1.1.1',
  queryRetentionDays: '7',
  dnsPort: '53',
};

for (const [key, value] of Object.entries(defaultSettings)) {
  if (!dbSettings.get(key, '')) {
    dbSettings.set(key, value);
  }
}

export const dbClientGroups = {
  create(name: string, description?: string) {
    const now = Date.now();
    const stmt = db.prepare(`
      INSERT INTO client_groups (name, description, createdAt, updatedAt)
      VALUES (?, ?, ?, ?)
    `);
    const result = stmt.run(name, description || null, now, now);
    return result.lastInsertRowid as number;
  },

  getAll() {
    const stmt = db.prepare(`
      SELECT g.*, 
        COUNT(m.clientIp) as memberCount
      FROM client_groups g
      LEFT JOIN client_group_members m ON g.id = m.groupId
      GROUP BY g.id
      ORDER BY g.name ASC
    `);
    return stmt.all() as Array<{
      id: number;
      name: string;
      description: string | null;
      createdAt: number;
      updatedAt: number;
      memberCount: number;
    }>;
  },

  getById(id: number) {
    const stmt = db.prepare('SELECT * FROM client_groups WHERE id = ?');
    return stmt.get(id) as
      | {
          id: number;
          name: string;
          description: string | null;
          createdAt: number;
          updatedAt: number;
        }
      | undefined;
  },

  update(id: number, name?: string, description?: string) {
    const updates: string[] = [];
    const values: unknown[] = [];

    if (name !== undefined) {
      updates.push('name = ?');
      values.push(name);
    }
    if (description !== undefined) {
      updates.push('description = ?');
      values.push(description);
    }

    if (updates.length === 0) return;

    updates.push('updatedAt = ?');
    values.push(Date.now());
    values.push(id);

    const stmt = db.prepare(`
      UPDATE client_groups 
      SET ${updates.join(', ')}
      WHERE id = ?
    `);
    stmt.run(...values);
  },

  delete(id: number) {
    const stmt = db.prepare('DELETE FROM client_groups WHERE id = ?');
    stmt.run(id);
  },

  addMember(groupId: number, clientIp: string) {
    const stmt = db.prepare(`
      INSERT OR IGNORE INTO client_group_members (groupId, clientIp)
      VALUES (?, ?)
    `);
    stmt.run(groupId, clientIp);
  },

  removeMember(groupId: number, clientIp: string) {
    const stmt = db.prepare(`
      DELETE FROM client_group_members 
      WHERE groupId = ? AND clientIp = ?
    `);
    stmt.run(groupId, clientIp);
  },

  getMembers(groupId: number) {
    const stmt = db.prepare(`
      SELECT clientIp FROM client_group_members WHERE groupId = ?
    `);
    const rows = stmt.all(groupId) as Array<{ clientIp: string }>;
    return rows.map((row) => row.clientIp);
  },

  getGroupsForClient(clientIp: string): number[] {
    const stmt = db.prepare('SELECT groupId FROM client_group_members WHERE clientIp = ?');
    const rows = stmt.all(clientIp) as Array<{ groupId: number }>;
    return rows.map((row) => row.groupId);
  },
};

export const dbAllowlist = {
  add(domain: string, comment?: string) {
    const stmt = db.prepare(`
      INSERT INTO allowlist (domain, addedAt, comment)
      VALUES (?, ?, ?)
    `);
    stmt.run(domain.toLowerCase(), Date.now(), comment || null);
  },

  remove(domain: string) {
    const stmt = db.prepare('DELETE FROM allowlist WHERE domain = ?');
    stmt.run(domain.toLowerCase());
  },

  getAll() {
    const stmt = db.prepare('SELECT * FROM allowlist ORDER BY domain ASC');
    return stmt.all() as Array<{
      id: number;
      domain: string;
      addedAt: number;
      comment: string | null;
    }>;
  },

  getDomains(): Set<string> {
    const stmt = db.prepare('SELECT domain FROM allowlist');
    const rows = stmt.all() as Array<{ domain: string }>;
    return new Set(rows.map((row) => row.domain));
  },

  isAllowed(domain: string): boolean {
    const lower = domain.toLowerCase();
    const stmt = db.prepare('SELECT COUNT(*) as count FROM allowlist WHERE domain = ?');
    const result = stmt.get(lower) as { count: number };
    if (result.count > 0) return true;

    // Check subdomains - if a parent domain is allowed, subdomains are too
    const parts = lower.split('.');
    for (let i = 0; i < parts.length - 1; i++) {
      const subdomain = parts.slice(i).join('.');
      const subResult = stmt.get(subdomain) as { count: number };
      if (subResult.count > 0) return true;
    }

    return false;
  },
};

export const dbRegexFilters = {
  add(pattern: string, type: 'block' | 'allow', comment?: string) {
    const stmt = db.prepare(`
      INSERT INTO regex_filters (pattern, type, enabled, addedAt, comment)
      VALUES (?, ?, 1, ?, ?)
    `);
    stmt.run(pattern, type, Date.now(), comment || null);
  },

  remove(id: number) {
    const stmt = db.prepare('DELETE FROM regex_filters WHERE id = ?');
    stmt.run(id);
  },

  getAll() {
    const stmt = db.prepare('SELECT * FROM regex_filters ORDER BY addedAt DESC');
    return stmt.all() as Array<{
      id: number;
      pattern: string;
      type: 'block' | 'allow';
      enabled: number;
      addedAt: number;
      comment: string | null;
    }>;
  },

  getEnabled() {
    const stmt = db.prepare('SELECT * FROM regex_filters WHERE enabled = 1 ORDER BY addedAt DESC');
    return stmt.all() as Array<{
      id: number;
      pattern: string;
      type: 'block' | 'allow';
      enabled: number;
      addedAt: number;
      comment: string | null;
    }>;
  },

  setEnabled(id: number, enabled: boolean) {
    const stmt = db.prepare('UPDATE regex_filters SET enabled = ? WHERE id = ?');
    stmt.run(enabled ? 1 : 0, id);
  },

  testPattern(pattern: string, domain: string): boolean {
    try {
      const regex = new RegExp(pattern);
      return regex.test(domain);
    } catch {
      return false;
    }
  },
};

export const dbClientBlockingRules = {
  setBlockingEnabled(clientIp: string, enabled: boolean) {
    const stmt = db.prepare(`
      INSERT INTO client_blocking_rules (clientIp, blockingEnabled, updatedAt)
      VALUES (?, ?, ?)
      ON CONFLICT(clientIp) DO UPDATE SET blockingEnabled = ?, updatedAt = ?
    `);
    stmt.run(clientIp, enabled ? 1 : 0, Date.now(), enabled ? 1 : 0, Date.now());
  },

  getBlockingEnabled(clientIp: string): boolean {
    const stmt = db.prepare('SELECT blockingEnabled FROM client_blocking_rules WHERE clientIp = ?');
    const result = stmt.get(clientIp) as { blockingEnabled: number } | undefined;
    return result ? result.blockingEnabled === 1 : true; // Default to enabled
  },

  getAll() {
    const stmt = db.prepare('SELECT * FROM client_blocking_rules');
    return stmt.all() as Array<{
      clientIp: string;
      blockingEnabled: number;
      updatedAt: number;
    }>;
  },
};

export const dbGroupBlockingRules = {
  setBlockingEnabled(groupId: number, enabled: boolean) {
    const stmt = db.prepare(`
      INSERT INTO group_blocking_rules (groupId, blockingEnabled, updatedAt)
      VALUES (?, ?, ?)
      ON CONFLICT(groupId) DO UPDATE SET blockingEnabled = ?, updatedAt = ?
    `);
    stmt.run(groupId, enabled ? 1 : 0, Date.now(), enabled ? 1 : 0, Date.now());
  },

  getBlockingEnabled(groupId: number): boolean {
    const stmt = db.prepare('SELECT blockingEnabled FROM group_blocking_rules WHERE groupId = ?');
    const result = stmt.get(groupId) as { blockingEnabled: number } | undefined;
    return result ? result.blockingEnabled === 1 : true; // Default to enabled
  },

  getAll() {
    const stmt = db.prepare('SELECT * FROM group_blocking_rules');
    return stmt.all() as Array<{
      groupId: number;
      blockingEnabled: number;
      updatedAt: number;
    }>;
  },
};

export const dbClientAllowlist = {
  add(clientIp: string, domain: string) {
    const stmt = db.prepare(`
      INSERT INTO client_allowlist (clientIp, domain, addedAt)
      VALUES (?, ?, ?)
    `);
    stmt.run(clientIp, domain.toLowerCase(), Date.now());
  },

  remove(clientIp: string, domain: string) {
    const stmt = db.prepare('DELETE FROM client_allowlist WHERE clientIp = ? AND domain = ?');
    stmt.run(clientIp, domain.toLowerCase());
  },

  getAll(clientIp: string) {
    const stmt = db.prepare('SELECT * FROM client_allowlist WHERE clientIp = ? ORDER BY domain ASC');
    return stmt.all(clientIp) as Array<{
      id: number;
      clientIp: string;
      domain: string;
      addedAt: number;
    }>;
  },

  getDomains(clientIp: string): Set<string> {
    const stmt = db.prepare('SELECT domain FROM client_allowlist WHERE clientIp = ?');
    const rows = stmt.all(clientIp) as Array<{ domain: string }>;
    return new Set(rows.map((row) => row.domain));
  },

  isAllowed(clientIp: string, domain: string): boolean {
    const lower = domain.toLowerCase();
    const stmt = db.prepare('SELECT COUNT(*) as count FROM client_allowlist WHERE clientIp = ? AND domain = ?');
    const result = stmt.get(clientIp, lower) as { count: number };
    if (result.count > 0) return true;

    // Check subdomains
    const parts = lower.split('.');
    for (let i = 0; i < parts.length - 1; i++) {
      const subdomain = parts.slice(i).join('.');
      const subResult = stmt.get(clientIp, subdomain) as { count: number };
      if (subResult.count > 0) return true;
    }

    return false;
  },
};

export const dbClientBlocklist = {
  add(clientIp: string, domain: string) {
    const stmt = db.prepare(`
      INSERT INTO client_blocklist (clientIp, domain, addedAt)
      VALUES (?, ?, ?)
    `);
    stmt.run(clientIp, domain.toLowerCase(), Date.now());
  },

  remove(clientIp: string, domain: string) {
    const stmt = db.prepare('DELETE FROM client_blocklist WHERE clientIp = ? AND domain = ?');
    stmt.run(clientIp, domain.toLowerCase());
  },

  getAll(clientIp: string) {
    const stmt = db.prepare('SELECT * FROM client_blocklist WHERE clientIp = ? ORDER BY domain ASC');
    return stmt.all(clientIp) as Array<{
      id: number;
      clientIp: string;
      domain: string;
      addedAt: number;
    }>;
  },

  getDomains(clientIp: string): Set<string> {
    const stmt = db.prepare('SELECT domain FROM client_blocklist WHERE clientIp = ?');
    const rows = stmt.all(clientIp) as Array<{ domain: string }>;
    return new Set(rows.map((row) => row.domain));
  },

  isBlocked(clientIp: string, domain: string): boolean {
    const lower = domain.toLowerCase();
    const stmt = db.prepare('SELECT COUNT(*) as count FROM client_blocklist WHERE clientIp = ? AND domain = ?');
    const result = stmt.get(clientIp, lower) as { count: number };
    if (result.count > 0) return true;

    // Check subdomains
    const parts = lower.split('.');
    for (let i = 0; i < parts.length - 1; i++) {
      const subdomain = parts.slice(i).join('.');
      const subResult = stmt.get(clientIp, subdomain) as { count: number };
      if (subResult.count > 0) return true;
    }

    return false;
  },
};

export const dbGroupAllowlist = {
  add(groupId: number, domain: string) {
    const stmt = db.prepare(`
      INSERT INTO group_allowlist (groupId, domain, addedAt)
      VALUES (?, ?, ?)
    `);
    stmt.run(groupId, domain.toLowerCase(), Date.now());
  },

  remove(groupId: number, domain: string) {
    const stmt = db.prepare('DELETE FROM group_allowlist WHERE groupId = ? AND domain = ?');
    stmt.run(groupId, domain.toLowerCase());
  },

  getAll(groupId: number) {
    const stmt = db.prepare('SELECT * FROM group_allowlist WHERE groupId = ? ORDER BY domain ASC');
    return stmt.all(groupId) as Array<{
      id: number;
      groupId: number;
      domain: string;
      addedAt: number;
    }>;
  },

  getDomains(groupId: number): Set<string> {
    const stmt = db.prepare('SELECT domain FROM group_allowlist WHERE groupId = ?');
    const rows = stmt.all(groupId) as Array<{ domain: string }>;
    return new Set(rows.map((row) => row.domain));
  },

  isAllowed(groupId: number, domain: string): boolean {
    const lower = domain.toLowerCase();
    const stmt = db.prepare('SELECT COUNT(*) as count FROM group_allowlist WHERE groupId = ? AND domain = ?');
    const result = stmt.get(groupId, lower) as { count: number };
    if (result.count > 0) return true;

    // Check subdomains
    const parts = lower.split('.');
    for (let i = 0; i < parts.length - 1; i++) {
      const subdomain = parts.slice(i).join('.');
      const subResult = stmt.get(groupId, subdomain) as { count: number };
      if (subResult.count > 0) return true;
    }

    return false;
  },
};

export const dbGroupBlocklist = {
  add(groupId: number, domain: string) {
    const stmt = db.prepare(`
      INSERT INTO group_blocklist (groupId, domain, addedAt)
      VALUES (?, ?, ?)
    `);
    stmt.run(groupId, domain.toLowerCase(), Date.now());
  },

  remove(groupId: number, domain: string) {
    const stmt = db.prepare('DELETE FROM group_blocklist WHERE groupId = ? AND domain = ?');
    stmt.run(groupId, domain.toLowerCase());
  },

  getAll(groupId: number) {
    const stmt = db.prepare('SELECT * FROM group_blocklist WHERE groupId = ? ORDER BY domain ASC');
    return stmt.all(groupId) as Array<{
      id: number;
      groupId: number;
      domain: string;
      addedAt: number;
    }>;
  },

  getDomains(groupId: number): Set<string> {
    const stmt = db.prepare('SELECT domain FROM group_blocklist WHERE groupId = ?');
    const rows = stmt.all(groupId) as Array<{ domain: string }>;
    return new Set(rows.map((row) => row.domain));
  },

  isBlocked(groupId: number, domain: string): boolean {
    const lower = domain.toLowerCase();
    const stmt = db.prepare('SELECT COUNT(*) as count FROM group_blocklist WHERE groupId = ? AND domain = ?');
    const result = stmt.get(groupId, lower) as { count: number };
    if (result.count > 0) return true;

    // Check subdomains
    const parts = lower.split('.');
    for (let i = 0; i < parts.length - 1; i++) {
      const subdomain = parts.slice(i).join('.');
      const subResult = stmt.get(groupId, subdomain) as { count: number };
      if (subResult.count > 0) return true;
    }

    return false;
  },
};

export const dbBlocklistUpdates = {
  startUpdate() {
    const stmt = db.prepare(`
      INSERT INTO blocklist_updates (startedAt, status)
      VALUES (?, 'running')
    `);
    const result = stmt.run(Date.now());
    return result.lastInsertRowid as number;
  },

  completeUpdate(id: number, domainsAdded: number) {
    const stmt = db.prepare(`
      UPDATE blocklist_updates
      SET completedAt = ?, status = 'completed', domainsAdded = ?
      WHERE id = ?
    `);
    stmt.run(Date.now(), domainsAdded, id);
  },

  failUpdate(id: number, error: string) {
    const stmt = db.prepare(`
      UPDATE blocklist_updates
      SET completedAt = ?, status = 'failed', error = ?
      WHERE id = ?
    `);
    stmt.run(Date.now(), error, id);
  },

  getLatest() {
    const stmt = db.prepare(`
      SELECT * FROM blocklist_updates
      ORDER BY startedAt DESC
      LIMIT 1
    `);
    return stmt.get() as
      | {
          id: number;
          startedAt: number;
          completedAt: number | null;
          status: 'running' | 'completed' | 'failed';
          domainsAdded: number;
          error: string | null;
        }
      | undefined;
  },

  getAll(limit: number = 10) {
    const stmt = db.prepare(`
      SELECT * FROM blocklist_updates
      ORDER BY startedAt DESC
      LIMIT ?
    `);
    return stmt.all(limit) as Array<{
      id: number;
      startedAt: number;
      completedAt: number | null;
      status: 'running' | 'completed' | 'failed';
      domainsAdded: number;
      error: string | null;
    }>;
  },
};

export const dbConditionalForwarding = {
  add(domain: string, upstreamDNS: string, comment?: string, priority: number = 0) {
    const now = Date.now();
    const stmt = db.prepare(`
      INSERT INTO conditional_forwarding (domain, upstreamDNS, enabled, priority, comment, createdAt, updatedAt)
      VALUES (?, ?, 1, ?, ?, ?, ?)
    `);
    const result = stmt.run(domain.toLowerCase(), upstreamDNS, priority, comment || null, now, now);
    return result.lastInsertRowid as number;
  },

  remove(id: number) {
    const stmt = db.prepare('DELETE FROM conditional_forwarding WHERE id = ?');
    stmt.run(id);
  },

  getAll() {
    const stmt = db.prepare('SELECT * FROM conditional_forwarding ORDER BY priority DESC, domain ASC');
    return stmt.all() as Array<{
      id: number;
      domain: string;
      upstreamDNS: string;
      enabled: number;
      priority: number;
      comment: string | null;
      createdAt: number;
      updatedAt: number;
    }>;
  },

  getEnabled() {
    const stmt = db.prepare('SELECT * FROM conditional_forwarding WHERE enabled = 1 ORDER BY priority DESC, domain ASC');
    return stmt.all() as Array<{
      id: number;
      domain: string;
      upstreamDNS: string;
      enabled: number;
      priority: number;
      comment: string | null;
      createdAt: number;
      updatedAt: number;
    }>;
  },

  setEnabled(id: number, enabled: boolean) {
    const stmt = db.prepare('UPDATE conditional_forwarding SET enabled = ?, updatedAt = ? WHERE id = ?');
    stmt.run(enabled ? 1 : 0, Date.now(), id);
  },

  update(id: number, domain: string, upstreamDNS: string, comment?: string, priority?: number) {
    const now = Date.now();
    if (priority !== undefined && priority !== null) {
      const stmt = db.prepare(`
        UPDATE conditional_forwarding
        SET domain = ?, upstreamDNS = ?, comment = ?, priority = ?, updatedAt = ?
        WHERE id = ?
      `);
      stmt.run(domain.toLowerCase(), upstreamDNS, comment || null, priority, now, id);
    } else {
      const stmt = db.prepare(`
        UPDATE conditional_forwarding
        SET domain = ?, upstreamDNS = ?, comment = ?, updatedAt = ?
        WHERE id = ?
      `);
      stmt.run(domain.toLowerCase(), upstreamDNS, comment || null, now, id);
    }
  },

  findUpstreamDNS(domain: string): string | null {
    const lower = domain.toLowerCase();
    const rules = this.getEnabled();

    // Track best match (longest domain match wins, then highest priority)
    let bestMatch: { domain: string; upstreamDNS: string; priority: number; matchLength: number } | null = null;

    for (const rule of rules) {
      const ruleDomain = rule.domain.toLowerCase();
      let matchLength = 0;
      let isMatch = false;

      // Check for wildcard pattern (e.g., *.example.com)
      if (ruleDomain.startsWith('*.')) {
        const pattern = ruleDomain.substring(2); // Remove '*.'
        if (lower === pattern || lower.endsWith('.' + pattern)) {
          isMatch = true;
          matchLength = pattern.length;
        }
      }
      // Check exact match
      else if (ruleDomain === lower) {
        isMatch = true;
        matchLength = ruleDomain.length;
      }
      // Check subdomain match (domain ends with .ruleDomain)
      else if (lower.endsWith('.' + ruleDomain)) {
        isMatch = true;
        matchLength = ruleDomain.length;
      }

      if (isMatch) {
        // Prefer longer domain matches, then higher priority
        if (
          !bestMatch ||
          matchLength > bestMatch.matchLength ||
          (matchLength === bestMatch.matchLength && rule.priority > bestMatch.priority)
        ) {
          bestMatch = {
            domain: ruleDomain,
            upstreamDNS: rule.upstreamDNS,
            priority: rule.priority,
            matchLength,
          };
        }
      }
    }

    return bestMatch ? bestMatch.upstreamDNS : null;
  },
};

export const dbClientUpstreamDNS = {
  set(clientIp: string, upstreamDNS: string) {
    const stmt = db.prepare(`
      INSERT INTO client_upstream_dns (clientIp, upstreamDNS, updatedAt)
      VALUES (?, ?, ?)
      ON CONFLICT(clientIp) DO UPDATE SET upstreamDNS = ?, updatedAt = ?
    `);
    const now = Date.now();
    stmt.run(clientIp, upstreamDNS, now, upstreamDNS, now);
  },

  get(clientIp: string): string | null {
    const stmt = db.prepare('SELECT upstreamDNS FROM client_upstream_dns WHERE clientIp = ?');
    const row = stmt.get(clientIp) as { upstreamDNS: string } | undefined;
    return row?.upstreamDNS || null;
  },

  remove(clientIp: string) {
    const stmt = db.prepare('DELETE FROM client_upstream_dns WHERE clientIp = ?');
    stmt.run(clientIp);
  },

  getAll(): Record<string, string> {
    const stmt = db.prepare('SELECT clientIp, upstreamDNS FROM client_upstream_dns');
    const rows = stmt.all() as Array<{ clientIp: string; upstreamDNS: string }>;
    return rows.reduce((acc, row) => {
      acc[row.clientIp] = row.upstreamDNS;
      return acc;
    }, {} as Record<string, string>);
  },
};

export const dbBlockPageSettings = {
  get() {
    const stmt = db.prepare('SELECT * FROM block_page_settings WHERE id = 1');
    const row = stmt.get() as
      | {
          id: number;
          title: string | null;
          message: string | null;
          backgroundColor: string | null;
          textColor: string | null;
          logoUrl: string | null;
          updatedAt: number;
        }
      | undefined;
    return (
      row || {
        id: 1,
        title: 'Blocked',
        message: 'This domain has been blocked by your DNS server.',
        backgroundColor: '#ffffff',
        textColor: '#000000',
        logoUrl: null,
        updatedAt: Date.now(),
      }
    );
  },

  update(settings: { title?: string; message?: string; backgroundColor?: string; textColor?: string; logoUrl?: string }) {
    const existing = this.get();
    const stmt = db.prepare(`
      INSERT INTO block_page_settings (id, title, message, backgroundColor, textColor, logoUrl, updatedAt)
      VALUES (1, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = COALESCE(?, title),
        message = COALESCE(?, message),
        backgroundColor = COALESCE(?, backgroundColor),
        textColor = COALESCE(?, textColor),
        logoUrl = COALESCE(?, logoUrl),
        updatedAt = ?
    `);
    const now = Date.now();
    stmt.run(
      settings.title ?? existing.title,
      settings.message ?? existing.message,
      settings.backgroundColor ?? existing.backgroundColor,
      settings.textColor ?? existing.textColor,
      settings.logoUrl ?? existing.logoUrl,
      now,
      settings.title ?? null,
      settings.message ?? null,
      settings.backgroundColor ?? null,
      settings.textColor ?? null,
      settings.logoUrl ?? null,
      now,
    );
  },
};

export const dbScheduledTasks = {
  create(taskType: string, schedule: string) {
    const now = Date.now();
    const stmt = db.prepare(`
      INSERT INTO scheduled_tasks (taskType, schedule, enabled, createdAt, updatedAt, lastRun, nextRun)
      VALUES (?, ?, 1, ?, ?, NULL, ?)
    `);
    const nextRun = this.calculateNextRun(schedule, now);
    stmt.run(taskType, schedule, now, now, nextRun);
    return db.prepare('SELECT last_insert_rowid() as id').get() as { id: number };
  },

  getAll() {
    const stmt = db.prepare('SELECT * FROM scheduled_tasks ORDER BY taskType ASC');
    return stmt.all() as Array<{
      id: number;
      taskType: string;
      schedule: string;
      enabled: number;
      lastRun: number | null;
      nextRun: number | null;
      createdAt: number;
      updatedAt: number;
    }>;
  },

  getEnabled() {
    const stmt = db.prepare('SELECT * FROM scheduled_tasks WHERE enabled = 1');
    return stmt.all() as Array<{
      id: number;
      taskType: string;
      schedule: string;
      enabled: number;
      lastRun: number | null;
      nextRun: number | null;
      createdAt: number;
      updatedAt: number;
    }>;
  },

  setEnabled(id: number, enabled: boolean) {
    const stmt = db.prepare('UPDATE scheduled_tasks SET enabled = ?, updatedAt = ? WHERE id = ?');
    stmt.run(enabled ? 1 : 0, Date.now(), id);
  },

  remove(id: number) {
    const stmt = db.prepare('DELETE FROM scheduled_tasks WHERE id = ?');
    stmt.run(id);
  },

  update(id: number, schedule: string) {
    const stmt = db.prepare('UPDATE scheduled_tasks SET schedule = ?, updatedAt = ?, nextRun = ? WHERE id = ?');
    const nextRun = this.calculateNextRun(schedule, Date.now());
    stmt.run(schedule, Date.now(), nextRun, id);
  },

  markRun(id: number) {
    const task = db.prepare('SELECT schedule FROM scheduled_tasks WHERE id = ?').get(id) as { schedule: string } | undefined;
    if (!task) return;

    const now = Date.now();
    const nextRun = this.calculateNextRun(task.schedule, now);
    const stmt = db.prepare('UPDATE scheduled_tasks SET lastRun = ?, nextRun = ?, updatedAt = ? WHERE id = ?');
    stmt.run(now, nextRun, now, id);
  },

  calculateNextRun(schedule: string, fromTime: number): number {
    // Schedule format: "daily", "weekly", "hourly", or cron-like "0 2 * * *" (daily at 2 AM)
    const now = new Date(fromTime);

    if (schedule === 'hourly') {
      now.setHours(now.getHours() + 1, 0, 0, 0);
      return now.getTime();
    }

    if (schedule === 'daily') {
      now.setDate(now.getDate() + 1);
      now.setHours(2, 0, 0, 0); // 2 AM
      return now.getTime();
    }

    if (schedule === 'weekly') {
      now.setDate(now.getDate() + 7);
      now.setHours(2, 0, 0, 0);
      return now.getTime();
    }

    // Simple cron parsing: "0 2 * * *" = daily at 2 AM
    const cronMatch = schedule.match(/^(\d+)\s+(\d+)\s+\*\s+\*\s+\*$/);
    if (cronMatch) {
      const minute = parseInt(cronMatch[1], 10);
      const hour = parseInt(cronMatch[2], 10);
      now.setDate(now.getDate() + 1);
      now.setHours(hour, minute, 0, 0);
      return now.getTime();
    }

    // Default: daily at 2 AM
    now.setDate(now.getDate() + 1);
    now.setHours(2, 0, 0, 0);
    return now.getTime();
  },

  getDueTasks(): Array<{ id: number; taskType: string; schedule: string }> {
    const now = Date.now();
    const stmt = db.prepare('SELECT id, taskType, schedule FROM scheduled_tasks WHERE enabled = 1 AND nextRun <= ?');
    return stmt.all(now) as Array<{ id: number; taskType: string; schedule: string }>;
  },
};

export const dbRateLimits = {
  checkRateLimit(clientIp: string, maxQueries: number, windowMs: number): { allowed: boolean; remaining: number } {
    const now = Date.now();
    const windowStart = Math.floor(now / windowMs) * windowMs;

    const stmt = db.prepare(`
      SELECT queryCount, windowStart, blocked FROM rate_limits WHERE clientIp = ?
    `);
    const row = stmt.get(clientIp) as { queryCount: number; windowStart: number; blocked: number } | undefined;

    if (!row || row.windowStart !== windowStart) {
      // New window or new client
      const insertStmt = db.prepare(`
        INSERT INTO rate_limits (clientIp, queryCount, windowStart, blocked)
        VALUES (?, 1, ?, 0)
        ON CONFLICT(clientIp) DO UPDATE SET queryCount = 1, windowStart = ?, blocked = 0
      `);
      insertStmt.run(clientIp, windowStart, windowStart);
      return { allowed: true, remaining: maxQueries - 1 };
    }

    if (row.blocked === 1) {
      return { allowed: false, remaining: 0 };
    }

    const newCount = row.queryCount + 1;
    const updateStmt = db.prepare(`
      UPDATE rate_limits SET queryCount = ?, blocked = ? WHERE clientIp = ?
    `);

    if (newCount > maxQueries) {
      updateStmt.run(newCount, 1, clientIp);
      return { allowed: false, remaining: 0 };
    }

    updateStmt.run(newCount, 0, clientIp);
    return { allowed: true, remaining: maxQueries - newCount };
  },

  unblock(clientIp: string) {
    const stmt = db.prepare('UPDATE rate_limits SET blocked = 0 WHERE clientIp = ?');
    stmt.run(clientIp);
  },

  cleanupOldWindows(windowMs: number) {
    const now = Date.now();
    const cutoff = now - windowMs * 2; // Keep 2 windows worth
    const stmt = db.prepare('DELETE FROM rate_limits WHERE windowStart < ?');
    stmt.run(cutoff);
  },
};

export const dbManualBlocklist = {
  add(domain: string, comment?: string) {
    const stmt = db.prepare(`
      INSERT INTO manual_blocklist (domain, addedAt, comment)
      VALUES (?, ?, ?)
      ON CONFLICT(domain) DO NOTHING
    `);
    stmt.run(domain.toLowerCase(), Date.now(), comment || null);
  },

  remove(domain: string) {
    const stmt = db.prepare('DELETE FROM manual_blocklist WHERE domain = ?');
    stmt.run(domain.toLowerCase());
  },

  getAll() {
    const stmt = db.prepare('SELECT * FROM manual_blocklist ORDER BY domain ASC');
    return stmt.all() as Array<{
      id: number;
      domain: string;
      addedAt: number;
      comment: string | null;
    }>;
  },

  getDomains(): Set<string> {
    const stmt = db.prepare('SELECT domain FROM manual_blocklist');
    const rows = stmt.all() as Array<{ domain: string }>;
    return new Set(rows.map((row) => row.domain));
  },
};

export const dbZones = {
  create(domain: string, soaMname: string, soaRname: string) {
    const now = Date.now();
    const stmt = db.prepare(`
      INSERT INTO zones (domain, soa_mname, soa_rname, soa_serial, soa_refresh, soa_retry, soa_expire, soa_minimum, createdAt, updatedAt)
      VALUES (?, ?, ?, 1, 3600, 600, 86400, 3600, ?, ?)
    `);
    const result = stmt.run(domain.toLowerCase(), soaMname, soaRname, now, now);
    return result.lastInsertRowid as number;
  },

  getAll(): Array<{
    id: number;
    domain: string;
    enabled: number;
    soa_serial: number;
    soa_refresh: number;
    soa_retry: number;
    soa_expire: number;
    soa_minimum: number;
    soa_mname: string;
    soa_rname: string;
    createdAt: number;
    updatedAt: number;
  }> {
    const stmt = db.prepare(`
      SELECT id, domain, enabled, soa_serial, soa_refresh, soa_retry, soa_expire, soa_minimum, 
             soa_mname, soa_rname, createdAt, updatedAt 
      FROM zones 
      ORDER BY domain
    `);
    return stmt.all() as Array<{
      id: number;
      domain: string;
      enabled: number;
      soa_serial: number;
      soa_refresh: number;
      soa_retry: number;
      soa_expire: number;
      soa_minimum: number;
      soa_mname: string;
      soa_rname: string;
      createdAt: number;
      updatedAt: number;
    }>;
  },

  getById(id: number) {
    const stmt = db.prepare(`
      SELECT id, domain, enabled, soa_serial, soa_refresh, soa_retry, soa_expire, soa_minimum, 
             soa_mname, soa_rname, createdAt, updatedAt 
      FROM zones 
      WHERE id = ?
    `);
    return stmt.get(id) as
      | {
          id: number;
          domain: string;
          enabled: number;
          soa_serial: number;
          soa_refresh: number;
          soa_retry: number;
          soa_expire: number;
          soa_minimum: number;
          soa_mname: string;
          soa_rname: string;
          createdAt: number;
          updatedAt: number;
        }
      | undefined;
  },

  getByDomain(domain: string) {
    const stmt = db.prepare(`
      SELECT id, domain, enabled, soa_serial, soa_refresh, soa_retry, soa_expire, soa_minimum, 
             soa_mname, soa_rname, createdAt, updatedAt 
      FROM zones 
      WHERE domain = ? AND enabled = 1
    `);
    return stmt.get(domain.toLowerCase()) as
      | {
          id: number;
          domain: string;
          enabled: number;
          soa_serial: number;
          soa_refresh: number;
          soa_retry: number;
          soa_expire: number;
          soa_minimum: number;
          soa_mname: string;
          soa_rname: string;
          createdAt: number;
          updatedAt: number;
        }
      | undefined;
  },

  findZoneForDomain(domain: string) {
    // Find the most specific zone that matches the domain
    // e.g., for "sub.example.com", check "sub.example.com", "example.com", "com"
    const parts = domain.toLowerCase().split('.');
    for (let i = 0; i < parts.length; i++) {
      const zoneDomain = parts.slice(i).join('.');
      const zone = this.getByDomain(zoneDomain);
      if (zone) {
        return zone;
      }
    }
    return undefined;
  },

  update(
    id: number,
    updates: {
      domain?: string;
      enabled?: boolean;
      soa_serial?: number;
      soa_refresh?: number;
      soa_retry?: number;
      soa_expire?: number;
      soa_minimum?: number;
      soa_mname?: string;
      soa_rname?: string;
    },
  ) {
    const now = Date.now();
    const fields: string[] = [];
    const values: unknown[] = [];

    if (updates.domain !== undefined) {
      fields.push('domain = ?');
      values.push(updates.domain.toLowerCase());
    }
    if (updates.enabled !== undefined) {
      fields.push('enabled = ?');
      values.push(updates.enabled ? 1 : 0);
    }
    if (updates.soa_serial !== undefined) {
      fields.push('soa_serial = ?');
      values.push(updates.soa_serial);
    }
    if (updates.soa_refresh !== undefined) {
      fields.push('soa_refresh = ?');
      values.push(updates.soa_refresh);
    }
    if (updates.soa_retry !== undefined) {
      fields.push('soa_retry = ?');
      values.push(updates.soa_retry);
    }
    if (updates.soa_expire !== undefined) {
      fields.push('soa_expire = ?');
      values.push(updates.soa_expire);
    }
    if (updates.soa_minimum !== undefined) {
      fields.push('soa_minimum = ?');
      values.push(updates.soa_minimum);
    }
    if (updates.soa_mname !== undefined) {
      fields.push('soa_mname = ?');
      values.push(updates.soa_mname);
    }
    if (updates.soa_rname !== undefined) {
      fields.push('soa_rname = ?');
      values.push(updates.soa_rname);
    }

    if (fields.length === 0) return;

    fields.push('updatedAt = ?');
    values.push(now);
    values.push(id);

    const stmt = db.prepare(`UPDATE zones SET ${fields.join(', ')} WHERE id = ?`);
    stmt.run(...values);
  },

  delete(id: number) {
    const stmt = db.prepare('DELETE FROM zones WHERE id = ?');
    stmt.run(id);
  },

  incrementSerial(id: number) {
    const stmt = db.prepare('UPDATE zones SET soa_serial = soa_serial + 1, updatedAt = ? WHERE id = ?');
    stmt.run(Date.now(), id);
  },
};

export const dbZoneRecords = {
  create(zoneId: number, name: string, type: string, ttl: number, data: string, priority?: number) {
    const now = Date.now();
    const stmt = db.prepare(`
      INSERT INTO zone_records (zone_id, name, type, ttl, data, priority, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(zoneId, name.toLowerCase(), type.toUpperCase(), ttl, data, priority ?? null, now, now);
    return result.lastInsertRowid as number;
  },

  getByZone(zoneId: number) {
    const stmt = db.prepare('SELECT * FROM zone_records WHERE zone_id = ? AND enabled = 1 ORDER BY name, type');
    return stmt.all(zoneId) as Array<{
      id: number;
      zone_id: number;
      name: string;
      type: string;
      ttl: number;
      data: string;
      priority: number | null;
      enabled: number;
      createdAt: number;
      updatedAt: number;
    }>;
  },

  getByZoneAndName(zoneId: number, name: string) {
    const stmt = db.prepare('SELECT * FROM zone_records WHERE zone_id = ? AND name = ? AND enabled = 1');
    return stmt.all(zoneId, name.toLowerCase()) as Array<{
      id: number;
      zone_id: number;
      name: string;
      type: string;
      ttl: number;
      data: string;
      priority: number | null;
      enabled: number;
      createdAt: number;
      updatedAt: number;
    }>;
  },

  getByZoneNameAndType(zoneId: number, name: string, type: string) {
    const stmt = db.prepare('SELECT * FROM zone_records WHERE zone_id = ? AND name = ? AND type = ? AND enabled = 1');
    return stmt.all(zoneId, name.toLowerCase(), type.toUpperCase()) as Array<{
      id: number;
      zone_id: number;
      name: string;
      type: string;
      ttl: number;
      data: string;
      priority: number | null;
      enabled: number;
      createdAt: number;
      updatedAt: number;
    }>;
  },

  getById(id: number) {
    const stmt = db.prepare('SELECT * FROM zone_records WHERE id = ?');
    return stmt.get(id) as
      | {
          id: number;
          zone_id: number;
          name: string;
          type: string;
          ttl: number;
          data: string;
          priority: number | null;
          enabled: number;
          createdAt: number;
          updatedAt: number;
        }
      | undefined;
  },

  update(
    id: number,
    updates: {
      name?: string;
      type?: string;
      ttl?: number;
      data?: string;
      priority?: number | null;
      enabled?: boolean;
    },
  ) {
    const now = Date.now();
    const fields: string[] = [];
    const values: unknown[] = [];

    if (updates.name !== undefined) {
      fields.push('name = ?');
      values.push(updates.name.toLowerCase());
    }
    if (updates.type !== undefined) {
      fields.push('type = ?');
      values.push(updates.type.toUpperCase());
    }
    if (updates.ttl !== undefined) {
      fields.push('ttl = ?');
      values.push(updates.ttl);
    }
    if (updates.data !== undefined) {
      fields.push('data = ?');
      values.push(updates.data);
    }
    if (updates.priority !== undefined) {
      fields.push('priority = ?');
      values.push(updates.priority);
    }
    if (updates.enabled !== undefined) {
      fields.push('enabled = ?');
      values.push(updates.enabled ? 1 : 0);
    }

    if (fields.length === 0) return;

    fields.push('updatedAt = ?');
    values.push(now);
    values.push(id);

    const stmt = db.prepare(`UPDATE zone_records SET ${fields.join(', ')} WHERE id = ?`);
    stmt.run(...values);
  },

  delete(id: number) {
    const stmt = db.prepare('DELETE FROM zone_records WHERE id = ?');
    stmt.run(id);
  },

  deleteByZone(zoneId: number) {
    const stmt = db.prepare('DELETE FROM zone_records WHERE zone_id = ?');
    stmt.run(zoneId);
  },
};

export const dbZoneKeys = {
  create(zoneId: number, flags: number, algorithm: number, privateKey: string, publicKey: Buffer, keyTag: number) {
    const now = Date.now();
    const stmt = db.prepare(`
      INSERT INTO zone_keys (zone_id, flags, algorithm, private_key, public_key, key_tag, active, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
    `);
    const result = stmt.run(zoneId, flags, algorithm, privateKey, publicKey, keyTag, now, now);
    return result.lastInsertRowid as number;
  },

  getByZone(
    zoneId: number,
    activeOnly: boolean = true,
  ): Array<{
    id: number;
    zoneId: number;
    flags: number;
    algorithm: number;
    privateKey: string;
    publicKey: Buffer;
    keyTag: number;
    active: number;
  }> {
    const stmt = activeOnly
      ? db.prepare('SELECT * FROM zone_keys WHERE zone_id = ? AND active = 1')
      : db.prepare('SELECT * FROM zone_keys WHERE zone_id = ?');
    const rows = stmt.all(zoneId) as Array<{
      id: number;
      zone_id: number;
      flags: number;
      algorithm: number;
      private_key: string;
      public_key: Buffer;
      key_tag: number;
      active: number;
    }>;
    return rows.map((row) => ({
      id: row.id,
      zoneId: row.zone_id,
      flags: row.flags,
      algorithm: row.algorithm,
      privateKey: row.private_key,
      publicKey: row.public_key,
      keyTag: row.key_tag,
      active: row.active,
    }));
  },

  getZSK(zoneId: number): {
    id: number;
    zoneId: number;
    flags: number;
    algorithm: number;
    privateKey: string;
    publicKey: Buffer;
    keyTag: number;
    active: number;
  } | null {
    const stmt = db.prepare('SELECT * FROM zone_keys WHERE zone_id = ? AND flags = 256 AND active = 1 LIMIT 1');
    const row = stmt.get(zoneId) as
      | {
          id: number;
          zone_id: number;
          flags: number;
          algorithm: number;
          private_key: string;
          public_key: Buffer;
          key_tag: number;
          active: number;
        }
      | undefined;
    if (!row) return null;
    return {
      id: row.id,
      zoneId: row.zone_id,
      flags: row.flags,
      algorithm: row.algorithm,
      privateKey: row.private_key,
      publicKey: row.public_key,
      keyTag: row.key_tag,
      active: row.active,
    };
  },

  setActive(id: number, active: boolean) {
    const stmt = db.prepare('UPDATE zone_keys SET active = ?, updatedAt = ? WHERE id = ?');
    stmt.run(active ? 1 : 0, Date.now(), id);
  },

  delete(id: number) {
    const stmt = db.prepare('DELETE FROM zone_keys WHERE id = ?');
    stmt.run(id);
  },
};

export const dbTSIGKeys = {
  create(name: string, algorithm: string, secret: string) {
    const now = Date.now();
    const stmt = db.prepare(`
      INSERT INTO tsig_keys (name, algorithm, secret, enabled, createdAt, updatedAt)
      VALUES (?, ?, ?, 1, ?, ?)
    `);
    const result = stmt.run(name.toLowerCase(), algorithm, secret, now, now);
    return result.lastInsertRowid as number;
  },

  getByName(name: string): {
    id: number;
    name: string;
    algorithm: string;
    secret: string;
    enabled: number;
  } | null {
    const stmt = db.prepare('SELECT * FROM tsig_keys WHERE name = ? AND enabled = 1');
    const row = stmt.get(name.toLowerCase()) as
      | {
          id: number;
          name: string;
          algorithm: string;
          secret: string;
          enabled: number;
        }
      | undefined;
    return row || null;
  },

  getAll() {
    const stmt = db.prepare('SELECT * FROM tsig_keys ORDER BY name ASC');
    return stmt.all() as Array<{
      id: number;
      name: string;
      algorithm: string;
      secret: string;
      enabled: number;
      createdAt: number;
      updatedAt: number;
    }>;
  },

  setEnabled(id: number, enabled: boolean) {
    const stmt = db.prepare('UPDATE tsig_keys SET enabled = ?, updatedAt = ? WHERE id = ?');
    stmt.run(enabled ? 1 : 0, Date.now(), id);
  },

  delete(id: number) {
    const stmt = db.prepare('DELETE FROM tsig_keys WHERE id = ?');
    stmt.run(id);
  },
};

export const dbCache = {
  set(domain: string, type: number, response: Buffer, expiresAt: number) {
    const stmt = db.prepare(`
      INSERT INTO dns_cache (domain, type, response, expiresAt)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(domain, type) DO UPDATE SET response = ?, expiresAt = ?
    `);
    stmt.run(domain.toLowerCase(), type, response, expiresAt, response, expiresAt);
  },

  get(domain: string, type: number): Buffer | null {
    const stmt = db.prepare(`
      SELECT response, expiresAt FROM dns_cache
      WHERE domain = ? AND type = ?
    `);
    const row = stmt.get(domain.toLowerCase(), type) as { response: Buffer; expiresAt: number } | undefined;

    if (!row) return null;

    // Check if expired
    if (Date.now() > row.expiresAt) {
      this.delete(domain, type);
      return null;
    }

    return row.response;
  },

  delete(domain: string, type: number) {
    const stmt = db.prepare('DELETE FROM dns_cache WHERE domain = ? AND type = ?');
    stmt.run(domain.toLowerCase(), type);
  },

  clear() {
    db.exec('DELETE FROM dns_cache');
  },

  getAll(): Array<{ domain: string; type: number; response: Buffer; expiresAt: number }> {
    const stmt = db.prepare('SELECT domain, type, response, expiresAt FROM dns_cache');
    return stmt.all() as Array<{ domain: string; type: number; response: Buffer; expiresAt: number }>;
  },

  cleanupExpired() {
    const now = Date.now();
    const stmt = db.prepare('DELETE FROM dns_cache WHERE expiresAt < ?');
    const result = stmt.run(now);
    return result.changes;
  },
};

export default db;
