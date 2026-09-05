# TALPHA — Bot báo cáo & cảnh báo WhatsApp

Gửi vào **1 nhóm WhatsApp**:
- **8h sáng**: digest tồn kho dưới ngưỡng + 1 tin **TỔNG TEAM** (cả team + xếp hạng marketer + phần chưa gán) rồi báo cáo ads từng marketer (ngày hôm qua).
- **13:30 và 22:00**: TỔNG TEAM + từng marketer với số **ĐANG CHẠY của hôm nay** (không kèm
  tồn kho/billing — hai thứ đó đã có ở tin 8h). Tin dán nhãn `HÔM NAY dd/mm · 13:30` và có
  dòng _số đang chạy trong ngày — chưa chốt_, để không ai đọc nhầm thành số cuối ngày rồi
  tưởng doanh thu tụt.
- **Mỗi `adsPollMinutes` (180')**: cảnh báo spend cao bất thường / campaign đốt tiền 0 tin nhắn.
- Lệnh **`/kho`** trong nhóm: trả tồn kho dưới ngưỡng ngay lúc đó.

Nguồn số = API dashboard. Base URL lấy theo thứ tự: env **`TALPHA_DASHBOARD_URL`** →
`config.json` → `dashboardBaseUrl` → mặc định `http://localhost:3001` (đúng trên SERVER).
Trên Mac 3001 là app broadcast (project khác) nên **test local phải đặt env**, đừng sửa
config.json rồi commit:
```bash
TALPHA_DASHBOARD_URL=http://localhost:3000 node bot.js
```
Log dòng đầu in ra base đang dùng — kiểm tra dòng đó trước khi nghi số sai.

Dùng `whatsapp-web.js` (bot không chính thức → phải quét QR bằng 1 số điện thoại, số
đó phải nằm trong nhóm đích).

## Cài trên server (Ubuntu, headless)
```bash
# deps hệ thống cho Chromium (puppeteer)
apt-get install -y libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
  libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 \
  libasound2t64 libpango-1.0-0 libcairo2 libatspi2.0-0 fonts-liberation

cd /opt/talpha/ops/whatsapp-alerts && npm install
```

## Ghép nhóm (chạy 1 lần)
```bash
node bot.js --list-groups     # quét QR (in ra terminal) → liệt kê các nhóm
```
1. Mở WhatsApp trên điện thoại → **Thiết bị đã liên kết → Liên kết thiết bị** → quét QR.
2. Copy tên nhóm đích vào `config.json` → `groupName`.

## Chạy nền
```bash
pm2 start bot.js --name talpha-wa-alerts
pm2 save
```

## Deploy lên server (chạy trên Mac, trong repo)
```bash
ops/whatsapp-alerts/deploy.sh          # deploy commit mới nhất của nhánh main
```
Script lấy code **từ git** (không rsync working tree — tránh đẩy nhầm code chưa commit),
bung sang `/opt/talpha/ops/whatsapp-alerts`, `npm install` khi `package.json` đổi,
`pm2 restart talpha-wa-alerts`, rồi **tự verify** bot có gửi được tin hay không.

- Đường (A): server tự `git fetch` trong clone `/opt/talpha-src` — cần **deploy key** GitHub
  trên server (`ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519` rồi dán public key vào repo →
  Settings → Deploy keys, chỉ quyền đọc).
- Chưa có key → script tự chuyển đường (B): Mac đẩy `git archive` sang server.
- Mac **luôn fetch trước để chốt 1 SHA**, cả 2 đường deploy cùng commit đó → không có
  cảnh phiên khác push xen giữa làm 2 đường ra 2 bản khác nhau.

**Dọn file lạ** — việc rsync không làm được: rsync chỉ ghi đè, file đã rời git thì nằm lại
server mãi (rác `rules.js.bak-E3` từng sống ở đó nhiều ngày). Sau khi bung code, script xoá
mọi **file ở tầng gốc** không có trong git và không khớp `.gitignore`.
→ Hệ quả: **file sinh ra trên server phải được khai trong `.gitignore`**, nếu không sẽ bị dọn.
Đã khai sẵn: `state.json`, `ads_state.json`, `package-lock.json`, `.deps_md5`, `.deployed_sha`.
Script **không bao giờ xoá thư mục** → `.wwebjs_auth/` (phiên WhatsApp) không có đường nào mất.

**Verify tự động**: `pm2 online` KHÔNG đủ — bot online nhưng mất phiên WhatsApp thì vẫn im
lặng. Script chờ tới 120s, đọc log kể từ lần khởi động gần nhất, và chỉ báo XONG khi thấy
dòng `Đã gửi tin xác nhận kết nối` (bằng chứng bot đã gửi thật vào nhóm). Không thấy →
exit 1 kèm log lỗi, thường là phải quét lại QR (`node pair.js`).

Commit đang chạy trên server ghi ở `/opt/talpha/ops/whatsapp-alerts/.deployed_sha`:
```bash
ssh root@169.58.33.8 'cat /opt/talpha/ops/whatsapp-alerts/.deployed_sha'   # so với git rev-parse main
```

## Tinh chỉnh (`config.json`)
- `soonDays` (15): đủ bán < N ngày = "sắp hết".
- `minPerDay` (0.2): bỏ qua SKU gần như không bán.
- `adsPollMinutes` (180): chu kỳ cảnh báo ads.
- `adsSpikeRatio`/`adsMinTotalForSpike`: ngưỡng spend bất thường.
- `adsWasteSpend` (300k): ngưỡng campaign đốt tiền 0 tin nhắn.
- `dailyReport.hour` (8): giờ gửi báo cáo đầu ngày.
- `dailyReport.intradaySlots` (`["13:30","22:00"]`): các mốc báo cáo giữa ngày. Để `[]` là tắt.
- `dailyReport.intradayCatchUpMinutes` (60): cửa sổ bù. Bot bật lại muộn hơn mốc quá số phút
  này thì **bỏ hẳn mốc đó hôm nay** thay vì bắn bù — tin dán nhãn "13:30" mà rơi vào 21h thì
  vừa sai nhãn vừa dẫm chân mốc 22h ngay sau.
- `quietStartHour`/`quietEndHour` (23→7): không gửi ban đêm.

## Kiểm tra sau khi deploy
Mốc giữa ngày rà theo vòng 5' (không phải timer hẹn giờ) nên pm2 restart không làm mất mốc.
Muốn thử ngay mà không đợi tới 13:30 — chạy **từ chính tiến trình bot**, script một-lần bên
ngoài không gửi được (xem ghi chú `TEAM_NOW` trong `bot.js`):
```bash
pm2 stop talpha-wa-alerts && node bot.js --intraday-now; pm2 start talpha-wa-alerts
```

Phần quyết định "mốc này có phải gửi bây giờ không" nằm riêng ở `schedule.js` để test được
(đây đúng chỗ từng sinh bug giờ giấc — báo cáo 8h bắn lúc 0h05):
```bash
node schedule.test.js
```

## Lệnh trong nhóm
- Gõ `/kho` → bot trả danh sách SKU đang dưới ngưỡng ngay lúc đó.

## Lưu ý
- Phiên đăng nhập lưu trong `.wwebjs_auth/` (gitignore) — quét QR 1 lần, sau đó tự động.
- Nếu đổi máy/xoá phiên → phải quét lại QR.
