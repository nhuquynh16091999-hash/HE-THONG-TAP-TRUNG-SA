# ARCHITECTURE_2026 — Kiến Trúc Hệ Thống TALPHA

> **Trạng thái:** Source of truth về KIẾN TRÚC — cập nhật 2026-08-03 (đối chiếu trực tiếp với code đang chạy).
> **Rule chỉ số** (doanh thu, tỷ giá, gán marketer…): `docs/TALPHA_METRIC_RULES.md` — file đó mới là source of truth về SỐ.
> **Thay thế:** `docs/SYSTEM_ARCHITECTURE.md` (FAOS v6, frozen 2026-03-02) — di sản, mô tả agent tự chủ, không khớp code đang chạy.
> **Audience:** Dev / Leader / Handover.

---

## 0. TL;DR

**TALPHA** bán trang sức & mỹ phẩm cho phụ nữ Philippines tại **GCC + Taiwan**
(UAE · Saudi · Kuwait · Oman · Qatar · Bahrain · **Taiwan**) qua **Facebook Ads +
chat-sale (Messenger/WhatsApp) + COD**.

Hệ thống KHÔNG chỉ là dashboard. Có 4 mặt trận chạy song song:

```
1. Sync + Sheet   : Meta API + Poscake POS → BigQuery → ~50 Google Sheets   (launchd, MÁY MAC)
2. Dashboard      : BigQuery (lịch sử) + Meta/POS live → Next.js            (Mac :3000 + server :3001)
3. Bot WhatsApp   : đọc dashboard API → nhóm "BOT AI THÔNG BÁO"             (server 169.58.33.8)
4. Tồn kho        : POS live + Google Sheets → tab Kho + digest bot
```

**AI:** "Hỏi dashboard" (CEO-ask) viết bằng **Google Gemini SDK**, hiện **TẮT** —
đã gỡ `GEMINI_API_KEY` khỏi cả 2 máy ngày 03/08/2026 (mục F2). Route vẫn còn, trả
lỗi hướng dẫn thay vì crash. AI agent tự chủ `faos_brain/` (Thế hệ 1) vẫn đóng băng.

---

## 1. Cái gì chạy ở đâu (quan trọng nhất — đọc trước khi sửa)

| Thành phần | Chạy ở đâu | Code nguồn |
|:--|:--|:--|
| Dashboard Mac | pm2 `talpha-dashboard`, port **3000** | repo `dashboard-ui/` (build tại chỗ) |
| Dashboard server | 169.58.33.8, pm2 `talpha-dashboard`, port **3001** | `/opt/talpha/`, deploy bằng rsync |
| Sync + xuất Sheet | launchd `com.talpha.dailyreport` — **StartInterval 3600s** (guard 50') | chạy bản **runtime** `~/talpha_reports/`, KHÔNG phải repo (bẫy #1) |
| Export worker ("Xuất Sheet") | launchd `com.talpha.export-worker` — poll BQ `export_jobs` 20s | `ops/talpha_reports/export_worker.py` |
| Shadow-sync validation | launchd `com.talpha.shadowsync` | `ops/talpha_reports/shadow_run.sh` (mục B1, đang chạy đối chứng) |
| Bot WhatsApp | server 169.58.33.8, pm2 `talpha-wa-alerts` | repo `ops/whatsapp-alerts/` |
| `talpha-cron` / `talpha-broadcast` (pm2 Mac) | `~/Desktop/Bắn bot AI/app` | **DỰ ÁN KHÁC** (broadcast Messenger) — đừng nhầm |

⚠️ **Bẫy #1 — HAI BẢN CODE SYNC.** Repo `sync/talpha/` + `sync/core/` (modular) vs
runtime `~/talpha_reports/runtime/sync/` (monolith). launchd chạy bản RUNTIME vì
không đọc được `~/Desktop` (thiếu Full Disk Access). **Sửa sync mà không deploy
runtime = chưa sửa gì.** Hợp nhất 2 bản là mục B1 của lộ trình tối ưu.

⚠️ **Bẫy #2 — Bot đọc `localhost:3001`.** Đúng trên server; trên Mac 3001 là app
broadcast của dự án khác → test bot trên Mac sẽ 404 im lặng.

---

## 2. Sáu tầng kiến trúc

```
┌─────────────────────────────────────────────────────────────────┐
│  1. NGUỒN NGOÀI                                                 │
│     Poscake POS (7 shop)  ·  Meta Ads API (14 TKQC)             │
│     Google Sheets (kho nhập tay — nguồn dự phòng tồn)           │
└──────────────────────┬──────────────────────────────────────────┘
                       │ launchd mỗi giờ (sync) + live (dashboard)
┌──────────────────────▼──────────────────────────────────────────┐
│  2. ETL / SYNC  — runtime ~/talpha_reports/runtime/sync/         │
│     daily_guarded.sh → sync_month.py → format_all.py → Sheets    │
│     LOAD JOB WRITE_TRUNCATE (BQ free tier: KHÔNG streaming/DML)  │
└──────────────────────┬──────────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────────┐
│  3. BIGQUERY  ← NGUỒN SỰ THẬT LỊCH SỬ                            │
│     talpha-faos-2026 / TALPHA_Dataset                            │
│     fb_ads_data · sale_order · order_items · inventory_snapshot  │
│     8 view chuẩn hoá vw_* (sql/talpha/views/)                    │
└──────────────────────┬──────────────────────────────────────────┘
                       │ SELECT (qua view, không SQL inline)
┌──────────────────────▼───────────────┬──────────────────────────┐
│  4. API — Next.js Route Handlers     │  Meta API + POS API LIVE  │
│  /api/query  ← 6 tab BQ đi đường này │  (hôm nay / hôm qua)      │
│  /api/talpha/{realtime · inventory · │                           │
│   ads-alerts · snapshot-ads ·        │                           │
│   sync-inventory · sync-health ·     │                           │
│   export-report · billing · ceo-ask} │                           │
└──────────────┬───────────────────────┴───────────┬──────────────┘
               │                                   │
┌──────────────▼────────────────┐  ┌───────────────▼──────────────┐
│  5. DASHBOARD                 │  │  5b. BOT WHATSAPP            │
│  Next.js 16 · React 19 · TW   │  │  ops/whatsapp-alerts/        │
│  /talpha (8 tab) +            │  │  báo cáo định kỳ · /kho ·    │
│  /talpha/ads-command-center   │  │  cảnh báo spend              │
└───────────────────────────────┘  └──────────────────────────────┘

  🧊 faos_brain/ (Thế hệ 1: analyst · marketing_director · FalkorDB) — ĐÓNG BĂNG
```

---

## 3. Nguồn rule dùng chung (E3 — đọc trước khi viết logic số)

Từ 03/08/2026 mọi rule máy-đọc-được nằm ở **`config/talpha_rules.json`**
(bản copy `dashboard-ui/config/talpha_rules.json` — sync bằng `scripts/sync-config.mjs`
lúc prebuild). Kèm 3 module attribution **cùng một rule, 3 ngôn ngữ**:

| Ngôn ngữ | File | Ai dùng |
|:--|:--|:--|
| Python | `ops/talpha_reports/talpha_rules.py` | `format_all.py`, `team_report.py` (Sheet) |
| TypeScript | `dashboard-ui/src/lib/talpha/rules.ts` | route dashboard |
| JavaScript | `ops/whatsapp-alerts/rules.js` | bot WhatsApp |

Nội dung: 7 marketer + mọi variant tên · 7 thị trường + tỷ giá (CÓ Taiwan) ·
status GTC · pattern campaign test · phí ship 3PL 6 thị trường · danh sách tên
ngoài team. **Rule CEO 3 bậc gán đơn**: tag POS → `ad_id` → chủ campaign →
tab "(không gán)".

Cấu hình hạ tầng vẫn ở **`config/projects/talpha.yaml`** (+ bản copy
`dashboard-ui/config/`): 14 TKQC (id · tên hiển thị · **timezone thật lấy từ Meta
API**), 7 shop POS, 27 SKU + giá vốn, KPI.

⚠️ Danh sách `marketers:` trong `talpha.yaml` là bản CŨ (còn "Lê Thục Bình", thiếu
"Chính") — chỉ dùng tham chiếu nhân sự. Logic gán marketer phải đọc `talpha_rules.json`.

---

## 4. BigQuery — Bảng, view & quy tắc

### 4.1 Bảng chính (`talpha-faos-2026.TALPHA_Dataset`)

| Bảng | Nội dung | Ghi bởi |
|:--|:--|:--|
| `fb_ads_data` | spend (VND), impressions, clicks, `date` (theo tz TKQC), `ad_id` INT64, account_name | sync ads |
| `sale_order` | `cod`, `status_category`, `shop_label`, `marketer` (JSON string), `ad_id` STRING, `inserted_at` (UTC) | sync orders |
| `order_items` | item-level — ghi nhận 03/08: **có dòng từ 04/07/2026** nhưng ⚠️ **giá vốn/`retail_price` = 0 toàn bộ** → P&L theo SP chưa trừ được COGS (mục E2) | sync orders |
| `inventory_snapshot` | tồn kho mirror từ POS + Sheets | `/api/talpha/sync-inventory` |
| `export_jobs` | hàng đợi nút "Xuất Sheet" | dashboard → export worker |

### 4.2 View chuẩn hoá — `sql/talpha/views/` (8 file, tab BQ đọc qua đây)

`vw_fb_ads_std` · `vw_orders_std` · `vw_fact_daily_pnl` · `vw_fact_daily_marketer`
· `vw_daily_momentum` · `vw_marketer_momentum` · `vw_campaign_lifecycle` ·
`vw_creative_fatigue`.

View đã gánh sẵn: quy VND theo `shop_label` (cột `*_vnd`), gom ngày theo tz TKQC,
tách marketer khỏi JSON. **Tab mới KHÔNG viết SQL inline — query view.**

### 4.3 Quy tắc mapping BẮT BUỘC (sai = số bậy)

| # | Quy tắc | Ghi chú |
|:--|:--|:--|
| 1 | **Doanh thu** = `SUM(cod)/100` WHERE `status_category='GIAO_THANH_CONG' AND cod>0` | POS lưu ×100; KHÔNG dùng `total_price` |
| 2 | **Quy đổi → VND theo `shop_label`**: AE 7010 · SA 6850 · KW 83000 · OM 66700 · QA 7050 · BH 68000 · **TW 800** | Bản code cũ thiếu TW → đơn Taiwan phồng ~9 lần |
| 3 | **Market** = `shop_label`: AE=UAE, SA=Saudi, KW=Kuwait, OM=Oman, QA=Qatar, BH=Bahrain, **TW=Taiwan** | — |
| 4 | **Marketer của đơn** — 3 bậc: tag POS `JSON_EXTRACT_SCALAR(marketer,'$.name')` → `ad_id`→chủ campaign → "(không gán)" | KHÔNG bỏ đơn lặng lẽ |
| 5 | **Ads spend ĐÃ là VND** (không ÷100, không quy đổi) | Cột `date`, không phải `date_start` |
| 6 | **Join ads↔đơn**: `CAST(fb_ads_data.ad_id AS STRING) = sale_order.ad_id` | INT64 ↔ STRING |
| 7 | **ROAS** = DT(VND) ÷ spend(VND) · **AOV** = DT ÷ đơn | Ads Command Center dùng DS **đặt**, tab BQ dùng **GTC** → 2 nơi khác bản chất |
| 8 | **Timezone**: `inserted_at` là UTC; spend theo tz TỪNG TKQC (3 account `America/Los_Angeles`) | Từng ngày lệch, cả tháng khớp |
| 9 | **Campaign chứa từ "test"** đứng riêng → tách khỏi báo cáo doanh số | Trừ thị trường Taiwan (miễn trừ trong rule) |

Chi tiết + quy trình chẩn đoán "số sai": `docs/TALPHA_METRIC_RULES.md`.

---

## 5. Dashboard — cấu trúc thực tế

```
dashboard-ui/src/
├── app/
│   ├── talpha/page.tsx                 # Shell + 8 tab
│   ├── talpha/ads-command-center/      # Ads Command Center bản full trang (Meta + POS live)
│   ├── admin/                          # TKQC Manager (đọc ops/talpha_reports/ad_accounts.json)
│   └── api/
│       ├── query                      # ⚠️ KHÔNG legacy — 6 tab BQ (CEO · Marketing · P&L ·
│       │                              #   P&L theo SP · Khách hàng · Market Intel) đi đường này
│       ├── talpha/realtime            # Meta live + POS live → ads command + bot
│       ├── talpha/inventory           # POS live, fallback Google Sheets (có banner)
│       ├── talpha/ads-alerts          # cảnh báo spend cho bot
│       ├── talpha/snapshot-ads · sync-inventory · sync-health · export-report · billing
│       └── talpha/ceo-ask             # Gemini text-to-SQL — ĐANG TẮT (xem §6)
├── components/talpha/
│   ├── tabs/                          # 8 tab: CEO Intelligence · Ads Command Center ·
│   │                                  #   Marketing & Ads · Sản phẩm & Kho · P&L ·
│   │                                  #   P&L theo SP · Khách hàng · Market Intel
│   ├── ceo-assistant.tsx              # box "Hỏi dashboard" (gọi ceo-ask — đang tắt)
│   ├── data/inventory.ts · utils.ts · constants.ts · dashboard-shell.tsx
└── lib/
    ├── talpha/rules.ts                # module attribution + rule dùng chung (E3)
    ├── bigquery.ts · constants.ts · auth.ts
    └── talpha-inventory.ts · talpha-stock-sources.ts · talpha-pos-images.ts
```

Tab legacy `src/components/tabs/` (ad-accounts, user-management) và các route cũ
(`ai-brain`, `executive-report`, war-room) là di sản — mục A6 sẽ archive.

---

## 6. AI Layer — "Hỏi dashboard" (CEO-ask) · ĐANG TẮT

File: `dashboard-ui/src/app/api/talpha/ceo-ask/route.ts`

- SDK: **`@google/genai`** — model `gemini-2.5-flash,gemini-2.0-flash` (fallback khi 429),
  override bằng env `TALPHA_AI_MODEL`. **Không phải Claude** (bản doc cũ ghi sai).
- Tool `run_sql`, vòng lặp `MAX_SQL_CALLS=4`, auto `LIMIT 200`, `maximumBytesBilled` 2GB.
- **Guardrail `checkSql()`**: chỉ `SELECT`/`WITH`, cấm `;`, chặn 16 từ khoá DDL/DML,
  khoá cứng vào `talpha-faos-2026.TALPHA_Dataset`. Từ 04/08 nằm ở
  `dashboard-ui/src/lib/talpha/ceo-ask-sql.ts` để prompt builder dùng CHUNG danh sách
  từ khoá cấm — tên sản phẩm nhúng vào SQL sinh tự động phải qua `sanitizeSqlComment()`,
  không thì một cái tên lọt từ khoá cấm sẽ làm câu truy vấn hợp lệ bị chặn oan.
- **System prompt SINH TỰ ĐỘNG** từ `config/talpha_rules.json` (mục A5, 03/08/2026) —
  `dashboard-ui/src/lib/talpha/ceo-ask-prompt.ts`. Tỷ giá 7 thị trường, danh sách
  marketer, tên ngoài team, pattern campaign test, phí ship 3PL đều lấy từ rules file;
  prompt trỏ vào **view chuẩn** `vw_orders_std`/`vw_fb_ads_std` (đã quy VND + gom ngày
  theo tz TKQC) và kèm sẵn CTE attribution 3 bậc. **Đừng chép rule bằng tay vào prompt** —
  sửa rule là sửa JSON.
- **Giá vốn (bổ sung 04/08)**: BigQuery KHÔNG có bảng giá vốn (`order_items.avg_imported_price`
  = 0 mọi dòng → `vw_orders_std.cogs_vnd` luôn 0), nên `productCostCte()` sinh khối
  `product_cost` từ `rules.products` (27 SKU) để model JOIN theo `sku`. Prompt bắt buộc
  nêu độ phủ kèm mẫu số — đo 04/08: **21,6% doanh thu cấp sản phẩm**, 6/51 SKU bán ra có
  giá vốn. Prompt cũng cảnh báo `vw_product_pnl.revenue_local` là **tệ địa phương chưa quy
  VND** và không có cột ngày.
- **Trạng thái 03/08/2026:** đã gỡ `GEMINI_API_KEY` khỏi `.env.local` cả 2 máy (mục F2 —
  CEO quyết bỏ hẳn). Route trả lỗi hướng dẫn gọn, dashboard không crash.
- **Bật lại:** tạo key mới → thêm `GEMINI_API_KEY=` vào `.env.local` cả 2 máy → restart pm2.
  Prompt đã chuẩn hoá xong (A5), không còn việc phải làm trước khi bật.

---

## 7. Marketers (7 người báo cáo)

Nguồn canonical: **`config/talpha_rules.json` → `marketers`** (kèm mọi variant tên
để match campaign/tag POS).

| Key | Hiển thị | Tên đầy đủ |
|:--|:--|:--|
| `SAnh` | S.Anh | Hồ Sỹ Anh |
| `Loc` | Lộc | Hồ Sỹ Lộc |
| `ChuThuy` | Chu Thuý | Chu Thị Thuý |
| `Nhung` | Nhung | Hoàng Thị Thùy Nhung |
| `The` | Thế | Trần Ngọc Thế |
| `Mai` | Mai | Phạm Hà Thục Mai |
| `Chinh` | Chính | Chính |
| `Quan` | Quân | Quân — **inactive** (NV cũ) |

⚠️ **Bẫy Unicode**: POS lưu "Chu Thuý" (dấu sắc trên Y) ≠ "Thúy" — rule match bằng
`"THU"`. Tên ngoài team (Kính, Thạch, Tú…) nằm ở `external_team` → đơn của họ đi
theo fallback `ad_id` hoặc vào "(không gán)".

---

## 8. Bảo mật & Critical Guards

- **KHÔNG commit** `.env`, `dashboard-ui/.env.local`, `bigquery_key.json`, `levelup-*.json`.
  `.gitignore` đã phủ `*.env` (F2). Git history sạch — chưa từng commit key thật.
- **`bigquery_key.json` — 1 bản/máy**: Mac = `~/talpha_reports/runtime/bigquery_key.json`
  (repo root là symlink trỏ tới đó); server = `/opt/talpha/bigquery_key.json`.
- **BigQuery**: KHÔNG auto-run DELETE/DROP/TRUNCATE. Free tier → chỉ LOAD JOB
  (WRITE_TRUNCATE atomic), KHÔNG streaming/DML.
  Bản `daily.sh` cũ (`bq rm` trước khi sync) đã bị archive — pattern này gây mất data 06/07.
- **Sync**: luôn `--dry-run` lần đầu; account/shop fail phải RAISE, KHÔNG ghi bộ thiếu.
- **Secrets rotation**: token System User `talpha-sync` của Meta hết hạn KHÔNG báo trước.
- **LLM (Thế hệ 1 `faos_brain/`)**: giữ nguyên fallback chain trong `llm_client.py`.

---

## 9. Thế hệ 1 — ĐÓNG BĂNG (`faos_brain/`)

Giữ nguyên 100%, không chỉnh sửa, không xoá: `analyst.py`, `marketing_director.py`,
`state_machine.py`, `llm_client.py`, `graph/` (FalkorDB), `workflows/`, `prompts/`,
`ads_spy/`. Khi hồi sinh: đọc từ BigQuery đã chuẩn hoá (không tạo nguồn mới),
`--dry-run` trước mọi action Meta, người duyệt trước lệnh đổi budget.

---

## 10. Lộ trình hiện hành

Lộ trình đang chạy là **22 hạng mục P0/P1/P2** từ audit
`docs/proposals/AUDIT_HE_THONG_2026-07-29.md` (nhóm A Dashboard · B Sheets&Sync ·
C Tồn kho · D Bot · E Data layer · F Vận hành). Quy trình làm 1 hạng mục:
skill `lam-section` (1 section = 1 commit = push ngay = deploy nơi đang chạy).

`docs/CHECKLIST_ROADMAP.md` là roadmap A–F cũ (đã hoàn tất giai đoạn dựng hệ) —
giữ để tra lịch sử, không phải việc đang làm.

---

*Cập nhật lần cuối: 2026-08-03 (mục F4 — đối chiếu toàn bộ với code đang chạy).*
