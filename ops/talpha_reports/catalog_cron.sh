#!/bin/bash
# ═══════════════════════════════════════════════════════════════════
# TALPHA — làm tươi product_catalog (variation_id → mã SKU, tên SP).
#
# vw_product_catalog_std đọc bảng này để vw_orders_std tra giá vốn theo mã SKU
# (cogs_vnd) và vw_product_pnl gom doanh thu theo SP. Bảng trống là giá vốn trong
# BigQuery bằng 0 toàn bộ.
#
# Gọi định kỳ bởi systemd `talpha-catalog.timer` (mỗi ngày 05:10 giờ VN), do
# ops/deploy/vps-setup.sh dựng ở mỗi lần deploy. Chạy tay trên máy chủ:
#     systemctl start talpha-catalog
# (đừng gọi trần script: khoá POS TALPHA_POSCAKE_*_KEY do systemd nạp từ
# dashboard-ui/.env.local, giống talpha-sync.service).
#
# Ghi BQ bằng LOAD JOB WRITE_TRUNCATE (atomic). sync_product_catalog.py tự dừng,
# giữ nguyên bảng cũ, khi: không có khoá shop nào · đọc được 0 dòng · hụt >30%.
# ═══════════════════════════════════════════════════════════════════
set -uo pipefail

APP="${TALPHA_APP_DIR:-/opt/talpha}"
PY="$APP/.venv/bin/python"
DIR="$HOME/talpha_reports"
LOG="$DIR/catalog_$(date +%Y%m%d).log"
LOCK="$DIR/.lock_catalog"
mkdir -p "$DIR"

log() { echo "$(date '+%F %T') [catalog] $*" >> "$LOG"; }

# Lock riêng — KHÔNG dùng $DIR/.lock (lock của vòng ghi Sheet mỗi giờ).
# Chủ lock ghi PID; PID chết là dọn ngay (bài học lock kẹt 4 ngày 08/07).
if ! mkdir "$LOCK" 2>/dev/null; then
    OWNER="$(cat "$LOCK/pid" 2>/dev/null || echo '')"
    if [ -n "$OWNER" ] && kill -0 "$OWNER" 2>/dev/null; then
        log "lượt trước (pid $OWNER) còn chạy — bỏ lượt"; exit 0
    fi
    log "lock mồ côi (pid '${OWNER:-?}' đã chết) — dọn và chạy tiếp"
    rm -rf "$LOCK"; mkdir "$LOCK" 2>/dev/null || { log "không tạo được lock"; exit 1; }
fi
echo $$ > "$LOCK/pid"
trap 'rm -rf "$LOCK"' EXIT

[ -x "$PY" ] || { log "thiếu python: $PY"; exit 1; }
# cd vào gốc repo: script mở "bigquery_key.json" theo đường dẫn tương đối cwd.
cd "$APP" || { log "không vào được $APP"; exit 1; }
[ -f bigquery_key.json ] || { log "thiếu $APP/bigquery_key.json"; exit 1; }

log "bắt đầu"
"$PY" "$APP/sync/talpha/sync_product_catalog.py" >> "$LOG" 2>&1
RC=$?
if [ $RC -eq 0 ]; then
    log "xong"
else
    log "LỖI rc=$RC — bảng cũ VẪN CÒN NGUYÊN (WRITE_TRUNCATE chỉ thay khi load thành công)"
fi
find "$DIR" -maxdepth 1 -name 'catalog_*.log' -mtime +30 -delete 2>/dev/null
exit $RC
