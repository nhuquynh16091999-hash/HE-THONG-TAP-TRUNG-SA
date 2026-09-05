---
name: talpha-system
description: Bản đồ hệ thống + rule chỉ số + bẫy mapping của TALPHA (dashboard ads GCC, báo cáo Google Sheets, tồn kho, bot WhatsApp, BigQuery talpha-faos-2026). LUÔN dùng skill này TRƯỚC KHI làm bất cứ việc gì đụng tới số liệu, dashboard, sheet báo cáo, sync, tồn kho, bot cảnh báo, hay chẩn đoán "số sai/thiếu/lệch" trong dự án TALPHA — kể cả khi user chỉ hỏi "sao spend hôm nay thiếu", "đơn của X đâu", "thêm TKQC mới", "sửa báo cáo", "bot không gửi tin". Không đọc skill này trước khi sửa code liên quan số liệu = rủi ro phá rule đã được CEO duyệt.
---

# TALPHA System — Bản đồ hệ thống & rule chỉ số

Dự án TALPHA: bán trang sức/mỹ phẩm qua Facebook Ads + chat-sale + COD tại GCC
(UAE/Saudi/Kuwait/Oman/Qatar/Bahrain + Taiwan). Hệ thống = dashboard + sheet báo cáo
+ quản lý kho + cảnh báo WhatsApp, xoay quanh BigQuery `talpha-faos-2026.TALPHA_Dataset`.

## 1. Kiến trúc — cái gì chạy ở đâu

```
Meta API (14 TKQC) ─┬─(launchd MỖI GIỜ: daily_guarded.sh → sync_month.py)─► BQ ─► format_all.py ─► ~50 Google Sheets
Poscake POS (7 shop)┘
Meta API + POS ──(live)──► dashboard /api/talpha/realtime ─► tab Ads Command Center + bot WA báo cáo marketer
POS live ────────────────► /api/talpha/inventory ─► tab Sản phẩm & Kho + bot WA digest tồn kho
BQ fb_ads_data ──────────► /api/talpha/ads-alerts ─► bot WA cảnh báo spend
```

| Thành phần | Chạy ở đâu | Ghi chú |
|---|---|---|
| Dashboard Mac | pm2 `talpha-dashboard`, port **3000** | repo `dashboard-ui/` |
| Dashboard server | 169.58.33.8, pm2 `talpha-dashboard`, port **3001** | `/opt/talpha/`, deploy bằng `scripts/deploy_server.sh` (git pull) |
| Sync + Sheet | launchd `com.talpha.dailyreport` (StartInterval 3600s, guard 50') | chạy bản **runtime** `~/talpha_reports/` — KHÔNG phải repo (xem bẫy #1) |
| Export worker | launchd `com.talpha.export-worker` (poll BQ `export_jobs` 20s) | nút "Xuất Sheet" trên web đẩy job vào |
| Bot WhatsApp | server 169.58.33.8, pm2 `talpha-wa-alerts` | code repo `ops/whatsapp-alerts/`, nhóm "BOT AI THÔNG BÁO" |
| `broadcast-web`/`broadcast-cron` (pm2 Mac, ns `broadcast`) | `/Users/syanh/Desktop/Bắn bot AI/app` | **DỰ ÁN KHÁC** (broadcast Messenger). Trước 04/08 tên là `talpha-broadcast`/`talpha-cron`, F3 đã đổi để hết nhầm namespace |
| pm2 config | `ops/pm2/ecosystem.mac.config.js` · `ops/pm2/ecosystem.server.config.js` | 1 file/máy, app TALPHA ở namespace `talpha` → `pm2 restart talpha` |

## 2. Rule chỉ số BẮT BUỘC (CEO đã duyệt — sai = số bậy)

1. **Doanh thu** = `SUM(cod ÷ SỐ CHIA CỦA SHOP)` WHERE `status_category='GIAO_THANH_CONG'
   AND cod>0`. KHÔNG dùng `total_price`. "GTC hôm nay ≈ 0" là ĐÚNG (COD trễ), không phải bug.
   ⚠️ **X13 — số chia KHÔNG phải lúc nào cũng 100**: 6 shop GCC lưu minor units
   (cod=9900 ⇒ 99,00 SAR) → ÷100; shop **Đài lưu NGUYÊN TWD** (cod=950 ⇒ 950 TWD) → ÷1.
   Bảng số chia: `talpha_rules.json → markets.*.pos_money_divisor`. Gõ `/100` cứng cho mọi
   shop = tiền Đài tụt đúng 100 lần (đã dính 20/08). Thêm shop mới: lấy đơn thật từ POS API
   so với giá bán thật rồi mới khai.
2. **Tỷ giá → VND** theo `shop_label`: AE 7010 · SA 6850 · KW 83000 · OM 66700 ·
   QA 7050 · BH 68000 · **TW 800** (nhiều bản code cũ thiếu TW — kiểm tra trước khi tin).
3. **Ads spend đã là VND** (không ÷100, không quy đổi). Cột `date`, không phải `date_start`.
4. **Marketer của đơn** — rule 3 bậc: (a) tag POS `JSON_EXTRACT_SCALAR(marketer,'$.name')`;
   (b) không tag/ngoài team → `ad_id` → chủ campaign; (c) vẫn không → tab "(không gán)".
   KHÔNG bỏ đơn lặng lẽ.
5. **Join ads↔đơn**: `CAST(fb_ads_data.ad_id AS STRING) = sale_order.ad_id`.
6. **Timezone**: `inserted_at` là UTC. Sheet gom đơn theo VN+7; spend theo tz từng TKQC
   (account "Trung Đông múi h Mỹ" = giờ Los Angeles) → **từng ngày lệch, cả tháng khớp**.
7. **Campaign chứa từ "test"** (đứng riêng) → tách khỏi mọi báo cáo doanh số, vào file
   `[Test] Ads - <marketer>` (`~/talpha_reports/test_files.json`).
8. 1 TKQC chứa campaign của NHIỀU marketer và ngược lại — đừng coi tổng account = spend 1 người.

Nguồn văn bản đầy đủ: `docs/TALPHA_METRIC_RULES.md` (source of truth) + `docs/ARCHITECTURE_2026.md`.

## 3. Bẫy chết người (đọc trước khi sửa code)

1. **HAI BẢN CODE SYNC, kiến trúc đã lệch hẳn**: repo `sync/talpha/` (modular, 459 dòng
   + `sync/core/*`) vs runtime `~/talpha_reports/runtime/sync/talpha/talpha_sync.py`
   (monolith 656 dòng, không có core/). Launchd chạy bản RUNTIME (Desktop bị chặn Full
   Disk Access). Fix sync → phải vá đúng bản đang chạy, tốt nhất vá cả hai.
2. **Danh sách 14 TKQC nằm ở ~6 nơi**: `config/projects/talpha.yaml` (dashboard đọc),
   `runtime/config/ad_accounts.json` (sync đọc), `ops/talpha_reports/ad_accounts.json`
   (bản git), `sync/core/meta_client.py`, `ACCOUNT_NAMES` trong realtime route +
   ads-command page. Thêm TKQC = sửa đủ các chỗ, thiếu 1 chỗ = undercount spend âm thầm.
3. **Logic gán marketer bị nhân bản ~7 chỗ** (format_all.py, realtime route ×2,
   ads-alerts route, bot daily_report.js, talpha-inventory.ts…) — regex khác nhau,
   output khác nhau (`Loc` vs `Lộc`). Sửa mapping 1 chỗ KHÔNG lan sang chỗ khác.
4. **Chẩn đoán "số sai": KHÔNG BAO GIỜ so Sheet ↔ BigQuery** — cùng nguồn, cùng sai.
   Ground truth: spend = Meta API trực tiếp; đơn = POS API live. Quy trình 5 bước ở
   `docs/TALPHA_METRIC_RULES.md` §6.
5. **Sheet vs Dashboard lệch là CỐ HỮU** (sync 3h vs live; tag POS vs ad_id; ngày tz
   TKQC vs ngày VN) — đừng "fix" cho khớp từng ngày.
6. **Ads Command Center dùng doanh thu ĐẶT (mọi đơn), tab BQ dùng GTC** → ROAS 2 nơi
   khác bản chất, không so trực tiếp.
7. **BQ free tier**: KHÔNG streaming/DML — chỉ LOAD JOB (WRITE_TRUNCATE atomic).
   `daily.sh` bản cũ (bq rm trước khi sync) là NGUY HIỂM, đừng chạy.
8. **Bot WA đọc `localhost:3001`**: đúng trên server; trên Mac 3001 là app broadcast
   → test bot trên Mac sẽ 404 im lặng.
9. **Bẫy Unicode tên**: POS lưu "Chu Thuý" (sắc trên Y) ≠ "Thúy" — match bằng `"THU"`.
10. Chi tiết đầy đủ (route hỏng, dead code, caps phân trang, file ngoài git…):
    đọc `references/landmines.md`.

## 4. Khi cần thao tác vận hành

Thêm TKQC, chữa số thiếu, re-sync tay, deploy bot, pair lại WhatsApp, xử lý lock kẹt,
vị trí log — đọc `references/runbook.md` (làm theo từng bước, đừng chế).

## 5. Tài liệu gốc trong repo

- `docs/TALPHA_METRIC_RULES.md` — rule chỉ số chi tiết + quy trình chẩn đoán (source of truth)
- `docs/ARCHITECTURE_2026.md` — kiến trúc 6 tầng + "cái gì chạy ở đâu" (đã đối chiếu code 03/08, mục F4)
- `docs/proposals/AUDIT_HE_THONG_2026-07-29.md` — audit toàn hệ thống + lộ trình tối ưu P0/P1/P2
