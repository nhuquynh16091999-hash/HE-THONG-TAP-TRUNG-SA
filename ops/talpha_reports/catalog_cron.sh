#!/bin/bash
# ═══════════════════════════════════════════════════════════════════
# TALPHA E2 — làm tươi product_catalog mỗi ngày (launchd gọi)
#
# product_catalog là bảng dimension variation_id → sku/tên SP; MỌI báo cáo theo
# sản phẩm (tab "P&L theo SP", view vw_product_pnl, cột cogs_vnd của vw_orders_std)
# đều JOIN qua nó. Trước E2 script chỉ chạy tay: lần ghi cuối ~giữa 06/2026, đến
# 04/08 bảng đã cũ ~1,5 tháng ⇒ 38,7% dòng order_items không khớp catalog
# (419,2tr doanh thu không phân tích được theo SP) và SP mới lên sàn thì vô hình.
#
# Chạy từ RUNTIME ~/talpha_reports — launchd KHÔNG đọc được Desktop.
# Sửa ở repo (sync/talpha/sync_product_catalog.py + ops/talpha_reports/) rồi
# `./deploy_runtime.sh --yes`.
#
# Ghi BQ bằng LOAD JOB WRITE_TRUNCATE (atomic, hợp free tier — không streaming/DML).
# ═══════════════════════════════════════════════════════════════════
set -uo pipefail

DIR="$HOME/talpha_reports"
RT="$DIR/runtime"
PY="$RT/.venv/bin/python"
LOG="$DIR/catalog_$(date +%Y%m%d).log"
LOCK="$DIR/.lock_catalog"

log() { echo "$(date '+%F %T') [catalog] $*" >> "$LOG"; }

# Lock riêng — KHÔNG dùng $DIR/.lock (lock của vòng sync mỗi giờ), tránh làm
# daily_guarded.sh/deploy nghẽn vì một lượt fetch catalog vài chục giây.
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

[ -x "$PY" ] || { log "thiếu python runtime: $PY"; exit 1; }

# cd vào runtime: script dùng load_dotenv() và "bigquery_key.json" theo ĐƯỜNG DẪN
# TƯƠNG ĐỐI cwd — chạy từ chỗ khác là mất key POS lẫn credentials BQ.
cd "$RT" || { log "không vào được $RT"; exit 1; }

# Danh sách 7 shop đọc từ bản talpha.yaml đã deploy (repo config/ không có ở runtime).
export TALPHA_CONFIG_YAML="$RT/config/talpha.yaml"

log "bắt đầu"
"$PY" "$DIR/sync_product_catalog.py" >> "$LOG" 2>&1
RC=$?
if [ $RC -eq 0 ]; then
    log "xong"
else
    log "LỖI rc=$RC — bảng cũ VẪN CÒN NGUYÊN (WRITE_TRUNCATE chỉ thay khi load thành công)"
fi
exit $RC
