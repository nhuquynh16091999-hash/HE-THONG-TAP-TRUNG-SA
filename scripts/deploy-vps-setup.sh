#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════
# VPS SETUP — HNLE + ZEN8 Dashboard
# ═══════════════════════════════════════════════════════════
# Script này chạy TRÊN VPS (sau khi upload code bằng deploy-vps-pack.sh)
#
# Kết quả:
#   HNLE: http://164.68.101.179:3002/hnle
#   ZEN8: http://164.68.101.179:3002/zen8
#   Backend: http://164.68.101.179:8002
# ═══════════════════════════════════════════════════════════

set -euo pipefail

# ─── Config ───
VPS_IP="164.68.101.179"
APP_DIR="/opt/hnle"
FRONTEND_PORT=3002
BACKEND_PORT=8002
PM2_FRONTEND="hnle-zen8-frontend"
PM2_BACKEND="hnle-zen8-backend"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

info()    { echo -e "${BLUE}[INFO]${NC}  $1"; }
ok()      { echo -e "${GREEN}[ OK ]${NC}  $1"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $1"; }
fail()    { echo -e "${RED}[FAIL]${NC}  $1"; exit 1; }
section() { echo -e "\n${CYAN}═══ $1 ═══${NC}\n"; }

echo ""
echo "╔═══════════════════════════════════════════════════════╗"
echo "║  HNLE + ZEN8 Dashboard — VPS Setup                    ║"
echo "║  $(date '+%Y-%m-%d %H:%M:%S')                                 ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo ""

# ═══════════════════════════════════════════
# STEP 1: Create app directory
# ═══════════════════════════════════════════
section "STEP 1: Create app directory"

sudo mkdir -p "$APP_DIR"
sudo chown deploy:deploy "$APP_DIR"
ok "Directory $APP_DIR ready"

# ═══════════════════════════════════════════
# STEP 2: Extract code
# ═══════════════════════════════════════════
section "STEP 2: Extract code"

if [ ! -f /tmp/faos-dashboard.tar.gz ]; then
    fail "Code archive not found at /tmp/faos-dashboard.tar.gz. Chạy deploy-vps-pack.sh trước!"
fi

cd "$APP_DIR"
tar xzf /tmp/faos-dashboard.tar.gz
ok "Code extracted to $APP_DIR"

# ═══════════════════════════════════════════
# STEP 3: Deploy secrets
# ═══════════════════════════════════════════
section "STEP 3: Deploy secrets"

# .env
if [ -f /tmp/faos-env ]; then
    cp /tmp/faos-env "$APP_DIR/.env"
    chmod 600 "$APP_DIR/.env"
    ok ".env deployed (chmod 600)"
else
    warn "No .env found — backend may not work"
fi

# bigquery_key.json
if [ -f /tmp/faos-bq-key.json ]; then
    cp /tmp/faos-bq-key.json "$APP_DIR/bigquery_key.json"
    chmod 600 "$APP_DIR/bigquery_key.json"
    ok "bigquery_key.json deployed (chmod 600)"
else
    warn "No bigquery_key.json found — BQ queries will fail"
fi

# dashboard-ui/.env.local — create production config
section "STEP 3b: Create dashboard .env.local for production"

cat > "$APP_DIR/dashboard-ui/.env.local" << 'ENVEOF'
# ═══ Production Dashboard Config ═══
# BigQuery
NEXT_PUBLIC_BQ_PROJECT=levelup-465304
NEXT_PUBLIC_DATASET=HNLE_Dataset

# Backend API
NEXT_PUBLIC_API_URL=http://164.68.101.179:8002
NEXT_PUBLIC_WAR_ROOM_URL=http://164.68.101.179:8002

# Branding
NEXT_PUBLIC_APP_NAME=FAOS-Dashboard

# Auth — CRITICAL for production
NEXTAUTH_URL=http://164.68.101.179:3002
AUTH_TRUST_HOST=true
NEXTAUTH_SECRET=faos-hnle-zen8-production-secret-2026

# Dataset override (server-side)
DATASET=HNLE_Dataset
ENVEOF

chmod 600 "$APP_DIR/dashboard-ui/.env.local"
ok ".env.local created for production"

# If user uploaded their own .env.local, merge critical fields
if [ -f /tmp/faos-env-local ]; then
    info "User .env.local found — merging (keeping production AUTH settings)"
    # Keep user's BQ settings but ensure auth is correct
    grep -v "NEXTAUTH_URL\|AUTH_TRUST_HOST\|NEXTAUTH_SECRET" /tmp/faos-env-local > /tmp/faos-env-local-filtered 2>/dev/null || true
    if [ -s /tmp/faos-env-local-filtered ]; then
        # Prepend user settings, append our auth settings
        cat /tmp/faos-env-local-filtered > /tmp/faos-env-local-merged
        echo "" >> /tmp/faos-env-local-merged
        echo "# ═══ Production Auth (auto-added) ═══" >> /tmp/faos-env-local-merged
        echo "NEXTAUTH_URL=http://164.68.101.179:3002" >> /tmp/faos-env-local-merged
        echo "AUTH_TRUST_HOST=true" >> /tmp/faos-env-local-merged
        echo "NEXTAUTH_SECRET=faos-hnle-zen8-production-secret-2026" >> /tmp/faos-env-local-merged
        cp /tmp/faos-env-local-merged "$APP_DIR/dashboard-ui/.env.local"
        chmod 600 "$APP_DIR/dashboard-ui/.env.local"
        ok "Merged user .env.local with production auth settings"
    fi
fi

# ═══════════════════════════════════════════
# STEP 4: Python venv + dependencies
# ═══════════════════════════════════════════
section "STEP 4: Python backend setup"

cd "$APP_DIR"

if [ -f requirements.txt ]; then
    python3 -m venv venv
    source venv/bin/activate
    pip install --upgrade pip --quiet
    pip install -r requirements.txt --quiet 2>&1 | tail -5
    ok "Python venv + dependencies installed"

    # Test BQ connection
    info "Testing BigQuery connection..."
    GOOGLE_APPLICATION_CREDENTIALS="$APP_DIR/bigquery_key.json" python3 -c "
from google.cloud import bigquery
c = bigquery.Client()
print('  BQ OK:', list(c.query('SELECT 1 as ok').result())[0].ok)
" 2>&1 && ok "BigQuery connection verified" || warn "BQ connection failed — check bigquery_key.json"
else
    warn "requirements.txt not found — skipping Python setup"
fi

# ═══════════════════════════════════════════
# STEP 5: Build Next.js
# ═══════════════════════════════════════════
section "STEP 5: Build Next.js dashboard"

cd "$APP_DIR/dashboard-ui"

info "Installing npm dependencies..."
npm install --legacy-peer-deps 2>&1 | tail -3
ok "npm dependencies installed"

info "Building production bundle (this takes 1-3 minutes)..."
npm run build 2>&1 | tail -10
ok "Next.js build complete"

# ═══════════════════════════════════════════
# STEP 6: PM2 start services
# ═══════════════════════════════════════════
section "STEP 6: Start PM2 services"

# Install PM2 if not available
if ! command -v pm2 &>/dev/null; then
    info "Installing PM2..."
    sudo npm install -g pm2
    ok "PM2 installed"
fi

# Stop existing if any (safe — only touches our services)
pm2 delete "$PM2_FRONTEND" 2>/dev/null || true
pm2 delete "$PM2_BACKEND" 2>/dev/null || true

# Start Frontend on port 3002
info "Starting frontend on port $FRONTEND_PORT..."
pm2 start npm --name "$PM2_FRONTEND" \
    --cwd "$APP_DIR/dashboard-ui" \
    -- start -- -p $FRONTEND_PORT
ok "Frontend started: http://$VPS_IP:$FRONTEND_PORT"

# Start Backend on port 8002
if [ -f "$APP_DIR/faos_brain/api/main.py" ]; then
    info "Starting backend on port $BACKEND_PORT..."
    pm2 start "$APP_DIR/venv/bin/uvicorn" \
        --name "$PM2_BACKEND" \
        --cwd "$APP_DIR" \
        --interpreter none \
        -- faos_brain.api.main:app --host 0.0.0.0 --port $BACKEND_PORT
    ok "Backend started: http://$VPS_IP:$BACKEND_PORT"
else
    warn "Backend main.py not found — skipping backend start"
fi

# Save PM2 config
pm2 save
ok "PM2 config saved (auto-restart on reboot)"

# ═══════════════════════════════════════════
# STEP 7: Setup cron for syncs
# ═══════════════════════════════════════════
section "STEP 7: Cron jobs for data sync"

mkdir -p "$APP_DIR/logs"

# Add cron entries (only for HNLE/ZEN8, preserve existing entries)
CRON_MARKER="# === HNLE+ZEN8 syncs ==="
EXISTING_CRON=$(crontab -l 2>/dev/null || echo "")

if echo "$EXISTING_CRON" | grep -q "$CRON_MARKER"; then
    info "HNLE/ZEN8 cron entries already exist — skipping"
else
    info "Adding HNLE/ZEN8 cron entries..."
    (echo "$EXISTING_CRON"; cat << 'CRONEOF'

# === HNLE+ZEN8 syncs === DO NOT EDIT THIS BLOCK ===
# HNLE order sync — every 2 hours (incremental, fast)
0 */2 * * * cd /opt/hnle && source venv/bin/activate && GOOGLE_APPLICATION_CREDENTIALS=/opt/hnle/bigquery_key.json python3 -m sync.hnle.hnle_sync --orders >> /opt/hnle/logs/hnle_sync.log 2>&1

# HNLE sliding-window sync — every 6 hours, re-fetch last 14 days to catch status changes
# (POS đôi khi không bump updated_at khi đổi status DANG_GIAO→DON_HOAN → Smart Stop skip → phí ship sai)
15 */6 * * * cd /opt/hnle && source venv/bin/activate && GOOGLE_APPLICATION_CREDENTIALS=/opt/hnle/bigquery_key.json python3 -m sync.hnle.hnle_sync --orders --window-days 14 >> /opt/hnle/logs/hnle_sync.log 2>&1

# HNLE daily full sync — 3:00 AM UTC (orders + ads + stock + cogs)
0 3 * * * cd /opt/hnle && source venv/bin/activate && GOOGLE_APPLICATION_CREDENTIALS=/opt/hnle/bigquery_key.json python3 -m sync.hnle.hnle_sync >> /opt/hnle/logs/hnle_sync.log 2>&1

# ZEN8 order sync — every 2 hours (incremental, fast)
30 */2 * * * cd /opt/hnle && source venv/bin/activate && GOOGLE_APPLICATION_CREDENTIALS=/opt/hnle/bigquery_key.json python3 -m sync.zen8.zen8_sync --orders >> /opt/hnle/logs/zen8_sync.log 2>&1

# ZEN8 sliding-window sync — every 6 hours, re-fetch last 14 days
45 */6 * * * cd /opt/hnle && source venv/bin/activate && GOOGLE_APPLICATION_CREDENTIALS=/opt/hnle/bigquery_key.json python3 -m sync.zen8.zen8_sync --orders --window-days 14 >> /opt/hnle/logs/zen8_sync.log 2>&1

# ZEN8 daily full sync — 3:30 AM UTC
30 3 * * * cd /opt/hnle && source venv/bin/activate && GOOGLE_APPLICATION_CREDENTIALS=/opt/hnle/bigquery_key.json python3 -m sync.zen8.zen8_sync >> /opt/hnle/logs/zen8_sync.log 2>&1
# === END HNLE+ZEN8 syncs ===
CRONEOF
    ) | crontab -
    ok "Cron jobs installed"
fi

# ═══════════════════════════════════════════
# STEP 8: Cleanup + Verify
# ═══════════════════════════════════════════
section "STEP 8: Cleanup & Verify"

# Cleanup temp files
rm -f /tmp/faos-dashboard.tar.gz /tmp/faos-env /tmp/faos-bq-key.json /tmp/faos-env-local /tmp/faos-env-local-filtered /tmp/faos-env-local-merged
ok "Temp files cleaned"

# Verify services
echo ""
echo "─── PM2 Status ───"
pm2 status

echo ""
echo "─── HTTP Health Check ───"
sleep 3
curl -s -o /dev/null -w "  Frontend (port $FRONTEND_PORT): HTTP %{http_code}\n" "http://localhost:$FRONTEND_PORT/" 2>/dev/null || echo "  Frontend: starting up..."
curl -s -o /dev/null -w "  Backend  (port $BACKEND_PORT): HTTP %{http_code}\n" "http://localhost:$BACKEND_PORT/docs" 2>/dev/null || echo "  Backend: starting up..."

echo ""
echo "╔═══════════════════════════════════════════════════════════╗"
echo "║  DEPLOY COMPLETE!                                         ║"
echo "║                                                           ║"
echo "║  HNLE Dashboard:  http://$VPS_IP:$FRONTEND_PORT/hnle     ║"
echo "║  ZEN8 Dashboard:  http://$VPS_IP:$FRONTEND_PORT/zen8     ║"
echo "║  Backend API:     http://$VPS_IP:$BACKEND_PORT/docs      ║"
echo "║                                                           ║"
echo "║  Login: admin@faos.io (hoặc user trong config/users.json) ║"
echo "║                                                           ║"
echo "║  PM2 commands:                                            ║"
echo "║    pm2 logs $PM2_FRONTEND --lines 30                      ║"
echo "║    pm2 restart $PM2_FRONTEND                              ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo ""
