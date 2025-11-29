import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { DNSServer } from './dns-server.js';
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
} from './db.js';
import db from './db.js';
import { auth } from './auth.js';
import { requireAuth } from './middleware.js';
import dns from 'dns';
import { promisify } from 'util';

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

// Public API Routes (no auth required)
app.get('/api/stats', (c) => {
  return c.json(dnsServer.getStats());
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
  const includeCount = c.req.query('includeCount') === 'true';

  const filters = {
    type: type || undefined,
    blocked: blocked !== undefined ? blocked === 'true' : undefined,
    startTime: startTime ? parseInt(startTime, 10) : undefined,
    endTime: endTime ? parseInt(endTime, 10) : undefined,
    domain: domain || undefined,
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
  const settings = dbSettings.getAll();
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
    cacheTTL: cacheStats.ttl,
    cacheSize: cacheStats.size,
    blockPageEnabled: blockPageStatus.enabled,
    blockPageIP: blockPageStatus.ipv4,
    blockPageIPv6: blockPageStatus.ipv6,
    ...settings,
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
    cacheTTL,
    blockPageEnabled,
    blockPageIP,
    blockPageIPv6,
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

  if (cacheTTL && typeof cacheTTL === 'number' && cacheTTL > 0) {
    dnsServer.setCacheTTL(cacheTTL);
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
const resolve4 = promisify(dns.resolve4);
const resolve6 = promisify(dns.resolve6);
const reverse = promisify(dns.reverse);

app.get('/api/tools/lookup', async (c) => {
  const domain = c.req.query('domain');
  const type = c.req.query('type') || 'A';

  if (!domain) {
    return c.json({ error: 'domain is required' }, 400);
  }

  try {
    if (type === 'A') {
      const addresses = await resolve4(domain);
      return c.json({ domain, type, addresses });
    } else if (type === 'AAAA') {
      const addresses = await resolve6(domain);
      return c.json({ domain, type, addresses });
    } else if (type === 'PTR') {
      const hostnames = await reverse(domain);
      return c.json({ domain, type, hostnames });
    } else {
      return c.json({ error: 'Unsupported type. Use A, AAAA, or PTR' }, 400);
    }
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400);
  }
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
    console.error('Import error:', error);
    return c.json({ error: 'Import failed', details: error instanceof Error ? error.message : 'Unknown error' }, 500);
  }
});

// Health check
app.get('/health', (c) => {
  return c.json({ status: 'ok' });
});

async function runScheduledTasks() {
  const dueTasks = dbScheduledTasks.getDueTasks();

  for (const task of dueTasks) {
    if (task.taskType === 'blocklist-update') {
      try {
        console.log('🔄 Running scheduled blocklist update...');
        const updateId = dbBlocklistUpdates.startUpdate();
        const adlists = dbAdlists.getAll().filter((a) => a.enabled === 1);
        const urls = adlists.map((a) => a.url);

        dnsServer
          .reloadBlocklist()
          .then(() => {
            const blocklistSize = dnsServer.getBlocklistSize();
            dbBlocklistUpdates.completeUpdate(updateId, blocklistSize);
            console.log('✅ Scheduled blocklist update completed');
          })
          .catch((error) => {
            console.error('❌ Scheduled blocklist update failed:', error);
            dbBlocklistUpdates.failUpdate(updateId, error instanceof Error ? error.message : 'Unknown error');
          });
      } catch (error) {
        console.error('Error running scheduled blocklist update:', error);
      }
    }

    dbScheduledTasks.markRun(task.id);
  }
}

async function main() {
  console.log('🔧 Initializing DNS server...');

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
    runScheduledTasks().catch(console.error);
  }, 60000); // Check every minute

  // Run immediately on startup
  runScheduledTasks().catch(console.error);

  // Start HTTP API server
  const port = 3001;
  console.log(`🌐 API server running on http://localhost:${port}`);

  serve({
    fetch: app.fetch,
    port,
  });
}

main().catch(console.error);
