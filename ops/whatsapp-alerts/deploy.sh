#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
# TALPHA — deploy bot WhatsApp lên máy chủ TỪ GIT.
#
# ⚠️ Bot đang TẮT và chưa từng chạy trên VPS hiện tại. Xem ops/pm2/README.md.
# Thay cho "rsync tay từ working tree" (nguồn cũ của lệch bản: server từng chạy
# code chưa commit, và file rác kiểu rules.js.bak-E3 do copy tay để lại).
#
# Chạy TRÊN MAC, trong repo:   ops/whatsapp-alerts/deploy.sh [ref]     (mặc định ref = main)
#
# Mac fetch remote trước để CHỐT ĐÚNG 1 COMMIT, rồi deploy commit đó theo 1 trong 2 đường:
#   (A) server tự `git fetch` clone /opt/talpha-src  — cần deploy key GitHub trên server;
#   (B) chưa có key → Mac đẩy `git archive` của chính commit đó sang.
# Cả hai bung ra y hệt nhau vì cùng khoá theo 1 SHA — không lấy file đang sửa dở trên máy.
#
# Sau khi bung: DỌN file lạ ở thư mục đích (file không có trong git và cũng không
# khớp .gitignore) — đây là điểm rsync không làm được: rsync không xoá file đã rời git.
# Giữ nguyên mọi thứ .gitignore liệt kê: .wwebjs_auth/ state.json node_modules/…
# ═══════════════════════════════════════════════════════════════════
set -euo pipefail

SERVER="${TALPHA_SERVER:-root@139.180.131.21}"
REPO_URL="${TALPHA_REPO_URL:-git@github.com:syanh12092024-maker/Talpha-New-16-6.git}"
REMOTE="${TALPHA_GIT_REMOTE:-talpha-new}"
REF="${1:-main}"
SRC_DIR=/opt/talpha-src
DEST_ROOT=/opt/talpha
SUBDIR=ops/whatsapp-alerts
PM2_APP=talpha-wa-alerts
DEST="$DEST_ROOT/$SUBDIR"

say() { printf '\n\033[1m▶ %s\033[0m\n' "$*"; }

say "Deploy $SUBDIR → $SERVER:$DEST_ROOT  (ref: $REF)"

# ─── Chốt commit: cả 2 đường deploy CÙNG 1 SHA ──────────────────────
# (Nếu để mỗi bên tự fetch, phiên khác push xen giữa là 2 đường ra 2 bản khác nhau.)
git fetch --quiet "$REMOTE" "$REF"
SHA_FULL="$(git rev-parse FETCH_HEAD)"
SHA="$(git rev-parse --short FETCH_HEAD)"
# Danh sách file ĐANG có trong git tại commit đó — dùng để dọn file lạ ở bước sau.
TRACKED="$(git ls-tree -r --name-only "$SHA_FULL" "$SUBDIR/" | sed "s|^$SUBDIR/||")"
echo "   commit: $SHA  ($(git log -1 --format=%s "$SHA_FULL"))"

# ─── (A) Server tự pull từ GitHub ───────────────────────────────────
say "Thử đường (A): server tự git fetch"
if ssh -o ConnectTimeout=15 "$SERVER" "
    set -e
    if [ ! -d '$SRC_DIR/.git' ]; then
        git clone --filter=blob:none '$REPO_URL' '$SRC_DIR' >/dev/null 2>&1 || exit 20
    fi
    git -C '$SRC_DIR' fetch --quiet origin '$REF' >/dev/null 2>&1 || exit 20
    # Commit Mac đã chốt phải có mặt trong clone của server, nếu không thì bỏ đường (A).
    git -C '$SRC_DIR' cat-file -e '$SHA_FULL^{commit}' >/dev/null 2>&1 || exit 20
    git -C '$SRC_DIR' archive '$SHA_FULL' '$SUBDIR' | tar -x -C '$DEST_ROOT'
"; then
    MODE="A (server git fetch)"
else
    rc=$?
    [ "$rc" -eq 20 ] || { echo "Deploy (A) lỗi bất thường (rc=$rc) — dừng."; exit "$rc"; }

    # ─── (B) Fallback: Mac đẩy archive của đúng commit đã chốt ──────
    say "Server chưa có quyền đọc GitHub → đường (B): đẩy git archive từ Mac"
    echo "   (muốn dùng (A): tạo deploy key trên server rồi thêm vào GitHub → repo Settings → Deploy keys)"
    git archive "$SHA_FULL" "$SUBDIR" | ssh -o ConnectTimeout=15 "$SERVER" "tar -x -C '$DEST_ROOT'"
    MODE="B (git archive từ Mac)"
fi

# ─── Dọn file lạ + ghi dấu commit đang chạy ─────────────────────────
# Giữ: file có trong git ($TRACKED) + mọi pattern trong .gitignore (state, auth,
# node_modules, package-lock…). Chỉ đụng FILE ở tầng gốc — không bao giờ xoá thư mục,
# để không có đường nào chạm được .wwebjs_auth/ (mất = phải quét lại QR).
say "Dọn file lạ ngoài git ở $DEST"
ssh -o ConnectTimeout=15 "$SERVER" "
    set -e
    cd '$DEST'
    printf '%s\n' '$TRACKED' > /tmp/talpha_tracked.txt
    echo '$SHA_FULL' > .deployed_sha
    n=0
    for f in * .[!.]*; do
        [ -f \"\$f\" ] || continue
        keep=0
        if grep -qxF \"\$f\" /tmp/talpha_tracked.txt; then keep=1; fi
        if [ \"\$keep\" = 0 ]; then
            while IFS= read -r pat; do
                case \"\$pat\" in ''|'#'*) continue;; esac
                pat=\"\${pat%/}\"
                case \"\$f\" in \$pat) keep=1; break;; esac
            done < .gitignore
        fi
        if [ \"\$keep\" = 0 ]; then
            echo \"  ✗ xoá rác ngoài git: \$f\"
            rm -f \"\$f\"
            n=\$((n+1))
        fi
    done
    if [ \"\$n\" = 0 ]; then echo '  → không có file lạ, thư mục khớp git'; fi
    rm -f /tmp/talpha_tracked.txt
"

# ─── Cài deps nếu package.json đổi, rồi restart ─────────────────────
say "npm install (chỉ khi cần) + pm2 restart $PM2_APP"
ssh -o ConnectTimeout=15 "$SERVER" "
    set -e
    cd '$DEST'
    sum=\$(md5sum package.json | cut -d' ' -f1)
    if [ ! -d node_modules ] || [ \"\$(cat .deps_md5 2>/dev/null)\" != \"\$sum\" ]; then
        echo '  → package.json đổi/thiếu node_modules: npm install'
        npm install --omit=dev --no-audit --no-fund
        echo \"\$sum\" > .deps_md5
    else
        echo '  → deps không đổi, bỏ qua npm install'
    fi
    pm2 restart '$PM2_APP' --update-env >/dev/null
"

# ─── Verify: bot phải THỰC SỰ gửi được tin sau restart ──────────────
# pm2 'online' KHÔNG đủ: bot online nhưng mất phiên WhatsApp thì vẫn im lặng.
# Bằng chứng duy nhất đáng tin là dòng log xác nhận nó đã gửi tin vào nhóm.
say "Đợi bot kết nối lại WhatsApp và gửi tin xác nhận (tối đa 120s)"
ssh -o ConnectTimeout=180 "$SERVER" "
    for i in \$(seq 1 24); do
        sleep 5
        # Chỉ xét phần log SAU lần khởi động gần nhất — bỏ dấu vết các lần restart cũ.
        tail -c 200000 /root/.pm2/logs/${PM2_APP}-out.log \
          | awk '/Khởi động bot TALPHA/ {buf=\"\"} {buf=buf \$0 ORS} END {printf \"%s\", buf}' \
          > /tmp/talpha_wa_boot.log
        if grep -q 'Đã gửi tin xác nhận kết nối' /tmp/talpha_wa_boot.log; then
            echo \"  ✅ bot đã gửi tin vào nhóm sau \$((i*5))s\"
            cat /tmp/talpha_wa_boot.log; rm -f /tmp/talpha_wa_boot.log
            exit 0
        fi
    done
    echo '  ❌ 120s không thấy dòng \"Đã gửi tin xác nhận kết nối\" — bot KHÔNG gửi được tin.'
    echo '     Thường là mất phiên WhatsApp (.wwebjs_auth) → phải quét lại QR: node pair.js'
    echo '  --- log sau lần khởi động gần nhất ---'
    cat /tmp/talpha_wa_boot.log; rm -f /tmp/talpha_wa_boot.log
    tail -20 /root/.pm2/logs/${PM2_APP}-error.log
    exit 1
"

ssh -o ConnectTimeout=15 "$SERVER" "
    pm2 jlist | node -e \"
        let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{
          const a=JSON.parse(d).find(x=>x.name==='$PM2_APP');
          console.log('  pm2:', a.pm2_env.status, '| restart#', a.pm2_env.restart_time, '| uptime', Math.round((Date.now()-a.pm2_env.pm_uptime)/1000)+'s');
          process.exit(a.pm2_env.status==='online'?0:1);
        });\"
"

say "XONG — deploy đường $MODE, commit $SHA (ghi ở $DEST/.deployed_sha)"
