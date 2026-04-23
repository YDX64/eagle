#!/usr/bin/env bash
# Install the probet-tracking cron file on AWAXX. Idempotent.
#
# Run from AWAXX (the script resolves its own location):
#   sudo bash /opt/probet/scripts/install-cron.sh
#
# Run from the laptop via SSH:
#   ssh AWAXX "sudo bash /opt/probet/scripts/install-cron.sh"

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SRC="$SCRIPT_DIR/cron-probet-tracking"
DEST="/etc/cron.d/probet-tracking"
LOG_DIR="/var/log/probet-tracking"
ENV_FILE="/opt/probet/.env"

echo "[cron] installing $SRC → $DEST"

if [ ! -f "$SRC" ]; then
  echo "[cron] missing source file $SRC" >&2
  exit 1
fi

# Make sure CRON_SECRET exists in /opt/probet/.env — if not, generate one
if ! grep -q '^CRON_SECRET=' "$ENV_FILE"; then
  SECRET=$(head -c 32 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 32)
  echo "CRON_SECRET=$SECRET" >> "$ENV_FILE"
  echo "[cron] generated CRON_SECRET in $ENV_FILE — you MUST rebuild probet-app so the container picks it up"
  NEED_REBUILD=1
else
  echo "[cron] CRON_SECRET already present"
fi

# Make sure CRON_SECRET is forwarded into the container
if ! grep -q 'CRON_SECRET:' /opt/probet/docker-compose.yml; then
  # Insert after TRACKING_DATABASE_URL line
  sed -i '/TRACKING_DATABASE_URL:/a\      CRON_SECRET: ${CRON_SECRET}' /opt/probet/docker-compose.yml
  echo "[cron] added CRON_SECRET to docker-compose.yml"
  NEED_REBUILD=1
fi

mkdir -p "$LOG_DIR"
chown root:root "$LOG_DIR"

cp "$SRC" "$DEST"
chmod 0644 "$DEST"
chown root:root "$DEST"

# Reload cron service (Ubuntu/Debian uses 'cron', RHEL uses 'crond')
if systemctl list-unit-files | grep -q '^cron\.service'; then
  systemctl reload cron || systemctl restart cron
elif systemctl list-unit-files | grep -q '^crond\.service'; then
  systemctl reload crond || systemctl restart crond
else
  service cron reload 2>/dev/null || service crond reload 2>/dev/null || true
fi

echo "[cron] installed. Active jobs:"
crontab -l 2>/dev/null || true
cat "$DEST"

if [ "${NEED_REBUILD:-0}" = "1" ]; then
  echo
  echo "[cron] NEXT STEP: rebuild probet-app to pick up new env:"
  echo "  cd /opt/probet && docker compose up -d --build probet-app"
fi
