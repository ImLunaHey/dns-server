# Testing DNS-over-TLS (DoT)

## Step 1: Generate Certificates ✅

```bash
node generate-dot-certs.js localhost
```

Certificates are now in `server/certs/`:
- `dot.crt` - Certificate  
- `dot.key` - Private key

## Step 2: Enable DoT

**Note:** The database is owned by root (since server runs with sudo), so we must use the API.

### Option A: Via Web UI (Settings page)
1. Go to Settings page in the web UI
2. Add DoT settings:
   - `dotEnabled`: true
   - `dotCertPath`: `server/certs/dot.crt` (or full path)
   - `dotKeyPath`: `server/certs/dot.key` (or full path)
3. Save settings

### Option B: Via API (with session cookie)
```bash
# Get your session cookie from browser DevTools after logging in
# Then update settings:
curl -X PUT http://localhost:3001/api/settings \
  -H "Content-Type: application/json" \
  -H "Cookie: your-session-cookie" \
  -d '{
    "dotEnabled": true,
    "dotCertPath": "server/certs/dot.crt",
    "dotKeyPath": "server/certs/dot.key"
  }'
```

### Option C: Via API (with API key)
```bash
# Create an API key in the web UI first, then:
export API_KEY="your-api-key"
curl -X PUT http://localhost:3001/api/settings \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{
    "dotEnabled": true,
    "dotCertPath": "server/certs/dot.crt",
    "dotKeyPath": "server/certs/dot.key"
  }'
```

### Option D: Using the helper script
```bash
# If you have an API key:
export API_KEY="your-api-key"
node enable-dot.js

# Or if logged in via browser, the script will use your session cookie
node enable-dot.js
```

## Step 3: Restart the Server

Restart the DNS server. You should see:
```
🔒 DNS server (DoT) running on port 853
```

## Step 4: Test DoT

### Using the test script:
```bash
node test-dot.js example.com A
```

### Using kdig (if installed):
```bash
# Install: brew install knot (macOS) or apt-get install knot-dnsutils (Linux)
kdig -d @localhost +tls +tls-hostname=localhost example.com A
```

### Using getdns_query (if installed):
```bash
# Install: brew install getdns (macOS)
getdns_query -s @127.0.0.1#853 -A example.com
```

## Troubleshooting

- **Connection refused**: Make sure DoT is enabled and server restarted
- **Certificate errors**: Self-signed certs will show warnings (expected for testing)
- **Port 853**: Make sure port 853 is not blocked by firewall
- **Server not starting DoT**: Check that certificates exist at the specified paths
