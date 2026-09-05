# PM2 TALPHA — 1 file ecosystem cho mỗi máy

| Máy | File | App | Cổng |
|---|---|---|---|
| Mac (dev + dashboard nội bộ) | `ecosystem.mac.config.js` | `talpha-dashboard` | 3000 |
| Server 169.58.33.8 (`/opt/talpha`) | `ecosystem.server.config.js` | `talpha-dashboard`, `talpha-wa-alerts` | 3001 |

Trước F3 mỗi máy có 2–3 file ecosystem rải rác (`dashboard-ui/ecosystem.config.js`,
`sync/talpha/ecosystem.sync.config.js`, một bản chết ở repo root của dự án AUUS).
Không ai biết bản nào đang chạy thật. Giờ **mỗi máy đúng 1 file, đều nằm ở đây** —
thêm file pm2 chỗ khác là quay lại đúng cái bẫy vừa gỡ.

## Namespace `talpha` — vì sao bắt buộc

Cả 2 máy đều chạy app của dự án khác trên cùng pm2 daemon (Mac: `broadcast-web`;
server: `auus1-*`, `pialpha-*`). App TALPHA nằm namespace `talpha` để lệnh hàng loạt
không đụng nhau:

```bash
pm2 restart talpha        # CHỈ app TALPHA
pm2 restart all           # ĐỪNG — đụng cả dự án khác
```

## Mac

```bash
pm2 start ops/pm2/ecosystem.mac.config.js && pm2 save
cd dashboard-ui && npm run build && pm2 restart talpha-dashboard   # sau khi sửa code
```

Dashboard Mac **KHÔNG tự reload** — sửa code xong phải build + restart, không thì
vẫn chạy bản cũ. Máy khởi động lại thì LaunchAgent `com.talpha.pm2-resurrect` lo
resurrect; KHÔNG dùng `pm2 startup`. pm2 daemon phải khởi động từ shell có Full
Disk Access (đọc được `~/Desktop`), không thì EPERM lúc nạp binary next.

Sync/Sheet trên Mac chạy bằng launchd (`com.talpha.dailyreport`,
`com.talpha.export-worker`, `com.talpha.shadowsync`, 2 job `com.talpha.snapshot-*`)
trỏ vào runtime `~/talpha_reports`, **không** nằm trong pm2. Thêm app sync vào pm2
= chạy sync 2 lần.

## Log — vì sao có `merge_logs` + `out_file`

Cả 2 file đều khai `merge_logs: true` và `out_file`/`error_file` tường minh. Không khai
thì pm2 gắn số id vào tên file (`talpha-dashboard-out-5.log`), nên mỗi lần
`pm2 delete` + `pm2 start` là log nhảy sang file mới và mọi lệnh `tail` trong runbook
trỏ vào file chết. Chỉ đặt `out_file` là chưa đủ — còn `instances` thì pm2 vẫn gắn id,
phải có `merge_logs: true` đi kèm.

## Server — deploy

```bash
ssh root@169.58.33.8 'bash /opt/talpha/scripts/deploy_server.sh'
```

Script làm: `git merge --ff-only origin/main` → build nếu `dashboard-ui/` hoặc
`config/` đổi → `pm2 restart talpha` → curl kiểm tra `:3001/talpha`.
Xem trước không đổi gì: `DRY_RUN=1 bash scripts/deploy_server.sh`.

Vì sao git pull chứ không rsync từng file: rsync **không xoá** file đã bỏ khỏi repo.
Đã dính 2 lần — `daily.sh` nguy hiểm (P0-B2) và `ecosystem.config.js` chết của AUUS
(F3) nằm lại trên server hàng tuần sau khi xoá ở repo.

File ngoài git (`.env`, `node_modules`, `.next`, `.wwebjs_auth`, `state.json`) đều
trong `.gitignore` → `git pull` không đụng tới.

## Cutover `/opt/talpha` sang git working copy — làm 1 lần

`deploy_server.sh` yêu cầu `/opt/talpha` là working copy. Nếu chưa (bản rsync cũ):

**Điều kiện trước tiên — deploy key.** Repo là private và server KHÔNG có credential
GitHub nào (`git ls-remote https://github.com/...` trả `could not read Username`).
Clone bằng HTTPS sẽ treo/fail. Phải dùng deploy key read-only:

1. ✅ Key đã sinh sẵn trên server: `/root/.ssh/talpha_deploy_key(.pub)` (04/08).
2. ✅ Host `github-talpha` đã khai trong `/root/.ssh/config` (04/08):

   ```
   Host github-talpha
       HostName github.com
       User git
       IdentityFile /root/.ssh/talpha_deploy_key
       IdentitiesOnly yes
   ```

3. ⏳ **CHỜ USER** — dán nội dung `/root/.ssh/talpha_deploy_key.pub` vào GitHub →
   repo `Talpha-New-16-6` → Settings → Deploy keys → Add deploy key,
   **KHÔNG** tick "Allow write access".

Kiểm tra bước 3 xong chưa (chạy trên server) — ra danh sách ref là xong,
ra `Permission denied (publickey)` là chưa dán:

```bash
git ls-remote git@github-talpha:syanh12092024-maker/Talpha-New-16-6.git HEAD
```

Có key rồi mới cutover:

```bash
ssh root@169.58.33.8
cp -a /opt/talpha /opt/talpha.bak.$(date +%F)      # phao cứu sinh, xoá sau khi chạy ổn 1 tuần
cd /opt/talpha
git init && git remote add origin git@github-talpha:syanh12092024-maker/Talpha-New-16-6.git
git fetch origin main
git reset origin/main                               # mixed: chỉ nạp index, KHÔNG ghi đè file
git status --short                                  # ĐỌC KỸ: file nào server đang lệch repo
git checkout -f -B main origin/main                 # .env / .next / node_modules an toàn nhờ .gitignore
ls -la dashboard-ui/.env ops/whatsapp-alerts/.env   # XÁC NHẬN env còn nguyên TRƯỚC khi restart
pm2 start /opt/talpha/ops/pm2/ecosystem.server.config.js && pm2 save
```

Bước `git reset` + `git status` là để **nhìn trước** danh sách lệch; `git checkout -f`
ngay sau đó ghi đè hết. File nào server đang giữ bản vá tay mới hơn repo thì phải đưa
ngược về repo + commit TRƯỚC, không có đường lùi ngoài bản `.bak`.

Sau cutover, `deploy_server.sh` fail ở bước `--ff-only` nghĩa là có người sửa tay
trên server → xử lý bằng tay, đừng merge bừa.
