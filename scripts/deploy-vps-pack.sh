#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════
# PACK & UPLOAD code lên VPS cho HNLE + ZEN8
# ═══════════════════════════════════════════════════════════
# Chạy script này TRÊN MÁY LOCAL (Git Bash), KHÔNG phải trên VPS
#
# Usage:
#   cd /c/Users/Admin/Desktop/Agentic-AI-Levelup
#   bash scripts/deploy-vps-pack.sh
# ═══════════════════════════════════════════════════════════

set -euo pipefail

# ─── Config ───
VPS_IP="164.68.101.179"
VPS_USER="deploy"
SSH_KEY="$HOME/.ssh/id_ed25519_thao"
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Detect OS for path handling
if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "cygwin" ]]; then
    # Git Bash on Windows
    PROJECT_DIR_NATIVE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -W)"
fi

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

info()  { echo -e "${BLUE}[INFO]${NC}  $1"; }
ok()    { echo -e "${GREEN}[ OK ]${NC}  $1"; }
fail()  { echo -e "${RED}[FAIL]${NC}  $1"; }

echo ""
echo "╔═══════════════════════════════════════════════════╗"
echo "║  FAOS — Pack & Upload to VPS                      ║"
echo "║  HNLE + ZEN8 Dashboard Deploy                      ║"
echo "╚═══════════════════════════════════════════════════╝"
echo ""

# ─── Pre-flight checks ───
if [ ! -f "$SSH_KEY" ]; then
    fail "SSH key not found: $SSH_KEY"
    echo "  Tạo SSH key trước:"
    echo "  ssh-keygen -t ed25519 -C \"thao-deploy-2026\" -f ~/.ssh/id_ed25519_thao -N \"\""
    exit 1
fi

# Test SSH connection
info "Testing SSH connection to $VPS_IP..."
if ssh -i "$SSH_KEY" -o ConnectTimeout=5 -o BatchMode=yes "$VPS_USER@$VPS_IP" "echo 'SSH OK'" 2>/dev/null; then
    ok "SSH connection successful"
else
    fail "Cannot SSH to $VPS_IP. Đã gửi public key cho chị Grace chưa?"
    exit 1
fi

# ─── Step 1: Pack code ───
info "Packing code (excluding secrets, node_modules, .next, venv)..."
cd "$PROJECT_DIR"

tar czf /tmp/faos-dashboard.tar.gz \
    --exclude='.git' \
    --exclude='node_modules' \
    --exclude='.next' \
    --exclude='__pycache__' \
    --exclude='venv' \
    --exclude='.venv' \
    --exclude='.env' \
    --exclude='.env.local' \
    --exclude='bigquery_key.json' \
    --exclude='*.log' \
    --exclude='tsconfig.tsbuildinfo' \
    --exclude='logs' \
    --exclude='.auto-memory' \
    --exclude='memory-bank' \
    .

ok "Code packed: $(du -h /tmp/faos-dashboard.tar.gz | cut -f1)"

# ─── Step 2: Upload code ───
info "Uploading code to VPS..."
scp -i "$SSH_KEY" /tmp/faos-dashboard.tar.gz "$VPS_USER@$VPS_IP:/tmp/"
ok "Code uploaded"

# ─── Step 3: Upload secrets ───
info "Uploading secrets..."

# .env (backend)
if [ -f "$PROJECT_DIR/.env" ]; then
    scp -i "$SSH_KEY" "$PROJECT_DIR/.env" "$VPS_USER@$VPS_IP:/tmp/faos-env"
    ok "Uploaded .env"
else
    fail ".env not found at $PROJECT_DIR/.env"
    exit 1
fi

# bigquery_key.json
if [ -f "$PROJECT_DIR/bigquery_key.json" ]; then
    scp -i "$SSH_KEY" "$PROJECT_DIR/bigquery_key.json" "$VPS_USER@$VPS_IP:/tmp/faos-bq-key.json"
    ok "Uploaded bigquery_key.json"
else
    fail "bigquery_key.json not found"
    exit 1
fi

# dashboard .env.local (will be created on VPS if not exists)
if [ -f "$PROJECT_DIR/dashboard-ui/.env.local" ]; then
    scp -i "$SSH_KEY" "$PROJECT_DIR/dashboard-ui/.env.local" "$VPS_USER@$VPS_IP:/tmp/faos-env-local"
    ok "Uploaded dashboard-ui/.env.local"
else
    info "No local .env.local found — will create on VPS"
fi

# ─── Step 4: Upload setup script ───
info "Uploading VPS setup script..."
scp -i "$SSH_KEY" "$PROJECT_DIR/scripts/deploy-vps-setup.sh" "$VPS_USER@$VPS_IP:/tmp/deploy-vps-setup.sh"
ok "Setup script uploaded"

# ─── Step 5: Run setup on VPS ───
echo ""
echo "╔═══════════════════════════════════════════════════╗"
echo "║  Upload complete! Now run setup on VPS:            ║"
echo "╚═══════════════════════════════════════════════════╝"
echo ""
echo -e "  ${YELLOW}ssh -i $SSH_KEY $VPS_USER@$VPS_IP${NC}"
echo -e "  ${YELLOW}bash /tmp/deploy-vps-setup.sh${NC}"
echo ""
echo "  Hoặc chạy 1 lệnh:"
echo -e "  ${YELLOW}ssh -i $SSH_KEY $VPS_USER@$VPS_IP 'bash /tmp/deploy-vps-setup.sh'${NC}"
echo ""

# Cleanup local temp
rm -f /tmp/faos-dashboard.tar.gz
ok "Local temp cleaned"
