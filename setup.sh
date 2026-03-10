#!/bin/bash
# DigitalOcean Droplet setup script for inventory-bot
# Run as root on a fresh Ubuntu 22.04/24.04 droplet

set -e

echo "=== 1. Updating system ==="
apt update && apt upgrade -y

echo "=== 2. Installing Node.js 20 ==="
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

echo "=== 3. Installing pm2 globally ==="
npm install -g pm2

echo "=== 4. Creating app user ==="
useradd -m -s /bin/bash botuser || echo "User botuser already exists"

echo "=== 5. Setting up project ==="
cd /home/botuser
if [ ! -d "inventory-bot" ]; then
  echo "Clone your repo or copy project files to /home/botuser/inventory-bot"
  echo "Then run the following commands as botuser:"
  echo ""
  echo "  cd /home/botuser/inventory-bot"
  echo "  npm install"
  echo "  npm run build"
  echo "  cp .env.example .env   # then edit .env with your values"
  echo "  pm2 start ecosystem.config.js"
  echo "  pm2 save"
  echo "  pm2 startup"
  exit 0
fi

cd inventory-bot
chown -R botuser:botuser /home/botuser/inventory-bot

su - botuser -c "cd /home/botuser/inventory-bot && npm install && npm run build"

echo ""
echo "=== Setup complete ==="
echo ""
echo "Next steps:"
echo "1. Create .env file:  nano /home/botuser/inventory-bot/.env"
echo "2. Start bot:         su - botuser -c 'cd ~/inventory-bot && pm2 start ecosystem.config.js'"
echo "3. Save pm2:          su - botuser -c 'pm2 save'"
echo "4. Auto-start:        env PATH=\$PATH:/usr/bin pm2 startup systemd -u botuser --hp /home/botuser"
echo ""
