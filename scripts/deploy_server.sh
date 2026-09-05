#!/usr/bin/env bash
# Deploy TALPHA lên server 169.58.33.8 — CHẠY TRÊN SERVER, không chạy trên Mac.
#
#   ssh root@169.58.33.8 'bash /opt/talpha/scripts/deploy_server.sh'
#
# Thay cho lối rsync từng file trước đây. rsync từng file KHÔNG xoá file đã bị bỏ
# khỏi repo — đã dính 2 lần: daily.sh nguy hiểm (P0-B2) và ecosystem.config.js
# chết của dự án AUUS (F3) vẫn nằm lại trên server nhiều tuần sau khi xoá ở repo.
# `git pull` thì file xoá ở repo là mất trên server luôn.
#
# KHÔNG đụng tới file ngoài git: .env, node_modules, .next, .wwebjs_auth,
# state.json… đều nằm trong .gitignore nên git pull không ghi đè.
#
# Muốn xem trước mà không đổi gì: DRY_RUN=1 bash scripts/deploy_server.sh
set -euo pipefail

ROOT=${TALPHA_ROOT:-/opt/talpha}
DRY_RUN=${DRY_RUN:-0}

say() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
run() {
  if [ "$DRY_RUN" = "1" ]; then echo "[dry-run] $*"; else "$@"; fi
}

cd "$ROOT"

if [ ! -d .git ]; then
  echo "LỖI: $ROOT chưa phải git working copy — deploy git pull không dùng được." >&2
  echo "Xem hướng dẫn cutover trong ops/pm2/README.md." >&2
  exit 1
fi

say "1/4 Kéo code mới"
BEFORE=$(git rev-parse --short HEAD)
git fetch --quiet origin main
# --ff-only: server không được có commit riêng. Fail = có ai sửa tay trên server,
# phải xử lý bằng tay chứ đừng merge bừa.
run git merge --ff-only origin/main
AFTER=$(git rev-parse --short HEAD)

if [ "$BEFORE" = "$AFTER" ]; then
  echo "Không có commit mới (đang ở $AFTER). Vẫn restart để nạp lại env."
  CHANGED=""
else
  echo "$BEFORE -> $AFTER"
  CHANGED=$(git diff --name-only "$BEFORE" "$AFTER")
fi

say "2/4 Build dashboard (nếu cần)"
if [ -z "$CHANGED" ] || echo "$CHANGED" | grep -qE '^(dashboard-ui|config)/'; then
  cd "$ROOT/dashboard-ui"
  if [ -z "$CHANGED" ] || echo "$CHANGED" | grep -q '^dashboard-ui/package-lock.json$'; then
    run npm ci
  fi
  run npm run build
  cd "$ROOT"
else
  echo "Không đổi gì trong dashboard-ui/ hay config/ → bỏ qua build."
fi

say "3/4 Restart pm2 (chỉ namespace talpha)"
# `pm2 restart talpha` nhắm namespace, KHÔNG đụng auus1-* / pialpha-* trên cùng máy.
run pm2 restart talpha --update-env
run pm2 save

say "4/4 Kiểm tra"
if [ "$DRY_RUN" != "1" ]; then
  sleep 8
  code=$(curl -s -o /dev/null -w '%{http_code}' -m 20 http://localhost:3001/talpha || echo 000)
  echo "dashboard :3001/talpha -> HTTP $code"
  pm2 list | grep -E 'talpha-(dashboard|wa-alerts)' || true
  [ "$code" = "200" ] || [ "$code" = "307" ] || { echo "CẢNH BÁO: dashboard không trả 200/307" >&2; exit 1; }
fi

echo "Deploy xong: $(git rev-parse --short HEAD)"
