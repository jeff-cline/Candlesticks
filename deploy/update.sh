#!/usr/bin/env bash
# Pull latest main and restart.
set -euo pipefail
APP_DIR=/opt/candlesticks
git -C "$APP_DIR" fetch --all -q
git -C "$APP_DIR" reset --hard origin/main -q
sudo -u candlesticks bash -c "cd $APP_DIR && npm install --omit=dev --no-audit --no-fund"
systemctl restart candlesticks
sleep 2
systemctl is-active --quiet candlesticks && echo "✓ candlesticks restarted" || journalctl -u candlesticks -n 30 --no-pager
