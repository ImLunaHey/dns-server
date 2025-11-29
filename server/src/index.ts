import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { DNSServer } from './dns-server.js';
import { logger } from './logger.js';
import {
  dbClientNames,
  dbAdlists,
  dbLocalDNS,
  dbSettings,
  dbQueries,
  dbClientGroups,
  dbAllowlist,
  dbRegexFilters,
  dbBlocklistUpdates,
  dbClientBlockingRules,
  dbGroupBlockingRules,
  dbClientAllowlist,
  dbClientBlocklist,
  dbGroupAllowlist,
  dbGroupBlocklist,
  dbManualBlocklist,
  dbConditionalForwarding,
  dbClientUpstreamDNS,
  dbRateLimits,
  dbScheduledTasks,
  dbBlockPageSettings,
  dbZones,
  dbZoneRecords,
} from './db.js';
import db from './db.js';
import { auth } from './auth.js';
import { requireAuth } from './middleware.js';

const app = new Hono();
const dnsServer = new DNSServer();

// Enable CORS for frontend
app.use(
  '/*',
  cors({
    origin: 'http://localhost:3000',
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowHeaders: ['Content-Type', 'Authorization', 'Cookie', 'Set-Cookie', 'x-api-key'],
    exposeHeaders: ['Content-Length', 'Set-Cookie'],
    maxAge: 86400,
    credentials: true,
  }),
);

// CORS for auth routes (as per better-auth docs)
app.use(
  '/api/auth/*',
  cors({
    origin: '*',
    allowHeaders: ['*'],
    allowMethods: ['POST', 'GET', 'OPTIONS'],
    exposeHeaders: ['Content-Length', 'Set-Cookie'],
    maxAge: 600,
    credentials: false,
  }),
);

// Auth routes
app.on(['POST', 'GET'], '/api/auth/*', (c) => {
  return auth.handler(c.req.raw);
});

// Helper function to add EDNS(0) OPT record to DNS query
function addEDNS0(query: Buffer, dnssecOK: boolean = false, udpPayloadSize: number = 4096): Buffer {
  // Check if EDNS(0) already exists by looking for OPT record (type 41) in additional section
  if (query.length < 12) return query;

  const arCount = query.readUInt16BE(10);
  if (arCount > 0) {
    // EDNS(0) might already be present, check for it
    let offset = 12;
    // Skip question section
    while (offset < query.length && query[offset] !== 0) {
      const length = query[offset];
      offset += length + 1;
    }
    if (offset < query.length) {
      offset += 5; // Skip null terminator and QTYPE/QCLASS
      // Check additional section for OPT record
      for (let i = 0; i < arCount && offset < query.length; i++) {
        if (query[offset] === 0) {
          // Name is root (0)
          const optType = query.readUInt16BE(offset + 1);
          if (optType === 41) {
            // OPT record already exists, update it
            const newQuery = Buffer.from(query);
            const optFlags = dnssecOK ? 0x8000 : 0x0000; // DO bit
            newQuery.writeUInt16BE(optFlags, offset + 5); // Extended RCODE and flags
            newQuery.writeUInt16BE(udpPayloadSize, offset + 7); // UDP payload size
            return newQuery;
          }
        }
        // Skip this record
        offset += 2; // Name
        const rrType = query.readUInt16BE(offset);
        offset += 2; // Type
        offset += 2; // Class
        offset += 4; // TTL
        const dataLength = query.readUInt16BE(offset);
        offset += 2 + dataLength; // Data length + data
      }
    }
  }

  // Add EDNS(0) OPT record
  const optRecord = Buffer.alloc(11);
  optRecord[0] = 0; // Root domain name (0)
  optRecord.writeUInt16BE(41, 1); // OPT type
  optRecord.writeUInt16BE(udpPayloadSize, 3); // UDP payload size
  optRecord.writeUInt16BE(dnssecOK ? 0x8000 : 0x0000, 5); // Extended RCODE and flags (DO bit)
  optRecord.writeUInt16BE(0, 7); // RCODE
  optRecord.writeUInt16BE(0, 9); // Data length

  // Update additional count
  const newQuery = Buffer.concat([query, optRecord]);
  newQuery.writeUInt16BE(arCount + 1, 10);

  return newQuery;
}

// Helper function to create DNS query from domain and type
function createDNSQueryFromParams(domain: string, type: string, dnssecOK: boolean = false): Buffer {
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
    RRSIG: 46,
    DNSKEY: 48,
    DS: 43,
    NSEC: 47,
    NSEC3: 50,
    OPT: 41,
  };

  const queryType = typeMap[type.toUpperCase()] || 1;

  // DNS header
  const header = Buffer.alloc(12);
  header.writeUInt16BE(0x1234, 0); // ID
  header.writeUInt16BE(0x0100, 2); // Flags: standard query, recursion desired
  header.writeUInt16BE(0x0001, 4); // Questions: 1
  header.writeUInt16BE(0x0000, 6); // Answers: 0
  header.writeUInt16BE(0x0000, 8); // Authority: 0
  header.writeUInt16BE(0x0000, 10); // Additional: 0

  // Domain name
  const parts = domain.split('.');
  const domainBuffer = Buffer.alloc(domain.length + 2);
  let offset = 0;
  for (const part of parts) {
    domainBuffer[offset++] = part.length;
    Buffer.from(part).copy(domainBuffer, offset);
    offset += part.length;
  }
  domainBuffer[offset++] = 0; // Null terminator

  // QTYPE and QCLASS
  const question = Buffer.alloc(4);
  question.writeUInt16BE(queryType, 0); // QTYPE
  question.writeUInt16BE(1, 2); // QCLASS (IN = 1)

  let query = Buffer.concat([header, domainBuffer.slice(0, offset), question]);

  // Add EDNS(0) if DNSSEC is requested
  if (dnssecOK) {
    query = addEDNS0(query, true);
  }

  return query;
}

// Helper function to parse domain name from DNS response
function parseDomainName(response: Buffer, offset: number): { name: string; newOffset: number } {
  const nameParts: string[] = [];
  let currentOffset = offset;
  const visitedOffsets = new Set<number>();

  while (currentOffset < response.length) {
    if (visitedOffsets.has(currentOffset)) {
      // Prevent infinite loops from compression pointers
      break;
    }
    visitedOffsets.add(currentOffset);

    const length = response[currentOffset];

    if (length === 0) {
      currentOffset++;
      break;
    }

    // Compression pointer
    if ((length & 0xc0) === 0xc0) {
      const pointer = ((length & 0x3f) << 8) | response[currentOffset + 1];
      if (pointer >= response.length) break;
      currentOffset += 2;
      // Follow compression pointer
      const decompressed = parseDomainName(response, pointer);
      nameParts.push(...decompressed.name.split('.'));
      break;
    }

    // Regular label
    if (currentOffset + 1 + length > response.length) break;
    nameParts.push(response.toString('utf8', currentOffset + 1, currentOffset + 1 + length));
    currentOffset += length + 1;
  }

  const name = nameParts.join('.');
  return { name: name || '.', newOffset: currentOffset };
}

// Helper function to parse a DNS resource record
function parseResourceRecord(
  response: Buffer,
  offset: number,
): { name: string; type: number; TTL: number; data: string; newOffset: number } | null {
  if (offset + 10 > response.length) return null;

  const nameResult = parseDomainName(response, offset);
  const name = nameResult.name;
  let currentOffset = nameResult.newOffset;

  if (currentOffset + 10 > response.length) return null;

  const rrType = response.readUInt16BE(currentOffset);
  const rrClass = response.readUInt16BE(currentOffset + 2);
  const ttl = response.readUInt32BE(currentOffset + 4);
  const dataLength = response.readUInt16BE(currentOffset + 8);
  currentOffset += 10;

  if (currentOffset + dataLength > response.length) return null;

  let data = '';
  if (rrType === 1) {
    // A record
    data = `${response[currentOffset]}.${response[currentOffset + 1]}.${response[currentOffset + 2]}.${
      response[currentOffset + 3]
    }`;
  } else if (rrType === 28) {
    // AAAA record
    const parts: string[] = [];
    for (let j = 0; j < 16; j += 2) {
      const val = response.readUInt16BE(currentOffset + j);
      parts.push(val.toString(16).padStart(4, '0'));
    }
    // Compress IPv6
    let ipv6 = parts.join(':');
    ipv6 = ipv6.replace(/\b0+([0-9a-f])/gi, '$1');
    const zeroGroups = ipv6.match(/(:0)+:?/g);
    if (zeroGroups) {
      const longest = zeroGroups.reduce((a, b) => (a.length > b.length ? a : b));
      ipv6 = ipv6.replace(longest, '::');
    }
    data = ipv6;
  } else if (rrType === 5) {
    // CNAME
    const nameResult = parseDomainName(response, currentOffset);
    data = nameResult.name.endsWith('.') ? nameResult.name : nameResult.name + '.';
  } else if (rrType === 15) {
    // MX
    const priority = response.readUInt16BE(currentOffset);
    const nameResult = parseDomainName(response, currentOffset + 2);
    const mxName = nameResult.name.endsWith('.') ? nameResult.name : nameResult.name + '.';
    data = `${priority} ${mxName}`;
  } else if (rrType === 2) {
    // NS
    const nameResult = parseDomainName(response, currentOffset);
    data = nameResult.name.endsWith('.') ? nameResult.name : nameResult.name + '.';
  } else if (rrType === 16) {
    // TXT
    let txtOffset = currentOffset;
    const txtParts: string[] = [];
    while (txtOffset < currentOffset + dataLength) {
      const txtLen = response[txtOffset];
      if (txtOffset + 1 + txtLen > currentOffset + dataLength) break;
      txtParts.push(response.toString('utf8', txtOffset + 1, txtOffset + 1 + txtLen));
      txtOffset += txtLen + 1;
    }
    data = txtParts.join('');
  } else if (rrType === 46) {
    // RRSIG (DNSSEC signature)
    if (dataLength >= 18) {
      const typeCovered = response.readUInt16BE(currentOffset);
      const algorithm = response[currentOffset + 2];
      const labels = response[currentOffset + 3];
      const originalTTL = response.readUInt32BE(currentOffset + 4);
      const expiration = response.readUInt32BE(currentOffset + 8);
      const inception = response.readUInt32BE(currentOffset + 12);
      const keyTag = response.readUInt16BE(currentOffset + 16);
      const signerName = parseDomainName(response, currentOffset + 18);
      const signature = response.slice(signerName.newOffset, currentOffset + dataLength);
      data = `${typeCovered} ${algorithm} ${labels} ${originalTTL} ${expiration} ${inception} ${keyTag} ${
        signerName.name
      } ${signature.toString('base64')}`;
    } else {
      data = response.slice(currentOffset, currentOffset + dataLength).toString('hex');
    }
  } else if (rrType === 48) {
    // DNSKEY (DNSSEC public key)
    if (dataLength >= 4) {
      const flags = response.readUInt16BE(currentOffset);
      const protocol = response[currentOffset + 2];
      const algorithm = response[currentOffset + 3];
      const publicKey = response.slice(currentOffset + 4, currentOffset + dataLength);
      data = `${flags} ${protocol} ${algorithm} ${publicKey.toString('base64')}`;
    } else {
      data = response.slice(currentOffset, currentOffset + dataLength).toString('hex');
    }
  } else if (rrType === 43) {
    // DS (Delegation Signer)
    if (dataLength >= 4) {
      const keyTag = response.readUInt16BE(currentOffset);
      const algorithm = response[currentOffset + 2];
      const digestType = response[currentOffset + 3];
      const digest = response.slice(currentOffset + 4, currentOffset + dataLength);
      data = `${keyTag} ${algorithm} ${digestType} ${digest.toString('hex')}`;
    } else {
      data = response.slice(currentOffset, currentOffset + dataLength).toString('hex');
    }
  } else if (rrType === 47) {
    // NSEC (Next Secure)
    const nextDomain = parseDomainName(response, currentOffset);
    const typeBitMap = response.slice(nextDomain.newOffset, currentOffset + dataLength);
    data = `${nextDomain.name} ${typeBitMap.toString('hex')}`;
  } else if (rrType === 50) {
    // NSEC3 (Next Secure v3)
    if (dataLength >= 7) {
      const hashAlgorithm = response[currentOffset];
      const flags = response[currentOffset + 1];
      const iterations = response.readUInt16BE(currentOffset + 2);
      const saltLength = response[currentOffset + 4];
      const salt = response.slice(currentOffset + 5, currentOffset + 5 + saltLength);
      const hashLength = response[currentOffset + 5 + saltLength];
      const nextHashedOwnerName = response.slice(
        currentOffset + 5 + saltLength + 1,
        currentOffset + 5 + saltLength + 1 + hashLength,
      );
      const typeBitMap = response.slice(currentOffset + 5 + saltLength + 1 + hashLength, currentOffset + dataLength);
      data = `${hashAlgorithm} ${flags} ${iterations} ${saltLength} ${salt.toString(
        'hex',
      )} ${hashLength} ${nextHashedOwnerName.toString('base64')} ${typeBitMap.toString('hex')}`;
    } else {
      data = response.slice(currentOffset, currentOffset + dataLength).toString('hex');
    }
  } else if (rrType === 41) {
    // OPT (EDNS(0))
    if (dataLength >= 4) {
      const udpPayloadSize = response.readUInt16BE(currentOffset);
      const extendedRcode = response[currentOffset + 2];
      const version = response[currentOffset + 3];
      const flags = response.readUInt16BE(currentOffset + 4);
      const dnssecOK = (flags & 0x8000) !== 0;
      data = `UDP:${udpPayloadSize} EXTENDED-RCODE:${extendedRcode} VERSION:${version} FLAGS:${flags.toString(
        16,
      )} DO:${dnssecOK}`;
    } else {
      data = response.slice(currentOffset, currentOffset + dataLength).toString('hex');
    }
  } else {
    // For other types, return hex
    data = response.slice(currentOffset, currentOffset + dataLength).toString('hex');
  }

  return {
    name: name.endsWith('.') ? name : name + '.',
    type: rrType,
    TTL: ttl,
    data,
    newOffset: currentOffset + dataLength,
  };
}

// Helper function to parse DNS response to JSON (Cloudflare format)
function parseDNSResponseToJSON(response: Buffer, domain: string, type: string): unknown {
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
    RRSIG: 46,
    DNSKEY: 48,
    DS: 43,
    NSEC: 47,
    NSEC3: 50,
    OPT: 41,
  };

  if (response.length < 12) {
    return { error: 'Invalid DNS response' };
  }

  const flags = response.readUInt16BE(2);
  const rcode = flags & 0x0f;
  const qdCount = response.readUInt16BE(4);
  const anCount = response.readUInt16BE(6);
  const nsCount = response.readUInt16BE(8);
  const arCount = response.readUInt16BE(10);

  const answers: Array<{ name: string; type: number; TTL: number; data: string }> = [];
  const authority: Array<{ name: string; type: number; TTL: number; data: string }> = [];
  const additional: Array<{ name: string; type: number; TTL: number; data: string }> = [];
  let offset = 12;

  // Parse question section
  let questionName = domain;
  for (let i = 0; i < qdCount; i++) {
    const nameResult = parseDomainName(response, offset);
    questionName = nameResult.name;
    offset = nameResult.newOffset;
    if (offset + 4 > response.length) break;
    offset += 4; // QTYPE + QCLASS
  }

  // Parse answer section
  for (let i = 0; i < anCount && offset < response.length; i++) {
    const rr = parseResourceRecord(response, offset);
    if (!rr) break;
    answers.push({ name: rr.name, type: rr.type, TTL: rr.TTL, data: rr.data });
    offset = rr.newOffset;
  }

  // Parse authority section
  for (let i = 0; i < nsCount && offset < response.length; i++) {
    const rr = parseResourceRecord(response, offset);
    if (!rr) break;
    authority.push({ name: rr.name, type: rr.type, TTL: rr.TTL, data: rr.data });
    offset = rr.newOffset;
  }

  // Parse additional section
  for (let i = 0; i < arCount && offset < response.length; i++) {
    const rr = parseResourceRecord(response, offset);
    if (!rr) break;
    additional.push({ name: rr.name, type: rr.type, TTL: rr.TTL, data: rr.data });
    offset = rr.newOffset;
  }

  const result: {
    Status: number;
    TC: boolean;
    RD: boolean;
    RA: boolean;
    AD: boolean;
    CD: boolean;
    Question: Array<{ name: string; type: number }>;
    Answer?: Array<{ name: string; type: number; TTL: number; data: string }>;
    Authority?: Array<{ name: string; type: number; TTL: number; data: string }>;
    Additional?: Array<{ name: string; type: number; TTL: number; data: string }>;
  } = {
    Status: rcode,
    TC: (flags & 0x0200) !== 0,
    RD: (flags & 0x0100) !== 0,
    RA: (flags & 0x0080) !== 0,
    AD: (flags & 0x0020) !== 0,
    CD: (flags & 0x0010) !== 0,
    Question: [
      { name: questionName.endsWith('.') ? questionName : questionName + '.', type: typeMap[type.toUpperCase()] || 1 },
    ],
  };

  if (answers.length > 0) result.Answer = answers;
  if (authority.length > 0) result.Authority = authority;
  if (additional.length > 0) result.Additional = additional;

  return result;
}

// DNS-over-HTTPS (DoH) endpoint - RFC 8484
// Supports both binary (application/dns-message) and JSON (application/dns-json) formats
app.all('/dns-query', async (c) => {
  try {
    // Get client IP from request headers (standard for DoH)
    const forwardedFor = c.req.header('x-forwarded-for');
    const realIp = c.req.header('x-real-ip');
    const cfConnectingIp = c.req.header('cf-connecting-ip');

    const clientIp = forwardedFor?.split(',')[0]?.trim() || realIp?.trim() || cfConnectingIp?.trim() || 'unknown';

    // Check if client wants JSON format
    const accept = c.req.header('accept') || '';
    const wantsJSON = accept.includes('application/dns-json');

    let dnsMessage: Buffer;
    let queryDomain = '';
    let queryType = 'A';

    if (wantsJSON) {
      // JSON format: use query parameters (Cloudflare format)
      queryDomain = c.req.query('name') || '';
      queryType = c.req.query('type') || 'A';

      if (!queryDomain) {
        return c.json({ error: 'Missing "name" query parameter' }, 400);
      }

      // Support do (DNSSEC) and cd (disable validation) parameters
      const doParam = c.req.query('do');
      const cdParam = c.req.query('cd');

      // Validate do parameter
      if (doParam && doParam !== '' && doParam !== '0' && doParam !== 'false' && doParam !== '1' && doParam !== 'true') {
        return c.json(
          { error: `Invalid DO flag \`${doParam}\`. Expected to be empty or one of \`0\`, \`false\`, \`1\`, or \`true\`.` },
          400,
        );
      }

      // Validate cd parameter
      if (cdParam && cdParam !== '' && cdParam !== '0' && cdParam !== 'false' && cdParam !== '1' && cdParam !== 'true') {
        return c.json(
          { error: `Invalid CD flag \`${cdParam}\`. Expected to be empty or one of \`0\`, \`false\`, \`1\`, or \`true\`.` },
          400,
        );
      }

      // Determine if DNSSEC is requested
      const wantsDNSSEC = doParam === '1' || doParam === 'true';
      const disableValidation = cdParam === '1' || cdParam === 'true';

      dnsMessage = createDNSQueryFromParams(queryDomain, queryType, wantsDNSSEC);

      // Set CD bit if requested (disable validation) - this goes in the DNS header flags
      if (disableValidation) {
        const flags = dnsMessage.readUInt16BE(2);
        dnsMessage.writeUInt16BE(flags | 0x0010, 2); // Set CD bit (Checking Disabled)
      }
    } else if (c.req.method === 'POST') {
      // POST: DNS message in request body
      const contentType = c.req.header('content-type') || '';
      if (!contentType.includes('application/dns-message')) {
        return c.text('Content-Type must be application/dns-message', 400);
      }

      const body = await c.req.arrayBuffer();
      dnsMessage = Buffer.from(body);
    } else if (c.req.method === 'GET') {
      // GET: DNS message in 'dns' query parameter (base64url encoded)
      const dnsParam = c.req.query('dns');
      if (!dnsParam) {
        return c.text('Missing "dns" query parameter', 400);
      }

      try {
        // Decode base64url to buffer
        const base64 = dnsParam.replace(/-/g, '+').replace(/_/g, '/');
        const padding = (4 - (base64.length % 4)) % 4;
        dnsMessage = Buffer.from(base64 + '='.repeat(padding), 'base64');
      } catch (error) {
        return c.text('Invalid base64url encoding in "dns" parameter', 400);
      }
    } else {
      return c.text('Method not allowed', 405);
    }

    // Validate DNS message size
    if (dnsMessage.length > 65535) {
      return wantsJSON ? c.json({ error: 'DNS message too large' }, 400) : c.text('DNS message too large', 400);
    }

    if (dnsMessage.length < 12) {
      return wantsJSON
        ? c.json({ error: 'DNS message too short' }, 400)
        : c.text('DNS message too short (minimum 12 bytes for DNS header)', 400);
    }

    // Basic DNS header validation
    const flags = dnsMessage.readUInt16BE(2);
    if ((flags & 0x8000) !== 0) {
      return wantsJSON
        ? c.json({ error: 'Invalid DNS message: expected query, got response' }, 400)
        : c.text('Invalid DNS message: expected query, got response', 400);
    }

    // Handle the DNS query
    const response = await dnsServer.handleDNSQuery(dnsMessage, clientIp, false);

    // Return response in requested format
    if (wantsJSON) {
      const jsonResponse = parseDNSResponseToJSON(response, queryDomain, queryType);
      return c.json(jsonResponse, 200, {
        'Content-Type': 'application/dns-json',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Accept',
      });
    } else {
      return c.body(response, 200, {
        'Content-Type': 'application/dns-message',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      });
    }
  } catch (error) {
    logger.error('DoH error', {
      error: error instanceof Error ? error : new Error(String(error)),
    });
    return c.text('Internal server error', 500);
  }
});

// OPTIONS for CORS preflight
app.options('/dns-query', (c) => {
  return c.text('', 200, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  });
});

// Public API Routes (no auth required)
app.get('/api/stats', (c) => {
  return c.json(dnsServer.getStats());
});

// Test DNS query endpoint
app.post('/api/dns/test', requireAuth, async (c) => {
  try {
    const { domain, type, dnssec } = await c.req.json();

    if (!domain || typeof domain !== 'string') {
      return c.json({ error: 'Domain is required' }, 400);
    }

    const queryType = type || 'A';
    const wantsDNSSEC = dnssec === true;

    // Create DNS query
    const dnsQuery = createDNSQueryFromParams(domain, queryType, wantsDNSSEC);

    // Handle the query (use a test client IP)
    const startTime = Date.now();
    const response = await dnsServer.handleDNSQuery(dnsQuery, '127.0.0.1', false);
    const responseTime = Date.now() - startTime;

    // Parse response to JSON
    const jsonResponse = parseDNSResponseToJSON(response, domain, queryType);

    return c.json({
      success: true,
      domain,
      type: queryType,
      responseTime,
      response: jsonResponse,
      rawResponse: response.toString('base64'),
    });
  } catch (error) {
    logger.error('DNS test error', {
      error: error instanceof Error ? error : new Error(String(error)),
    });
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to process DNS query',
      },
      500,
    );
  }
});

// Export statistics as CSV
app.get('/api/stats/export/csv', requireAuth, (c) => {
  const stats = dnsServer.getStats();
  const csvRows: string[] = [];

  // Helper to escape CSV values
  const escapeCSV = (value: string | number) => {
    const str = String(value);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  // Summary Statistics
  csvRows.push('Summary Statistics');
  csvRows.push('Metric,Value');
  csvRows.push(`Total Queries,${stats.totalQueries}`);
  csvRows.push(`Blocked Queries,${stats.blockedQueries}`);
  csvRows.push(`Allowed Queries,${stats.allowedQueries}`);
  csvRows.push(`Cached Queries,${stats.cachedQueries}`);
  csvRows.push(`Blocklist Size,${stats.blocklistSize}`);
  csvRows.push('');
  
  // Performance Metrics
  if (stats.performance) {
    csvRows.push('Performance Metrics');
    csvRows.push('Metric,Value');
    csvRows.push(`Average Response Time (ms),${stats.performance.avgResponseTime ?? 'N/A'}`);
    csvRows.push(`Min Response Time (ms),${stats.performance.minResponseTime ?? 'N/A'}`);
    csvRows.push(`Max Response Time (ms),${stats.performance.maxResponseTime ?? 'N/A'}`);
    csvRows.push(`P50 Response Time (ms),${stats.performance.p50 ?? 'N/A'}`);
    csvRows.push(`P95 Response Time (ms),${stats.performance.p95 ?? 'N/A'}`);
    csvRows.push(`P99 Response Time (ms),${stats.performance.p99 ?? 'N/A'}`);
    csvRows.push(`Cache Hit Rate (%),${stats.performance.cacheHitRate.toFixed(2)}`);
    csvRows.push('');
  }

  // Top Domains
  csvRows.push('Top Domains');
  csvRows.push('Domain,Count');
  for (const domain of stats.topDomainsArray) {
    csvRows.push(`${escapeCSV(domain.domain)},${domain.count}`);
  }
  csvRows.push('');

  // Top Blocked Domains
  csvRows.push('Top Blocked Domains');
  csvRows.push('Domain,Blocked Count');
  for (const domain of stats.topBlockedArray) {
    csvRows.push(`${escapeCSV(domain.domain)},${domain.count}`);
  }
  csvRows.push('');

  // Top Clients
  csvRows.push('Top Clients');
  csvRows.push('Client IP,Query Count');
  for (const client of stats.topClientsArray) {
    csvRows.push(`${escapeCSV(client.clientIp)},${client.count}`);
  }
  csvRows.push('');

  // Query Type Breakdown
  csvRows.push('Query Type Breakdown');
  csvRows.push('Type,Count');
  for (const type of stats.queryTypeBreakdown) {
    csvRows.push(`${escapeCSV(type.type)},${type.count}`);
  }
  csvRows.push('');

  // Block Percentage Over Time
  csvRows.push('Block Percentage Over Time');
  csvRows.push('Date,Total Queries,Blocked Queries,Block Percentage');
  for (const day of stats.blockPercentageOverTime) {
    csvRows.push(`${escapeCSV(day.date)},${day.total},${day.blocked},${day.blockPercentage.toFixed(2)}%`);
  }
  csvRows.push('');

  // Top Advertisers
  csvRows.push('Top Advertisers');
  csvRows.push('Domain,Blocked Count,Total Count,Block Rate');
  for (const advertiser of stats.topAdvertisers) {
    csvRows.push(
      `${escapeCSV(advertiser.domain)},${advertiser.blockedCount},${advertiser.totalCount},${advertiser.blockRate.toFixed(
        2,
      )}%`,
    );
  }

  const csv = csvRows.join('\n');
  const filename = `dns-stats-${new Date().toISOString().split('T')[0]}.csv`;

  return c.text(csv, 200, {
    'Content-Type': 'text/csv',
    'Content-Disposition': `attachment; filename="${filename}"`,
  });
});

// Export statistics as JSON
app.get('/api/stats/export/json', requireAuth, (c) => {
  const stats = dnsServer.getStats();
  const json = JSON.stringify(stats, null, 2);
  const filename = `dns-stats-${new Date().toISOString().split('T')[0]}.json`;

  return c.text(json, 200, {
    'Content-Type': 'application/json',
    'Content-Disposition': `attachment; filename="${filename}"`,
  });
});

// Advanced statistics
app.get('/api/stats/client/:clientIp', requireAuth, (c) => {
  const clientIp = c.req.param('clientIp');
  const stats = dbQueries.getPerClientStats(clientIp);
  if (!stats) {
    return c.json({ error: 'Client stats not available (privacy mode enabled or client not found)' }, 404);
  }
  return c.json(stats);
});

app.get('/api/stats/patterns', requireAuth, (c) => {
  const hours = parseInt(c.req.query('hours') || '24', 10);
  const patterns = dbQueries.getQueryPatterns(hours);
  return c.json(patterns);
});

app.get('/api/setup/check', (c) => {
  // Check if any users exist
  const stmt = db.prepare('SELECT COUNT(*) as count FROM user');
  const result = stmt.get() as { count: number };
  return c.json({ hasUsers: result.count > 0 });
});

// Protected API Routes (require auth)
app.get('/api/queries', requireAuth, (c) => {
  const limit = Number(c.req.query('limit')) || 100;
  const offset = Number(c.req.query('offset')) || 0;
  const clientIp = c.req.query('clientIp');
  const type = c.req.query('type');
  const blocked = c.req.query('blocked');
  const startTime = c.req.query('startTime');
  const endTime = c.req.query('endTime');
  const domain = c.req.query('domain');
  const domainPattern = c.req.query('domainPattern');
  const cached = c.req.query('cached');
  const blockReason = c.req.query('blockReason');
  const minResponseTime = c.req.query('minResponseTime');
  const maxResponseTime = c.req.query('maxResponseTime');
  const includeCount = c.req.query('includeCount') === 'true';

  const filters = {
    type: type || undefined,
    blocked: blocked !== undefined ? blocked === 'true' : undefined,
    startTime: startTime ? parseInt(startTime, 10) : undefined,
    endTime: endTime ? parseInt(endTime, 10) : undefined,
    domain: domain || undefined,
    domainPattern: domainPattern || undefined,
    cached: cached !== undefined ? cached === 'true' : undefined,
    blockReason: blockReason || undefined,
    minResponseTime: minResponseTime ? parseInt(minResponseTime, 10) : undefined,
    maxResponseTime: maxResponseTime ? parseInt(maxResponseTime, 10) : undefined,
    offset,
  };

  const queries = dnsServer.getQueries(limit, clientIp, filters);

  if (includeCount) {
    const totalCount = dnsServer.getQueriesCount(clientIp, filters);
    return c.json({
      queries,
      totalCount,
      limit,
      offset,
    });
  }

  return c.json(queries);
});

// Get unique block reasons
app.get('/api/queries/block-reasons', requireAuth, (c) => {
  const reasons = dbQueries.getUniqueBlockReasons();
  return c.json(reasons);
});

// Export queries as CSV
app.get('/api/queries/export/csv', requireAuth, (c) => {
  const clientIp = c.req.query('clientIp');
  const type = c.req.query('type');
  const blocked = c.req.query('blocked');
  const startTime = c.req.query('startTime');
  const endTime = c.req.query('endTime');
  const domain = c.req.query('domain');

  const filters = {
    clientIp: clientIp || undefined,
    type: type || undefined,
    blocked: blocked !== undefined ? blocked === 'true' : undefined,
    startTime: startTime ? parseInt(startTime, 10) : undefined,
    endTime: endTime ? parseInt(endTime, 10) : undefined,
    domain: domain || undefined,
  };

  const queries = dbQueries.getAllFiltered(filters);

  // CSV header
  const headers = ['Timestamp', 'Domain', 'Type', 'Status', 'Client IP', 'Response Time (ms)', 'Block Reason', 'Cached'];
  const csvRows = [headers.join(',')];

  // CSV rows
  for (const query of queries) {
    const timestamp = new Date(query.timestamp).toISOString();
    const status = query.blocked ? 'Blocked' : 'Allowed';
    const clientIp = query.clientIp || '';
    const responseTime = query.responseTime?.toString() || '';
    const blockReason = query.blockReason || '';
    const cached = query.cached ? 'Yes' : 'No';

    // Escape commas and quotes in CSV
    const escapeCSV = (value: string) => {
      if (value.includes(',') || value.includes('"') || value.includes('\n')) {
        return `"${value.replace(/"/g, '""')}"`;
      }
      return value;
    };

    csvRows.push(
      [
        escapeCSV(timestamp),
        escapeCSV(query.domain),
        escapeCSV(query.type),
        escapeCSV(status),
        escapeCSV(clientIp),
        escapeCSV(responseTime),
        escapeCSV(blockReason),
        escapeCSV(cached),
      ].join(','),
    );
  }

  const csv = csvRows.join('\n');
  const filename = `dns-queries-${new Date().toISOString().split('T')[0]}.csv`;

  return c.text(csv, 200, {
    'Content-Type': 'text/csv',
    'Content-Disposition': `attachment; filename="${filename}"`,
  });
});

// Export queries as JSON
app.get('/api/queries/export/json', requireAuth, (c) => {
  const clientIp = c.req.query('clientIp');
  const type = c.req.query('type');
  const blocked = c.req.query('blocked');
  const startTime = c.req.query('startTime');
  const endTime = c.req.query('endTime');
  const domain = c.req.query('domain');
  const domainPattern = c.req.query('domainPattern');
  const cached = c.req.query('cached');
  const blockReason = c.req.query('blockReason');
  const minResponseTime = c.req.query('minResponseTime');
  const maxResponseTime = c.req.query('maxResponseTime');

  const filters = {
    clientIp: clientIp || undefined,
    type: type || undefined,
    blocked: blocked !== undefined ? blocked === 'true' : undefined,
    startTime: startTime ? parseInt(startTime, 10) : undefined,
    endTime: endTime ? parseInt(endTime, 10) : undefined,
    domain: domain || undefined,
    domainPattern: domainPattern || undefined,
    cached: cached !== undefined ? cached === 'true' : undefined,
    blockReason: blockReason || undefined,
    minResponseTime: minResponseTime ? parseInt(minResponseTime, 10) : undefined,
    maxResponseTime: maxResponseTime ? parseInt(maxResponseTime, 10) : undefined,
  };

  const queries = dbQueries.getAllFiltered(filters);

  // Format queries for export
  const exportData = queries.map((query) => ({
    timestamp: new Date(query.timestamp).toISOString(),
    domain: query.domain,
    type: query.type,
    status: query.blocked ? 'Blocked' : 'Allowed',
    clientIp: query.clientIp || null,
    responseTime: query.responseTime || null,
    blockReason: query.blockReason || null,
    cached: query.cached || false,
  }));

  const filename = `dns-queries-${new Date().toISOString().split('T')[0]}.json`;

  return c.json(
    {
      exportedAt: new Date().toISOString(),
      totalQueries: exportData.length,
      filters: filters,
      queries: exportData,
    },
    200,
    {
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  );
});

app.post('/api/blocklist/add', requireAuth, async (c) => {
  const { domain } = await c.req.json();
  if (!domain) {
    return c.json({ error: 'Domain is required' }, 400);
  }
  dnsServer.addToBlocklist(domain);
  return c.json({ success: true, message: `Added ${domain} to blocklist` });
});

app.post('/api/blocklist/remove', requireAuth, async (c) => {
  const { domain } = await c.req.json();
  if (!domain) {
    return c.json({ error: 'Domain is required' }, 400);
  }
  dnsServer.removeFromBlocklist(domain);
  return c.json({ success: true, message: `Removed ${domain} from blocklist` });
});

// Allowlist
app.get('/api/allowlist', requireAuth, (c) => {
  return c.json(dbAllowlist.getAll());
});

app.post('/api/allowlist/add', requireAuth, async (c) => {
  const { domain, comment } = await c.req.json();
  if (!domain) {
    return c.json({ error: 'Domain is required' }, 400);
  }
  dbAllowlist.add(domain, comment);
  return c.json({ success: true, message: `Added ${domain} to allowlist` });
});

app.post('/api/allowlist/remove', requireAuth, async (c) => {
  const { domain } = await c.req.json();
  if (!domain) {
    return c.json({ error: 'Domain is required' }, 400);
  }
  dbAllowlist.remove(domain);
  return c.json({ success: true, message: `Removed ${domain} from allowlist` });
});

// Regex Filters
app.get('/api/regex-filters', requireAuth, (c) => {
  return c.json(dbRegexFilters.getAll());
});

app.post('/api/regex-filters', requireAuth, async (c) => {
  const { pattern, type, comment } = await c.req.json();
  if (!pattern || !type) {
    return c.json({ error: 'Pattern and type are required' }, 400);
  }
  if (type !== 'block' && type !== 'allow') {
    return c.json({ error: 'Type must be "block" or "allow"' }, 400);
  }

  // Validate regex pattern
  try {
    new RegExp(pattern);
  } catch (error) {
    return c.json({ error: 'Invalid regex pattern' }, 400);
  }

  dbRegexFilters.add(pattern, type, comment);
  return c.json({ success: true, message: `Added ${type} regex filter` });
});

app.delete('/api/regex-filters/:id', requireAuth, (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) {
    return c.json({ error: 'Invalid ID' }, 400);
  }
  dbRegexFilters.remove(id);
  return c.json({ success: true, message: 'Regex filter removed' });
});

app.put('/api/regex-filters/:id/enable', requireAuth, async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  const { enabled } = await c.req.json();
  if (isNaN(id)) {
    return c.json({ error: 'Invalid ID' }, 400);
  }
  dbRegexFilters.setEnabled(id, enabled);
  return c.json({ success: true, message: enabled ? 'Regex filter enabled' : 'Regex filter disabled' });
});

// Client names
app.get('/api/clients/names', requireAuth, (c) => {
  return c.json(dbClientNames.getAll());
});

app.post('/api/clients/name', requireAuth, async (c) => {
  const { clientIp, name } = await c.req.json();
  if (!clientIp || !name) {
    return c.json({ error: 'clientIp and name are required' }, 400);
  }
  dbClientNames.setName(clientIp, name);
  return c.json({ success: true });
});

app.delete('/api/clients/name/:clientIp', requireAuth, (c) => {
  const clientIp = c.req.param('clientIp');
  dbClientNames.delete(clientIp);
  return c.json({ success: true });
});

// Adlists
app.get('/api/adlists', requireAuth, (c) => {
  const adlists = dbAdlists.getAll();
  const urls = dnsServer.getBlocklistUrls();
  const latestUpdate = dbBlocklistUpdates.getLatest();
  return c.json({
    adlists: adlists.map((adlist) => ({
      ...adlist,
      enabled: adlist.enabled === 1,
    })),
    activeUrls: urls,
    latestUpdate,
  });
});

app.post('/api/adlists/update', requireAuth, async (c) => {
  try {
    const updateId = dbBlocklistUpdates.startUpdate();
    const adlists = dbAdlists.getAll().filter((a) => a.enabled === 1);
    const urls = adlists.map((a) => a.url);

    // Reload blocklists in background
    dnsServer
      .reloadBlocklist()
      .then(() => {
        const blocklistSize = dnsServer.getBlocklistSize();
        dbBlocklistUpdates.completeUpdate(updateId, blocklistSize);
      })
      .catch((error) => {
        dbBlocklistUpdates.failUpdate(updateId, error instanceof Error ? error.message : 'Unknown error');
      });

    return c.json({ success: true, message: 'Blocklist update started', updateId });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to start update' }, 500);
  }
});

app.get('/api/adlists/update-status', requireAuth, (c) => {
  const latestUpdate = dbBlocklistUpdates.getLatest();
  return c.json(latestUpdate || null);
});

app.post('/api/adlists', requireAuth, async (c) => {
  const { url } = await c.req.json();
  if (!url) {
    return c.json({ error: 'URL is required' }, 400);
  }
  dbAdlists.add(url);
  const urls = dnsServer.getBlocklistUrls();
  urls.push(url);
  await dnsServer.loadBlocklist(urls);
  return c.json({ success: true });
});

app.delete('/api/adlists', requireAuth, async (c) => {
  const { url } = await c.req.json();
  if (!url) {
    return c.json({ error: 'URL is required' }, 400);
  }
  dbAdlists.remove(url);
  const urls = dnsServer.getBlocklistUrls().filter((u) => u !== url);
  await dnsServer.loadBlocklist(urls);
  return c.json({ success: true });
});

// Local DNS
app.get('/api/local-dns', requireAuth, (c) => {
  const records = dbLocalDNS.getAll();
  return c.json(
    records.map((record) => ({
      ...record,
      enabled: record.enabled === 1,
    })),
  );
});

app.post('/api/local-dns', requireAuth, async (c) => {
  const { domain, ip, type = 'A' } = await c.req.json();
  if (!domain || !ip) {
    return c.json({ error: 'domain and ip are required' }, 400);
  }
  dbLocalDNS.add(domain, ip, type);
  return c.json({ success: true });
});

app.delete('/api/local-dns/:domain', requireAuth, (c) => {
  const domain = c.req.param('domain');
  dbLocalDNS.remove(domain);
  return c.json({ success: true });
});

app.put('/api/local-dns/:domain/enable', requireAuth, async (c) => {
  const domain = c.req.param('domain');
  const { enabled } = await c.req.json();
  dbLocalDNS.setEnabled(domain, enabled);
  return c.json({ success: true });
});

// Conditional forwarding
app.get('/api/conditional-forwarding', requireAuth, (c) => {
  const rules = dbConditionalForwarding.getAll();
  return c.json(
    rules.map((rule) => ({
      ...rule,
      enabled: rule.enabled === 1,
    })),
  );
});

app.post('/api/conditional-forwarding', requireAuth, async (c) => {
  const { domain, upstreamDNS, comment } = await c.req.json();
  if (!domain || !upstreamDNS) {
    return c.json({ error: 'domain and upstreamDNS are required' }, 400);
  }
  dbConditionalForwarding.add(domain, upstreamDNS, comment);
  return c.json({ success: true });
});

app.put('/api/conditional-forwarding/:id', requireAuth, async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  const { domain, upstreamDNS, comment } = await c.req.json();
  if (!domain || !upstreamDNS) {
    return c.json({ error: 'domain and upstreamDNS are required' }, 400);
  }
  dbConditionalForwarding.update(id, domain, upstreamDNS, comment);
  return c.json({ success: true });
});

app.delete('/api/conditional-forwarding/:id', requireAuth, (c) => {
  const id = parseInt(c.req.param('id'), 10);
  dbConditionalForwarding.remove(id);
  return c.json({ success: true });
});

app.put('/api/conditional-forwarding/:id/enable', requireAuth, async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  const { enabled } = await c.req.json();
  dbConditionalForwarding.setEnabled(id, enabled);
  return c.json({ success: true });
});

// Blocking control
app.get('/api/blocking/status', requireAuth, (c) => {
  return c.json(dnsServer.getBlockingStatus());
});

app.post('/api/blocking/enable', requireAuth, (c) => {
  dnsServer.setBlockingEnabled(true);
  return c.json({ success: true, status: dnsServer.getBlockingStatus() });
});

app.post('/api/blocking/disable', requireAuth, async (c) => {
  const { seconds } = await c.req.json();
  if (seconds && typeof seconds === 'number' && seconds > 0) {
    dnsServer.setBlockingDisabledFor(seconds);
  } else {
    dnsServer.setBlockingEnabled(false);
  }
  return c.json({ success: true, status: dnsServer.getBlockingStatus() });
});

// Settings
app.get('/api/settings', requireAuth, (c) => {
  const cacheStats = dnsServer.getCacheStats();
  const blockPageStatus = dnsServer.getBlockPageStatus();
  return c.json({
    upstreamDNS: dnsServer.getUpstreamDNS(),
    dnsPort: dnsServer.getPort(),
    queryRetentionDays: parseInt(dbSettings.get('queryRetentionDays', '7'), 10),
    privacyMode: dbSettings.get('privacyMode', 'false') === 'true',
    rateLimitEnabled: dbSettings.get('rateLimitEnabled', 'false') === 'true',
    rateLimitMaxQueries: parseInt(dbSettings.get('rateLimitMaxQueries', '1000'), 10),
    rateLimitWindowMs: parseInt(dbSettings.get('rateLimitWindowMs', '60000'), 10),
    cacheEnabled: cacheStats.enabled,
    cacheSize: cacheStats.size,
    blockPageEnabled: blockPageStatus.enabled,
    blockPageIP: blockPageStatus.ipv4,
    blockPageIPv6: blockPageStatus.ipv6,
    dotEnabled: dbSettings.get('dotEnabled', 'false') === 'true',
    dotPort: parseInt(dbSettings.get('dotPort', '853'), 10),
    dotCertPath: dbSettings.get('dotCertPath', ''),
    dotKeyPath: dbSettings.get('dotKeyPath', ''),
    dnssecValidation: dbSettings.get('dnssecValidation', 'false') === 'true',
  });
});

app.put('/api/settings', requireAuth, async (c) => {
  const {
    upstreamDNS,
    queryRetentionDays,
    privacyMode,
    rateLimitEnabled,
    rateLimitMaxQueries,
    rateLimitWindowMs,
    cacheEnabled,
    blockPageEnabled,
    blockPageIP,
    blockPageIPv6,
    dotEnabled,
    dotPort,
    dotCertPath,
    dotKeyPath,
    dnssecValidation,
  } = await c.req.json();

  if (upstreamDNS && typeof upstreamDNS === 'string') {
    dnsServer.setUpstreamDNS(upstreamDNS);
  }

  if (queryRetentionDays && typeof queryRetentionDays === 'number' && queryRetentionDays > 0) {
    dbSettings.set('queryRetentionDays', queryRetentionDays.toString());
  }

  if (typeof privacyMode === 'boolean') {
    dbSettings.set('privacyMode', privacyMode.toString());
  }

  if (typeof rateLimitEnabled === 'boolean') {
    dbSettings.set('rateLimitEnabled', rateLimitEnabled.toString());
    dnsServer.setRateLimitEnabled(rateLimitEnabled);
  }

  if (rateLimitMaxQueries && typeof rateLimitMaxQueries === 'number' && rateLimitMaxQueries > 0) {
    dbSettings.set('rateLimitMaxQueries', rateLimitMaxQueries.toString());
    dnsServer.setRateLimitMaxQueries(rateLimitMaxQueries);
  }

  if (rateLimitWindowMs && typeof rateLimitWindowMs === 'number' && rateLimitWindowMs > 0) {
    dbSettings.set('rateLimitWindowMs', rateLimitWindowMs.toString());
    dnsServer.setRateLimitWindowMs(rateLimitWindowMs);
  }

  if (typeof cacheEnabled === 'boolean') {
    dnsServer.setCacheEnabled(cacheEnabled);
  }

  if (typeof blockPageEnabled === 'boolean') {
    dnsServer.setBlockPageEnabled(blockPageEnabled);
  }

  if (blockPageIP && typeof blockPageIP === 'string') {
    dnsServer.setBlockPageIP(blockPageIP);
  }

  if (blockPageIPv6 && typeof blockPageIPv6 === 'string') {
    dnsServer.setBlockPageIPv6(blockPageIPv6);
  }

  // Track if DoT settings changed
  let dotSettingsChanged = false;
  const previousDotEnabled = dbSettings.get('dotEnabled', 'false') === 'true';
  const previousDotPort = parseInt(dbSettings.get('dotPort', '853'), 10);
  const previousDotCertPath = dbSettings.get('dotCertPath', '');
  const previousDotKeyPath = dbSettings.get('dotKeyPath', '');

  if (typeof dotEnabled === 'boolean') {
    const newDotEnabled = dotEnabled;
    if (newDotEnabled !== previousDotEnabled) {
      dotSettingsChanged = true;
      logger.info('DoT enabled changed', { previous: previousDotEnabled, current: newDotEnabled });
    }
    dbSettings.set('dotEnabled', dotEnabled.toString());
  }

  if (dotPort && typeof dotPort === 'number' && dotPort > 0) {
    if (dotPort !== previousDotPort) {
      dotSettingsChanged = true;
      logger.info('DoT port changed', { previous: previousDotPort, current: dotPort });
    }
    dbSettings.set('dotPort', dotPort.toString());
  }

  if (dotCertPath && typeof dotCertPath === 'string') {
    if (dotCertPath !== previousDotCertPath) {
      dotSettingsChanged = true;
      logger.info('DoT cert path changed', { previous: previousDotCertPath, current: dotCertPath });
    }
    dbSettings.set('dotCertPath', dotCertPath);
  }

  if (dotKeyPath && typeof dotKeyPath === 'string') {
    if (dotKeyPath !== previousDotKeyPath) {
      dotSettingsChanged = true;
      logger.info('DoT key path changed', { previous: previousDotKeyPath, current: dotKeyPath });
    }
    dbSettings.set('dotKeyPath', dotKeyPath);
  }

  if (typeof dnssecValidation === 'boolean') {
    dbSettings.set('dnssecValidation', dnssecValidation.toString());
  }

  // Restart DoT server if settings changed
  if (dotSettingsChanged) {
    logger.info('Restarting DoT server due to settings change...');
    try {
      await dnsServer.restartDoT();
      logger.info('DoT server restarted with new settings');
    } catch (error) {
      logger.error('Failed to restart DoT server', {
        error: error instanceof Error ? error : new Error(String(error)),
      });
      // Don't fail the request, just log the error
    }
  } else if (typeof dotEnabled === 'boolean' || dotPort || dotCertPath || dotKeyPath) {
    // Even if no change detected, if DoT settings were provided, verify they're correct
    logger.debug('DoT settings updated but no change detected (may already be configured)');
  }

  return c.json({ success: true, settings: dbSettings.getAll() });
});

app.post('/api/cache/clear', requireAuth, (c) => {
  dnsServer.clearCache();
  return c.json({ success: true });
});

// Query log archiving
app.post('/api/queries/archive', requireAuth, async (c) => {
  const { daysToKeep, compress } = await c.req.json();
  const days = typeof daysToKeep === 'number' ? daysToKeep : 7;
  const shouldCompress = typeof compress === 'boolean' ? compress : true;
  const archived = dbQueries.archiveOldQueries(days, shouldCompress);
  return c.json({ success: true, archived });
});

// Block page settings
app.get('/api/block-page/settings', requireAuth, (c) => {
  const settings = dbBlockPageSettings.get();
  return c.json(settings);
});

app.put('/api/block-page/settings', requireAuth, async (c) => {
  const { title, message, backgroundColor, textColor, logoUrl } = await c.req.json();
  dbBlockPageSettings.update({
    title,
    message,
    backgroundColor,
    textColor,
    logoUrl,
  });
  return c.json({ success: true });
});

// Query log streaming (Server-Sent Events)
app.get('/api/queries/stream', requireAuth, async (c) => {
  const clientIp = c.req.query('clientIp');
  const type = c.req.query('type');
  const blocked = c.req.query('blocked');
  const domain = c.req.query('domain');

  const filters = {
    type: type || undefined,
    blocked: blocked !== undefined ? blocked === 'true' : undefined,
    domain: domain || undefined,
  };

  let pollInterval: NodeJS.Timeout | null = null;

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      let lastQueryId: string | null = null;

      const sendEvent = (data: unknown) => {
        const message = `data: ${JSON.stringify(data)}\n\n`;
        controller.enqueue(encoder.encode(message));
      };

      // Send initial connection message
      sendEvent({ type: 'connected' });

      // Poll for new queries
      pollInterval = setInterval(async () => {
        try {
          const queries = dnsServer.getQueries(100, clientIp, filters);
          if (queries.length > 0) {
            const newQueries = lastQueryId
              ? queries.filter((q) => {
                  const queryIndex = queries.findIndex((q2) => q2.id === lastQueryId);
                  return queryIndex === -1 || queries.indexOf(q) < queryIndex;
                })
              : queries.slice(0, 10); // First time, send last 10

            if (newQueries.length > 0) {
              sendEvent({ type: 'queries', queries: newQueries });
              lastQueryId = queries[0].id;
            }
          }
        } catch (error) {
          sendEvent({ type: 'error', error: error instanceof Error ? error.message : 'Unknown error' });
        }
      }, 2000); // Poll every 2 seconds
    },
    cancel() {
      if (pollInterval) {
        clearInterval(pollInterval);
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
});

// Serve block page HTML
app.get('/block-page', (c) => {
  const settings = dbBlockPageSettings.get();
  const domain = c.req.query('domain') || 'this domain';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${settings.title || 'Blocked'}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      background-color: ${settings.backgroundColor || '#ffffff'};
      color: ${settings.textColor || '#000000'};
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 20px;
    }
    .container {
      text-align: center;
      max-width: 600px;
    }
    ${settings.logoUrl ? `img { max-width: 200px; margin-bottom: 20px; }` : ''}
    h1 { font-size: 2.5rem; margin-bottom: 1rem; }
    p { font-size: 1.2rem; line-height: 1.6; margin-bottom: 1rem; }
    .domain { font-family: monospace; font-weight: bold; color: ${settings.textColor || '#000000'}; }
  </style>
</head>
<body>
  <div class="container">
    ${settings.logoUrl ? `<img src="${settings.logoUrl}" alt="Logo">` : ''}
    <h1>${settings.title || 'Blocked'}</h1>
    <p>${(settings.message || 'This domain has been blocked by your DNS server.').replace('{{domain}}', domain)}</p>
    <p class="domain">${domain}</p>
  </div>
</body>
</html>`;

  return c.html(html);
});

// Scheduled tasks
app.get('/api/scheduled-tasks', requireAuth, (c) => {
  const tasks = dbScheduledTasks.getAll();
  return c.json(
    tasks.map((task) => ({
      ...task,
      enabled: task.enabled === 1,
    })),
  );
});

app.post('/api/scheduled-tasks', requireAuth, async (c) => {
  const { taskType, schedule } = await c.req.json();
  if (!taskType || !schedule) {
    return c.json({ error: 'taskType and schedule are required' }, 400);
  }
  if (taskType !== 'blocklist-update') {
    return c.json({ error: 'Invalid taskType' }, 400);
  }
  dbScheduledTasks.create(taskType, schedule);
  return c.json({ success: true });
});

app.put('/api/scheduled-tasks/:id', requireAuth, async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  const { schedule, enabled } = await c.req.json();

  if (schedule !== undefined) {
    dbScheduledTasks.update(id, schedule);
  }

  if (typeof enabled === 'boolean') {
    dbScheduledTasks.setEnabled(id, enabled);
  }

  return c.json({ success: true });
});

app.delete('/api/scheduled-tasks/:id', requireAuth, (c) => {
  const id = parseInt(c.req.param('id'), 10);
  dbScheduledTasks.remove(id);
  return c.json({ success: true });
});

// Long-term data
app.get('/api/long-term', requireAuth, (c) => {
  const days = Number(c.req.query('days')) || 30;
  const stats = dbQueries.getDailyStats(days);
  return c.json(stats);
});

// Client Groups
app.get('/api/groups', requireAuth, (c) => {
  const groups = dbClientGroups.getAll();
  return c.json(groups);
});

app.post('/api/groups', requireAuth, async (c) => {
  const { name, description } = await c.req.json();
  if (!name) {
    return c.json({ error: 'name is required' }, 400);
  }
  const id = dbClientGroups.create(name, description);
  return c.json({ success: true, id });
});

app.put('/api/groups/:id', requireAuth, async (c) => {
  const id = Number(c.req.param('id'));
  const { name, description } = await c.req.json();
  dbClientGroups.update(id, name, description);
  return c.json({ success: true });
});

app.delete('/api/groups/:id', requireAuth, (c) => {
  const id = Number(c.req.param('id'));
  dbClientGroups.delete(id);
  return c.json({ success: true });
});

app.post('/api/groups/:id/members', requireAuth, async (c) => {
  const id = Number(c.req.param('id'));
  const { clientIp } = await c.req.json();
  if (!clientIp) {
    return c.json({ error: 'clientIp is required' }, 400);
  }
  dbClientGroups.addMember(id, clientIp);
  return c.json({ success: true });
});

app.delete('/api/groups/:id/members/:clientIp', requireAuth, (c) => {
  const id = Number(c.req.param('id'));
  const clientIp = c.req.param('clientIp');
  dbClientGroups.removeMember(id, clientIp);
  return c.json({ success: true });
});

app.get('/api/groups/:id/members', requireAuth, (c) => {
  const id = Number(c.req.param('id'));
  const members = dbClientGroups.getMembers(id);
  return c.json(members);
});

// Per-client blocking rules
app.get('/api/clients/:clientIp/blocking', requireAuth, (c) => {
  const clientIp = c.req.param('clientIp');
  const enabled = dbClientBlockingRules.getBlockingEnabled(clientIp);
  const allowlist = dbClientAllowlist.getAll(clientIp);
  const blocklist = dbClientBlocklist.getAll(clientIp);
  return c.json({ enabled, allowlist, blocklist });
});

app.put('/api/clients/:clientIp/blocking', requireAuth, async (c) => {
  const clientIp = c.req.param('clientIp');
  const { enabled } = await c.req.json();
  if (typeof enabled !== 'boolean') {
    return c.json({ error: 'enabled must be a boolean' }, 400);
  }
  dbClientBlockingRules.setBlockingEnabled(clientIp, enabled);
  return c.json({ success: true });
});

app.post('/api/clients/:clientIp/allowlist', requireAuth, async (c) => {
  const clientIp = c.req.param('clientIp');
  const { domain } = await c.req.json();
  if (!domain) {
    return c.json({ error: 'domain is required' }, 400);
  }
  dbClientAllowlist.add(clientIp, domain);
  return c.json({ success: true });
});

app.delete('/api/clients/:clientIp/allowlist/:domain', requireAuth, (c) => {
  const clientIp = c.req.param('clientIp');
  const domain = c.req.param('domain');
  dbClientAllowlist.remove(clientIp, domain);
  return c.json({ success: true });
});

app.post('/api/clients/:clientIp/blocklist', requireAuth, async (c) => {
  const clientIp = c.req.param('clientIp');
  const { domain } = await c.req.json();
  if (!domain) {
    return c.json({ error: 'domain is required' }, 400);
  }
  dbClientBlocklist.add(clientIp, domain);
  return c.json({ success: true });
});

app.delete('/api/clients/:clientIp/blocklist/:domain', requireAuth, (c) => {
  const clientIp = c.req.param('clientIp');
  const domain = c.req.param('domain');
  dbClientBlocklist.remove(clientIp, domain);
  return c.json({ success: true });
});

// Client-specific upstream DNS
app.get('/api/clients/:clientIp/upstream-dns', requireAuth, (c) => {
  const clientIp = c.req.param('clientIp');
  const upstreamDNS = dbClientUpstreamDNS.get(clientIp);
  return c.json({ upstreamDNS });
});

app.put('/api/clients/:clientIp/upstream-dns', requireAuth, async (c) => {
  const clientIp = c.req.param('clientIp');
  const { upstreamDNS } = await c.req.json();
  if (!upstreamDNS || typeof upstreamDNS !== 'string') {
    return c.json({ error: 'upstreamDNS is required' }, 400);
  }
  dbClientUpstreamDNS.set(clientIp, upstreamDNS);
  return c.json({ success: true });
});

app.delete('/api/clients/:clientIp/upstream-dns', requireAuth, (c) => {
  const clientIp = c.req.param('clientIp');
  dbClientUpstreamDNS.remove(clientIp);
  return c.json({ success: true });
});

// Rate limiting
app.post('/api/clients/:clientIp/unblock-rate-limit', requireAuth, (c) => {
  const clientIp = c.req.param('clientIp');
  dnsServer.unblockRateLimitedClient(clientIp);
  return c.json({ success: true });
});

// Per-group blocking rules
app.get('/api/groups/:id/blocking', requireAuth, (c) => {
  const id = Number(c.req.param('id'));
  const enabled = dbGroupBlockingRules.getBlockingEnabled(id);
  const allowlist = dbGroupAllowlist.getAll(id);
  const blocklist = dbGroupBlocklist.getAll(id);
  return c.json({ enabled, allowlist, blocklist });
});

app.put('/api/groups/:id/blocking', requireAuth, async (c) => {
  const id = Number(c.req.param('id'));
  const { enabled } = await c.req.json();
  if (typeof enabled !== 'boolean') {
    return c.json({ error: 'enabled must be a boolean' }, 400);
  }
  dbGroupBlockingRules.setBlockingEnabled(id, enabled);
  return c.json({ success: true });
});

app.post('/api/groups/:id/allowlist', requireAuth, async (c) => {
  const id = Number(c.req.param('id'));
  const { domain } = await c.req.json();
  if (!domain) {
    return c.json({ error: 'domain is required' }, 400);
  }
  dbGroupAllowlist.add(id, domain);
  return c.json({ success: true });
});

app.delete('/api/groups/:id/allowlist/:domain', requireAuth, (c) => {
  const id = Number(c.req.param('id'));
  const domain = c.req.param('domain');
  dbGroupAllowlist.remove(id, domain);
  return c.json({ success: true });
});

app.post('/api/groups/:id/blocklist', requireAuth, async (c) => {
  const id = Number(c.req.param('id'));
  const { domain } = await c.req.json();
  if (!domain) {
    return c.json({ error: 'domain is required' }, 400);
  }
  dbGroupBlocklist.add(id, domain);
  return c.json({ success: true });
});

app.delete('/api/groups/:id/blocklist/:domain', requireAuth, (c) => {
  const id = Number(c.req.param('id'));
  const domain = c.req.param('domain');
  dbGroupBlocklist.remove(id, domain);
  return c.json({ success: true });
});

// Tools - DNS Lookup
app.get('/api/tools/lookup', async (c) => {
  const domain = c.req.query('domain');
  const type = c.req.query('type') || 'A';

  if (!domain) {
    return c.json({ error: 'domain is required' }, 400);
  }

  try {
    // Create DNS query
    const dnsQuery = createDNSQueryFromParams(domain, type, false);

    // Handle the query (use a test client IP)
    const response = await dnsServer.handleDNSQuery(dnsQuery, '127.0.0.1', false);

    // Parse response to JSON
    const jsonResponse = parseDNSResponseToJSON(response, domain, type) as {
      Status: number;
      Question?: Array<{ name: string; type: number }>;
      Answer?: Array<{ name: string; type: number; TTL: number; data: string }>;
      Authority?: Array<{ name: string; type: number; TTL: number; data: string }>;
      Additional?: Array<{ name: string; type: number; TTL: number; data: string }>;
    };

    // For backward compatibility, extract addresses/hostnames for A/AAAA/PTR
    const addresses: string[] = [];
    const hostnames: string[] = [];
    const answers = jsonResponse.Answer || [];

    if (type === 'A' || type === 'AAAA') {
      answers.forEach((answer) => {
        if (answer.type === 1 || answer.type === 28) {
          addresses.push(answer.data);
        }
      });
    } else if (type === 'PTR') {
      answers.forEach((answer) => {
        if (answer.type === 12) {
          hostnames.push(answer.data);
        }
      });
    }

    return c.json({
      domain,
      type,
      addresses: addresses.length > 0 ? addresses : undefined,
      hostnames: hostnames.length > 0 ? hostnames : undefined,
      answers: answers.length > 0 ? answers : undefined,
      authority: jsonResponse.Authority,
      additional: jsonResponse.Additional,
      status: jsonResponse.Status,
    });
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400);
  }
});

// Authoritative DNS Zones
app.get('/api/zones', requireAuth, (c) => {
  const zones = dbZones.getAll();
  return c.json(zones);
});

app.post('/api/zones', requireAuth, async (c) => {
  try {
    const { domain, soaMname, soaRname } = await c.req.json();

    if (!domain || !soaMname || !soaRname) {
      return c.json({ error: 'domain, soaMname, and soaRname are required' }, 400);
    }

    const zoneId = dbZones.create(domain, soaMname, soaRname);
    const zone = dbZones.getById(zoneId);
    return c.json(zone, 201);
  } catch (error) {
    logger.error('Error creating zone', {
      error: error instanceof Error ? error : new Error(String(error)),
    });
    return c.json({ error: (error as Error).message }, 400);
  }
});

app.get('/api/zones/:id', requireAuth, (c) => {
  const id = parseInt(c.req.param('id'), 10);
  const zone = dbZones.getById(id);
  if (!zone) {
    return c.json({ error: 'Zone not found' }, 404);
  }
  return c.json(zone);
});

app.put('/api/zones/:id', requireAuth, async (c) => {
  try {
    const id = parseInt(c.req.param('id'), 10);
    const updates = await c.req.json();
    dbZones.update(id, updates);
    const zone = dbZones.getById(id);
    if (!zone) {
      return c.json({ error: 'Zone not found' }, 404);
    }
    return c.json(zone);
  } catch (error) {
    logger.error('Error updating zone', {
      error: error instanceof Error ? error : new Error(String(error)),
    });
    return c.json({ error: (error as Error).message }, 400);
  }
});

app.delete('/api/zones/:id', requireAuth, (c) => {
  const id = parseInt(c.req.param('id'), 10);
  dbZones.delete(id);
  return c.json({ success: true });
});

app.get('/api/zones/:id/records', requireAuth, (c) => {
  const id = parseInt(c.req.param('id'), 10);
  const records = dbZoneRecords.getByZone(id);
  return c.json(records);
});

app.post('/api/zones/:id/records', requireAuth, async (c) => {
  try {
    const zoneId = parseInt(c.req.param('id'), 10);
    const { name, type, ttl, data, priority } = await c.req.json();

    if (!name || !type || !ttl || !data) {
      return c.json({ error: 'name, type, ttl, and data are required' }, 400);
    }

    const recordId = dbZoneRecords.create(zoneId, name, type, ttl, data, priority);
    dbZones.incrementSerial(zoneId);
    const record = dbZoneRecords.getById(recordId);
    return c.json(record, 201);
  } catch (error) {
    logger.error('Error creating zone record', {
      error: error instanceof Error ? error : new Error(String(error)),
    });
    return c.json({ error: (error as Error).message }, 400);
  }
});

app.put('/api/zones/records/:id', requireAuth, async (c) => {
  try {
    const id = parseInt(c.req.param('id'), 10);
    const updates = await c.req.json();
    const record = dbZoneRecords.getById(id);
    if (!record) {
      return c.json({ error: 'Record not found' }, 404);
    }
    dbZoneRecords.update(id, updates);
    dbZones.incrementSerial(record.zone_id);
    const updatedRecord = dbZoneRecords.getById(id);
    return c.json(updatedRecord);
  } catch (error) {
    logger.error('Error updating zone record', {
      error: error instanceof Error ? error : new Error(String(error)),
    });
    return c.json({ error: (error as Error).message }, 400);
  }
});

app.delete('/api/zones/records/:id', requireAuth, (c) => {
  const id = parseInt(c.req.param('id'), 10);
  const record = dbZoneRecords.getById(id);
  if (!record) {
    return c.json({ error: 'Record not found' }, 404);
  }
  dbZoneRecords.delete(id);
  dbZones.incrementSerial(record.zone_id);
  return c.json({ success: true });
});

// Teleporter (Import/Export)
app.get('/api/teleporter/export', requireAuth, (c) => {
  const exportData = {
    version: '1.0.0',
    exportedAt: new Date().toISOString(),
    settings: dbSettings.getAll(),
    adlists: dbAdlists.getAll(),
    allowlist: dbAllowlist.getAll(),
    manualBlocklist: dbManualBlocklist.getAll(),
    regexFilters: dbRegexFilters.getAll(),
    localDNS: dbLocalDNS.getAll(),
    conditionalForwarding: dbConditionalForwarding.getAll(),
    clientNames: dbClientNames.getAll(),
    clientGroups: dbClientGroups.getAll().map((group) => ({
      id: group.id,
      name: group.name,
      description: group.description,
      members: dbClientGroups.getMembers(group.id),
    })),
    groupBlockingRules: dbClientGroups.getAll().map((group) => ({
      groupId: group.id,
      enabled: dbGroupBlockingRules.getBlockingEnabled(group.id),
      allowlist: dbGroupAllowlist.getAll(group.id),
      blocklist: dbGroupBlocklist.getAll(group.id),
    })),
  };
  return c.json(exportData);
});

app.post('/api/teleporter/import', requireAuth, async (c) => {
  try {
    const importData = await c.req.json();

    if (!importData.version) {
      return c.json({ error: 'Invalid export file format' }, 400);
    }

    // Import settings
    if (importData.settings) {
      Object.entries(importData.settings).forEach(([key, value]) => {
        dbSettings.set(key, String(value));
      });
    }

    // Import adlists
    if (importData.adlists && Array.isArray(importData.adlists)) {
      // Clear existing and import new
      const existing = dbAdlists.getAll();
      existing.forEach((adlist) => {
        if (!importData.adlists.find((a: { url: string }) => a.url === adlist.url)) {
          dbAdlists.remove(adlist.url);
        }
      });
      importData.adlists.forEach((adlist: { url: string; enabled?: number }) => {
        try {
          dbAdlists.add(adlist.url);
          if (adlist.enabled !== undefined) {
            dbAdlists.setEnabled(adlist.url, adlist.enabled === 1);
          }
        } catch {
          // Already exists, skip
        }
      });
    }

    // Import allowlist
    if (importData.allowlist && Array.isArray(importData.allowlist)) {
      importData.allowlist.forEach((entry: { domain: string; comment?: string }) => {
        try {
          dbAllowlist.add(entry.domain, entry.comment);
        } catch {
          // Already exists, skip
        }
      });
    }

    // Import manual blocklist
    if (importData.manualBlocklist && Array.isArray(importData.manualBlocklist)) {
      importData.manualBlocklist.forEach((entry: { domain: string; comment?: string }) => {
        try {
          dbManualBlocklist.add(entry.domain, entry.comment);
        } catch {
          // Already exists, skip
        }
      });
    }

    // Import regex filters
    if (importData.regexFilters && Array.isArray(importData.regexFilters)) {
      importData.regexFilters.forEach((filter: { pattern: string; type: string; enabled?: number; comment?: string }) => {
        try {
          // Check if filter already exists
          const existing = dbRegexFilters.getAll().find((f) => f.pattern === filter.pattern);
          if (existing) {
            if (filter.enabled !== undefined) {
              dbRegexFilters.setEnabled(existing.id, filter.enabled === 1);
            }
          } else {
            dbRegexFilters.add(filter.pattern, filter.type as 'block' | 'allow', filter.comment);
            // Get the newly added filter to set enabled state
            const added = dbRegexFilters.getAll().find((f) => f.pattern === filter.pattern);
            if (added && filter.enabled !== undefined) {
              dbRegexFilters.setEnabled(added.id, filter.enabled === 1);
            }
          }
        } catch {
          // Already exists, skip
        }
      });
    }

    // Import local DNS
    if (importData.localDNS && Array.isArray(importData.localDNS)) {
      importData.localDNS.forEach((record: { domain: string; ip: string; type: string; enabled?: number }) => {
        try {
          dbLocalDNS.add(record.domain, record.ip, record.type);
          if (record.enabled !== undefined) {
            dbLocalDNS.setEnabled(record.domain, record.enabled === 1);
          }
        } catch {
          // Already exists, skip
        }
      });
    }

    // Import conditional forwarding
    if (importData.conditionalForwarding && Array.isArray(importData.conditionalForwarding)) {
      importData.conditionalForwarding.forEach(
        (rule: { domain: string; upstreamDNS: string; enabled?: number; comment?: string }) => {
          try {
            dbConditionalForwarding.add(rule.domain, rule.upstreamDNS, rule.comment);
            // Note: Can't set enabled on add, would need to get ID and update
          } catch {
            // Already exists, skip
          }
        },
      );
    }

    // Import client names
    if (importData.clientNames && Array.isArray(importData.clientNames)) {
      importData.clientNames.forEach((entry: { clientIp: string; name: string }) => {
        dbClientNames.setName(entry.clientIp, entry.name);
      });
    }

    // Import client groups
    if (importData.clientGroups && Array.isArray(importData.clientGroups)) {
      const groupIdMap = new Map<number, number>(); // old ID -> new ID
      importData.clientGroups.forEach((group: { id?: number; name: string; description?: string; members?: string[] }) => {
        try {
          const newGroupId = dbClientGroups.create(group.name, group.description);
          if (group.id !== undefined) {
            groupIdMap.set(group.id, newGroupId);
          }
          if (group.members && Array.isArray(group.members)) {
            group.members.forEach((clientIp: string) => {
              try {
                dbClientGroups.addMember(newGroupId, clientIp);
              } catch {
                // Already a member, skip
              }
            });
          }
        } catch {
          // Already exists, skip
        }
      });

      // Update group blocking rules with new IDs
      if (importData.groupBlockingRules && Array.isArray(importData.groupBlockingRules)) {
        importData.groupBlockingRules.forEach(
          (rule: {
            groupId: number;
            enabled: boolean;
            allowlist?: Array<{ domain: string }>;
            blocklist?: Array<{ domain: string }>;
          }) => {
            const newGroupId = groupIdMap.get(rule.groupId);
            if (newGroupId) {
              dbGroupBlockingRules.setBlockingEnabled(newGroupId, rule.enabled);
              if (rule.allowlist) {
                rule.allowlist.forEach((entry: { domain: string }) => {
                  try {
                    dbGroupAllowlist.add(newGroupId, entry.domain);
                  } catch {
                    // Already exists, skip
                  }
                });
              }
              if (rule.blocklist) {
                rule.blocklist.forEach((entry: { domain: string }) => {
                  try {
                    dbGroupBlocklist.add(newGroupId, entry.domain);
                  } catch {
                    // Already exists, skip
                  }
                });
              }
            }
          },
        );
      }
    } else if (importData.groupBlockingRules && Array.isArray(importData.groupBlockingRules)) {
      // Import group blocking rules without groups (groups already exist)
      importData.groupBlockingRules.forEach(
        (rule: {
          groupId: number;
          enabled: boolean;
          allowlist?: Array<{ domain: string }>;
          blocklist?: Array<{ domain: string }>;
        }) => {
          const group = dbClientGroups.getById(rule.groupId);
          if (group) {
            dbGroupBlockingRules.setBlockingEnabled(rule.groupId, rule.enabled);
            if (rule.allowlist) {
              rule.allowlist.forEach((entry: { domain: string }) => {
                try {
                  dbGroupAllowlist.add(rule.groupId, entry.domain);
                } catch {
                  // Already exists, skip
                }
              });
            }
            if (rule.blocklist) {
              rule.blocklist.forEach((entry: { domain: string }) => {
                try {
                  dbGroupBlocklist.add(rule.groupId, entry.domain);
                } catch {
                  // Already exists, skip
                }
              });
            }
          }
        },
      );
    }

    // Reload blocklists in DNS server
    const savedAdlists = dbAdlists.getAll().filter((a) => a.enabled === 1);
    const blocklists =
      savedAdlists.length > 0
        ? savedAdlists.map((a) => a.url)
        : [
            'https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts',
            'https://raw.githubusercontent.com/anudeepND/blacklist/master/adservers.txt',
          ];
    dnsServer.loadBlocklist(blocklists);

    return c.json({ success: true, message: 'Import completed successfully' });
  } catch (error) {
    logger.error('Import error', {
      error: error instanceof Error ? error : new Error(String(error)),
    });
    return c.json({ error: 'Import failed', details: error instanceof Error ? error.message : 'Unknown error' }, 500);
  }
});

// Health check endpoints
app.get('/health', (c) => {
  const health = dnsServer.getHealth();
  const statusCode = health.status === 'healthy' ? 200 : health.status === 'degraded' ? 200 : 503;
  return c.json(health, statusCode);
});

app.get('/api/health', (c) => {
  const health = dnsServer.getHealth();
  // Always return 200 for /api/health - let the status field indicate health
  // This allows the UI to always get health data even if status is degraded/unhealthy
  return c.json(health, 200);
});

async function runScheduledTasks() {
  const dueTasks = dbScheduledTasks.getDueTasks();

  for (const task of dueTasks) {
    if (task.taskType === 'blocklist-update') {
      try {
        logger.info('Running scheduled blocklist update...');
        const updateId = dbBlocklistUpdates.startUpdate();
        const adlists = dbAdlists.getAll().filter((a) => a.enabled === 1);
        const urls = adlists.map((a) => a.url);

        dnsServer
          .reloadBlocklist()
          .then(() => {
            const blocklistSize = dnsServer.getBlocklistSize();
            dbBlocklistUpdates.completeUpdate(updateId, blocklistSize);
            logger.info('Scheduled blocklist update completed', { blocklistSize });
          })
          .catch((error) => {
            logger.error('Scheduled blocklist update failed', {
              error: error instanceof Error ? error : new Error(String(error)),
            });
            dbBlocklistUpdates.failUpdate(updateId, error instanceof Error ? error.message : 'Unknown error');
          });
      } catch (error) {
        logger.error('Error running scheduled blocklist update', {
          error: error instanceof Error ? error : new Error(String(error)),
        });
      }
    }

    dbScheduledTasks.markRun(task.id);
  }
}

async function main() {
  logger.info('Initializing DNS server...');

  // Cleanup old queries based on retention setting
  const retentionDays = parseInt(dbSettings.get('queryRetentionDays', '7'), 10);
  dbQueries.cleanupOldQueries(retentionDays);

  // Load blocklists from database only (no defaults)
  const savedAdlists = dbAdlists.getAll().filter((a) => a.enabled === 1);
  const blocklists = savedAdlists.map((a) => a.url);

  await dnsServer.loadBlocklist(blocklists);

  // Start DNS server
  await dnsServer.start();

  // Start scheduled tasks runner
  setInterval(() => {
    runScheduledTasks().catch((error) => {
      logger.error('Error running scheduled tasks', {
        error: error instanceof Error ? error : new Error(String(error)),
      });
    });
  }, 60000); // Check every minute

  // Run immediately on startup
  runScheduledTasks().catch((error) => {
    logger.error('Error running scheduled tasks', {
      error: error instanceof Error ? error : new Error(String(error)),
    });
  });

  // Start HTTP API server
  const port = 3001;
  logger.info('API server running', { port, url: `http://localhost:${port}` });

  serve({
    fetch: app.fetch,
    port,
  });
}

main().catch((error) => {
  logger.error('Fatal error in main', {
    error: error instanceof Error ? error : new Error(String(error)),
  });
  process.exit(1);
});
