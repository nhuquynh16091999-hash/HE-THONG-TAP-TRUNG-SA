#!/bin/bash
# TALPHA — shadow-run engine sync REPO (ghi bảng *_shadow) + so sánh với bảng thật.
# Chạy daily 21:30 bởi launchd com.talpha.shadowsync từ clone ~/talpha_shadow
# (off-Desktop để launchd đọc được). Khớp 7 ngày liên tục → cutover theo
# docs/proposals/SYNC_CONSOLIDATION_PLAN.md.
set -uo pipefail
SHADOW_REPO="$HOME/talpha_shadow"
RT="$HOME/talpha_reports/runtime"
PY="$RT/.venv/bin/python"
LOG="$HOME/talpha_reports/shadow_$(date +%Y%m%d).log"
set -a; source "$RT/.env" 2>/dev/null; set +a
# đặt SAU source .env — .env có thể chứa path tương đối làm hỏng credentials
export GOOGLE_APPLICATION_CREDENTIALS="$RT/bigquery_key.json"

echo "=== SHADOW START $(date) ===" >> "$LOG"
# Clone này CHỈ để chạy — không sửa code ở đây, sửa ở repo rồi push.
# HARD-SYNC theo origin/main: `pull --ff-only` từng fail im lặng vì có sửa tay local
# (30/07 → 03/08 clone kẹt ở 3afc9ef, validation chạy bản compare lỗi thời 4 ngày liền).
if git -C "$SHADOW_REPO" fetch --quiet origin main >> "$LOG" 2>&1; then
    DIRTY=$(git -C "$SHADOW_REPO" status --porcelain | wc -l | tr -d ' ')
    [ "$DIRTY" != "0" ] && echo "⚠️  clone có $DIRTY file sửa tay — BỎ (sửa ở repo, đừng sửa clone)" >> "$LOG"
    git -C "$SHADOW_REPO" reset --hard origin/main >> "$LOG" 2>&1
    git -C "$SHADOW_REPO" clean -fd >> "$LOG" 2>&1
    echo "code: $(git -C "$SHADOW_REPO" log --oneline -1)" >> "$LOG"
else
    echo "⚠️  fetch fail (mạng?) — chạy bản đang có: $(git -C "$SHADOW_REPO" log --oneline -1)" >> "$LOG"
fi

# shadow_month.py mô phỏng đúng sync_month.py (orders bound đầu tháng — KHÔNG kéo cả lịch sử)
"$PY" "$SHADOW_REPO/ops/talpha_reports/shadow_month.py" >> "$LOG" 2>&1
RC=$?
echo "--- sync rc=$RC — compare:" >> "$LOG"
"$PY" "$SHADOW_REPO/ops/talpha_reports/compare_shadow.py" >> "$LOG" 2>&1
CMP=$?
echo "=== SHADOW DONE $(date) (sync=$RC compare=$CMP) ===" >> "$LOG"
