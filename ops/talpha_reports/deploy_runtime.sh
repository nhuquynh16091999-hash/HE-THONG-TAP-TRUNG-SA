#!/bin/bash
# ═══════════════════════════════════════════════════════════════════
# TALPHA — deploy MỘT CHIỀU repo → runtime (~/talpha_reports)
# Quy trình mới (P1, 29/07/2026): SỬA Ở REPO (ops/talpha_reports/ + config/),
# rồi chạy script này. KHÔNG sửa tay file trong ~/talpha_reports nữa.
# An toàn: giữ .lock trong lúc thay file (không đụng vòng launchd đang chạy),
# backup bản cũ, in diff checksum trước khi ghi.
# ═══════════════════════════════════════════════════════════════════
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
SRC="$REPO/ops/talpha_reports"
DST="$HOME/talpha_reports"
STAMP="$(date +%Y%m%d-%H%M%S)"

# file deploy: (nguồn tương đối REPO) → (đích tương đối DST)
#
# KHÔNG deploy engine sync sang runtime nữa (bỏ 11/09/2026). Engine chỉ có một
# bản, nằm trong repo, và `sync_month.py` import thẳng từ đó qua $TALPHA_REPO.
# Chép engine sang runtime là tự đẻ ra bản thứ hai — đúng cái đã khiến
# talpha-report và talpha-sync chạy hai bộ code khác nhau vào cùng một BigQuery.
PAIRS=(
  "ops/talpha_reports/talpha_paths.py|talpha_paths.py"
  "ops/talpha_reports/format_all.py|format_all.py"
  "ops/talpha_reports/talpha_rules.py|talpha_rules.py"
  "config/talpha_rules.json|talpha_rules.json"
  "ops/talpha_reports/sync_month.py|sync_month.py"
  "ops/talpha_reports/daily_guarded.sh|daily_guarded.sh"
  "ops/talpha_reports/export_worker.py|export_worker.py"
  "ops/talpha_reports/snapshot_cron.sh|snapshot_cron.sh"
  "ops/talpha_reports/catalog_cron.sh|catalog_cron.sh"
  "sync/talpha/sync_product_catalog.py|sync_product_catalog.py"
  "config/projects/talpha.yaml|runtime/config/talpha.yaml"
  "ops/talpha_reports/report_health.py|report_health.py"
  "ops/talpha_reports/report_account_health.py|report_account_health.py"
  "ops/talpha_reports/test_files.json|test_files.json"
  "ops/talpha_reports/taiwan_files.json|taiwan_files.json"
  "ops/talpha_reports/ad_accounts.json|runtime/config/ad_accounts.json"
)

echo "── Diff checksum (repo vs runtime):"
CHANGED=()
for pair in "${PAIRS[@]}"; do
  s="$REPO/${pair%%|*}"; d="$DST/${pair##*|}"
  [ -f "$s" ] || { echo "  ⚠️ thiếu nguồn: $s"; continue; }
  if [ ! -f "$d" ] || ! cmp -s "$s" "$d"; then
    echo "  ≠ ${pair##*|}"; CHANGED+=("$pair")
  fi
done
[ ${#CHANGED[@]} -eq 0 ] && { echo "  (không có gì thay đổi — thoát)"; exit 0; }

if [ "${1:-}" != "--yes" ]; then
  echo "── Chạy lại với --yes để deploy ${#CHANGED[@]} file trên."; exit 0
fi

# đợi lock (tối đa 60')
for i in $(seq 1 240); do
  if mkdir "$DST/.lock" 2>/dev/null; then trap 'rmdir "$DST/.lock"' EXIT; break; fi
  [ "$i" -eq 240 ] && { echo "TIMEOUT: lock bận 60 phút"; exit 1; }
  sleep 15
done

BK="$DST/_archive/deploy-backup-$STAMP"; mkdir -p "$BK"
for pair in "${CHANGED[@]}"; do
  s="$REPO/${pair%%|*}"; rel="${pair##*|}"; d="$DST/$rel"
  mkdir -p "$(dirname "$d")"
  [ -f "$d" ] && cp "$d" "$BK/$(basename "$rel")"
  cp "$s" "$d.tmp.$$" && mv "$d.tmp.$$" "$d"
  echo "  ✓ $rel"
done
echo "── Deploy xong ${#CHANGED[@]} file. Backup: $BK"
