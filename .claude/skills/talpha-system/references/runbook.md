# TALPHA — Runbook thao tác vận hành

> Làm theo từng bước. Mỗi thao tác ghi rõ máy nào (Mac / server 169.58.33.8).

## 1. Thêm TKQC mới (Mac)

1. Verify quyền token trước: `curl "https://graph.facebook.com/v21.0/act_<ID>?access_token=$TALPHA_META_ACCESS_TOKEN"` (token System User talpha-sync, BM Mua 02 — lấy từ `~/talpha_reports/runtime/.env`).
2. Sửa ĐỦ các chỗ (thiếu 1 = undercount âm thầm):
   - `~/talpha_reports/runtime/config/ad_accounts.json` (bản sync THẬT đọc)
   - `ops/talpha_reports/ad_accounts.json` (bản git)
   - `sync/core/meta_client.py` `TALPHA_AD_ACCOUNTS`
   - `config/projects/talpha.yaml` `meta_ads.ad_account_ids` (+ bản `dashboard-ui/config/projects/talpha.yaml` nếu có)
   - `ACCOUNT_NAMES` trong `dashboard-ui/src/app/api/talpha/realtime/route.ts` VÀ `dashboard-ui/src/app/talpha/ads-command-center/page.tsx`
3. Re-sync: chạy `sync_fb_ads` qua repo venv rồi `format_all.py` (giữ lock — xem §4).
4. Dashboard Mac: `cd dashboard-ui && npm run build && pm2 restart talpha-dashboard`.
5. Server: deploy rồi build + restart tương tự (xem §5).

## 2. Chẩn đoán "số sai / thiếu spend / thiếu đơn"

Theo đúng `docs/TALPHA_METRIC_RULES.md` §6 — tóm tắt:
1. Ground truth: spend = Meta API trực tiếp (`level=campaign, time_increment=1`); đơn = POS API live. **KHÔNG so Sheet↔BQ.**
2. So Meta ↔ BQ `fb_ads_data` theo account: lệch >2% → sync ads hỏng → xem `~/talpha_reports/daily_YYYYMMDD.log` (grep "Read timed out" / "request limit" / "PermissionError").
3. So POS live ↔ `sale_order` theo marketer/ngày → sync đơn hỏng (grep "chết ở page").
4. Dấu hiệu kinh điển: ngày có ĐƠN nhưng 0 SPEND = sync ads mất account/ngày; đơn tụt so với sáng = sync ghi đè bộ thiếu.
5. Nhớ: GTC hôm nay ≈ 0 là đúng; từng ngày lệch tz là cố hữu (cả tháng mới khớp).

## 3. Re-sync tay (chữa cháy, Mac)

```bash
cd ~/talpha_reports && GOOGLE_APPLICATION_CREDENTIALS=runtime/bigquery_key.json \
  <repo>/.venv/bin/python sync_month.py && .venv/bin/python format_all.py
```
- Chạy NỀN (sync full ~50-60'; SA ~10k đơn phân trang chậm). Backup `bq cp` 5 bảng trước nếu sợ.
- Kill giữa chừng: phải `pkill -f daily_guarded` (wrapper tự chạy tiếp format_all).
- KHÔNG BAO GIỜ chạy `daily.sh` (bản bq rm nguy hiểm).

## 4. Lock kẹt (sheet không cập nhật, export không chạy)

- Lock = thư mục `~/talpha_reports/.lock` (mkdir), dùng chung daily_guarded ↔ export_worker.
- Kẹt >45' thì daily_guarded tự dọn; muốn dọn tay: kiểm tra không còn process
  (`pgrep -f "sync_month|format_all|daily_guarded"`) rồi `rmdir ~/talpha_reports/.lock`.

## 5. Deploy server 169.58.33.8

- Cách chuẩn (F3): `ssh root@169.58.33.8 'bash /opt/talpha/scripts/deploy_server.sh'` — git pull + build + `pm2 restart talpha`. `DRY_RUN=1` để xem trước. Cần `/opt/talpha` đã cutover sang git; chưa cutover thì script báo lỗi, xem `ops/pm2/README.md`.
- Dashboard: `/opt/talpha/dashboard-ui`, pm2 `talpha-dashboard` port **3001** (3000 bị auus1 chiếm — ĐỪNG kill). Login lỗi → kiểm tra `AUTH_URL` phải trỏ :3001.
- Bot WA: `/opt/talpha/ops/whatsapp-alerts`, pm2 `talpha-wa-alerts`. Sửa local KHÔNG tự hiệu lực — phải deploy. Restart là bot gửi tin "đã kết nối nhóm" vào nhóm WA, đừng restart vô cớ.
- pm2: 2 app TALPHA nằm namespace `talpha` → `pm2 restart talpha` chỉ đụng chúng, không đụng `auus1-*`/`pialpha-*`. Config duy nhất: `ops/pm2/ecosystem.server.config.js`.
- Nếu buộc phải rsync tay: nhớ rsync từng file KHÔNG xoá file đã bỏ khỏi repo (đã dính `daily.sh` P0-B2, `ecosystem.config.js` chết F3).
- Web chết ERR_CONNECTION_REFUSED trên Mac: thường do node thiếu Full Disk Access → pm2 EPERM crash-loop; resurrect qua LaunchAgent `com.talpha.pm2-resurrect`, KHÔNG dùng `pm2 startup`.

## 6. Bot WhatsApp

- Phiên chết → `pair.js` dựng trang QR port 3099 trên server (mở ufw tạm, xong đóng); nếu treo: `pm2 stop`, `rm -rf .wwebjs_auth .wwebjs_cache`, start lại quét QR.
- KHÔNG dùng `getChats()` (lỗi "r" cố hữu) — gửi thẳng `sendMessage(groupId, …)`, groupId trong `config.json` (`120363428990065476@g.us`).
- Test local trên Mac: nhớ 3001 là app broadcast → đổi baseUrl sang `http://localhost:3000` tạm thời, đừng commit.

## 7. Vị trí log

- Sync/Sheet: `~/talpha_reports/daily_YYYYMMDD.log`
- pm2: `~/.pm2/logs/` (chú ý: chưa có logrotate, file có thể rất lớn)
- launchd: `launchctl list | grep talpha`; plist ở `~/Library/LaunchAgents/com.talpha.*`

## 8. Billing TKQC (thêm 30/07)

- Route `/api/talpha/billing`: trạng thái + số nợ chờ quét (balance) + thẻ đuôi số +
  spend hôm nay/hôm qua của 14 TKQC. Bot WA: digest 8h + cảnh báo 3h (UNSETTLED /
  khoá khi đang chạy / nợ ≥80% ngưỡng).
- **Ngưỡng quét Meta không còn trên API** → khai tay `bill_threshold_vnd` cho từng
  account trong `ops/talpha_reports/ad_accounts.json` (xem ngưỡng trong Trình quản lý
  TKQC → Cài đặt thanh toán). Chưa khai = chỉ có digest + cảnh báo fail, không có
  cảnh báo "sắp quét".
- UNSETTLED = thanh toán thất bại: nạp tiền thẻ → Trình quản lý TKQC → thanh toán lại.

## 9. Meta token chết

Triệu chứng: sync ads 0 rows mọi account / lỗi OAuth. Lấy lại: Business Manager "Mua 02"
→ System User `talpha-sync` (app abcd) → generate token mới → cập nhật
`~/talpha_reports/runtime/.env` `TALPHA_META_ACCESS_TOKEN` (+ env dashboard nếu có).
Chi tiết: memory `talpha-meta-token`.
