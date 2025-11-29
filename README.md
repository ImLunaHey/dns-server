# DNS Server with Ad-Blocking

A custom DNS server built with TypeScript that blocks ads using popular blocklists, similar to Pi-hole but with a modern React dashboard.

## Features

- 🚫 **Ad Blocking**: Uses popular blocklists (Steven Black's hosts, anudeep's blacklist)
- 🔄 **DNS Forwarding**: Forwards legitimate queries to Cloudflare DNS (1.1.1.1)
- 📊 **Real-time Dashboard**: Beautiful React + Tailwind UI
- 📈 **Statistics**: Track total queries, blocked domains, and top domains
- ⚡ **Fast**: Built with TypeScript and optimized for performance
- 🎯 **Custom Rules**: Add or remove domains from blocklist via UI

## Architecture

### Backend (Port 53 & 3001)
- DNS Server (UDP port 53) - Handles DNS queries
- HTTP API (port 3001) - Provides REST API for dashboard

### Frontend (Port 3000)
- React + TypeScript + Tailwind CSS
- Real-time updates every 2 seconds
- Responsive design

## Prerequisites

- Node.js 18+ or Bun
- Sudo/admin access (required for binding to port 53)

## Installation

### 1. Install Server Dependencies

```bash
cd server
npm install
# or
bun install
```

### 2. Install Client Dependencies

```bash
cd client
npm install
# or
bun install
```

## Usage

### Running the Server (requires sudo)

The DNS server needs to bind to port 53, which requires elevated privileges:

```bash
cd server
sudo npm run dev
# or
sudo bun run dev
```

### Running the Client

In a separate terminal:

```bash
cd client
npm run dev
# or
bun run dev
```

The dashboard will be available at `http://localhost:3000`

## Configuration

### Change Upstream DNS

Edit `server/src/dns-server.ts`:

```typescript
private upstreamDNS = '1.1.1.1'; // Change to your preferred DNS
```

Popular options:
- Cloudflare: `1.1.1.1`
- Google: `8.8.8.8`
- Quad9: `9.9.9.9`

### Add Custom Blocklists

Edit `server/src/index.ts`:

```typescript
const blocklists = [
  'https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts',
  'https://raw.githubusercontent.com/anudeepND/blacklist/master/adservers.txt',
  // Add more blocklist URLs here
];
```

## Using the DNS Server

### On Your Computer

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

### On Your Network

Point your router's DNS settings to the IP address of the machine running this DNS server.

## API Endpoints

- `GET /api/stats` - Get DNS server statistics
- `GET /api/queries?limit=100` - Get recent DNS queries
- `POST /api/blocklist/add` - Add domain to blocklist
- `POST /api/blocklist/remove` - Remove domain from blocklist

## Dashboard Features

### Statistics Cards
- Total queries processed
- Number of blocked requests
- Number of allowed requests
- Blocklist size

### Top Domains Charts
- Most frequently queried domains
- Most frequently blocked domains

### Query Log
- Real-time log of DNS queries
- Shows domain, type, status, and response time
- Quick block/allow buttons for each domain

## Development

### Server Development

```bash
cd server
npm run dev  # Auto-reloads on changes
```

### Client Development

```bash
cd client
npm run dev  # Hot module replacement
```

### Building for Production

**Server:**
```bash
cd server
npm run build
sudo node dist/index.js
```

**Client:**
```bash
cd client
npm run build
npm run preview
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
3. Firewall allows UDP traffic on port 53

### Dashboard Not Loading Data

1. Verify the API server is running on port 3001
2. Check browser console for CORS errors
3. Ensure both servers are running

## Performance

- Handles thousands of queries per second
- Low memory footprint (~50MB)
- Efficient blocklist lookup using Set data structure
- Keeps last 1000 queries in memory

## License

MIT

## Credits

Built with:
- [Node.js](https://nodejs.org/)
- [React](https://react.dev/)
- [Hono](https://hono.dev/)
- [Tailwind CSS](https://tailwindcss.com/)
- [Steven Black's Hosts](https://github.com/StevenBlack/hosts)
