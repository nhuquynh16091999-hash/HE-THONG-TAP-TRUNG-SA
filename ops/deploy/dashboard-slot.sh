# Dựng dashboard vào thư mục KHÁC bản đang chạy, xong mới chuyển sang — dùng chung cho
# vps-setup.sh (from-mac.sh gọi) và vps-deploy.sh. Nạp bằng `source`, gọi khi đang đứng
# trong $APP_DIR/dashboard-ui:
#
#     cai_goi                 # npm ci — chỉ khi package-lock.json đổi
#     dung_ban_moi            # next build vào thư mục build đang rảnh
#     chuyen_sang_ban_moi     # ghi .next-active rồi pm2 khởi động lại từ thư mục mới
#
# Vì sao (08/10/2026, Sỹ Anh gửi ảnh iPad mở trang Báo cáo lúc 19:5x): cách cũ chạy
# `npm ci && next build` thẳng vào .next trong khi pm2 vẫn phục vụ từ chính .next đó.
#   • `next build` xoá sạch .next/static ngay từ đầu → bản cũ vẫn trả HTML, nhưng HTML trỏ
#     vào file CSS/JS không còn → trang trơn: chữ Times, logo to tràn màn hình, nút xám,
#     vòng quay mãi. Thử ở máy: CSS trả 500 giữa chừng build.
#   • `npm ci` xoá node_modules mà bản đang chạy còn nạp dần.
# Lỗ hổng kéo dài suốt 3–5 phút deploy, ngày deploy 6–7 lần, ai mở app lúc đó là dính.
#
# Nay: hai thư mục build .next-a ⇄ .next-b (next.config.mjs đọc NEXT_DIST_DIR). Bản đang
# chạy nằm nguyên một chỗ trong lúc bản mới dựng ở chỗ kia; chỉ còn vài giây pm2 khởi động
# lại. ops/pm2/ecosystem.vps.config.js đọc tên thư mục đang dùng từ .next-active, nên
# `pm2 start` tay theo README vẫn chạy đúng bản mới nhất.

SLOT_FILE=.next-active

slot_dang_chay() { cat "$SLOT_FILE" 2>/dev/null || echo .next; }
slot_ranh() { [ "$(slot_dang_chay)" = .next-a ] && echo .next-b || echo .next-a; }

# npm ci xoá node_modules rồi cài lại từ đầu — bản đang chạy mất gói giữa chừng. Lockfile
# không đổi thì cài lại cũng ra đúng cây cũ, nên bỏ qua. Muốn ép cài lại:
#     rm /opt/talpha/dashboard-ui/node_modules/.talpha-lock-sha
cai_goi() {
    local sha
    sha=$(sha256sum package-lock.json | cut -d' ' -f1)
    if [ -d node_modules ] && [ "$(cat node_modules/.talpha-lock-sha 2>/dev/null)" = "$sha" ]; then
        echo "   package-lock.json không đổi — giữ node_modules"
        return 0
    fi
    npm ci --no-audit --no-fund
    echo "$sha" > node_modules/.talpha-lock-sha
}

dung_ban_moi() {
    BAN_MOI=$(slot_ranh)
    echo "   bản đang chạy ở $(slot_dang_chay) — dựng bản mới vào $BAN_MOI"
    # Chặn trần bộ nhớ của Node dưới mức RAM+swap để build không bị giết đột ngột.
    NEXT_DIST_DIR="$BAN_MOI" NODE_OPTIONS="--max-old-space-size=1536" npm run build
}

chuyen_sang_ban_moi() {
    [ -n "${BAN_MOI:-}" ] || { echo "!! chuyen_sang_ban_moi gọi trước dung_ban_moi" >&2; return 1; }
    local cu
    cu=$(slot_dang_chay)
    echo "$BAN_MOI" > "$SLOT_FILE"
    pm2 delete talpha-dashboard >/dev/null 2>&1 || true
    pm2 start ../ops/pm2/ecosystem.vps.config.js --only talpha-dashboard
    pm2 save
    echo "   đang chạy từ $BAN_MOI"
    # .next của thời dựng-đè không bao giờ được dùng lại — dọn cho đỡ chật ổ. Còn .next-a/b
    # của bản trước thì để nguyên: lần deploy sau dựng đè lên chính nó.
    if [ "$cu" = .next ]; then rm -rf .next && echo "   đã dọn .next cũ"; fi
}
