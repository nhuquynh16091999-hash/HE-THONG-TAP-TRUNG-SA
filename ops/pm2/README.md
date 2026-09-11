# PM2 TALPHA — một file ecosystem, một máy chủ

`ecosystem.vps.config.js` là **file ecosystem DUY NHẤT** của dự án.

| App | Cổng | Trạng thái |
|---|---|---|
| `talpha-dashboard` | 3000 | Đang chạy trên `139.180.131.21` (`/opt/talpha`) |
| `talpha-wa-alerts` | — | **Tắt** — chưa cài, chưa quét QR (xem chú thích trong file) |

Trước 11/09/2026 có **bốn** file pm2 cho một dự án: bản Mac (Cloudflare Tunnel +
caffeinate), bản máy chủ cũ `169.58.33.8` cổng 3001, bản VPS, và một bản nữa ở
`dashboard-ui/ecosystem.config.js`. Cả bốn khai cùng một tên app `talpha-dashboard`
với ba cổng khác nhau. Thêm file pm2 ở chỗ khác là quay lại đúng cái bẫy vừa gỡ.

## Namespace `talpha` — vì sao bắt buộc

Máy chủ có thể chạy app của dự án khác trên cùng pm2 daemon. App TALPHA nằm
namespace `talpha` để lệnh hàng loạt không đụng nhau:

```bash
pm2 restart talpha        # CHỈ app TALPHA
pm2 restart all           # ĐỪNG — đụng cả dự án khác
```

## Máy chủ

Dựng lần đầu và mỗi lần cập nhật code: xem `docs/DEPLOY_VPS.md`. Tóm tắt:

```bash
bash ops/deploy/from-mac.sh              # từ máy Mac — dựng/cập nhật toàn bộ
```

Trên chính máy chủ:

```bash
pm2 start /opt/talpha/ops/pm2/ecosystem.vps.config.js --only talpha-dashboard
pm2 save
pm2 logs talpha-dashboard --lines 40
```

Dashboard **không tự reload** — sửa code xong phải `npm run build` rồi
`pm2 restart talpha-dashboard`, không thì vẫn chạy bản cũ.

## Máy Mac

Máy Mac là **máy dev**, không phục vụ ai: chạy `cd dashboard-ui && npm run dev`.
Không có pm2, không launchd, không cron. Build ở máy Mac **không phải** deploy —
deploy là `ops/deploy/from-mac.sh`.

## Job theo giờ không nằm trong pm2

Hai việc chạy nền trên máy chủ là **systemd timer**, không phải pm2:

| Timer | Làm gì | Xem |
|---|---|---|
| `talpha-sync.timer` | Kéo đơn POS + chi tiêu Meta vào BigQuery | `ops/deploy/vps-sync-setup.sh` |
| `talpha-report.timer` | Đọc BigQuery rồi ghi báo cáo Google Sheets | `ops/deploy/vps-reports-setup.sh` |

```bash
systemctl list-timers 'talpha-*'
journalctl -u talpha-sync -n 40 --no-pager
```

Thêm job sync vào pm2 = chạy sync hai lần.
