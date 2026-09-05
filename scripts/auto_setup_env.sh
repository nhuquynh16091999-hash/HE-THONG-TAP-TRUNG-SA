#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════
# FAOS v6 — AUTO SETUP ENVIRONMENT (1-Click cho Leader)
# ═══════════════════════════════════════════════════════
# Usage: chmod +x scripts/auto_setup_env.sh && ./scripts/auto_setup_env.sh
# ═══════════════════════════════════════════════════════

set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; MAGENTA='\033[0;35m'; CYAN='\033[0;36m'
BOLD='\033[1m'; NC='\033[0m'

ok()   { echo -e "  ${GREEN}✅ $1${NC}"; }
warn() { echo -e "  ${YELLOW}⚠️  $1${NC}"; }
err()  { echo -e "  ${RED}❌ $1${NC}"; }
info() { echo -e "  ${BLUE}ℹ️  $1${NC}"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
TOTAL=6

echo ""
echo -e "${MAGENTA}═══════════════════════════════════════════════${NC}"
echo -e "${BOLD}${MAGENTA}  🚀 FAOS v6 — AUTO SETUP ENVIRONMENT${NC}"
echo -e "${MAGENTA}═══════════════════════════════════════════════${NC}"
echo -e "${BLUE}📁 Root: ${BOLD}${PROJECT_ROOT}${NC}"
echo ""

# ─── STEP 1: Python 3.10+ ───
echo -e "${CYAN}[1/$TOTAL]${NC} ${BOLD}Kiểm tra Python...${NC}"
if command -v python3 &>/dev/null; then
    PY_VER=$(python3 --version 2>&1 | awk '{print $2}')
    PY_MAJ=$(echo "$PY_VER" | cut -d. -f1)
    PY_MIN=$(echo "$PY_VER" | cut -d. -f2)
    if [ "$PY_MAJ" -ge 3 ] && [ "$PY_MIN" -ge 10 ]; then
        ok "Python $PY_VER ✓"
    else
        err "Python $PY_VER — Cần 3.10+! → brew install python@3.12"; exit 1
    fi
else
    err "Python3 chưa cài! → https://python.org/downloads/"; exit 1
fi

# ─── STEP 2: Node.js 18+ ───
echo -e "${CYAN}[2/$TOTAL]${NC} ${BOLD}Kiểm tra Node.js...${NC}"
if command -v node &>/dev/null; then
    NODE_VER=$(node --version | sed 's/v//')
    NODE_MAJ=$(echo "$NODE_VER" | cut -d. -f1)
    if [ "$NODE_MAJ" -ge 18 ]; then
        ok "Node.js v$NODE_VER ✓"
        ok "npm v$(npm --version) ✓"
    else
        err "Node.js v$NODE_VER — Cần 18+! → nvm install 20"; exit 1
    fi
else
    err "Node.js chưa cài! → https://nodejs.org/"; exit 1
fi

# ─── STEP 3: Python venv + pip install ───
echo -e "${CYAN}[3/$TOTAL]${NC} ${BOLD}Tạo Python Virtual Environment...${NC}"
cd "$PROJECT_ROOT"
if [ -d ".venv" ]; then
    warn ".venv đã tồn tại — bỏ qua tạo mới"
else
    python3 -m venv .venv
    ok "Tạo .venv thành công"
fi
source .venv/bin/activate
ok "Activated .venv ($(python3 --version))"

if [ -f "requirements.txt" ]; then
    echo -e "  ${BLUE}📦 Cài đặt Python dependencies...${NC}"
    pip install --upgrade pip --quiet
    pip install -r requirements.txt --quiet
    ok "requirements.txt installed"
else
    warn "Không tìm thấy requirements.txt"
fi

# ─── STEP 4: Frontend npm install ───
echo -e "${CYAN}[4/$TOTAL]${NC} ${BOLD}Cài đặt Frontend dependencies...${NC}"
if [ -d "$PROJECT_ROOT/dashboard-ui" ] && [ -f "$PROJECT_ROOT/dashboard-ui/package.json" ]; then
    cd "$PROJECT_ROOT/dashboard-ui"
    echo -e "  ${BLUE}📦 npm install...${NC}"
    npm install --silent 2>/dev/null
    ok "npm install thành công"
    cd "$PROJECT_ROOT"
else
    warn "dashboard-ui/package.json không tồn tại — bỏ qua"
fi

# ─── STEP 5: .env setup ───
echo -e "${CYAN}[5/$TOTAL]${NC} ${BOLD}Thiết lập .env...${NC}"
cd "$PROJECT_ROOT"
if [ -f ".env" ]; then
    warn ".env đã tồn tại — KHÔNG ghi đè"
elif [ -f ".env.example" ]; then
    cp .env.example .env
    ok "Copied .env.example → .env"
else
    err "Không tìm thấy .env.example — liên hệ Boss"
fi

# ─── STEP 6: Project directories ───
echo -e "${CYAN}[6/$TOTAL]${NC} ${BOLD}Tạo cấu trúc thư mục dự án...${NC}"
echo -e "${BOLD}Nhập tên dự án (vd: auus1, zen8):${NC}"
read -r PROJ
PROJ=${PROJ:-template_project}

for d in \
    "app/projects/${PROJ}/sync" \
    "app/projects/${PROJ}/components" \
    "app/projects/${PROJ}/hooks" \
    "app/projects/${PROJ}/types" \
    "sql/${PROJ}/tables" \
    "sql/${PROJ}/views" \
    "api/routers/${PROJ}" \
    "sync/${PROJ}" \
    "docs/designs/${PROJ}" \
    "dashboard-ui/src/app/projects/${PROJ}"; do
    mkdir -p "$PROJECT_ROOT/$d"
done

touch "$PROJECT_ROOT/app/projects/${PROJ}/__init__.py"
touch "$PROJECT_ROOT/api/routers/${PROJ}/__init__.py"
touch "$PROJECT_ROOT/sync/${PROJ}/__init__.py"
ok "Tạo cấu trúc thư mục cho ${PROJ^^}"

# ─── SUMMARY ───
echo ""
echo -e "${MAGENTA}═══════════════════════════════════════════════${NC}"
echo -e "${BOLD}${GREEN}  ✅ SETUP HOÀN TẤT!${NC}"
echo -e "${MAGENTA}═══════════════════════════════════════════════${NC}"
echo ""
echo -e "  ${YELLOW}1.${NC} Mở ${CYAN}.env${NC} và điền:"
echo -e "     META_ACCESS_TOKEN, META_AD_ACCOUNT_IDS"
echo -e "     GEMINI_API_KEY, OPENAI_API_KEY"
echo -e "     PROJECT_ID=${PROJ}, BQ_DATASET=${PROJ^^}_Dataset"
echo ""
echo -e "  ${YELLOW}2.${NC} Đọc: ${CYAN}docs/TRAINING_MANUAL.md${NC}"
echo -e "  ${YELLOW}3.${NC} Git:  ${CYAN}git checkout -b feature/${PROJ}-[feature]${NC}"
echo -e "  ${YELLOW}4.${NC} AI:   Copy ${CYAN}docs/LEADER_AI_ONBOARDING_PROMPT.md${NC} vào chat"
echo ""
echo -e "${BOLD}  🎯 Dự án: ${GREEN}${PROJ^^}${NC} | 📁 ${GREEN}${PROJECT_ROOT}${NC}"
echo -e "${BOLD}${BLUE}  Chúc Leader code vui vẻ! 🚀${NC}"
echo ""
