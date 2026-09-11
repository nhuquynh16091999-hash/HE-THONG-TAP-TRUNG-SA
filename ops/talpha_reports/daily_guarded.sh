#!/bin/bash
# Đường dẫn KHÔNG khoá cứng vào máy nào.
#
# Bản cũ ghi thẳng /Users/syanh/talpha_reports nên chỉ chạy được trên đúng một
# máy Mac. Hạ tầng nay nằm ở VPS (/opt/talpha), mà cùng một script phải chạy
# được cả hai chỗ — chép ra hai bản là sớm muộn hai bản lệch nhau.
#
# Thứ tự dò: biến môi trường đặt tay > runtime cũ trên Mac > cây repo hiện tại.
if [ -n "${TALPHA_REPORTS_DIR:-}" ]; then
  DIR="$TALPHA_REPORTS_DIR"; RT="${TALPHA_RUNTIME_DIR:-$DIR/runtime}"
elif [ -d "$HOME/talpha_reports/runtime" ]; then
  DIR="$HOME/talpha_reports"; RT="$DIR/runtime"
else
  # Chạy thẳng trong repo: script nằm ở ops/talpha_reports/, gốc repo lùi hai cấp.
  DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  RT="$(cd "$DIR/../.." && pwd)"
fi
PY="${TALPHA_PYTHON:-$RT/.venv/bin/python}"
[ -x "$PY" ] || PY=python3
EPOCH=$DIR/last_run_epoch; LOG=$DIR/daily_$(date +%Y%m%d).log
# Dọn lock KẸT: 1 lần chạy bị kill giữa chừng để lại .lock → chặn mọi lần sau (bug 08/07,
# kẹt 4 ngày). Chủ lock ghi PID vào .lock/pid — PID chết là dọn NGAY, không đợi 45'.
# Lock không có pid (đang mkdir dở / bản cũ) → fallback mtime > 45' (1 vòng chạy < 30').
if [ -d "$DIR/.lock" ]; then
  LPID=$(cat "$DIR/.lock/pid" 2>/dev/null)
  if [ -n "$LPID" ] && ! kill -0 "$LPID" 2>/dev/null; then
    echo "$(date) removing DEAD lock (owner pid $LPID da chet)" >> "$LOG"; rm -rf "$DIR/.lock"
  elif find "$DIR/.lock" -maxdepth 0 -mmin +45 2>/dev/null | grep -q .; then
    echo "$(date) removing STALE lock (>45m)" >> "$LOG"; rm -rf "$DIR/.lock"
  fi
fi
if ! mkdir "$DIR/.lock" 2>/dev/null; then echo "$(date) skip: dang chay" >> "$LOG"; exit 0; fi
echo $$ > "$DIR/.lock/pid"
trap 'rm -rf "$DIR/.lock" 2>/dev/null' EXIT
now=$(date +%s); last=$(cat "$EPOCH" 2>/dev/null || echo 0)
if [ $((now-last)) -lt 3000 ]; then echo "$(date) skip: <50m" >> "$LOG"; exit 0; fi
for k in "$RT/bigquery_key.json" "$RT/../bigquery_key.json" "$DIR/bigquery_key.json"; do
  [ -f "$k" ] && { export GOOGLE_APPLICATION_CREDENTIALS="$k"; break; }
done
echo "=== START $(date) ===" >> "$LOG"
PYTHONPATH=$RT $PY $DIR/sync_month.py >> "$LOG" 2>&1; SYNC_RC=$?
# CHỐT 03/09: sync fail thì KHÔNG ghi Sheet — giữ số cũ ĐÚNG hơn là ghi đè số mới SAI.
# Vì sao: token Meta chết 02/09 11:50, fb_ads_data đứng từ 10:36. Vòng chạy vẫn rc=1 và
# vẫn in "ADS FAIL", nhưng format_all.py chạy vô điều kiện ngay sau đó nên mỗi giờ lại
# ghi spend THIẾU xuống Sheet dưới dạng số 0 — không phân biệt được với "không tiêu đồng
# nào". Spend nằm ở MẪU SỐ nên Sheet sai theo hướng ĐẸP GIẢ (CPO 103.735đ khi thật
# ~165.000đ, %Ads/DT 11,98% khi thật ~19%). 46 tiếng không ai nghi, tới lúc CEO nhìn Sheet
# thấy lạ mới lộ. Bảng ĐỨNG chứ không MẤT dòng nên report_account_health vẫn báo "ok".
# LƯU Ý: chốt này chặn cả vòng ghi khi CHỈ ads hỏng — doanh số POS (vẫn khoẻ) cũng đứng
# theo. Cố ý: một Sheet cũ toàn phần đọc được, còn Sheet nửa mới nửa thiếu thì không.
# Chạy tay có chủ đích: TALPHA_FORCE_FORMAT=1 ./daily_guarded.sh
if [ $SYNC_RC -ne 0 ] && [ "${TALPHA_FORCE_FORMAT:-0}" != "1" ]; then
  FMT_RC=90   # 90 = CHƯA CHẠY vì sync hỏng (khác hẳn format_all tự lỗi)
  echo "SKIP format_all: sync rc=$SYNC_RC — giu nguyen Sheet, khong ghi de bang so thieu." >> "$LOG"
else
  $PY $DIR/format_all.py >> "$LOG" 2>&1; FMT_RC=$?
fi
date +%s > "$EPOCH"; echo "=== DONE $(date) (sync=$SYNC_RC format=$FMT_RC) ===" >> "$LOG"
# Ghi health vào BQ để bot WhatsApp cảnh báo khi sync fail/im lặng (không chặn vòng chạy)
OK=1; [ $SYNC_RC -ne 0 ] && OK=0; [ $FMT_RC -ne 0 ] && OK=0
DETAIL=$(tail -3 "$LOG" | tr '\n' ' | ' | head -c 900)
$PY $DIR/report_health.py --ok $OK --sync-rc $SYNC_RC --format-rc $FMT_RC --detail "$DETAIL" >> "$LOG" 2>&1 || true
# B5: health THEO TỪNG TKQC/shop — bắt lỗi âm thầm (1 mục rơi khỏi sync mà vòng vẫn rc=0)
$PY $DIR/report_account_health.py >> "$LOG" 2>&1 || true
