# AUDIT HỆ THỐNG TALPHA — Hiện trạng & Đề xuất tối ưu (29/07/2026)

> Kết quả rà soát toàn bộ codebase + hệ thống đang chạy (Mac + server 169.58.33.8),
> đối chiếu với mục tiêu cao nhất: **hệ thống quản lý tập trung** cho team ads GCC.
> Đọc kèm: `docs/ARCHITECTURE_2026.md`, `docs/TALPHA_METRIC_RULES.md`.

---

## PHẦN 1 — Hiện trạng theo 5 mục tiêu

### 1.1 Dashboard chỉ số ads team — ✅ CÓ, nhưng 2 pipeline số lệch nhau

- 8 tab tại `/talpha` (`dashboard-ui/src/components/talpha/dashboard-shell.tsx`).
- **6 tab đọc BigQuery** (CEO, Marketing, P&L, P&L theo SP, Khách hàng, Market Intel):
  client tự viết SQL inline → POST `/api/query`.
- **2 tab gọi live** (Ads Command Center → `/api/talpha/realtime` = Meta API + POS hybrid;
  Sản phẩm & Kho → `/api/talpha/inventory` = POS live).
- Text-to-SQL "Hỏi dashboard": **Gemini** (`ceo-ask/route.ts`), fallback 2.5-flash → 2.0-flash,
  guardrail SELECT-only. (Doc ARCHITECTURE_2026 vẫn ghi Claude — đã lỗi thời.)

### 1.2 Báo cáo Sheet — ✅ CÓ, chạy mỗi giờ, là source of truth rule chỉ số

- Chain: launchd `com.talpha.dailyreport` (**StartInterval 3600s**, guard 50')
  → `daily_guarded.sh` → `sync_month.py` → `format_all.py` → **~50 Google Sheets**
  (42 file marketer×market + 7 TỔNG + 1 TỔNG TEAM + Taiwan/Test files).
- Xuất tay: nút "Xuất Sheet" → BQ `export_jobs` → launchd `com.talpha.export-worker` (poll 20s).

### 1.3 Quản lý kho — ✅ CÓ, POS live + 3 lớp fallback

- Tab Sản phẩm & Kho: POS Poscake live (7 shop) → fallback BQ `inventory_snapshot`
  → fallback cuối là **data tĩnh hard-code 19/06** (`components/talpha/data/inventory.ts`).
- Saudi/UAE đọc Google Sheet CSV public với parser dựa chuỗi literal — đổi layout là vỡ im lặng.
- `inventory_snapshot` + `ads_command_snapshot` **không có scheduler nào gọi** — chỉ ghi khi bấm tay.

### 1.4 Phân tích (marketer/thị trường/sản phẩm/tồn) — ⚠️ NỬA VỜI

- Có CEO Intelligence + Smart Insights (rule-based) + Hỏi dashboard (Gemini).
- **8 view analytics đã deploy (`sql/talpha/views/`) nhưng dashboard KHÔNG dùng view nào** —
  chỉ `faos_brain` (đang đóng băng) đọc. Mỗi tab tự viết SQL thô → mỗi tab một định nghĩa.
- **`order_items` rỗng/không tin được** → P&L theo SP và Market Intel số sai;
  COGS không được trừ ở bất kỳ tab nào dù `talpha.yaml` có `cost_price` 27 SKU.

### 1.5 Cảnh báo WhatsApp — ✅ CÓ, chạy trên server, 3 loại tin sống + 1 dead code

- Bot `ops/whatsapp-alerts/` (repo) chạy thật tại `/opt/talpha/...` server 169.58.33.8
  (pm2 `talpha-wa-alerts`), gửi nhóm "BOT AI THÔNG BÁO".
- Sống: digest tồn kho 8h, báo cáo ads từng marketer 8h, cảnh báo spend spike/camp 0 mess mỗi 3h, lệnh `/kho`.
- **Dead code**: cảnh báo tồn kho realtime `poll()` không được đăng ký setInterval — config
  `pollMinutes/reArmDays` vô dụng, README quảng cáo sai.

---

## PHẦN 2 — Chẩn đoán: 5 gốc rễ của "rời rạc, mapping chưa chuẩn"

### A. Business rules KHÔNG có nguồn duy nhất (gốc rễ số 1)

| Rule | Số nơi định nghĩa | Ghi chú lệch |
|---|---|---|
| Gán marketer (parse campaign + tag POS) | **7 bản**: `format_all.py`, `quick_update.py`, `realtime/route.ts` (2 hàm), `ads-alerts/route.ts`, `daily_report.js` (bot), `talpha-inventory.ts`, `bq-queries.ts` (chết) | regex `THE` khác nhau → cùng camp gán người khác nhau; output key khác nhau (`Loc` vs `Lộc`) |
| Tỷ giá | **6-8 nơi**: yaml, format_all, quick_update, realtime, utils.ts client, view SQL, 2 CSV | quick_update + yaml + view SQL **thiếu Taiwan**; USD 25500 vs 25700; view chia cứng /7010 mọi account |
| Danh sách TKQC | **6 nơi, 4 con số**: yaml (14), meta_client (14), runtime json (14), ads-command page (**11**), runtime fallback (**10**), config_loader repo (**file không tồn tại**) | UI hiện raw id 3 account; docs còn ghi "10 TKQC" |
| Status GTC / doanh thu | 6 nơi (business_rules.py, runtime sync, format_all, realtime, constants.ts, template yaml) | Ads Command tính revenue **mọi đơn** `(cod\|\|total_price)/100`; tab BQ chỉ GTC `cod>0` → ROAS 2 tab khác bản chất |
| Timezone | 5 kiểu: VN IANA, offset +7, tz theo TKQC, `Asia/Dubai` (yaml), UTC thô (views + tab BQ) | cùng khoảng ngày → tổng khác nhau giữa các tab |
| Rule tổng hợp (văn bản) | `TALPHA_METRIC_RULES.md` + system prompt ceo-ask (văn xuôi, nguồn thứ 7) | không đồng bộ tự động với code |

### B. Nhiều bản code chạy song song

1. **Sync 2 kiến trúc khác nhau**: repo `sync/talpha/` (459 dòng + `sync/core/*`) vs runtime
   `~/talpha_reports/runtime/sync/` (monolith 656 dòng, KHÔNG có core/, default project
   `levelup-465304` từ .env, tự sync thêm `fb_adset_data` autodetect). Launchd chạy bản runtime.
   Diff 867 dòng — không còn là "2 bản cùng code".
2. `ops/talpha_reports/` = backup copy tay của `~/talpha_reports/*.py` (hiện khớp, nhưng dễ trôi).
3. Bot WhatsApp: repo ↔ server rsync tay + `pm2 restart`.
4. `talpha-cron` + `talpha-broadcast` (pm2 Mac) = repo git ĐỘC LẬP `/Users/syanh/Desktop/Bắn bot AI/app`
   (broadcast Messenger, Firestore `banbot-494807`) — cùng namespace `talpha-*` rất dễ nhầm.
5. 2 bộ tab song song: `components/tabs/*` (14 file, query view legacy `vw_fact_*`) vs
   `components/talpha/tabs/*` (bảng thô) — 12 file cũ không còn được import.

### C. Hai pipeline dữ liệu không có lớp semantic chung

- BQ sync mỗi giờ (Sheet + 6 tab + ads-alerts) vs live API (Ads Command + Kho + bot marketer report).
- Views chuẩn hoá (`vw_orders_std`, `vw_fb_ads_std`…) có sẵn nhưng **0 consumer** trong dashboard.
- Bot đọc qua HTTP API dashboard (`localhost:3001`) — đúng trên server, còn trên Mac 3001 là
  app broadcast → test local 404 im lặng.

### D. Code chết & config hỏng đang gây sai số thật

| # | Vấn đề | Hậu quả |
|---|---|---|
| 1 | `/api/ad-accounts` trỏ `cwd()/../config/ad_accounts.json` không tồn tại | Tab TKQC Manager `/admin` luôn rỗng, POST 404 |
| 2 | `ads-command-center/page.tsx` ACCOUNT_NAMES chỉ 11/14 | UI hiện raw id, dễ hiểu nhầm thiếu account |
| 3 | JOIN `order_items` chỗ CAST chỗ không (`product-pnl-tab` vs `market-intel`) | 1 trong 2 gần như chắc trả rỗng |
| 4 | `daily.sh` (bq rm 5 bảng rồi mới sync) còn nguyên ở repo + runtime | Chạy nhầm = mất data (pattern đã gây sự cố 06/07) |
| 5 | `/api/executive-report` trỏ project `levelup-465304` + schema STRAMARK cũ | Lỗi trên dataset TALPHA |
| 6 | `quick_update.py` dead scheduler + thiếu Taiwan trong RATE | Nếu ai chạy tay → số sai |
| 7 | `bq-queries.ts` (651 dòng) + `bq-schema.ts` + `marketer-map.ts` không được import | Rule canonical viết ra nhưng không ai dùng |
| 8 | Realtime cap im lặng: 10 trang Meta (5000 ads/acc), 200 trang POS | Silent truncation khi scale |
| 9 | `taiwan_files.json` thiếu SAnh; `test_files.json`/`taiwan_files.json` CHỈ ở `~/talpha_reports/` ngoài git | Mất máy = mất mapping |
| 10 | DATA_CONTRACT.md + FRONTEND_RULES.md mô tả STRAMARK, cấm điều mà 100% code đang làm | Docs đánh lừa người mới |

### E. Vận hành & bảo mật

- Log pm2 không logrotate: `talpha-dashboard-error.log` **2.06 GB**, `talpha-broadcast-error.log`
  **1.24 GB** → rủi ro đầy đĩa.
- `.lock` chia sẻ giữa daily_guarded và export_worker; worker crash giữa chừng → lock kẹt tới 45'.
- Path tuyệt đối `/Users/syanh/...` rải trong route, plist, shell script.
- `bigquery_key.json` nằm 3 nơi; `GEMINI_API_KEY` plaintext trong `.env.local` (nên rotate).
- `ecosystem.config.js` repo root là file chết (config máy khác).

---

## PHẦN 3 — Đề xuất tối ưu (3 giai đoạn)

### P0 — Sửa ngay, ít rủi ro (1-2 ngày)

1. **Fix `/api/ad-accounts`** trỏ đúng `ops/talpha_reports/ad_accounts.json` → hồi sinh tab TKQC Manager.
2. **Bổ sung 3 TKQC thiếu** vào `ACCOUNT_NAMES` của `ads-command-center/page.tsx` (11→14) —
   tốt hơn: đọc tên từ yaml, xoá hẳn map hard-code.
3. **Xoá/archive `daily.sh`** cả repo lẫn runtime (bản bq rm nguy hiểm, không còn lịch nào gọi).
4. **`pm2 install pm2-logrotate`** + xoá 3.3GB log cũ (cả Mac lẫn server).
5. **Đưa `test_files.json` + `taiwan_files.json` vào `ops/talpha_reports/`** (git), thêm SAnh vào taiwan.
6. **Dọn bot WhatsApp**: xoá `poll()` dead code + config thừa, sửa README; hoặc nếu muốn cảnh báo
   tồn realtime thì đăng ký lại setInterval.
7. Xoá `quick_update.py` (dead) hoặc sửa thiếu Taiwan nếu giữ.
8. Rotate `GEMINI_API_KEY`; xoá `ecosystem.config.js` chết ở repo root.
9. Sửa JOIN `order_items` thiếu CAST trong `product-pnl-tab.tsx`.

### P1 — Hợp nhất "một nguồn sự thật" (1-2 tuần) — giải quyết "mapping chưa chuẩn"

10. **Tạo 1 file rule máy-đọc-được** (mở rộng `config/projects/talpha.yaml` hoặc
    `config/talpha_rules.json`): 7 marketer + mọi variant tên (kể cả bẫy Unicode Thuý/Thúy),
    tỷ giá 7 thị trường (CÓ Taiwan), status GTC, 14 TKQC + timezone từng account, shop_label map,
    phí ship, cost_price. Python (`format_all`, sync) và TypeScript (dashboard, bot) cùng ĐỌC file này —
    xoá 7 bản marketer-mapping, 6 bản tỷ giá.
11. **1 module attribution duy nhất** theo rule CEO đã duyệt (tag POS → ad_id→chủ camp → "(không gán)"):
    dùng chung cho Sheet, realtime, ads-alerts, bot. Hết cảnh "cùng nhóm WhatsApp 2 tin gán 2 người khác nhau".
12. **Thống nhất định nghĩa doanh thu hiển thị**: mọi nơi hiện rõ 2 chỉ số "DS đặt (placement)" vs
    "DS Giao TC" — Ads Command ghi rõ ROAS blended; tab BQ ghi rõ GTC. Hết tranh cãi "sao 2 tab khác nhau".
13. **Chấm dứt 2 bản sync**: chọn bản repo (`sync/` + `sync/core/`) làm chuẩn, port nốt phần
    `fb_adset_data` nếu cần, rồi biến `~/talpha_reports/runtime/sync/` thành bản deploy từ git
    (`git clone` ngoài Desktop + launchd chạy từ đó; hoặc script `deploy_runtime.sh` copy 1 chiều
    có checksum). Quy trình mới: sửa 1 nơi → deploy, không "vá cả hai".
14. **Dashboard chuyển dần sang views**: 6 tab BQ bỏ SQL inline, query `vw_orders_std`/`vw_fb_ads_std`
    (đã có timezone + tỷ giá chuẩn — cần fix /7010 và thêm Taiwan trước) → hết lệch timezone/parse ngày giữa tab.

### P2 — Nền tảng trung hạn (3-6 tuần)

15. **Semantic layer hoàn chỉnh**: mọi consumer (tabs, bot, Sheet, prompt CEO-ask) đọc từ bộ views +
    rules file; system prompt CEO-ask **sinh tự động** từ rules file thay vì văn xuôi chép tay.
16. **Fix `order_items` sync** → mở khoá P&L theo SP + trừ COGS thật (27 SKU đã có cost_price)
    → mục tiêu "sản phẩm nào lãi nhất" mới trả lời được đúng.
17. **Scheduler hoá snapshot**: cron gọi `sync-inventory` + `snapshot-ads` định kỳ (hiện chỉ tay)
    → có lịch sử tồn kho + lịch sử ads để phân tích xu hướng.
18. **Sync health monitor**: sau mỗi lần sync ghi 1 dòng trạng thái (rows/account, fail) + bot WhatsApp
    báo khi sync fail — hết cảnh "chết câm, sheet kẹt số cũ" như 22-29/6.
19. **Dọn code chết**: 12 tab cũ, `bq-queries.ts`, war-room/ai-brain routes, executive-report legacy,
    `talpha-stock-sources.ts` (nếu đã bỏ Sheet UAE/Saudi) → chuyển `_archive/`.
20. **Chuẩn hoá deploy server**: bot + dashboard server deploy bằng `git pull` thay rsync tay;
    1 ecosystem file cho server, 1 cho Mac; cân nhắc đổi tên pm2 app broadcast khỏi namespace `talpha-*`.
21. Cập nhật docs: ARCHITECTURE_2026 (CEO-ask = Gemini), TALPHA_METRIC_RULES (14 TKQC, Taiwan),
    xoá DATA_CONTRACT/FRONTEND_RULES lỗi thời.

### Thứ tự ưu tiên nếu chỉ làm được 3 việc

1. **#10 + #11** (rules file + attribution chung) — đánh trúng "số liệu mapping chưa chuẩn".
2. **#13** (1 bản sync) — đánh trúng "hệ thống rời rạc", giảm 1 nửa chi phí bảo trì.
3. **#18** (sync health + cảnh báo fail) — bảo vệ mọi thứ phía sau khỏi chết câm.
