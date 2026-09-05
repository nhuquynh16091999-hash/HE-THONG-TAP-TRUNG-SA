#!/bin/bash
# ═══════════════════════════════════════════════════════════════════
# TALPHA C2 — scheduler hoá snapshot (launchd gọi định kỳ 2 route dashboard)
#
#   inventory → /api/talpha/sync-inventory → BQ inventory_snapshot
#               Đây là ĐƯỜNG DỰ PHÒNG của tab Kho: POS Poscake chết thì
#               /api/talpha/inventory đọc snapshot mới nhất. Không ai gọi định kỳ
#               → 03/08 snapshot mới nhất là 10/07, tức dự phòng lệch 24 ngày.
#   ads       → /api/talpha/snapshot-ads   → BQ ads_command_snapshot
#               Lịch sử spend/ROAS live theo campaign (bảng đứng im từ 18/06).
#
# Dùng: snapshot_cron.sh inventory | ads
# Chạy từ RUNTIME ~/talpha_reports — launchd KHÔNG đọc được Desktop.
# Sửa ở repo ops/talpha_reports/ rồi `./deploy_runtime.sh --yes`.
# ═══════════════════════════════════════════════════════════════════
set -uo pipefail

JOB="${1:-}"
case "$JOB" in
    inventory) ROUTE="sync-inventory"; TIMEOUT=90 ;;
    ads)       ROUTE="snapshot-ads";   TIMEOUT=120 ;;
    *) echo "dùng: $0 inventory|ads" >&2; exit 2 ;;
esac

DIR="$HOME/talpha_reports"
LOG="$DIR/snapshot_$(date +%Y%m%d).log"
# KHÔNG dùng $DIR/.lock — đó là lock của vòng sync mỗi giờ (daily_guarded.sh);
# dùng chung sẽ làm sync/deploy nghẽn vì một cú curl 20s.
LOCK="$DIR/.lock_snapshot_$JOB"

# Cấu hình tuỳ chọn, KHÔNG vào git: TALPHA_DASH_URL, TALPHA_SYNC_TOKEN
# (chỉ cần khi dashboard bật token — phải khớp .env.local của dashboard).
set -a; source "$DIR/snapshot_cron.env" 2>/dev/null; set +a
BASE="${TALPHA_DASH_URL:-http://127.0.0.1:3000}"

log() { echo "$(date '+%F %T') [$JOB] $*" >> "$LOG"; }

# Lock: chu kỳ trước còn chạy (dashboard treo) thì bỏ lượt, không chồng request.
# Chủ lock ghi PID — PID chết là dọn NGAY (bài học lock kẹt 4 ngày 08/07),
# không có PID thì fallback mtime.
if [ -d "$LOCK" ]; then
    LPID=$(cat "$LOCK/pid" 2>/dev/null)
    if [ -n "$LPID" ] && ! kill -0 "$LPID" 2>/dev/null; then
        log "dọn lock chết (owner pid $LPID)"; rm -rf "$LOCK"
    elif find "$LOCK" -maxdepth 0 -mmin +30 2>/dev/null | grep -q .; then
        log "dọn lock quá hạn (>30')"; rm -rf "$LOCK"
    fi
fi
if ! mkdir "$LOCK" 2>/dev/null; then log "bỏ lượt: chu kỳ trước đang chạy"; exit 0; fi
echo $$ > "$LOCK/pid"
trap 'rm -rf "$LOCK" 2>/dev/null' EXIT

# Token đi qua HEADER, không nhét vào URL (URL lộ trong `ps` và access log).
CURL_ARGS=(-sS -m "$TIMEOUT")
[ -n "${TALPHA_SYNC_TOKEN:-}" ] && CURL_ARGS+=(-H "x-talpha-token: $TALPHA_SYNC_TOKEN")

START=$(date +%s)
RESP=$(curl "${CURL_ARGS[@]}" "$BASE/api/talpha/$ROUTE" 2>&1); RC=$?
ELAPSED=$(( $(date +%s) - START ))

if [ $RC -ne 0 ]; then
    # dashboard tắt / pm2 đang restart / máy vừa ngủ dậy → lượt sau chạy lại.
    log "❌ curl rc=$RC sau ${ELAPSED}s: $(echo "$RESP" | tr -d '\n' | head -c 200)"
    exit 1
fi

case "$RESP" in
    *'"ok":true'*)
        log "✅ ${ELAPSED}s $(echo "$RESP" | tr -d '\n' | head -c 400)"
        # warnings ≠ 0 nghĩa là có TKQC/shop fetch fail → dòng snapshot vừa ghi
        # là số THIẾU. Không bỏ dòng (mất lịch sử), nhưng phải soi được trong log.
        case "$RESP" in *'"warnings":'[1-9]*) log "⚠️  snapshot trên ghi khi có nguồn lỗi — số THIẾU" ;; esac
        ;;
    *)
        log "❌ route trả lỗi sau ${ELAPSED}s: $(echo "$RESP" | tr -d '\n' | head -c 400)"
        exit 1
        ;;
esac

# Giữ log 14 ngày — job chạy 96 lượt/ngày, không để phình vô hạn.
find "$DIR" -maxdepth 1 -name 'snapshot_*.log' -mtime +14 -delete 2>/dev/null
exit 0
