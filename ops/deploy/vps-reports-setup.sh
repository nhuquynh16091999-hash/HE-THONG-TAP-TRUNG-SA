#!/usr/bin/env bash
#
# Dựng ĐƯỜNG ỐNG BÁO CÁO GOOGLE SHEETS trên máy chủ: mỗi giờ kéo số mới rồi ghi
# xuống Sheet của từng marketer, không cần ai bấm.
#
# Chạy TRÊN MÁY CHỦ:
#     bash /opt/talpha/ops/deploy/vps-reports-setup.sh
#
# Khác gì talpha-sync đã có sẵn:
#   talpha-sync   → kéo đơn POS + chi tiêu Meta VÀO BigQuery
#   talpha-report → đọc BigQuery rồi GHI RA Google Sheets cho người đọc
# Hai việc khác nhau, hai timer riêng: sync hỏng thì báo cáo phải biết mà đứng
# lại, chứ không ghi đè Sheet đang đúng bằng số thiếu (chốt 03/09 trong
# daily_guarded.sh — 46 tiếng Sheet sai đẹp giả vì đúng chuyện này).
#
# Runtime vẫn là thư mục PHẲNG ~/talpha_reports, y hệt bản chạy trên Mac, dựng
# bằng chính deploy_runtime.sh của repo. Không đẻ ra layout riêng cho máy chủ:
# hai layout là sớm muộn hai đường số khác nhau.
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/talpha}"
VENV="${VENV:-$APP_DIR/.venv}"
DST="${DST:-$HOME/talpha_reports}"
RT="$DST/runtime"

say() { printf '\n\033[1;33m▸ %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

[ -d "$APP_DIR/.git" ] || die "Không thấy repo ở $APP_DIR"

# ─────────────────────────────────────────────────────────────────────────
say "1/5 · Thư viện Python cho phần ghi Sheets"
"$VENV/bin/pip" install --quiet --upgrade pip
"$VENV/bin/pip" install --quiet \
    google-cloud-bigquery requests python-dotenv PyYAML gspread google-auth
echo "   $("$VENV/bin/python" -V)"

# ─────────────────────────────────────────────────────────────────────────
say "2/5 · Dựng runtime phẳng $DST"
# runtime CHỈ còn giữ config + key + log. Engine sync ở lại repo — xem TALPHA_REPO.
mkdir -p "$RT/config"
# Dọn bản sao engine của các lần dựng trước, nếu còn.
rm -rf "$RT/sync"
bash "$APP_DIR/ops/talpha_reports/deploy_runtime.sh" --yes || true

# Key BigQuery: cũng là key ghi Sheets (cùng một service account). daily_guarded
# dò $RT/bigquery_key.json trước, nên đặt đúng chỗ đó.
if [ -f "$APP_DIR/bigquery_key.json" ]; then
    cp "$APP_DIR/bigquery_key.json" "$RT/bigquery_key.json"
    chmod 600 "$RT/bigquery_key.json"
    echo "   đã chép key BigQuery vào runtime"
else
    die "Thiếu $APP_DIR/bigquery_key.json — chạy ops/deploy/from-mac.sh trước"
fi

# ─────────────────────────────────────────────────────────────────────────
say "3/5 · Dịch vụ systemd"
cat > /etc/systemd/system/talpha-report.service <<EOF
[Unit]
Description=TALPHA — đọc BigQuery rồi ghi báo cáo xuống Google Sheets
After=network-online.target talpha-sync.service
Wants=network-online.target

[Service]
Type=oneshot
WorkingDirectory=$DST
# Token Meta và key POS — sync_month.py bên trong vòng chạy vẫn cần.
EnvironmentFile=$APP_DIR/dashboard-ui/.env.local
# Trỏ script về đúng runtime này thay vì để nó tự dò theo \$HOME.
Environment=TALPHA_REPORTS_DIR=$DST
Environment=TALPHA_RUNTIME_DIR=$RT
Environment=TALPHA_PYTHON=$VENV/bin/python
# Engine sync lấy TỪ REPO, không lấy bản sao trong runtime. Thiếu dòng này là
# sync_month.py rơi về bản sao cũ dưới \$PYTHONPATH và chạy code khác hẳn với
# talpha-sync.service — hai engine cùng ghi một bộ bảng BigQuery mỗi giờ.
Environment=TALPHA_REPO=$APP_DIR
# Khai THẲNG dự án BigQuery, không để script tự lùi về giá trị mặc định: bản chép
# runtime từng lùi về dự án của hệ thống cũ và ghi nhầm sang đó.
Environment=BQ_PROJECT_ID=cty-507710
Environment=BQ_DATASET=TALPHA_Dataset
Environment=GOOGLE_APPLICATION_CREDENTIALS=$RT/bigquery_key.json
ExecStart=/bin/bash $DST/daily_guarded.sh
# Vòng chạy thật dưới 30'; cắt ở 45' để một lần treo không chặn lần sau.
TimeoutStartSec=2700
StandardOutput=journal
StandardError=journal
EOF

cat > /etc/systemd/system/talpha-report.timer <<'EOF'
[Unit]
Description=Chạy báo cáo TALPHA mỗi giờ

[Timer]
# Lệch 20 phút so với talpha-sync (chạy đúng phút tròn) để báo cáo đọc được số
# sync vừa kéo về, thay vì đọc bản cũ của giờ trước.
OnCalendar=*-*-* *:20:00
RandomizedDelaySec=180
Persistent=true

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now talpha-report.timer
echo "   đã bật"

# ─────────────────────────────────────────────────────────────────────────
say "4/5 · Chạy thử một lần ngay"
# daily_guarded tự chặn nếu vòng trước cách đây dưới 50 phút. Lần dựng đầu thì
# chưa có mốc nào nên nó chạy thật.
systemctl start talpha-report.service || true
sleep 5
systemctl status talpha-report.service --no-pager -n 0 2>/dev/null | head -4 || true

# ─────────────────────────────────────────────────────────────────────────
say "5/5 · Kết quả vòng chạy"
LOG="$DST/daily_$(date +%Y%m%d).log"
if [ -f "$LOG" ]; then
    tail -12 "$LOG"
else
    echo "   chưa có log — xem: journalctl -u talpha-report -n 60 --no-pager"
fi

printf '\n\033[1;32m✓ XONG\033[0m\n\n'
echo "Lịch chạy tới:  systemctl list-timers 'talpha-*'"
echo "Xem nhật ký  :  journalctl -u talpha-report -n 60 --no-pager"
echo "Log vòng chạy:  tail -f $DST/daily_\$(date +%Y%m%d).log"
echo "Chạy tay ngay:  systemctl start talpha-report"
