#!/bin/bash

# DNS Server Systemd Service Installer
# This script installs the DNS server and client as systemd services

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
  echo -e "${RED}Please run as root (use sudo)${NC}"
  exit 1
fi

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
SERVER_SERVICE_FILE="$SCRIPT_DIR/dns-server.service"
CLIENT_SERVICE_FILE="$SCRIPT_DIR/dns-client.service"
SYSTEMD_SERVER_PATH="/etc/systemd/system/dns-server.service"
SYSTEMD_CLIENT_PATH="/etc/systemd/system/dns-client.service"

echo -e "${GREEN}DNS Server Systemd Service Installer${NC}"
echo "=========================================="
echo ""

# Function to check and configure system DNS
configure_system_dns() {
  # Detect OS and configure DNS appropriately
  if [ -f /etc/resolv.conf ]; then
    CURRENT_DNS=$(grep -E "^nameserver" /etc/resolv.conf | head -1 | awk '{print $2}' || echo "")
    
    # Check if system is using localhost/127.0.0.1 as DNS
    if [ "$CURRENT_DNS" = "127.0.0.1" ] || [ "$CURRENT_DNS" = "localhost" ] || [ "$CURRENT_DNS" = "::1" ]; then
      echo -e "${YELLOW}Warning: System DNS is configured to use localhost (127.0.0.1)${NC}"
      echo -e "${YELLOW}This will prevent DNS resolution until the DNS server is running.${NC}"
      echo ""
      echo -e "${YELLOW}Options:${NC}"
      echo "  1. Temporarily set system DNS to 1.1.1.1 (recommended)"
      echo "  2. Continue anyway (may fail if DNS resolution is needed)"
      echo "  3. Skip DNS check"
      echo ""
      read -p "Choose option (1-3): " dns_choice
      
      case $dns_choice in
        1)
          echo -e "${GREEN}Configuring system DNS to use 1.1.1.1...${NC}"
          # Backup current resolv.conf
          if [ ! -f /etc/resolv.conf.backup ]; then
            cp /etc/resolv.conf /etc/resolv.conf.backup
          fi
          
          # Try to update resolv.conf (may not work on all systems)
          if command -v resolvconf &> /dev/null; then
            # Ubuntu/Debian with resolvconf
            echo "nameserver 1.1.1.1" | resolvconf -a lo.dns-server
          elif [ -w /etc/resolv.conf ]; then
            # Direct write if possible
            sed -i.bak 's/^nameserver.*/nameserver 1.1.1.1/' /etc/resolv.conf
            if ! grep -q "^nameserver 1.1.1.1" /etc/resolv.conf; then
              echo "nameserver 1.1.1.1" >> /etc/resolv.conf
            fi
          else
            echo -e "${YELLOW}Could not automatically update /etc/resolv.conf${NC}"
            echo -e "${YELLOW}Please manually configure DNS or use NetworkManager/systemd-resolved${NC}"
            echo ""
            echo "For NetworkManager:"
            echo "  sudo nmcli connection modify <connection-name> ipv4.dns '1.1.1.1 8.8.8.8'"
            echo "  sudo nmcli connection up <connection-name>"
            echo ""
            echo "For systemd-resolved:"
            echo "  sudo systemd-resolve --interface <interface> --set-dns 1.1.1.1"
            echo ""
            read -p "Press Enter to continue anyway..."
          fi
          ;;
        2)
          echo -e "${YELLOW}Continuing without changing DNS...${NC}"
          ;;
        3)
          echo -e "${YELLOW}Skipping DNS check...${NC}"
          return
          ;;
        *)
          echo -e "${YELLOW}Invalid choice, continuing anyway...${NC}"
          ;;
      esac
    else
      echo -e "${GREEN}System DNS is configured to use: $CURRENT_DNS${NC}"
    fi
  fi
  
  # Test DNS resolution
  echo -e "${GREEN}Testing DNS resolution...${NC}"
  if ! timeout 5 getent hosts google.com > /dev/null 2>&1 && ! timeout 5 nslookup google.com > /dev/null 2>&1; then
    echo -e "${RED}Warning: DNS resolution test failed!${NC}"
    echo -e "${YELLOW}The build process may fail if it needs to download packages.${NC}"
    echo -e "${YELLOW}Consider configuring system DNS to use 1.1.1.1 or 8.8.8.8${NC}"
    read -p "Press Enter to continue anyway..."
  else
    echo -e "${GREEN}DNS resolution working!${NC}"
  fi
}

# Check and configure system DNS before proceeding
configure_system_dns

# Check if service files exist
if [ ! -f "$SERVER_SERVICE_FILE" ]; then
  echo -e "${RED}Error: Server service file not found at $SERVER_SERVICE_FILE${NC}"
  exit 1
fi

# Detect installation path
if [ -d "/opt/dns-server" ]; then
  INSTALL_PATH="/opt/dns-server"
  echo -e "${YELLOW}Found installation at $INSTALL_PATH${NC}"
elif [ -d "$PROJECT_ROOT" ]; then
  INSTALL_PATH="$PROJECT_ROOT"
  echo -e "${YELLOW}Using project directory: $INSTALL_PATH${NC}"
else
  echo -e "${YELLOW}Enter installation path (default: /opt/dns-server):${NC}"
  read -r INSTALL_PATH
  INSTALL_PATH="${INSTALL_PATH:-/opt/dns-server}"
fi

# Check if this is a re-run (services already exist)
RE_RUN=false
if [ -f "$SYSTEMD_SERVER_PATH" ]; then
  RE_RUN=true
  echo -e "${GREEN}Detected existing installation. This will update the configuration.${NC}"
fi

# Ask for bind IP address
echo ""
echo -e "${GREEN}DNS Server Configuration${NC}"
echo "=========================="
echo ""
echo -e "${YELLOW}Which IP address should the DNS server bind to?${NC}"
echo ""

# List available IP addresses
echo -e "${GREEN}Available network interfaces and IP addresses:${NC}"
if command -v ip &> /dev/null; then
  # Use 'ip' command (Linux)
  ip -4 addr show | grep -E "^[0-9]+:|inet " | while read -r line; do
    if [[ $line =~ ^[0-9]+: ]]; then
      INTERFACE=$(echo "$line" | awk '{print $2}' | tr -d ':')
      echo -e "  ${GREEN}Interface: $INTERFACE${NC}"
    elif [[ $line =~ inet ]]; then
      IP=$(echo "$line" | awk '{print $2}' | cut -d'/' -f1)
      echo -e "    IP: $IP"
    fi
  done
elif command -v ifconfig &> /dev/null; then
  # Use 'ifconfig' command (macOS/older Linux)
  ifconfig | grep -E "^[a-z]|inet " | while read -r line; do
    if [[ $line =~ ^[a-z] ]]; then
      INTERFACE=$(echo "$line" | awk '{print $1}' | tr -d ':')
      echo -e "  ${GREEN}Interface: $INTERFACE${NC}"
    elif [[ $line =~ inet[^6] ]]; then
      IP=$(echo "$line" | awk '{print $2}')
      echo -e "    IP: $IP"
    fi
  done
else
  echo -e "${YELLOW}  (Could not detect network interfaces)${NC}"
fi

echo ""
echo -e "${YELLOW}Options:${NC}"
echo "  - 0.0.0.0  = All interfaces (accessible from network)"
echo "  - 127.0.0.1 = Localhost only (for testing)"
echo "  - <specific IP> = Specific network interface (use one from above)"
echo ""
echo -e "${RED}⚠️  WARNING: Using 0.0.0.0 makes your DNS server accessible from ALL network interfaces!${NC}"
echo -e "${RED}   This means:${NC}"
echo -e "${RED}   - Your server will be accessible from the internet if not behind a firewall${NC}"
echo -e "${RED}   - It could become a public/open DNS resolver${NC}"
echo -e "${RED}   - This may expose you to abuse and security risks${NC}"
echo -e "${RED}   - Consider using a specific IP address or ensure proper firewall rules${NC}"
echo ""
echo -e "${YELLOW}For most home/private networks, binding to a specific local IP (e.g., 192.168.x.x) is safer.${NC}"
echo -e "${YELLOW}Only use 0.0.0.0 if you understand the security implications and have proper firewall rules.${NC}"
echo ""

# Check if we have a previous value
CURRENT_BIND=""
if [ "$RE_RUN" = true ] && [ -f "$INSTALL_PATH/apps/server/.env" ]; then
  CURRENT_BIND=$(grep "^DNS_BIND_ADDRESS=" "$INSTALL_PATH/apps/server/.env" | cut -d'=' -f2 | tr -d '"' || echo "")
  if [ -n "$CURRENT_BIND" ]; then
    echo -e "${GREEN}Current bind address: $CURRENT_BIND${NC}"
    echo -e "${YELLOW}Press Enter to keep current value, or enter a new IP address:${NC}"
  fi
fi

read -p "Bind IP address (default: ${CURRENT_BIND:-0.0.0.0}): " BIND_IP
BIND_IP="${BIND_IP:-${CURRENT_BIND:-0.0.0.0}}"

# Warn and confirm if user chose 0.0.0.0
if [ "$BIND_IP" = "0.0.0.0" ]; then
  echo ""
  echo -e "${RED}⚠️  You selected 0.0.0.0 (all interfaces)${NC}"
  echo -e "${RED}This will make your DNS server accessible from all network interfaces.${NC}"
  echo -e "${YELLOW}Are you sure you want to proceed? (yes/no)${NC}"
  read -r confirm
  if [[ ! "$confirm" =~ ^([yY][eE][sS])$ ]]; then
    echo -e "${YELLOW}Please enter a specific IP address or 127.0.0.1 for localhost only:${NC}"
    read -p "Bind IP address: " BIND_IP
    if [ -z "$BIND_IP" ]; then
      echo -e "${RED}No IP address provided. Exiting.${NC}"
      exit 1
    fi
  fi
fi

# Validate IP address format (basic check)
if [[ ! "$BIND_IP" =~ ^(0\.0\.0\.0|127\.0\.0\.1|[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3})$ ]]; then
  echo -e "${YELLOW}Warning: IP address format may be invalid, but continuing...${NC}"
fi

# Determine server and client URLs based on bind IP
if [ "$BIND_IP" = "0.0.0.0" ]; then
  # If binding to all interfaces, use localhost for URLs (or detect primary IP)
  # Try to detect the primary network IP
  if command -v ip &> /dev/null; then
    PRIMARY_IP=$(ip -4 addr show | grep -E "inet " | grep -v "127.0.0.1" | head -1 | awk '{print $2}' | cut -d'/' -f1 || echo "")
  elif command -v ifconfig &> /dev/null; then
    PRIMARY_IP=$(ifconfig | grep -E "inet " | grep -v "127.0.0.1" | head -1 | awk '{print $2}' || echo "")
  fi
  
  if [ -n "$PRIMARY_IP" ]; then
    SERVER_URL="http://$PRIMARY_IP:3001"
    CLIENT_URL="http://$PRIMARY_IP:3000"
    echo -e "${GREEN}Detected primary IP: $PRIMARY_IP${NC}"
    echo -e "${GREEN}  Server URL: $SERVER_URL${NC}"
    echo -e "${GREEN}  Client URL: $CLIENT_URL${NC}"
  else
    SERVER_URL="http://localhost:3001"
    CLIENT_URL="http://localhost:3000"
    echo -e "${YELLOW}Could not detect primary IP, using localhost${NC}"
  fi
elif [ "$BIND_IP" = "127.0.0.1" ]; then
  SERVER_URL="http://localhost:3001"
  CLIENT_URL="http://localhost:3000"
else
  # Use the specific bind IP
  SERVER_URL="http://$BIND_IP:3001"
  CLIENT_URL="http://$BIND_IP:3000"
fi

# Caddy reverse proxy is required
echo ""
echo -e "${GREEN}Reverse Proxy Configuration${NC}"
echo "============================="
echo ""
echo -e "${GREEN}Caddy will be used as a reverse proxy to serve both client and server.${NC}"
echo -e "${YELLOW}This provides:${NC}"
echo "  - Single URL for both client and API"
echo "  - Automatic HTTPS (if using a domain)"
echo "  - Simplified access"
echo ""
echo -e "${YELLOW}Do you want to use a domain name?${NC}"
echo -e "${YELLOW}  - Yes: Enter a domain (e.g., dns.example.com) for automatic HTTPS${NC}"
echo -e "${YELLOW}  - No: Will use the bind IP address ($BIND_IP) for HTTP only${NC}"
echo ""
read -p "Use domain? (y/n, default: n): " use_domain
USE_DOMAIN=false
if [[ "$use_domain" =~ ^([yY][eE][sS]|[yY])$ ]]; then
  USE_DOMAIN=true
  echo ""
  echo -e "${YELLOW}Enter your domain name:${NC}"
  echo -e "${YELLOW}  Example: dns.example.com${NC}"
  echo ""
  read -p "Domain: " caddy_domain
  if [ -z "$caddy_domain" ]; then
    echo -e "${YELLOW}No domain provided, falling back to bind IP: $BIND_IP${NC}"
    CADDY_DOMAIN="$BIND_IP"
    USE_DOMAIN=false
  else
    CADDY_DOMAIN="$caddy_domain"
  fi
else
  CADDY_DOMAIN="$BIND_IP"
fi

# Set URLs based on whether we're using a domain or IP
if [ "$USE_DOMAIN" = true ] && [[ ! "$CADDY_DOMAIN" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  # It's a domain - use HTTPS
  FINAL_SERVER_URL="https://$CADDY_DOMAIN"
  FINAL_CLIENT_URL="https://$CADDY_DOMAIN"
else
  # It's an IP address - use HTTP
  FINAL_SERVER_URL="http://$CADDY_DOMAIN"
  FINAL_CLIENT_URL="http://$CADDY_DOMAIN"
fi

SERVER_URL="$FINAL_SERVER_URL"
CLIENT_URL="$FINAL_CLIENT_URL"

echo ""
echo -e "${GREEN}Caddy Configuration:${NC}"
echo -e "${GREEN}  Will serve on: $CADDY_DOMAIN${NC}"
echo -e "${GREEN}  Client and API accessible at: $FINAL_CLIENT_URL${NC}"
if [ "$USE_DOMAIN" = true ] && [[ ! "$CADDY_DOMAIN" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo -e "${GREEN}  HTTPS will be automatically enabled${NC}"
fi
USE_CADDY=true

echo ""
echo -e "${GREEN}Web Interface URLs${NC}"
echo "=================="
echo -e "${GREEN}  Server API: $FINAL_SERVER_URL${NC}"
echo -e "${GREEN}  Client Dashboard: $FINAL_CLIENT_URL${NC}"
echo -e "${GREEN}  (Both served via Caddy reverse proxy)${NC}"
echo ""
echo -e "${YELLOW}If you need to change these URLs, edit $INSTALL_PATH/apps/server/.env after installation${NC}"
echo ""

echo ""
echo -e "${GREEN}Generating .env file...${NC}"
ENV_FILE="$INSTALL_PATH/apps/server/.env"

# Generate or update .env file
if [ ! -f "$ENV_FILE" ]; then
  # Generate a secure random secret for better-auth
  AUTH_SECRET=$(openssl rand -hex 32 2>/dev/null || head -c 64 /dev/urandom | base64 | tr -d '\n' | head -c 64)
  
  cat > "$ENV_FILE" <<EOF
# DNS Server Environment Configuration
# Generated by install script on $(date)

# Better Auth Secret (change this in production!)
BETTER_AUTH_SECRET=$AUTH_SECRET

# DNS Server Bind Address
DNS_BIND_ADDRESS=$BIND_IP

# Node Environment
NODE_ENV=production

# Optional: Log Level (debug, info, warn, error)
# LOG_LEVEL=info

# CORS Origins (comma-separated) - URLs allowed to access the API
CORS_ORIGINS=$FINAL_CLIENT_URL

# Better Auth Trusted Origins (comma-separated) - URLs allowed for authentication
BETTER_AUTH_TRUSTED_ORIGINS=$FINAL_CLIENT_URL

# Server URL - Base URL for the API server (used by better-auth)
SERVER_URL=$FINAL_SERVER_URL
BETTER_AUTH_BASE_URL=$FINAL_SERVER_URL
EOF
  echo -e "${GREEN}✓ Created .env file${NC}"
else
  # Update existing .env file
  # Update BETTER_AUTH_SECRET if not set or is default
  if ! grep -q "^BETTER_AUTH_SECRET=" "$ENV_FILE" || grep -q "^BETTER_AUTH_SECRET=change-me-in-production" "$ENV_FILE"; then
    AUTH_SECRET=$(openssl rand -hex 32 2>/dev/null || head -c 64 /dev/urandom | base64 | tr -d '\n' | head -c 64)
    if grep -q "^BETTER_AUTH_SECRET=" "$ENV_FILE"; then
      sed -i "s/^BETTER_AUTH_SECRET=.*/BETTER_AUTH_SECRET=$AUTH_SECRET/" "$ENV_FILE"
    else
      echo "BETTER_AUTH_SECRET=$AUTH_SECRET" >> "$ENV_FILE"
    fi
    echo -e "${GREEN}✓ Updated BETTER_AUTH_SECRET in .env file${NC}"
  fi
  
  # Update DNS_BIND_ADDRESS (only if it changed or doesn't exist)
  if grep -q "^DNS_BIND_ADDRESS=" "$ENV_FILE"; then
    OLD_BIND=$(grep "^DNS_BIND_ADDRESS=" "$ENV_FILE" | cut -d'=' -f2 | tr -d '"')
    if [ "$OLD_BIND" != "$BIND_IP" ]; then
      sed -i "s|^DNS_BIND_ADDRESS=.*|DNS_BIND_ADDRESS=$BIND_IP|" "$ENV_FILE"
      echo -e "${GREEN}✓ Updated DNS_BIND_ADDRESS from $OLD_BIND to $BIND_IP${NC}"
    else
      echo -e "${GREEN}✓ DNS_BIND_ADDRESS already set to $BIND_IP${NC}"
    fi
  else
    echo "DNS_BIND_ADDRESS=$BIND_IP" >> "$ENV_FILE"
    echo -e "${GREEN}✓ Added DNS_BIND_ADDRESS=$BIND_IP${NC}"
  fi
  
  # Update CORS_ORIGINS
  if grep -q "^CORS_ORIGINS=" "$ENV_FILE"; then
    sed -i "s|^CORS_ORIGINS=.*|CORS_ORIGINS=$FINAL_CLIENT_URL|" "$ENV_FILE"
  else
    echo "CORS_ORIGINS=$FINAL_CLIENT_URL" >> "$ENV_FILE"
  fi
  echo -e "${GREEN}✓ Updated CORS_ORIGINS to $FINAL_CLIENT_URL${NC}"
  
  # Update BETTER_AUTH_TRUSTED_ORIGINS
  if grep -q "^BETTER_AUTH_TRUSTED_ORIGINS=" "$ENV_FILE"; then
    sed -i "s|^BETTER_AUTH_TRUSTED_ORIGINS=.*|BETTER_AUTH_TRUSTED_ORIGINS=$FINAL_CLIENT_URL|" "$ENV_FILE"
  else
    echo "BETTER_AUTH_TRUSTED_ORIGINS=$FINAL_CLIENT_URL" >> "$ENV_FILE"
  fi
  echo -e "${GREEN}✓ Updated BETTER_AUTH_TRUSTED_ORIGINS to $FINAL_CLIENT_URL${NC}"
  
  # Update SERVER_URL and BETTER_AUTH_BASE_URL
  if grep -q "^SERVER_URL=" "$ENV_FILE"; then
    sed -i "s|^SERVER_URL=.*|SERVER_URL=$FINAL_SERVER_URL|" "$ENV_FILE"
  else
    echo "SERVER_URL=$FINAL_SERVER_URL" >> "$ENV_FILE"
  fi
  
  if grep -q "^BETTER_AUTH_BASE_URL=" "$ENV_FILE"; then
    sed -i "s|^BETTER_AUTH_BASE_URL=.*|BETTER_AUTH_BASE_URL=$FINAL_SERVER_URL|" "$ENV_FILE"
  else
    echo "BETTER_AUTH_BASE_URL=$FINAL_SERVER_URL" >> "$ENV_FILE"
  fi
  echo -e "${GREEN}✓ Updated SERVER_URL and BETTER_AUTH_BASE_URL to $FINAL_SERVER_URL${NC}"
fi

# Ensure NODE_ENV is set
if ! grep -q "^NODE_ENV=" "$ENV_FILE"; then
  echo "NODE_ENV=production" >> "$ENV_FILE"
fi

# Check for and disable services using port 53
# This happens after .env is created so we know the bind address
echo ""
echo -e "${GREEN}Checking for services using port 53...${NC}"

# Check if systemd-resolved is running
if systemctl is-active --quiet systemd-resolved 2>/dev/null; then
  echo -e "${YELLOW}systemd-resolved is running on port 53${NC}"
  echo -e "${YELLOW}This needs to be stopped/disabled for the DNS server to use port 53${NC}"
  echo ""
  echo -e "${YELLOW}Options:${NC}"
  echo "  1. Stop and disable systemd-resolved (recommended)"
  echo "  2. Continue anyway (may cause port conflict)"
  echo ""
  read -p "Choose option (1-2): " resolved_choice
  
  case $resolved_choice in
    1)
      echo -e "${GREEN}Stopping systemd-resolved...${NC}"
      systemctl stop systemd-resolved
      systemctl disable systemd-resolved
      echo -e "${GREEN}✓ systemd-resolved stopped and disabled${NC}"
      
      # Configure /etc/resolv.conf to use upstream DNS (never our DNS server)
      # This ensures the system can always resolve DNS independently
      echo -e "${GREEN}Configuring system DNS resolver...${NC}"
      SYSTEM_DNS="1.1.1.1"
      echo -e "${GREEN}  Using 1.1.1.1 as system DNS (system will use upstream DNS, not our server)${NC}"
      
      # Backup current resolv.conf
      if [ ! -f /etc/resolv.conf.backup ]; then
        cp /etc/resolv.conf /etc/resolv.conf.backup 2>/dev/null || true
      fi
      
      # Configure resolv.conf
      if [ -w /etc/resolv.conf ]; then
        cat > /etc/resolv.conf <<EOF
# DNS configuration for DNS Server
# Generated by install script on $(date)
# This file is managed by the DNS server installer
nameserver $SYSTEM_DNS
nameserver 8.8.8.8
EOF
        echo -e "${GREEN}✓ Configured /etc/resolv.conf to use $SYSTEM_DNS${NC}"
        echo -e "${YELLOW}Note: The system will use 1.1.1.1 for DNS resolution.${NC}"
        echo -e "${YELLOW}      To use our DNS server, configure clients/devices to point to our server's IP.${NC}"
        echo -e "${YELLOW}      If systemd-resolvconf or NetworkManager overwrites this, you may need to:${NC}"
        echo -e "${YELLOW}      - Configure NetworkManager DNS settings, or${NC}"
        echo -e "${YELLOW}      - Use 'chattr +i /etc/resolv.conf' to prevent overwrites${NC}"
      else
        echo -e "${YELLOW}Could not write to /etc/resolv.conf (may be managed by systemd-resolvconf)${NC}"
        echo -e "${YELLOW}Please manually configure DNS:${NC}"
        echo ""
        echo "For NetworkManager:"
        echo "  sudo nmcli connection modify <connection-name> ipv4.dns '$SYSTEM_DNS 8.8.8.8'"
        echo "  sudo nmcli connection up <connection-name>"
        echo ""
        echo "For systemd-resolved (if still enabled):"
        echo "  sudo systemd-resolve --interface <interface> --set-dns $SYSTEM_DNS"
        echo ""
        read -p "Press Enter to continue..."
      fi
      ;;
    2)
      echo -e "${YELLOW}Continuing without stopping systemd-resolved...${NC}"
      echo -e "${RED}Warning: Port 53 conflict may occur!${NC}"
      echo -e "${YELLOW}You may need to configure systemd-resolved to forward to our DNS server${NC}"
      echo -e "${YELLOW}or run our DNS server on a different port.${NC}"
      ;;
    *)
      echo -e "${YELLOW}Invalid choice, continuing anyway...${NC}"
      ;;
  esac
fi

# Check if anything else is using port 53
if command -v lsof &> /dev/null; then
  PORT53_PROCESS=$(sudo lsof -i :53 -t 2>/dev/null | head -1)
  if [ -n "$PORT53_PROCESS" ]; then
    PROCESS_NAME=$(ps -p "$PORT53_PROCESS" -o comm= 2>/dev/null || echo "unknown")
    echo -e "${YELLOW}Warning: Process $PROCESS_NAME (PID: $PORT53_PROCESS) is using port 53${NC}"
    echo -e "${YELLOW}You may need to stop this process before starting the DNS server${NC}"
    read -p "Press Enter to continue..."
  fi
elif command -v netstat &> /dev/null; then
  PORT53_PROCESS=$(sudo netstat -tulpn 2>/dev/null | grep ':53 ' | head -1)
  if [ -n "$PORT53_PROCESS" ]; then
    echo -e "${YELLOW}Warning: Something is using port 53:${NC}"
    echo "$PORT53_PROCESS"
    echo -e "${YELLOW}You may need to stop this process before starting the DNS server${NC}"
    read -p "Press Enter to continue..."
  fi
fi

# Setup nvm if available
if [ -s "$HOME/.nvm/nvm.sh" ]; then
  echo -e "${GREEN}Loading nvm...${NC}"
  export NVM_DIR="$HOME/.nvm"
  [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
  [ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"
elif [ -s "/usr/local/opt/nvm/nvm.sh" ]; then
  echo -e "${GREEN}Loading nvm...${NC}"
  export NVM_DIR="/usr/local/opt/nvm"
  [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
elif [ -s "/opt/homebrew/opt/nvm/nvm.sh" ]; then
  echo -e "${GREEN}Loading nvm...${NC}"
  export NVM_DIR="/opt/homebrew/opt/nvm"
  [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
fi

# Check if nvm is available
if command -v nvm &> /dev/null || [ -n "$NVM_DIR" ]; then
  echo -e "${GREEN}nvm found, using nvm to set up Node.js...${NC}"
  # Try to use the version from .nvmrc if it exists
  if [ -f "$INSTALL_PATH/.nvmrc" ]; then
    cd "$INSTALL_PATH"
    nvm use
  else
    # Use default or latest LTS
    nvm use --lts || nvm use node || nvm use default
  fi
else
  echo -e "${YELLOW}nvm not found. Using system Node.js...${NC}"
fi

# Check if node is available
if ! command -v node &> /dev/null; then
  echo -e "${RED}Node.js not found. Please install Node.js or nvm first.${NC}"
  exit 1
fi

NODE_PATH=$(which node)
NODE_VERSION=$(node --version)
echo -e "${GREEN}Using Node.js at: $NODE_PATH (version: $NODE_VERSION)${NC}"

# Check if pnpm is available
if ! command -v pnpm &> /dev/null; then
  echo -e "${YELLOW}pnpm not found. Installing pnpm globally...${NC}"
  npm install -g pnpm
fi

PNPM_VERSION=$(pnpm --version)
echo -e "${GREEN}Using pnpm version: $PNPM_VERSION${NC}"

# Ensure system DNS is working before building (build may need to download packages)
echo -e "${GREEN}Verifying DNS resolution before build...${NC}"
if ! timeout 5 getent hosts registry.npmjs.org > /dev/null 2>&1 && ! timeout 5 nslookup registry.npmjs.org > /dev/null 2>&1; then
  echo -e "${RED}Error: Cannot resolve registry.npmjs.org${NC}"
  echo -e "${RED}System DNS must be working to download npm packages.${NC}"
  echo -e "${YELLOW}Please configure system DNS to use 1.1.1.1 or 8.8.8.8${NC}"
  exit 1
fi

# Build the project
echo -e "${GREEN}Building project...${NC}"
cd "$INSTALL_PATH"

# Set environment variables for client build with final URLs
export VITE_API_URL="$FINAL_SERVER_URL"
export VITE_AUTH_BASE_URL="$FINAL_SERVER_URL"

pnpm install
pnpm run build

# Verify builds
if [ ! -f "$INSTALL_PATH/apps/server/dist/index.js" ]; then
  echo -e "${RED}Error: Server build failed. dist/index.js not found.${NC}"
  exit 1
fi

if [ ! -d "$INSTALL_PATH/apps/client/dist" ] || [ -z "$(ls -A "$INSTALL_PATH/apps/client/dist")" ]; then
  echo -e "${RED}Error: Client build failed. dist directory not found or empty.${NC}"
  exit 1
fi

echo -e "${GREEN}Build completed successfully!${NC}"

# Verify DNS server will have upstream DNS configured
echo -e "${GREEN}DNS server configuration:${NC}"
echo -e "${GREEN}  - Upstream DNS will be set to 1.1.1.1 on first start (default)${NC}"
echo -e "${GREEN}  - This ensures the server can resolve domains even if system DNS points to localhost${NC}"

# Note: systemd-resolved check happens after .env is created (see below)
if systemctl is-active --quiet systemd-resolved 2>/dev/null; then
  echo -e "${YELLOW}systemd-resolved is running on port 53${NC}"
  echo -e "${YELLOW}This needs to be stopped/disabled for the DNS server to use port 53${NC}"
  echo ""
  echo -e "${YELLOW}Options:${NC}"
  echo "  1. Stop and disable systemd-resolved (recommended)"
  echo "  2. Continue anyway (may cause port conflict)"
  echo ""
  read -p "Choose option (1-2): " resolved_choice
  
  case $resolved_choice in
    1)
      echo -e "${GREEN}Stopping systemd-resolved...${NC}"
      systemctl stop systemd-resolved
      systemctl disable systemd-resolved
      echo -e "${GREEN}✓ systemd-resolved stopped and disabled${NC}"
      
      # Configure /etc/resolv.conf to use upstream DNS (never our DNS server)
      # This ensures the system can always resolve DNS independently
      echo -e "${GREEN}Configuring system DNS resolver...${NC}"
      SYSTEM_DNS="1.1.1.1"
      echo -e "${GREEN}  Using 1.1.1.1 as system DNS (system will use upstream DNS, not our server)${NC}"
      
      # Backup current resolv.conf
      if [ ! -f /etc/resolv.conf.backup ]; then
        cp /etc/resolv.conf /etc/resolv.conf.backup 2>/dev/null || true
      fi
      
      # Configure resolv.conf
      if [ -w /etc/resolv.conf ]; then
        cat > /etc/resolv.conf <<EOF
# DNS configuration for DNS Server
# Generated by install script on $(date)
# This file is managed by the DNS server installer
nameserver $SYSTEM_DNS
nameserver 8.8.8.8
EOF
        echo -e "${GREEN}✓ Configured /etc/resolv.conf to use $SYSTEM_DNS${NC}"
        echo -e "${YELLOW}Note: The system will use 1.1.1.1 for DNS resolution.${NC}"
        echo -e "${YELLOW}      To use our DNS server, configure clients/devices to point to our server's IP.${NC}"
        echo -e "${YELLOW}      If systemd-resolvconf or NetworkManager overwrites this, you may need to:${NC}"
        echo -e "${YELLOW}      - Configure NetworkManager DNS settings, or${NC}"
        echo -e "${YELLOW}      - Use 'chattr +i /etc/resolv.conf' to prevent overwrites${NC}"
      else
        echo -e "${YELLOW}Could not write to /etc/resolv.conf (may be managed by systemd-resolvconf)${NC}"
        echo -e "${YELLOW}Please manually configure DNS:${NC}"
        echo ""
        echo "For NetworkManager:"
        echo "  sudo nmcli connection modify <connection-name> ipv4.dns '$SYSTEM_DNS 8.8.8.8'"
        echo "  sudo nmcli connection up <connection-name>"
        echo ""
        echo "For systemd-resolved (if still enabled):"
        echo "  sudo systemd-resolve --interface <interface> --set-dns $SYSTEM_DNS"
        echo ""
        read -p "Press Enter to continue..."
      fi
      ;;
    2)
      echo -e "${YELLOW}Continuing without stopping systemd-resolved...${NC}"
      echo -e "${RED}Warning: Port 53 conflict may occur!${NC}"
      echo -e "${YELLOW}You may need to configure systemd-resolved to forward to our DNS server${NC}"
      echo -e "${YELLOW}or run our DNS server on a different port.${NC}"
      ;;
    *)
      echo -e "${YELLOW}Invalid choice, continuing anyway...${NC}"
      ;;
  esac
fi

# Check if anything else is using port 53
PORT53_IN_USE=false
PORT53_PROCESS=""
PORT53_PROCESS_NAME=""

if command -v lsof &> /dev/null; then
  PORT53_PROCESS=$(sudo lsof -i :53 -t 2>/dev/null | head -1)
  if [ -n "$PORT53_PROCESS" ]; then
    PORT53_PROCESS_NAME=$(ps -p "$PORT53_PROCESS" -o comm= 2>/dev/null || echo "unknown")
    PORT53_IN_USE=true
  fi
elif command -v netstat &> /dev/null; then
  PORT53_INFO=$(sudo netstat -tulpn 2>/dev/null | grep ':53 ' | head -1)
  if [ -n "$PORT53_INFO" ]; then
    PORT53_PROCESS=$(echo "$PORT53_INFO" | awk '{print $7}' | cut -d'/' -f1)
    PORT53_PROCESS_NAME=$(echo "$PORT53_INFO" | awk '{print $7}' | cut -d'/' -f2)
    PORT53_IN_USE=true
  fi
fi

if [ "$PORT53_IN_USE" = true ]; then
  # Check if it's our DNS server
  IS_OUR_SERVER=false
  
  # Check if it's our systemd service
  if systemctl is-active --quiet dns-server.service 2>/dev/null; then
    IS_OUR_SERVER=true
    echo -e "${GREEN}Detected our DNS server is already running${NC}"
    echo -e "${GREEN}  Will stop it, update configuration, and restart it${NC}"
  # Check if the process is node and matches our server path
  elif [ "$PORT53_PROCESS_NAME" = "node" ] && [ -n "$PORT53_PROCESS" ]; then
    # Try to check if it's running our server
    PROCESS_CMD=$(ps -p "$PORT53_PROCESS" -o cmd= 2>/dev/null || echo "")
    if echo "$PROCESS_CMD" | grep -q "dns-server.*dist/index.js" || echo "$PROCESS_CMD" | grep -q "$INSTALL_PATH/apps/server"; then
      IS_OUR_SERVER=true
      echo -e "${GREEN}Detected our DNS server process is running (PID: $PORT53_PROCESS)${NC}"
      echo -e "${GREEN}  Will stop it, update configuration, and restart it${NC}"
    fi
  fi
  
  if [ "$IS_OUR_SERVER" = true ]; then
    # Stop our server gracefully
    if systemctl is-active --quiet dns-server.service 2>/dev/null; then
      echo -e "${GREEN}Stopping DNS server service...${NC}"
      systemctl stop dns-server.service
    else
      echo -e "${GREEN}Stopping DNS server process (PID: $PORT53_PROCESS)...${NC}"
      kill -TERM "$PORT53_PROCESS" 2>/dev/null || true
      # Wait a moment for graceful shutdown
      sleep 2
      # Force kill if still running
      if kill -0 "$PORT53_PROCESS" 2>/dev/null; then
        echo -e "${YELLOW}Process still running, forcing shutdown...${NC}"
        kill -KILL "$PORT53_PROCESS" 2>/dev/null || true
      fi
    fi
    echo -e "${GREEN}✓ DNS server stopped${NC}"
  else
    # It's something else using port 53
    echo -e "${YELLOW}Warning: Process $PORT53_PROCESS_NAME (PID: $PORT53_PROCESS) is using port 53${NC}"
    echo -e "${YELLOW}This doesn't appear to be our DNS server.${NC}"
    echo -e "${YELLOW}You may need to stop this process before starting the DNS server${NC}"
    read -p "Press Enter to continue anyway, or Ctrl+C to cancel..."
  fi
fi

# Create nvm environment file if nvm is being used
if [ -n "$NVM_DIR" ]; then
  echo -e "${GREEN}Creating nvm environment file...${NC}"
  mkdir -p /etc/dns-server
  cat > /etc/dns-server/nvm-env <<EOF
NVM_DIR=$NVM_DIR
PATH=$PATH
EOF
fi

# Find npx path (should be next to node)
NPX_PATH=$(which npx || echo "/usr/bin/npx")
if [ ! -f "$NPX_PATH" ]; then
  # Try to find npx in the same directory as node
  NODE_DIR=$(dirname "$NODE_PATH")
  if [ -f "$NODE_DIR/npx" ]; then
    NPX_PATH="$NODE_DIR/npx"
  else
    echo -e "${YELLOW}Warning: npx not found, using /usr/bin/npx${NC}"
    NPX_PATH="/usr/bin/npx"
  fi
fi

# Create temporary service files with correct paths
TEMP_SERVER_SERVICE=$(mktemp)
sed "s|/opt/dns-server|$INSTALL_PATH|g" "$SERVER_SERVICE_FILE" | \
  sed "s|/usr/bin/node|$NODE_PATH|g" > "$TEMP_SERVER_SERVICE"

# Copy server service file
echo -e "${GREEN}Installing server service file...${NC}"
cp "$TEMP_SERVER_SERVICE" "$SYSTEMD_SERVER_PATH"
rm "$TEMP_SERVER_SERVICE"

# Install client service if file exists
if [ -f "$CLIENT_SERVICE_FILE" ]; then
  TEMP_CLIENT_SERVICE=$(mktemp)
  sed "s|/opt/dns-server|$INSTALL_PATH|g" "$CLIENT_SERVICE_FILE" | \
    sed "s|/usr/bin/npx|$NPX_PATH|g" > "$TEMP_CLIENT_SERVICE"
  
  echo -e "${GREEN}Installing client service file...${NC}"
  cp "$TEMP_CLIENT_SERVICE" "$SYSTEMD_CLIENT_PATH"
  rm "$TEMP_CLIENT_SERVICE"
fi

# Install and configure Caddy (required)
echo ""
echo -e "${GREEN}Installing and configuring Caddy...${NC}"
  
  # Check if Caddy is installed
  if ! command -v caddy &> /dev/null; then
    echo -e "${YELLOW}Caddy not found. Installing Caddy...${NC}"
    
    # Install Caddy (Ubuntu/Debian)
    if command -v apt-get &> /dev/null; then
      sudo apt-get update
      sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
      curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
      curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
      sudo apt-get update
      sudo apt-get install -y caddy
    # Install Caddy (RHEL/CentOS/Fedora)
    elif command -v dnf &> /dev/null || command -v yum &> /dev/null; then
      if command -v dnf &> /dev/null; then
        sudo dnf install -y 'dnf-command(copr)'
        sudo dnf copr enable -y @caddy/caddy
        sudo dnf install -y caddy
      else
        sudo yum install -y yum-plugin-copr
        sudo yum copr enable -y @caddy/caddy
        sudo yum install -y caddy
      fi
    else
      echo -e "${YELLOW}Could not auto-install Caddy. Please install it manually:${NC}"
      echo "  Visit: https://caddyserver.com/docs/install"
      read -p "Press Enter after installing Caddy, or Ctrl+C to cancel..."
    fi
  fi
  
  # Create Caddyfile
  CADDYFILE="$INSTALL_PATH/systemd/Caddyfile"
  if [ -f "$CADDYFILE" ]; then
    # Update Caddyfile with domain (replace {$DOMAIN} placeholder)
    sed "s/{\\\$DOMAIN:localhost}/$CADDY_DOMAIN/g" "$CADDYFILE" | \
      sed "s/{\\\$DOMAIN}/$CADDY_DOMAIN/g" > /etc/caddy/Caddyfile
    echo -e "${GREEN}✓ Created Caddyfile at /etc/caddy/Caddyfile${NC}"
  else
    # Create Caddyfile from scratch
    cat > /etc/caddy/Caddyfile <<EOF
# DNS Server Caddy Configuration
# Generated by install script on $(date)

$CADDY_DOMAIN {
  # Proxy API requests to the server (port 3001)
  reverse_proxy /api/* localhost:3001 {
    header_up Host {host}
    header_up X-Real-IP {remote}
    header_up X-Forwarded-For {remote}
    header_up X-Forwarded-Proto {scheme}
  }
  
  # Proxy all other requests to the client (port 3000)
  reverse_proxy /* localhost:3000 {
    header_up Host {host}
    header_up X-Real-IP {remote}
    header_up X-Forwarded-For {remote}
    header_up X-Forwarded-Proto {scheme}
  }
  
  # Security headers
  header {
    X-Content-Type-Options "nosniff"
    X-Frame-Options "DENY"
    X-XSS-Protection "1; mode=block"
    Referrer-Policy "strict-origin-when-cross-origin"
  }
  
  # Enable compression
  encode gzip zstd
}
EOF
    echo -e "${GREEN}✓ Created Caddyfile at /etc/caddy/Caddyfile${NC}"
  fi
  
# Enable and start Caddy
systemctl enable caddy
systemctl restart caddy
echo -e "${GREEN}✓ Caddy configured and started${NC}"

# Note about ports
echo -e "${YELLOW}Note: Caddy will handle ports 80/443.${NC}"
if [[ ! "$CADDY_DOMAIN" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo -e "${YELLOW}      Make sure ports 80 and 443 are open for automatic HTTPS.${NC}"
  echo -e "${YELLOW}      Ensure your domain's DNS points to this server's IP address.${NC}"
fi

# Reload systemd
echo -e "${GREEN}Reloading systemd...${NC}"
systemctl daemon-reload

# Stop services if they're running (for re-run)
# Note: We may have already stopped the server above if it was using port 53
if [ "$RE_RUN" = true ]; then
  echo -e "${GREEN}Stopping existing services for update...${NC}"
  # Only stop if not already stopped (we may have stopped it above)
  if systemctl is-active --quiet dns-server.service 2>/dev/null; then
    systemctl stop dns-server.service 2>/dev/null || true
  fi
  if [ -f "$SYSTEMD_CLIENT_PATH" ]; then
    if systemctl is-active --quiet dns-client.service 2>/dev/null; then
      systemctl stop dns-client.service 2>/dev/null || true
    fi
  fi
fi

# Enable services
echo -e "${GREEN}Enabling services to start on boot...${NC}"
systemctl enable dns-server.service
if [ -f "$SYSTEMD_CLIENT_PATH" ]; then
  systemctl enable dns-client.service
fi

# Ask if user wants to start/restart the services now
echo ""
if [ "$RE_RUN" = true ]; then
  echo -e "${YELLOW}Do you want to restart the services now? (y/n)${NC}"
else
  echo -e "${YELLOW}Do you want to start the services now? (y/n)${NC}"
fi
read -r response
if [[ "$response" =~ ^([yY][eE][sS]|[yY])$ ]]; then
  if [ "$RE_RUN" = true ]; then
    echo -e "${GREEN}Restarting services...${NC}"
  else
    echo -e "${GREEN}Starting services...${NC}"
  fi
  systemctl start dns-server.service
  if [ -f "$SYSTEMD_CLIENT_PATH" ]; then
    systemctl start dns-client.service
  fi
  
  # Wait a moment and check status
  sleep 3
  if systemctl is-active --quiet dns-server.service; then
    echo -e "${GREEN}Server service started successfully!${NC}"
  else
    echo -e "${RED}Server service failed to start. Check logs with:${NC}"
    echo "  sudo journalctl -u dns-server.service -n 50"
    exit 1
  fi
  
  if [ -f "$SYSTEMD_CLIENT_PATH" ]; then
    if systemctl is-active --quiet dns-client.service; then
      echo -e "${GREEN}Client service started successfully!${NC}"
    else
      echo -e "${YELLOW}Client service failed to start. Check logs with:${NC}"
      echo "  sudo journalctl -u dns-client.service -n 50"
    fi
  fi
  
  echo ""
  echo "Useful commands:"
  echo "  Check server status: sudo systemctl status dns-server.service"
  echo "  Check client status: sudo systemctl status dns-client.service"
  echo "  View server logs:    sudo journalctl -u dns-server.service -f"
  echo "  View client logs:     sudo journalctl -u dns-client.service -f"
  echo "  Restart all:          sudo systemctl restart dns-server.service dns-client.service caddy"
else
  echo -e "${YELLOW}Services installed but not started. Start them with:${NC}"
  echo "  sudo systemctl start dns-server.service"
  if [ -f "$SYSTEMD_CLIENT_PATH" ]; then
    echo "  sudo systemctl start dns-client.service"
  fi
  echo "  sudo systemctl start caddy"
fi

echo ""
echo -e "${GREEN}Installation complete!${NC}"
echo ""
echo -e "${GREEN}Access your DNS server dashboard at:${NC}"
echo -e "${GREEN}  $FINAL_CLIENT_URL${NC}"
echo ""
if [[ ! "$CADDY_DOMAIN" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo -e "${YELLOW}Note: Caddy will automatically obtain an SSL certificate for your domain.${NC}"
  echo -e "${YELLOW}      Make sure your domain's DNS points to this server's IP address.${NC}"
fi

