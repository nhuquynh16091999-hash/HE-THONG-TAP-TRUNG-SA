#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
# FAOS v6 — Production Deployment Script
# ═══════════════════════════════════════════════════════════════════
# Deploys the full FAOS v6 stack:
#   1. FalkorDB (Docker)
#   2. Backend API (uvicorn + PM2)
#   3. Frontend Dashboard (Next.js + PM2)
#   4. Crontab schedule (08:00/18:00/21:00)
#
# Usage:
#   chmod +x deploy.sh
#   ./deploy.sh
#
# Prerequisites:
#   - .env file configured
#   - GOOGLE_APPLICATION_CREDENTIALS set
#   - Node.js + npm installed
# ═══════════════════════════════════════════════════════════════════

set -euo pipefail

# ─── Config ───
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="${PROJECT_DIR}/logs/deploy"
VENV_DIR="${PROJECT_DIR}/.venv"
DASHBOARD_DIR="${PROJECT_DIR}/dashboard-ui"

# ─── Colors ───
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

info()    { echo -e "${BLUE}[INFO]${NC}  $1"; }
ok()      { echo -e "${GREEN}[ OK ]${NC}  $1"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $1"; }
fail()    { echo -e "${RED}[FAIL]${NC}  $1"; }
section() { echo -e "\n${CYAN}═══════════════════════════════════════════${NC}"; echo -e "${CYAN}  $1${NC}"; echo -e "${CYAN}═══════════════════════════════════════════${NC}\n"; }

mkdir -p "${LOG_DIR}"

echo ""
echo "╔═══════════════════════════════════════════════╗"
echo "║    FAOS v6 — Production Deployment            ║"
echo "║    $(date '+%Y-%m-%d %H:%M:%S')                        ║"
echo "╚═══════════════════════════════════════════════╝"
echo ""

# ═══════════════════════════════════════════
# STEP 1: Docker + FalkorDB
# ═══════════════════════════════════════════
section "STEP 1: Docker + FalkorDB"

# Check Docker
if command -v docker &>/dev/null; then
    ok "Docker is installed: $(docker --version)"
else
    fail "Docker not found. Please install Docker first."
    echo "  → https://docs.docker.com/get-docker/"
    exit 1
fi

# Check if Docker daemon is running
if docker info &>/dev/null; then
    ok "Docker daemon is running"
else
    fail "Docker daemon is not running. Please start Docker Desktop."
    exit 1
fi

# Start FalkorDB
if docker ps --format '{{.Names}}' | grep -q "^falkordb$"; then
    ok "FalkorDB container already running"
elif docker ps -a --format '{{.Names}}' | grep -q "^falkordb$"; then
    info "FalkorDB container exists but stopped. Starting..."
    docker start falkordb
    ok "FalkorDB started"
else
    info "Creating FalkorDB container..."
    docker run -d \
        -p 6379:6379 \
        -p 3000:3000 \
        --name falkordb \
        --restart unless-stopped \
        -v falkordb_data:/data \
        falkordb/falkordb:latest
    ok "FalkorDB container created and running"
fi

# Verify FalkorDB
sleep 2
if docker exec falkordb redis-cli PING 2>/dev/null | grep -q "PONG"; then
    ok "FalkorDB responding to PING → PONG"
else
    warn "FalkorDB not responding yet, may need a few more seconds"
fi

# ═══════════════════════════════════════════
# STEP 2: Backend Dependencies
# ═══════════════════════════════════════════
section "STEP 2: Backend Dependencies"

# Create venv if needed
if [ ! -d "${VENV_DIR}" ]; then
    info "Creating Python virtual environment..."
    python3 -m venv "${VENV_DIR}"
    ok "Virtual environment created"
else
    ok "Virtual environment already exists"
fi

# Install dependencies
info "Installing Python dependencies..."
source "${VENV_DIR}/bin/activate"
pip install -r "${PROJECT_DIR}/requirements.txt" --quiet 2>&1 | tail -3
ok "Python dependencies installed"

# Initialize graph schema
info "Initializing FalkorDB graph schema..."
python -c "
from faos_brain.graph.connection import FalkorDBConnection
from faos_brain.graph.schema import create_graph_schema
try:
    conn = FalkorDBConnection()
    conn.connect()
    result = create_graph_schema(conn)
    print(f'  Schema: {result[\"indexes_created\"]} created, {result[\"indexes_skipped\"]} skipped')
except Exception as e:
    print(f'  Warning: {e} (will retry on first run)')
" 2>&1
ok "Graph schema initialized"

# ═══════════════════════════════════════════
# STEP 3: Frontend Dependencies
# ═══════════════════════════════════════════
section "STEP 3: Frontend Dashboard"

cd "${DASHBOARD_DIR}"

info "Installing Node.js dependencies..."
npm install --silent 2>&1 | tail -3
ok "npm dependencies installed"

info "Building production bundle..."
npx next build 2>&1 | tail -5
ok "Next.js production build complete"

cd "${PROJECT_DIR}"

# ═══════════════════════════════════════════
# STEP 4: PM2 Process Manager
# ═══════════════════════════════════════════
section "STEP 4: PM2 Process Manager"

# Install PM2
if command -v pm2 &>/dev/null; then
    ok "PM2 already installed: $(pm2 --version)"
else
    info "Installing PM2 globally..."
    npm install -g pm2
    ok "PM2 installed"
fi

# Stop existing processes (if any)
pm2 delete faos-backend 2>/dev/null || true
pm2 delete faos-frontend 2>/dev/null || true

# Start Backend API
info "Starting Backend API (uvicorn)..."
cd "${PROJECT_DIR}"
pm2 start "${VENV_DIR}/bin/uvicorn" \
    --name "faos-backend" \
    --cwd "${PROJECT_DIR}" \
    -- faos_brain.api.main:app --host 0.0.0.0 --port 8000
ok "Backend API started on :8000"

# Start Frontend Dashboard
info "Starting Frontend Dashboard (Next.js)..."
pm2 start npm \
    --name "faos-frontend" \
    --cwd "${DASHBOARD_DIR}" \
    -- start
ok "Frontend Dashboard started on :3000"

# Save PM2 config
pm2 save
ok "PM2 process list saved"

# Setup PM2 startup (auto-restart on reboot)
info "Setting up PM2 startup hook..."
pm2 startup 2>&1 | grep "sudo" || ok "PM2 startup already configured"
ok "PM2 startup configured"

# ═══════════════════════════════════════════
# STEP 5: Crontab Schedule
# ═══════════════════════════════════════════
section "STEP 5: Crontab Schedule"

SCRIPT_PATH="${PROJECT_DIR}/start_dry_run_cycle.sh"
chmod +x "${SCRIPT_PATH}"

# Build cron entries
CRON_DAILY="0 8 * * * cd ${PROJECT_DIR} && ${SCRIPT_PATH} daily stramark >> ${LOG_DIR}/cron_daily.log 2>&1"
CRON_REFLECT="0 18 * * * cd ${PROJECT_DIR} && ${SCRIPT_PATH} reflection stramark >> ${LOG_DIR}/cron_reflection.log 2>&1"
CRON_CAPI="0 21 * * * cd ${PROJECT_DIR} && ${SCRIPT_PATH} capi stramark >> ${LOG_DIR}/cron_capi.log 2>&1"

# Remove existing FAOS entries, then add new
(crontab -l 2>/dev/null | grep -v "start_dry_run_cycle" | grep -v "faos_brain") | crontab - 2>/dev/null || true
(crontab -l 2>/dev/null; echo "${CRON_DAILY}"; echo "${CRON_REFLECT}"; echo "${CRON_CAPI}") | crontab -

ok "Crontab installed:"
echo "   08:00 → Full Daily (Analyst + Director) --dry-run"
echo "   18:00 → Reflection (T+1 Accuracy)"
echo "   21:00 → CAPI Push (POS → Meta)"

# ═══════════════════════════════════════════
# STEP 6: Final Verification
# ═══════════════════════════════════════════
section "STEP 6: Verification"

echo "─── PM2 Status ───"
pm2 status

echo ""
echo "─── Crontab ───"
crontab -l 2>/dev/null | grep -v "^#" | grep "." || echo "(empty)"

echo ""
echo "─── Docker ───"
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" | grep -E "NAME|falkordb"

echo ""
echo "╔═══════════════════════════════════════════════╗"
echo "║  ✅ FAOS v6 DEPLOYMENT COMPLETE               ║"
echo "║                                               ║"
echo "║  Backend:   http://localhost:8000              ║"
echo "║  Frontend:  http://localhost:3000              ║"
echo "║  FalkorDB:  localhost:6379                     ║"
echo "║  Browser:   http://localhost:3000              ║"
echo "║                                               ║"
echo "║  5-Day DRY_RUN starts tomorrow 08:00          ║"
echo "╚═══════════════════════════════════════════════╝"
