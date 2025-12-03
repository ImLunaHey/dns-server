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

# Check for and disable services using port 53
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
      echo -e "${YELLOW}Note: You may need to configure /etc/resolv.conf manually now${NC}"
      ;;
    2)
      echo -e "${YELLOW}Continuing without stopping systemd-resolved...${NC}"
      echo -e "${RED}Warning: Port 53 conflict may occur!${NC}"
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

# Reload systemd
echo -e "${GREEN}Reloading systemd...${NC}"
systemctl daemon-reload

# Enable services
echo -e "${GREEN}Enabling services to start on boot...${NC}"
systemctl enable dns-server.service
if [ -f "$SYSTEMD_CLIENT_PATH" ]; then
  systemctl enable dns-client.service
fi

# Ask if user wants to start the services now
echo ""
echo -e "${YELLOW}Do you want to start the services now? (y/n)${NC}"
read -r response
if [[ "$response" =~ ^([yY][eE][sS]|[yY])$ ]]; then
  echo -e "${GREEN}Starting services...${NC}"
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
  echo "  Restart all:          sudo systemctl restart dns-server.service dns-client.service"
else
  echo -e "${YELLOW}Services installed but not started. Start them with:${NC}"
  echo "  sudo systemctl start dns-server.service"
  if [ -f "$SYSTEMD_CLIENT_PATH" ]; then
    echo "  sudo systemctl start dns-client.service"
  fi
fi

echo ""
echo -e "${GREEN}Installation complete!${NC}"

