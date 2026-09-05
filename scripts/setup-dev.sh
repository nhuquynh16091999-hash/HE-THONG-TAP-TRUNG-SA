#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════
# FAOS — Developer Setup Script
# Chạy 1 lần sau khi clone repo:  bash scripts/setup-dev.sh
# ═══════════════════════════════════════════════════════════════════════
set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log()  { echo -e "${GREEN}✅ $1${NC}"; }
warn() { echo -e "${YELLOW}⚠️  $1${NC}"; }
fail() { echo -e "${RED}❌ $1${NC}"; exit 1; }

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║    FAOS Developer Environment Setup     ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# ─── 1. Python venv ───────────────────────────────────────────────────
if [ ! -d "venv" ]; then
  warn "Tạo Python venv..."
  python3 -m venv venv
fi
source venv/bin/activate
log "Python venv: $(python --version)"

# ─── 2. Python dependencies ───────────────────────────────────────────
warn "Cài Python dependencies..."
pip install -r requirements.txt -q
pip install pre-commit detect-secrets flake8 bandit -q
log "Python dependencies installed"

# ─── 3. Node dependencies ─────────────────────────────────────────────
if command -v npm &>/dev/null; then
  warn "Cài Node dependencies cho dashboard-ui..."
  cd dashboard-ui && npm ci -q && cd ..
  log "Node dependencies installed"
else
  warn "npm không tìm thấy — bỏ qua dashboard setup"
fi

# ─── 4. Pre-commit hooks ──────────────────────────────────────────────
warn "Cài pre-commit hooks vào .git/hooks/..."
pre-commit install
log "Pre-commit hooks installed"

# ─── 5. Secrets baseline ─────────────────────────────────────────────
if [ ! -f ".secrets.baseline" ]; then
  warn "Tạo secrets baseline..."
  detect-secrets scan > .secrets.baseline
  log "Secrets baseline created"
fi

# ─── 6. .env setup ────────────────────────────────────────────────────
if [ ! -f ".env" ]; then
  if [ -f ".env.example" ]; then
    cp .env.example .env
    warn ".env chưa có — đã copy từ .env.example. Điền thông tin thật vào trước khi chạy."
  fi
fi

# ─── Done ─────────────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════╗"
echo "║           Setup hoàn tất! 🎉            ║"
echo "╚══════════════════════════════════════════╝"
echo ""
echo "Từ giờ, mỗi lần commit sẽ tự động kiểm tra:"
echo "  • Không push thẳng lên main"
echo "  • File length limits (300 Python / 500 TS)"
echo "  • Architecture boundaries (không cross-import)"
echo "  • Syntax errors + undefined names"
echo "  • Secrets không bị commit"
echo ""
echo "Nếu hook báo lỗi → sửa rồi commit lại."
echo ""
