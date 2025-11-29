#!/bin/bash

echo "🚀 DNS Server Setup Script"
echo "=========================="
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
  echo "⚠️  Note: The DNS server will need sudo/root privileges to bind to port 53"
  echo ""
fi

echo "📦 Installing server dependencies..."
cd server
if command -v bun &> /dev/null; then
  bun install
else
  npm install
fi

echo ""
echo "📦 Installing client dependencies..."
cd ../client
if command -v bun &> /dev/null; then
  bun install
else
  npm install
fi

echo ""
echo "✅ Setup complete!"
echo ""
echo "To start the DNS server:"
echo "  cd server"
echo "  sudo npm run dev    (or: sudo bun run dev)"
echo ""
echo "To start the dashboard (in another terminal):"
echo "  cd client"
echo "  npm run dev         (or: bun run dev)"
echo ""
echo "Dashboard will be available at: http://localhost:3000"
echo "API will be available at: http://localhost:3001"
echo ""
