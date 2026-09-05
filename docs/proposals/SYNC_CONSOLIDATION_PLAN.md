# Kế hoạch hợp nhất 2 engine sync TALPHA (P1.5)

> Trạng thái 29/07/2026 (sau P1): cả 2 engine đã nằm trong git, deploy runtime đã có
> script một chiều. Việc CÒN LẠI — gộp 2 engine làm 1 — cần 1-2 tuần chạy song song,
> làm theo checklist dưới đây.

## Hiện trạng sau P1

| | Engine repo | Engine runtime (ĐANG CHẠY) |
|---|---|---|
| Vị trí | `sync/talpha/talpha_sync.py` + `sync/core/*` | `~/talpha_reports/runtime/sync/` — git-track tại `ops/talpha_reports/runtime_sync/` |
| Kiến trúc | modular 459 dòng | monolith 656 dòng |
| Account list | `sync/core/meta_client.py` hard-code | `runtime/config/ad_accounts.json` |
| Khác biệt hành vi | không sync `fb_adset_data` | có `fb_adset_data` (autodetect ⚠️), field `project_id`, default BQ project từ `.env` |
| Ai gọi | chạy TAY từ terminal | launchd `com.talpha.dailyreport` mỗi giờ |

Quy trình sửa từ nay: **sửa bản trong git** (`ops/talpha_reports/runtime_sync/` cho engine
đang chạy) → `ops/talpha_reports/deploy_runtime.sh --yes`. KHÔNG sửa tay `~/talpha_reports`.

## Checklist hợp nhất (khi có 1-2 tuần theo dõi)

1. **Chọn đích**: repo `sync/` (modular) là engine tương lai.
2. **Port 3 khác biệt** từ monolith vào `sync/`: ✅ XONG (verify 03/08)
   - [x] đọc account từ `ad_accounts.json` qua `config_loader` — 14 active; hard-code
     `TALPHA_AD_ACCOUNTS` giữ làm FALLBACK có warning (chủ đích, không phải sót)
   - [x] sync `fb_adset_data` với SCHEMA TƯỜNG MINH (`talpha_sync.py` — bỏ autodetect)
   - [x] field `project_id` trong rows
3. **Shadow run 1 tuần**: chạy repo engine ghi vào bảng `_shadow` (ví dụ `fb_ads_data_shadow`)
   song song launchd; mỗi ngày script so sánh row-count + SUM(spend)/SUM(cod) từng account/ngày
   giữa bảng thật và shadow. Lệch = sửa tiếp, khớp 7 ngày liên tục = đạt.
   - Nhật ký: 30/07 dựng + FAIL(1 nhóm cod GTC — đơn sửa giữa 2 snapshot);
     31/07–01/08 máy tắt lúc 21:30 → KHÔNG chạy (lỗ hổng lịch); 02/08 PASS ①.
   - 03/08: thêm `RunAtLoad` vào plist `com.talpha.shadowsync` (bản git:
     `ops/talpha_reports/com.talpha.shadowsync.plist`) — máy bật lại là chạy bù,
     hết cảnh thủng ngày validation vì máy tắt.
   - 03/08: chạy bù buổi sáng lộ 2 lớp FALSE-POSITIVE trong `compare_shadow.py`,
     đã fix: (1) ads bound theo ngày VN → account "múi h Mỹ" bị so ngày CHƯA CHỐT
     (10h VN = ~19-20h hôm trước ở LA) → đổi sang bound `ADS_DONE` mốc UTC-8;
     (2) tol % vô nghĩa khi baseline ≈0 đầu tháng (real=0 vs shadow=1 đơn GTC
     9.900) → thêm `abs_floor` cho check cod GTC (50k) + items qty (30).
     Lưu ý vận hành: sync + compare phải chạy LIỀN NHAU (như shadow_run.sh) —
     compare lẻ trên snapshot shadow cũ sẽ lệch oan chiều ngược lại.
   - Đếm PASS theo NGÀY có chạy; cutover sớm nhất ~09–10/08 nếu PASS liên tục.
4. **Cutover**: đổi `sync_month.py` import sang engine repo (qua deploy_runtime), giữ monolith
   thêm 1 tuần làm rollback, rồi xoá.
5. **Dọn**: xoá `runtime/sync/{auus1,hnle,stramark,t1,trendify,zen8}` (dự án khác, không dùng).

## Lưu ý an toàn

- Mọi thay đổi engine: verify bằng quy trình `docs/TALPHA_METRIC_RULES.md` §6
  (so Meta API / POS live, KHÔNG so Sheet↔BQ).
- Không đổi hành vi WRITE_TRUNCATE atomic + raise-khi-fetch-fail (chống sự cố 06/07).
- BQ free tier: chỉ LOAD JOB, không DML/streaming.
