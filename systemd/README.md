# Systemd Service Installation

This directory contains systemd service files for running the DNS server and client in production.

**Note:** For development setup, use `../setup.sh` instead. This installer is for production deployment only.

## Installation

### Quick Install (Recommended)

Use the automated install script:

```bash
sudo ./systemd/install.sh
```

This script will:

- Detect and use nvm if available
- Install pnpm globally if needed
- Build both server and client
- Install both service files
- Configure paths automatically

### Manual Installation

#### 1. Build the Project

First, build both server and client:

```bash
cd /opt/dns-server
# Setup nvm if needed
source ~/.nvm/nvm.sh
nvm use  # or specify version

# Install pnpm globally if not already installed
npm install -g pnpm

# Build everything
pnpm install
pnpm run build
```

#### 2. Install the Services

Copy the service files to systemd:

```bash
sudo cp systemd/dns-server.service /etc/systemd/system/
sudo cp systemd/dns-client.service /etc/systemd/system/
```

### 3. Update Service File Paths

The install script automatically updates paths, but if installing manually, edit the service files:

```bash
sudo nano /etc/systemd/system/dns-server.service
sudo nano /etc/systemd/system/dns-client.service
```

Update these paths if your installation is in a different location:

- Server: `WorkingDirectory=/opt/dns-server/apps/server`
- Server: `ExecStart=/path/to/node /opt/dns-server/apps/server/dist/index.js`
- Client: `WorkingDirectory=/opt/dns-server`
- Client: `ExecStart=/path/to/npx vite preview ...`

### 4. Reload systemd and Start Services

```bash
# Reload systemd to recognize the new services
sudo systemctl daemon-reload

# Enable services to start on boot
sudo systemctl enable dns-server.service
sudo systemctl enable dns-client.service

# Start the services
sudo systemctl start dns-server.service
sudo systemctl start dns-client.service
```

### 5. Check Status

```bash
# Check if services are running
sudo systemctl status dns-server.service
sudo systemctl status dns-client.service

# View logs
sudo journalctl -u dns-server.service -f
sudo journalctl -u dns-client.service -f

# View recent logs
sudo journalctl -u dns-server.service -n 100
sudo journalctl -u dns-client.service -n 100
```

## Service Management

```bash
# Start services
sudo systemctl start dns-server.service
sudo systemctl start dns-client.service

# Stop services
sudo systemctl stop dns-server.service
sudo systemctl stop dns-client.service

# Restart services
sudo systemctl restart dns-server.service
sudo systemctl restart dns-client.service

# Restart all at once
sudo systemctl restart dns-server.service dns-client.service

# Reload configuration (if you changed the service files)
sudo systemctl daemon-reload
sudo systemctl restart dns-server.service dns-client.service

# Disable auto-start on boot
sudo systemctl disable dns-server.service
sudo systemctl disable dns-client.service

# Enable auto-start on boot
sudo systemctl enable dns-server.service
sudo systemctl enable dns-client.service
```

## Security Considerations

### Option 1: Run as Root (Current Configuration)

The service file runs as root, which is required to bind to port 53. This is the simplest setup but less secure.

### Option 2: Use Capabilities (Recommended for Production)

For better security, you can run the service as a non-root user with capabilities:

1. Create a dedicated user:

```bash
sudo useradd -r -s /bin/false dns-server
```

2. Update the service file:

```ini
[Service]
User=dns-server
Group=dns-server
CapabilityBoundingSet=CAP_NET_BIND_SERVICE CAP_NET_RAW
AmbientCapabilities=CAP_NET_BIND_SERVICE CAP_NET_RAW
NoNewPrivileges=true
```

3. Set proper permissions:

```bash
sudo chown -R dns-server:dns-server /opt/dns-server/apps/server
sudo chown -R dns-server:dns-server /opt/dns-server/apps/server/dns.db
sudo chown -R dns-server:dns-server /opt/dns-server/apps/server/dns-queries.db
sudo chown -R dns-server:dns-server /opt/dns-server/apps/server/certs
```

## Troubleshooting

### Service Won't Start

1. Check the service status:

   ```bash
   sudo systemctl status dns-server.service
   ```

2. Check logs for errors:

   ```bash
   sudo journalctl -u dns-server.service -n 50
   ```

3. Verify the paths in the service file are correct

4. Check if port 53 is already in use:
   ```bash
   sudo lsof -i :53
   sudo netstat -tulpn | grep :53
   ```

### Port 53 Conflict (systemd-resolved)

On Ubuntu/Debian systems, `systemd-resolved` typically runs on port 53. The install script will automatically detect and offer to stop it. If you need to do it manually:

```bash
# Stop and disable systemd-resolved
sudo systemctl stop systemd-resolved
sudo systemctl disable systemd-resolved
```

**Important:** After stopping systemd-resolved, you may need to configure `/etc/resolv.conf` manually:

```bash
# Option 1: Create static resolv.conf (prevents systemd from overwriting)
sudo rm /etc/resolv.conf
sudo echo "nameserver 1.1.1.1" > /etc/resolv.conf
sudo chattr +i /etc/resolv.conf

# Option 2: Use NetworkManager
sudo nmcli connection modify <connection-name> ipv4.dns '1.1.1.1 8.8.8.8'
sudo nmcli connection up <connection-name>
```

**Note:** The install script handles this automatically during installation.

### Port 53 Permission Issues

If you see "EACCES" errors, the service needs root privileges or capabilities:

```bash
# Check current user
whoami

# Verify capabilities (if using non-root user)
getcap /usr/bin/node
```

### Database Permission Issues

If the database files can't be written:

```bash
# Check permissions
ls -la /opt/dns-server/apps/server/*.db

# Fix permissions (if running as root)
sudo chmod 644 /opt/dns-server/apps/server/*.db
```

## Environment Variables

You can set environment variables in the service file or create an environment file:

1. Create environment file:

   ```bash
   sudo nano /etc/dns-server/environment
   ```

2. Add variables:

   ```
   NODE_ENV=production
   DNS_BIND_ADDRESS=0.0.0.0
   LOG_LEVEL=info
   ```

3. Update service file to use it:
   ```ini
   EnvironmentFile=/etc/dns-server/environment
   ```

## Log Rotation

Systemd automatically handles log rotation. To view logs:

```bash
# Follow logs in real-time
sudo journalctl -u dns-server.service -f

# View logs from today
sudo journalctl -u dns-server.service --since today

# View logs from last hour
sudo journalctl -u dns-server.service --since "1 hour ago"

# Export logs to file
sudo journalctl -u dns-server.service > dns-server.log
```

## Updating the Service

After updating the code:

```bash
cd /opt/dns-server
git pull  # or however you update
pnpm install
pnpm run build
sudo systemctl restart dns-server.service
```
