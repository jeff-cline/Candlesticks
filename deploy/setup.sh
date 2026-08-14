#!/usr/bin/env bash
# Candlesticks.ai — provision the Vultr box (Ubuntu 22.04/24.04)
#
#   ssh root@137.220.56.129
#   curl -fsSL https://raw.githubusercontent.com/jeff-cline/Candlesticks/main/deploy/setup.sh | bash
#
# Idempotent: safe to re-run.

set -euo pipefail

DOMAIN="${DOMAIN:-candlesticks.ai}"
EMAIL="${LE_EMAIL:-jeff.cline@me.com}"
APP_DIR="/opt/candlesticks"
REPO="https://github.com/jeff-cline/Candlesticks.git"
NODE_MAJOR=22

log() { printf "\n\033[1;34m▸ %s\033[0m\n" "$1"; }

log "System packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl git ufw nginx ca-certificates gnupg

log "Node.js ${NODE_MAJOR}"
if ! command -v node >/dev/null || [ "$(node -v | cut -c2- | cut -d. -f1)" -lt "$NODE_MAJOR" ]; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y -qq nodejs
fi
node --version

log "Application user"
id -u candlesticks >/dev/null 2>&1 || useradd --system --create-home --shell /bin/bash candlesticks

log "Source"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" fetch --all -q && git -C "$APP_DIR" reset --hard origin/main -q
else
  git clone -q "$REPO" "$APP_DIR"
fi
chown -R candlesticks:candlesticks "$APP_DIR"

log "Dependencies"
sudo -u candlesticks bash -c "cd $APP_DIR && npm ci --omit=dev --no-audit --no-fund 2>/dev/null || npm install --omit=dev --no-audit --no-fund"

log "Environment"
if [ ! -f "$APP_DIR/.env" ]; then
  cp "$APP_DIR/.env.example" "$APP_DIR/.env"
  SECRET=$(openssl rand -hex 32)
  sed -i "s|^SESSION_SECRET=.*|SESSION_SECRET=${SECRET}|" "$APP_DIR/.env"
  sed -i "s|^NODE_ENV=.*|NODE_ENV=production|" "$APP_DIR/.env"
  chown candlesticks:candlesticks "$APP_DIR/.env"
  chmod 600 "$APP_DIR/.env"
  echo "  Created .env — edit it to add SMTP and Tradovate credentials."
else
  echo "  .env exists, leaving it alone."
fi

log "Database seed"
sudo -u candlesticks bash -c "cd $APP_DIR && npm run seed"

log "systemd service"
cp "$APP_DIR/deploy/candlesticks.service" /etc/systemd/system/candlesticks.service
systemctl daemon-reload
systemctl enable --now candlesticks
sleep 2
systemctl is-active --quiet candlesticks && echo "  Service running." || { journalctl -u candlesticks -n 30 --no-pager; exit 1; }

log "nginx"
sed "s/DOMAIN_PLACEHOLDER/${DOMAIN}/g" "$APP_DIR/deploy/nginx.conf" > /etc/nginx/sites-available/candlesticks
ln -sf /etc/nginx/sites-available/candlesticks /etc/nginx/sites-enabled/candlesticks
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

log "Firewall"
ufw allow OpenSSH >/dev/null
ufw allow 'Nginx Full' >/dev/null
ufw --force enable >/dev/null
ufw status numbered

log "TLS"
if host "$DOMAIN" >/dev/null 2>&1; then
  apt-get install -y -qq certbot python3-certbot-nginx
  certbot --nginx -d "$DOMAIN" -d "www.${DOMAIN}" \
    --non-interactive --agree-tos -m "$EMAIL" --redirect || \
    echo "  certbot failed — check DNS, then re-run: certbot --nginx -d $DOMAIN"
else
  cat <<EOF

  ⚠  ${DOMAIN} does not resolve yet, so TLS was skipped.

     In the Vultr control panel: Products → Network → DNS → Add Domain
       Domain: ${DOMAIN}
       A     @      137.220.56.129
       A     www    137.220.56.129

     Then re-run:  certbot --nginx -d ${DOMAIN} -d www.${DOMAIN}
EOF
fi

log "Done"
echo "  Service:  systemctl status candlesticks"
echo "  Logs:     journalctl -u candlesticks -f"
echo "  Update:   bash ${APP_DIR}/deploy/update.sh"
