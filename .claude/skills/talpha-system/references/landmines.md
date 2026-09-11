# TALPHA — Danh mục bẫy chi tiết (audit 29/07/2026)

> Bổ sung cho SKILL.md §3. Mỗi mục: hiện trạng + hậu quả nếu không biết.
> Khi một mục đã được fix, cập nhật file này.

## 1. Config trùng lặp — con số ở nhiều nơi

| Rule | Các nơi định nghĩa | Trạng thái lệch (29/07) |
|---|---|---|
| 14 TKQC | `config/projects/talpha.yaml` (14) · `sync/core/meta_client.py` (14) · `runtime/config/ad_accounts.json` (14) · `ops/talpha_reports/ad_accounts.json` (14) · `realtime/route.ts` ACCOUNT_NAMES (14) · `ads-command-center/page.tsx` ACCOUNT_NAMES (~~11~~ → **đã fix 14, 29/07**) · runtime fallback hard-code (**10**) | vẫn phải sửa đủ mọi chỗ khi thêm TKQC |
| Tỷ giá | **Nguồn chuẩn từ 29/07: `config/talpha_rules.json`** (7 thị trường có TW) — format_all + realtime + ads-alerts đọc từ đây. CÒN LỆCH: `talpha.yaml` §12 (không TW), `src/lib/constants.ts` (USD 25500), `utils.ts` client (không TW → tab BQ đơn TW nhân nhầm 6850), view `01_vw_fb_ads_std.sql` (/7010 cứng) — dọn ở P2 | |
| Gán marketer | ~~7 bản lệch nhau~~ → **HỢP NHẤT 29/07 (P1)**: 1 nguồn data `config/talpha_rules.json` + 3 loader (`ops/talpha_reports/talpha_rules.py`, `dashboard-ui/src/lib/talpha/rules.ts`, `ops/whatsapp-alerts/rules.js`). Golden-test 502 camp + 18 tên POS = 100% khớp bản cũ. Sửa rule = sửa JSON, đừng thêm map inline. Còn sót: `bq-queries.ts` (dead code) | |
| Status GTC | `sync/core/business_rules.py` · runtime sync · `format_all.py` · `realtime/route.ts` · `constants.ts` | |
| Timezone | VN IANA (format_all) · offset +7 (quick_update) · tz TKQC (realtime matched) · `Asia/Dubai` (yaml — không khớp ai) · UTC thô (views + 6 tab BQ) | |

## 2. Route/code đang HỎNG hoặc CHẾT

- ~~`/api/ad-accounts` trỏ file không tồn tại~~ → **đã fix 29/07**: route tự tìm
  `ops/talpha_reports/ad_accounts.json` (fallback `config/`), tab TKQC Manager hoạt động lại.
  **Tái phát 31/07 dạng khác**: process pm2 Mac còn metadata/cwd thời thư mục tên cũ
  `Agentic-AI-Levelup` → `process.cwd()` đóng băng ở module scope → `/api/ad-accounts`
  VÀ `/api/talpha/billing` trả RỖNG dù code + build đúng. Đã fix: (1) cả 2 route resolve
  `process.cwd()` mỗi request; (2) pm2 delete + start lại từ `Talpha-New-16-6/dashboard-ui`
  + `pm2 save`. Nhận diện triệu chứng: API port 3000 trả rỗng nhưng `next start` tay từ
  repo (port khác) lại có data → nghi process/metadata pm2 cũ, đừng nghi code.
- `/api/executive-report`: default project `levelup-465304` + schema STRAMARK cũ → lỗi trên TALPHA.
- ~~Bot WA `poll()` dead code~~ → **đã dọn 29/07** (xoá poll/computeNew + pollMinutes/reArmDays
  khỏi config, README viết lại đúng hành vi). Lưu ý: bản trên SERVER chưa deploy — rsync +
  restart đợt cập nhật bot kế tiếp (restart sẽ bắn tin "bot đã kết nối" vào nhóm).
- ~~`quick_update.py` dead~~ → **đã archive 29/07** vào `~/talpha_reports/_archive/`.
- ~~`daily.sh` nguy hiểm~~ → **đã xoá khỏi git + archive bản runtime 29/07**
  (`~/talpha_reports/_archive/daily.sh.DANGEROUS-bq-rm`).
- Code chết lớn: `src/components/tabs/*` (12/14 file không được import),
  `src/lib/talpha/bq-queries.ts` (651 dòng, 0 import), `bq-schema.ts`, `marketer-map.ts`
  (canonical nhưng không tab live nào dùng), war-room/ai-brain components (backend :8000 không tồn tại).
- ~~`ecosystem.config.js` repo root (config máy khác)~~ → **đã xoá khỏi git 29/07**
  (commit cfcb499, F3-P0 chốt xong — verify 03/08: pm2 Mac vẫn online, không script nào gọi file này).
- ~~JOIN `order_items` thiếu CAST ở product-pnl-tab~~ → **đã fix 29/07** (thêm
  `CAST(o.id AS STRING)`, commit cfcb499). A2-P0 chốt xong — verify 03/08: query JOIN
  trả 68 dòng SKU×shop trên cả BQ lẫn `/api/query` dashboard Mac; tổng doanh thu phân bổ
  theo item khớp đúng `SUM(cod)/100` GTC (86.244,6).
- `order_items` trên BQ ~~RỖNG~~ → 03/08 đã CÓ dữ liệu: 3.860 dòng, phủ 898/898 đơn GTC,
  nhưng CHỈ từ 04/07/2026 trở đi — trước ngày đó P&L theo SP vẫn rỗng (E2 lo phần backfill/sync).
  COGS chưa trừ ở tab nào (dù talpha.yaml §10 có cost_price 27 SKU).

## 3. Giới hạn im lặng (silent caps)

- `realtime/route.ts`: Meta insights cap **10 trang** (5000 ads/account); POS cap **200 trang** — chạm cap không log.
- `sync/core/pos_client.py`: `POS_PAGE_SIZE=10` → full-month SA ~220 request/shop, chain rất dài (gốc sự cố "chết ở page 11").
- `lib/talpha/sheet-source.ts`: cache CSV — bảng đơn đối tác nạp vào có thể trễ vài phút.
- UAE stock: fallback gid cứng `29108099` = tab "June 2" — regex tháng fail là đọc tồn kho THÁNG 6.
- Saudi parser: dựa chuỗi literal "Product SKU"/"Balance in Store" — đổi layout sheet là vỡ im lặng.
- `format_all.py` `is_test()`: campaign có từ "Test" ngoài ý đồ bị loại khỏi doanh số không cảnh báo.

## 3b. Quy trình sửa file runtime (MỚI từ 29/07 — P1)

**SỬA Ở REPO rồi deploy, KHÔNG sửa tay `~/talpha_reports` nữa:**
1. Sửa `ops/talpha_reports/*` hoặc `config/talpha_rules.json` trong repo
2. Chạy `ops/talpha_reports/deploy_runtime.sh --yes` (tự đợi lock, backup, copy atomic)
Engine sync ĐANG CHẠY đã git-track tại `ops/talpha_reports/runtime_sync/`. Kế hoạch gộp
2 engine: ĐÃ GỘP 11/09/2026 — chỉ còn `sync/talpha/talpha_sync.py`.
Bot deploy: rsync `ops/whatsapp-alerts/` **và `config/talpha_rules.json`** lên `/opt/talpha/`.

## 4. File quan trọng NGOÀI git (mất máy = mất)

- ~~test_files.json + taiwan_files.json chỉ ở máy~~ → **đã copy vào `ops/talpha_reports/` 29/07**
  (bản chạy thật vẫn là `~/talpha_reports/` — sửa xong nhớ copy sang ops). Taiwan đã đủ 7 người
  (SAnh thêm 29/07, sheet id 128hNH2e8xHssURAxljQyYfyoZtouexuvNPHLwcVbTn8).
- `~/talpha_reports/runtime/config/ad_accounts.json` (bản sync thật đọc)
- `~/talpha_reports/runtime/.env` (TALPHA_META_ACCESS_TOKEN…), `runtime/bigquery_key.json`
- Bot WA: `.wwebjs_auth/` session (chỉ trên server), `state.json`, `ads_state.json`

## 5. Vận hành

- **Log pm2 không logrotate trên VPS `139.180.131.21`** — chưa cài `pm2-logrotate`,
  `/var/log/talpha/*.log` có thể phình rất lớn. (Đã từng flush 3,2 GB trên máy Mac cũ.)
- `.lock` dùng chung daily_guarded ↔ export_worker; chỉ daily_guarded dọn stale (>45').
- `sql/talpha/views/` có 12 view. Dashboard dùng thật `vw_orders_std` (31 lần) và
  `vw_fb_ads_std` (16 lần); số còn lại chỉ một vài lần. Sáu tab BigQuery vẫn tự viết
  SQL inline thay vì đi qua view.
- CEO "Hỏi dashboard" = **Gemini** (`@google/genai`, fallback 2.5-flash→2.0-flash, free tier
  ~20 req/ngày/model), KHÔNG phải Claude — và hiện **ĐANG TẮT** (gỡ `GEMINI_API_KEY` 2 máy,
  mục F2).
- `DATA_CONTRACT.md` + `FRONTEND_RULES.md` (mô tả STRAMARK) đã archive về `docs/_archive/`
  kèm banner cảnh báo — mục F4. Đừng tin nội dung, chỉ để tra lịch sử.

## 6. Lộ trình tối ưu đã đề xuất

Xem `docs/proposals/AUDIT_HE_THONG_2026-07-29.md` phần 3 (P0 quick-fix / P1 hợp nhất
nguồn sự thật / P2 nền tảng). Ưu tiên: rules file dùng chung → attribution chung →
hợp nhất 2 bản sync → sync health alert.
