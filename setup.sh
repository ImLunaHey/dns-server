#!/bin/bash

echo "🚀 DNS Server Setup Script"
echo "=========================="
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
  echo "⚠️  Note: The DNS server will need sudo/root privileges to bind to port 53"
  echo ""
fi

echo "📦 Installing dependencies..."
if command -v pnpm &> /dev/null; then
  pnpm install
else
  echo "⚠️  pnpm not found. Please install pnpm: npm install -g pnpm"
  exit 1
fi

echo ""
echo "✅ Setup complete!"
echo ""
echo "To start both server and client:"
echo "  pnpm run dev"
echo ""
echo "Or start individually:"
echo "  sudo pnpm --filter @dns-server/server dev"
echo "  pnpm --filter @dns-server/client dev"
echo ""
echo "Dashboard will be available at: http://localhost:3000"
echo "API will be available at: http://localhost:3001"
echo ""
