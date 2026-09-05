#!/bin/bash
# ═══════════════════════════════════════════════════════
# FAOS — Telegram Bot Setup
# ═══════════════════════════════════════════════════════
# Hướng dẫn tạo Telegram Bot để nhận báo cáo FAOS
#
# BƯỚC 1: Tạo Bot
#   1. Mở Telegram → tìm @BotFather
#   2. Gửi: /newbot
#   3. Đặt tên: FAOS Bot
#   4. Đặt username: faos_brain_bot (hoặc tên khác)
#   5. BotFather sẽ cho bạn BOT TOKEN → copy lại
#
# BƯỚC 2: Lấy Chat ID
#   1. Gửi tin nhắn bất kỳ cho bot vừa tạo
#   2. Mở trình duyệt → vào link:
#      https://api.telegram.org/bot<BOT_TOKEN>/getUpdates
#   3. Tìm "chat":{"id": 123456789} → đó là CHAT_ID
#
# BƯỚC 3: Thêm vào .env
#   TELEGRAM_BOT_TOKEN=your_bot_token_here
#   TELEGRAM_CHAT_ID=your_chat_id_here
#
# BƯỚC 4: Test
#   Chạy script này để test gửi tin nhắn:
# ═══════════════════════════════════════════════════════

# Load .env
set -a
source "$(dirname "$0")/../.env"
set +a

if [ -z "$TELEGRAM_BOT_TOKEN" ] || [ -z "$TELEGRAM_CHAT_ID" ]; then
    echo "❌ Chưa cấu hình TELEGRAM_BOT_TOKEN và TELEGRAM_CHAT_ID trong .env"
    echo ""
    echo "Làm theo hướng dẫn ở đầu file này để lấy token."
    exit 1
fi

MESSAGE="🌳 *FAOS Test Message*

✅ Telegram Bot đã kết nối thành công!

🕐 Thời gian: $(date '+%Y-%m-%d %H:%M:%S')
🖥️ Hostname: $(hostname)

_Từ giờ bạn sẽ nhận báo cáo FAOS trên Telegram mỗi sáng._"

RESPONSE=$(curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    -d "chat_id=${TELEGRAM_CHAT_ID}" \
    -d "text=${MESSAGE}" \
    -d "parse_mode=Markdown")

if echo "$RESPONSE" | grep -q '"ok":true'; then
    echo "✅ Tin nhắn test đã gửi thành công! Kiểm tra Telegram."
else
    echo "❌ Gửi thất bại. Response:"
    echo "$RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$RESPONSE"
fi
