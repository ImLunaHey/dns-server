#!/bin/bash

# DNS Server Development Setup Script
# This script sets up the development environment
# For production deployment, use: systemd/install.sh

echo "🚀 DNS Server Development Setup"
echo "==============================="
echo ""
echo "This script sets up the development environment."
echo "For production deployment, use: sudo ./systemd/install.sh"
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
  echo "⚠️  Note: The DNS server will need sudo/root privileges to bind to port 53"
  echo ""
fi

# Setup nvm if available
if [ -s "$HOME/.nvm/nvm.sh" ]; then
  export NVM_DIR="$HOME/.nvm"
  [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
  [ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"
elif [ -s "/usr/local/opt/nvm/nvm.sh" ]; then
  export NVM_DIR="/usr/local/opt/nvm"
  [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
elif [ -s "/opt/homebrew/opt/nvm/nvm.sh" ]; then
  export NVM_DIR="/opt/homebrew/opt/nvm"
  [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
fi

# Use nvm if available
if command -v nvm &> /dev/null || [ -n "$NVM_DIR" ]; then
  if [ -f ".nvmrc" ]; then
    nvm use
  else
    nvm use --lts || nvm use node || nvm use default
  fi
fi

echo "📦 Installing dependencies..."
if command -v pnpm &> /dev/null; then
  pnpm install
else
  echo "⚠️  pnpm not found. Installing pnpm globally..."
  npm install -g pnpm
  pnpm install
fi

echo ""
echo "✅ Development setup complete!"
echo ""
echo "To start both server and client in development mode:"
echo "  pnpm run dev"
echo ""
echo "Or start individually:"
echo "  sudo pnpm --filter @dns-server/server dev"
echo "  pnpm --filter @dns-server/client dev"
echo ""
echo "Dashboard will be available at: http://localhost:3000"
echo "API will be available at: http://localhost:3001"
echo ""
echo "For production deployment:"
echo "  sudo ./systemd/install.sh"
echo ""
