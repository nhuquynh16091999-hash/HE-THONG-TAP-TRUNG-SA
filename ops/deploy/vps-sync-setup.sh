#!/usr/bin/env bash
#
# Dựng NỬA ĐƯỜNG ỐNG trên máy chủ: tự kéo đơn POS + chi tiêu Meta vào BigQuery
# theo giờ, không cần ai bấm.
#
# Chạy TRÊN MÁY CHỦ:
#     bash /opt/talpha/ops/deploy/vps-sync-setup.sh
#
# Dùng systemd timer chứ không dùng cron, vì ba lý do:
#   • `journalctl -u talpha-sync` xem được toàn bộ lịch sử chạy, cron thì phải
#     tự lo chuyện ghi log
#   • Persistent=true — máy tắt lúc tới giờ thì bật lên chạy bù, cron bỏ luôn
#   • systemctl start talpha-sync chạy tay được ngay, đúng y môi trường đã khai
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/talpha}"
VENV="$APP_DIR/.venv"

say() { printf '\n\033[1;33m▸ %s\033[0m\n' "$*"; }

# ─────────────────────────────────────────────────────────────────────────
say "1/4 · Python và thư viện"
if command -v dnf >/dev/null 2>&1; then
    dnf install -y -q python3 python3-pip
else
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq python3 python3-pip python3-venv
fi
python3 -m venv "$VENV" 2>/dev/null || true
"$VENV/bin/pip" install --quiet --upgrade pip
"$VENV/bin/pip" install --quiet \
    google-cloud-bigquery requests python-dotenv PyYAML gspread google-auth
echo "   $("$VENV/bin/python" -V)"

# ─────────────────────────────────────────────────────────────────────────
say "2/4 · Kiểm tra key POS gọi được API thật"
# Kiểm TRƯỚC khi hẹn giờ. Không kiểm thì hẹn giờ vẫn chạy đều mà chẳng kéo về
# đơn nào, và phải mấy ngày sau mới có người nhận ra bảng trống.
set -a; . "$APP_DIR/dashboard-ui/.env.local"; set +a
if "$VENV/bin/python" "$APP_DIR/scripts/check_pos_shop.py"; then
    echo "   key POS và shop_id đều tốt"
else
    echo "   ! có cảnh báo ở trên — vẫn dựng hẹn giờ, nhưng đọc kỹ trước khi tin số"
fi

# ─────────────────────────────────────────────────────────────────────────
say "3/4 · Dịch vụ systemd"
cat > /etc/systemd/system/talpha-sync.service <<EOF
[Unit]
Description=TALPHA — kéo đơn POS và chi tiêu Meta vào BigQuery
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
WorkingDirectory=$APP_DIR
# .env.local giữ key POS, token Meta, cấu hình BigQuery. Chỉ root đọc được.
EnvironmentFile=$APP_DIR/dashboard-ui/.env.local
Environment=GOOGLE_APPLICATION_CREDENTIALS=$APP_DIR/bigquery_key.json
ExecStart=$VENV/bin/python $APP_DIR/sync/talpha/talpha_sync.py
# Kéo cả tháng có lúc lâu; cắt ở 30 phút để một lần treo không chặn lần sau.
TimeoutStartSec=1800
StandardOutput=journal
StandardError=journal
EOF

cat > /etc/systemd/system/talpha-sync.timer <<'EOF'
[Unit]
Description=Chạy TALPHA sync mỗi giờ

[Timer]
OnCalendar=hourly
# Lệch 5 phút để không dồn vào đúng phút tròn cùng mọi máy chủ khác trên đời.
RandomizedDelaySec=300
# Máy tắt lúc tới giờ thì bật lên chạy bù, không bỏ luôn như cron.
Persistent=true

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now talpha-sync.timer
echo "   đã bật"

# ─────────────────────────────────────────────────────────────────────────
say "4/4 · Chạy thử một lần ngay"
systemctl start talpha-sync.service || true
sleep 3
systemctl status talpha-sync.service --no-pager -n 0 2>/dev/null | head -4 || true

printf '\n\033[1;32m✓ XONG\033[0m\n\n'
echo "Lịch chạy tới:  systemctl list-timers talpha-sync.timer"
echo "Xem nhật ký  :  journalctl -u talpha-sync -n 60 --no-pager"
echo "Chạy tay ngay:  systemctl start talpha-sync"
