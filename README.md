# DNS Server with Ad-Blocking

A custom DNS server built with TypeScript that blocks ads using popular blocklists, similar to Pi-hole but with a modern React dashboard.

## Features

- 🚫 **Ad Blocking**: Uses popular blocklists (Steven Black's hosts, anudeep's blacklist)
- 🔄 **DNS Forwarding**: Forwards legitimate queries to Cloudflare DNS (1.1.1.1)
- 📊 **Real-time Dashboard**: Beautiful React + Tailwind UI
- 📈 **Statistics**: Track total queries, blocked domains, and top domains
- ⚡ **Fast**: Built with TypeScript and optimized for performance
- 🎯 **Custom Rules**: Add or remove domains from blocklist via UI
- 🔒 **DNS-over-HTTPS (DoH)**: RFC 8484 compliant, supports both binary and JSON formats (Cloudflare-compatible)
- 🔐 **DNS-over-TLS (DoT)**: Encrypted DNS queries over TLS on port 853
- 🚀 **DNS-over-QUIC (DoQ)**: Encrypted DNS over QUIC protocol (RFC 9250) - requires Node.js 25+
- 🌐 **TCP DNS**: Full TCP support for DNS queries (RFC 1035)
- 🛡️ **Rate Limiting**: Protect against DNS amplification attacks
- 💾 **DNS Caching**: In-memory caching with TTL-based expiration (respects DNS response TTL)
- 📊 **Health Monitoring**: Real-time server health status, uptime, and performance metrics
- 🔐 **Privacy Mode**: Optional query logging for privacy
- 🚧 **Block Page**: Redirect blocked domains to custom IP addresses

## Architecture

### Backend (Ports 53, 853, 3001)

- **DNS Server (UDP port 53)** - Standard DNS queries
- **DNS Server (TCP port 53)** - TCP DNS queries for large responses
- **DNS-over-TLS (DoT) (port 853)** - Encrypted DNS over TLS
- **DNS-over-QUIC (DoQ) (port 853)** - Encrypted DNS over QUIC (requires Node.js 25+)
- **DNS-over-HTTPS (DoH) (port 3001)** - Encrypted DNS over HTTPS at `/dns-query`
- **HTTP API (port 3001)** - REST API for dashboard

### Frontend (Port 3000)

- React + TypeScript + Tailwind CSS
- Real-time updates every 2 seconds
- Responsive design

## Prerequisites

- Node.js 18+ (Node.js 25+ required for DoQ support)
- pnpm 9+ (package manager)
- Sudo/admin access (required for binding to port 53)

## Installation

This is a monorepo managed with Turborepo and pnpm workspaces. Install all dependencies from the root:

```bash
# Install all dependencies for client and server
pnpm install
```

## Usage

### Running Both Client and Server

Run both the client and server in development mode:

```bash
# From the root directory
pnpm run dev
```

This will start both:
- **Server** on ports 53 (UDP/TCP), 853 (DoT/DoQ), and 3001 (DoH/API)
- **Client** on port 3000 (dashboard)

### Running Individual Packages

You can also run packages individually:

**Server (requires sudo for port 53):**

```bash
# From root
sudo pnpm --filter @dns-server/server dev

# Or from server directory
cd apps/server
sudo pnpm run dev
```

**Client:**

```bash
# From root
pnpm --filter @dns-server/client dev

# Or from client directory
cd apps/client
pnpm run dev
```

The dashboard will be available at `http://localhost:3000`

## Configuration

### Change Upstream DNS

Configure via the Settings page in the web UI, or edit the database directly:

Popular options:

- Cloudflare: `1.1.1.1`
- Google: `8.8.8.8`
- Quad9: `9.9.9.9`

### Enable DNS-over-TLS (DoT)

1. Generate TLS certificates:

```bash
node generate-dot-certs.js localhost
```

2. Configure in Settings page:

   - Enable DoT: `true`
   - Certificate Path: `apps/server/certs/dot.crt`
   - Private Key Path: `apps/server/certs/dot.key`
   - Port: `853` (default)

3. Test DoT:

```bash
node test-dot.js example.com A
```

### Using DNS-over-HTTPS (DoH)

The DoH endpoint is available at `http://localhost:3001/dns-query` and supports:

- **RFC 8484 Binary Format**: `POST /dns-query` with `Content-Type: application/dns-message`
- **Cloudflare JSON Format**: `GET /dns-query?name=example.com&type=A` with `Accept: application/dns-json`

Example:

```bash
# Binary format
curl -X POST http://localhost:3001/dns-query \
  -H "Content-Type: application/dns-message" \
  --data-binary @dns-query.bin

# JSON format (Cloudflare-compatible)
curl "http://localhost:3001/dns-query?name=example.com&type=A" \
  -H "Accept: application/dns-json"
```

### Add Custom Blocklists

Configure via the Adlists page in the web UI, or add blocklist URLs directly.

### DNS Caching

The DNS server uses intelligent caching that respects TTL (Time To Live) values from DNS responses:

- **TTL-Based Caching**: Automatically extracts and uses TTL values from DNS responses
- **Fallback TTL**: Uses 300 seconds (5 minutes) if TTL extraction fails
- **Cache Management**: Clear cache manually via Settings page or API endpoint
- **Cache Statistics**: View cache size and cached query counts in the dashboard

To clear the cache:

1. Navigate to Settings → DNS Cache Settings
2. Click "Clear Cache" button
3. Cache will be cleared and statistics updated automatically

## Using the DNS Server

### Standard DNS (UDP/TCP)

**macOS/Linux:**

```bash
# Temporarily change DNS
sudo networksetup -setdnsservers Wi-Fi 127.0.0.1

# Restore original DNS
sudo networksetup -setdnsservers Wi-Fi empty
```

**Windows:**

```
1. Open Network Connections
2. Right-click your connection → Properties
3. Select "Internet Protocol Version 4 (TCP/IPv4)"
4. Click Properties
5. Select "Use the following DNS server addresses"
6. Enter: 127.0.0.1
```

### DNS-over-TLS (DoT)

**macOS (using kdig):**

```bash
# Install knot
brew install knot

# Query using DoT
kdig -d @localhost +tls +tls-hostname=localhost example.com A
```

**Linux (using kdig):**

```bash
# Install knot-dnsutils
sudo apt-get install knot-dnsutils

# Query using DoT
kdig -d @localhost +tls +tls-hostname=localhost example.com A
```

**Using the test script:**

```bash
node test-dot.js example.com A
```

### DNS-over-QUIC (DoQ)

**Note:** DoQ requires Node.js 25+. The QUIC implementation is available in Node.js 25.

**Using a DoQ client:**

DoQ clients can be used to test DoQ queries. The server implementation follows RFC 9250 (DNS-over-QUIC).

**Configuration:**

1. Navigate to Settings → DNS-over-QUIC (DoQ) Settings
2. Enable DoQ
3. Configure port (default: 853, same as DoT)
4. Set certificate paths (or leave empty to reuse DoT certificates)

**Using the test script:**

```bash
node test-doq.js example.com A
```

Note: Full DoQ testing requires Node.js 25+ and a QUIC client library.

### DNS-over-HTTPS (DoH)

**Using curl:**

```bash
# JSON format (Cloudflare-compatible)
curl "http://localhost:3001/dns-query?name=example.com&type=A" \
  -H "Accept: application/dns-json"

# Binary format
curl -X POST http://localhost:3001/dns-query \
  -H "Content-Type: application/dns-message" \
  --data-binary @dns-query.bin
```

**Using the test script:**

```bash
node test-doh.js example.com A
```

### On Your Network

Point your router's DNS settings to the IP address of the machine running this DNS server. For encrypted DNS, configure DoT (port 853) or DoH (port 3001) in your client applications.

## API Endpoints

### DNS Endpoints

- `POST /dns-query` - DNS-over-HTTPS (RFC 8484 binary format)
- `GET /dns-query?name=...&type=...` - DNS-over-HTTPS (Cloudflare JSON format)

### Management API

- `GET /api/stats` - Get DNS server statistics
- `GET /api/queries?limit=100` - Get recent DNS queries
- `GET /api/health` - Get server health status and metrics
- `POST /api/blocklist/add` - Add domain to blocklist
- `POST /api/blocklist/remove` - Remove domain from blocklist
- `GET /api/settings` - Get server settings
- `PUT /api/settings` - Update server settings (DoT, DoH, caching, etc.)
- `POST /api/cache/clear` - Clear DNS cache

## Dashboard Features

### Statistics Cards

- Total queries processed
- Number of blocked requests
- Number of allowed requests
- Number of cached queries (with percentage)
- Blocklist size

### Top Domains Charts

- Most frequently queried domains
- Most frequently blocked domains

### Query Log

- Real-time log of DNS queries
- Shows domain, type, status, cached status, and response time
- Quick block/allow buttons for each domain

### Health Monitoring

- Dedicated health page with server status
- Real-time uptime tracking
- Query rate and error rate monitoring
- Individual server status (UDP, TCP, DoT, DoH)

## Development

This monorepo uses [Turborepo](https://turbo.build/) for fast, cached builds and task orchestration.

### Available Scripts

From the root directory:

- `pnpm run dev` - Start both client and server in development mode
- `pnpm run build` - Build all packages
- `pnpm run typecheck` - Type check all packages
- `pnpm run test` - Run tests in watch mode for all packages
- `pnpm run test:run` - Run tests once for all packages
- `pnpm run test:coverage` - Run tests with coverage for all packages
- `pnpm run clean` - Clean all build artifacts and node_modules

### Running Individual Packages

**Server Development:**

```bash
# From root
sudo pnpm --filter @dns-server/server dev

# Or from server directory
cd apps/server
sudo pnpm run dev
```

**Client Development:**

```bash
# From root
pnpm --filter @dns-server/client dev

# Or from client directory
cd apps/client
pnpm run dev
```

### Building for Production

**Build all packages:**

```bash
pnpm run build
```

**Build individual packages:**

```bash
# Server
pnpm --filter @dns-server/server build
sudo pnpm --filter @dns-server/server start

# Client
pnpm --filter @dns-server/client build
pnpm --filter @dns-server/client preview
```

## Troubleshooting

### Port 53 Already in Use

If you get "address already in use" error:

**macOS/Linux:**

```bash
# Find process using port 53
sudo lsof -i :53

# Stop systemd-resolved (Ubuntu)
sudo systemctl stop systemd-resolved
```

### Cannot Resolve Domains

Make sure:

1. The DNS server is running with sudo privileges
2. Your upstream DNS (1.1.1.1) is reachable
3. Firewall allows UDP/TCP traffic on port 53

### DoT Connection Issues

If DoT connections fail:

1. Verify DoT is enabled in Settings
2. Check that certificate files exist at the configured paths
3. Ensure port 853 is not blocked by firewall
4. For self-signed certs, clients must use `rejectUnauthorized: false` or trust the certificate

### DoH Not Working

If DoH queries fail:

1. Verify the API server is running on port 3001
2. Check that the `/dns-query` endpoint is accessible
3. Ensure correct `Content-Type` or `Accept` headers are set

### Dashboard Not Loading Data

1. Verify the API server is running on port 3001
2. Check browser console for CORS errors
3. Ensure both servers are running

## Performance

- Handles thousands of queries per second
- Low memory footprint (~50MB)
- Efficient blocklist lookup using Set data structure
- TTL-based caching reduces upstream DNS queries
- Tracks cached vs non-cached queries for performance analysis
- Real-time health monitoring and metrics

## License

MIT

## Credits

Built with:

- [Node.js](https://nodejs.org/)
- [React](https://react.dev/)
- [Hono](https://hono.dev/)
- [Tailwind CSS](https://tailwindcss.com/)
- [Steven Black's Hosts](https://github.com/StevenBlack/hosts)
