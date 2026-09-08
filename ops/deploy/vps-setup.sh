#!/usr/bin/env bash
#
# Dựng dashboard TALPHA trên máy chủ Ubuntu/Debian sạch.
#
# Chạy TRÊN MÁY CHỦ, một lần duy nhất:
#     bash vps-setup.sh
#
# Sau đó mỗi lần cập nhật code chỉ cần:
#     bash ops/deploy/vps-deploy.sh
#
# KHÔNG chứa mật khẩu hay khoá nào. Secrets đi riêng bằng scp — xem
# docs/DEPLOY_VPS.md.
set -euo pipefail

REPO_URL="${REPO_URL:-git@github.com:nhuquynh16091999-hash/HE-THONG-TAP-TRUNG-SA.git}"
APP_DIR="${APP_DIR:-/opt/talpha}"
NODE_MAJOR="${NODE_MAJOR:-22}"
PORT="${PORT:-3000}"

say() { printf '\n\033[1;33m▸ %s\033[0m\n' "$*"; }

# ─────────────────────────────────────────────────────────────────────────
say "1/7 · Gói hệ thống"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl git ca-certificates gnupg ufw python3 python3-venv python3-pip

# ─────────────────────────────────────────────────────────────────────────
say "2/7 · Node.js $NODE_MAJOR"
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | cut -c2- | cut -d. -f1)" -lt "$NODE_MAJOR" ]; then
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
    apt-get install -y -qq nodejs
fi
node -v && npm -v

# ─────────────────────────────────────────────────────────────────────────
say "3/7 · pm2"
npm install -g pm2 --silent
pm2 -v

# ─────────────────────────────────────────────────────────────────────────
say "4/7 · Mã nguồn → $APP_DIR"
# Khoá deploy phải được cài trước (ssh -T git@github.com phải chào đúng tên).
if [ -d "$APP_DIR/.git" ]; then
    git -C "$APP_DIR" fetch --all --prune
    git -C "$APP_DIR" reset --hard origin/main
else
    mkdir -p "$(dirname "$APP_DIR")"
    git clone --depth 50 "$REPO_URL" "$APP_DIR"
fi
git -C "$APP_DIR" log --oneline -1

# ─────────────────────────────────────────────────────────────────────────
say "5/7 · Cài gói và dựng bản chạy"
cd "$APP_DIR/dashboard-ui"
if [ ! -f .env.local ]; then
    echo "!! THIẾU dashboard-ui/.env.local — chép lên trước rồi chạy lại." >&2
    echo "   scp dashboard-ui/.env.local root@<ip>:$APP_DIR/dashboard-ui/.env.local" >&2
    exit 1
fi
npm ci --no-audit --no-fund
npm run build

# ─────────────────────────────────────────────────────────────────────────
say "6/7 · pm2 khởi chạy + bật lại khi máy reboot"
cd "$APP_DIR"
pm2 delete talpha-dashboard >/dev/null 2>&1 || true
pm2 start ops/pm2/ecosystem.vps.config.js --only talpha-dashboard
pm2 save
pm2 startup systemd -u root --hp /root | tail -1 | bash || true

# ─────────────────────────────────────────────────────────────────────────
say "7/7 · Tường lửa"
# Mở đúng SSH + cổng app. KHÔNG bật ufw trước khi cho phép SSH — làm ngược
# thứ tự là tự khoá mình ra ngoài, phải vào console của nhà cung cấp mới gỡ.
ufw allow 22/tcp   >/dev/null
ufw allow "$PORT"/tcp >/dev/null
ufw --force enable >/dev/null
ufw status numbered

say "XONG"
echo "   Kiểm tra:  curl -I http://127.0.0.1:$PORT/login"
echo "   Nhật ký :  pm2 logs talpha-dashboard"
