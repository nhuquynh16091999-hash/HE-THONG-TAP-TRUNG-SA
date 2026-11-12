#!/bin/bash
# Canh máy chủ TỪ MÁY MAC (13/11/2026).
#
# Vì sao: bot Zalo nằm cùng máy chủ với dashboard — máy chủ đứng là bot câm theo, không ai được
# báo. 13/10/2026 máy chủ đứng 19:24 → 08:55 hôm sau mới có người thấy. Script này chạy ở nơi
# khác (máy Mac, launchd 5 phút một lần), gọi trang đăng nhập; hỏng 2 lượt liền (~10 phút) thì
# bật hộp thoại + thông báo trên Mac. Lên lại thì báo một lần nữa.
#
# Giới hạn: Mac tắt / ngủ thì không canh. Mac mất mạng thì bỏ lượt, không kêu oan.
# Cài:  bash ops/mac-watch/cai.sh        Gỡ:  bash ops/mac-watch/cai.sh --go
URL="${TALPHA_WATCH_URL:-https://139.180.131.21/login}"
DIR="$HOME/.talpha-watch"; mkdir -p "$DIR"
DEM="$DIR/hong_lien_tiep"; DA_BAO="$DIR/da_bao"; LOG="$DIR/canh.log"
NGUONG=2
gio() { date '+%d/%m %H:%M'; }
bao() {   # $1 tiêu đề, $2 nội dung, $3 = "hop" thì thêm hộp thoại nằm lại tới khi bấm
    /usr/bin/osascript -e "display notification \"$2\" with title \"$1\" sound name \"Sosumi\"" >/dev/null 2>&1
    [ "$3" = "hop" ] && (/usr/bin/osascript -e "display alert \"$1\" message \"$2\" as critical" >/dev/null 2>&1 &)
}
code=$(/usr/bin/curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$URL" 2>/dev/null); code=${code:-000}
if [ "$code" = "200" ]; then
    if [ -f "$DA_BAO" ]; then
        bao "Dashboard ANTALO đã lên lại" "Máy chủ trả lời lại lúc $(gio). Đứng từ $(cat "$DA_BAO")."
        echo "$(gio) LEN LAI (dung tu $(cat "$DA_BAO"))" >> "$LOG"; rm -f "$DA_BAO"
    fi
    rm -f "$DEM"; exit 0
fi
# Mac mất mạng thì không kết luận gì về máy chủ.
/usr/bin/curl -s -o /dev/null --max-time 10 https://www.apple.com/library/test/success.html 2>/dev/null \
    || { echo "$(gio) bo luot: Mac mat mang" >> "$LOG"; exit 0; }
n=$(( $(cat "$DEM" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$DEM"
echo "$(gio) HONG lan $n (HTTP $code)" >> "$LOG"
if [ "$n" -ge "$NGUONG" ] && [ ! -f "$DA_BAO" ]; then
    gio > "$DA_BAO"
    bao "MÁY CHỦ ANTALO KHÔNG TRẢ LỜI" "Dashboard không vào được từ $(gio) (HTTP $code). Bot Zalo cùng máy nên cũng đang câm. Vào Vultr xem máy chủ, hoặc mở Claude bảo kiểm." hop
fi
tail -n 500 "$LOG" > "$LOG.tmp" 2>/dev/null && mv "$LOG.tmp" "$LOG"
