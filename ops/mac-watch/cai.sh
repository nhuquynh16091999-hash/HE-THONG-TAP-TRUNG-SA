#!/bin/bash
# Cài / gỡ việc canh máy chủ trên máy Mac — xem canh-may-chu.sh.
# Script được CHÉP ra ~/.talpha-watch: launchd không được đọc thư mục Desktop (macOS chặn).
set -euo pipefail
TEN=vn.antalo.canh-may-chu
PLIST="$HOME/Library/LaunchAgents/$TEN.plist"
DIR="$HOME/.talpha-watch"
launchctl bootout "gui/$(id -u)/$TEN" 2>/dev/null || true
if [ "${1:-}" = "--go" ]; then rm -f "$PLIST"; echo "Đã gỡ. (Nhật ký còn ở $DIR)"; exit 0; fi
mkdir -p "$DIR" "$HOME/Library/LaunchAgents"
cp "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/canh-may-chu.sh" "$DIR/canh-may-chu.sh"
chmod +x "$DIR/canh-may-chu.sh"
cat > "$PLIST" <<P
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$TEN</string>
  <key>ProgramArguments</key><array><string>/bin/bash</string><string>$DIR/canh-may-chu.sh</string></array>
  <key>StartInterval</key><integer>300</integer>
  <key>RunAtLoad</key><true/>
</dict></plist>
P
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Đã cài: 5 phút gọi máy chủ một lần. Nhật ký: $DIR/canh.log"
