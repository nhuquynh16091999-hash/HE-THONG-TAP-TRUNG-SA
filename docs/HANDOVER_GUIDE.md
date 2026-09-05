# 📘 Hướng Dẫn Bàn Giao — Vibe Code Dashboard E-commerce

> **Dành cho**: Lead dự án tiếp nhận vibe code ZEN8, TRENDIFY, HNLE
> **Cập nhật**: 2026-03-14
> **Yêu cầu**: Không cần biết code. Chỉ cần hiểu logic và biết cách nói chuyện với AI.

---

## 📋 Mục Lục

1. [Tổng Quan Hệ Thống](#1-tổng-quan-hệ-thống)
2. [Luồng Dữ Liệu (Data Flow)](#2-luồng-dữ-liệu)
3. [File YAML — Não Của Dự Án](#3-file-yaml--não-của-dự-án)
4. [Database BigQuery — Hiểu Để Debug](#4-database-bigquery--hiểu-để-debug)
5. [Dashboard Frontend — Các Tab & Dữ Liệu](#5-dashboard-frontend--các-tab--dữ-liệu)
6. [Sync Dữ Liệu — POS & Meta Ads](#6-sync-dữ-liệu--pos--meta-ads)
7. [Cách Debug Khi Dashboard Hiển Thị Sai](#7-cách-debug-khi-dashboard-hiển-thị-sai)
8. [Cách Làm Việc Với AI (Antigravity)](#8-cách-làm-việc-với-ai-antigravity)
9. [Thêm Tính Năng Mới](#9-thêm-tính-năng-mới)
10. [Checklist Fix Lỗi — 8 Điểm Bắt Buộc](#10-checklist-fix-lỗi--8-điểm-bắt-buộc)
11. [Các Lỗi Phổ Biến & Cách Xử Lý](#11-các-lỗi-phổ-biến--cách-xử-lý)

---

## 1. Tổng Quan Hệ Thống

### Hệ thống làm gì?
Dashboard hiển thị dữ liệu kinh doanh e-commerce cho nhiều dự án. Mỗi dự án bán hàng ở thị trường khác nhau, có marketer (người chạy quảng cáo) riêng.

### Các dự án hiện tại:

| Dự án | Thị trường | Tiền tệ | Marketer |
|-------|-----------|---------|----------|
| **ZEN8** | Middle East (AE, KSA) | AED | NHAMHT, LYVLN, HUYTN, DUNGNH, TAIHH, TUNPT |
| **TRENDIFY** | EU (RO, US, HR, IT, BG) | RON | THUDM, VANPTT |
| **HNLE** | Middle East + Australia | USD | TUNGNT, NHAT, DUC, VAN |
| STRAMARK | EU (RO, IT, HR, BG) | RON | Lệ, Chip, Tuấn Anh... |
| AUUS1 | AU + US | AUD/USD | — |
| TALPHA | Facebook Ads only | — | — |

### Cấu trúc thư mục quan trọng:

```
Agentic-AI-Levelup/
│
├── config/projects/          ← 🧠 File YAML cấu hình dự án
│   ├── zen8.yaml
│   ├── trendify.yaml
│   ├── hnle.yaml
│   └── ...
│
├── sync/                     ← 🔄 Script đồng bộ dữ liệu
│   ├── sync_all.py           ← Chạy tất cả
│   ├── zen8/zen8_sync.py
│   ├── trendify/trendify_sync.py
│   └── hnle/hnle_sync.py
│
├── dashboard-ui/             ← 🖥️ Giao diện web (Next.js)
│   └── src/
│       ├── components/
│       │   ├── zen8/tabs/    ← Các tab của ZEN8
│       │   ├── trendify/tabs/
│       │   └── hnle/tabs/
│       └── lib/
│           ├── bq-queries.ts ← 📊 Tất cả câu truy vấn BigQuery
│           ├── bq-schema.ts  ← Tên bảng/cột BQ
│           ├── marketer-map.ts ← Mapping marketer
│           └── bigquery.ts   ← Kết nối BQ
│
├── sql/                      ← 🔧 Script SQL fix lỗi
│   └── fix_*.sql/py
│
└── bigquery_key.json         ← 🔑 Key truy cập BigQuery
```

---

## 2. Luồng Dữ Liệu

Đây là cách dữ liệu chạy từ đầu đến cuối. **Hiểu luồng này = hiểu được 80% cách debug**.

```
┌──────────────┐     ┌──────────────┐
│  POS (PosCake)│     │  Meta Ads    │
│  Đơn hàng     │     │  Chi phí QC  │
└──────┬───────┘     └──────┬───────┘
       │                     │
       │  sync scripts       │  sync scripts
       │  (Python)           │  (Python)
       ▼                     ▼
┌──────────────────────────────────────┐
│         Google BigQuery              │
│                                      │
│  BASE TABLES (dữ liệu gốc):        │
│  ├── sale_order    ← đơn hàng       │
│  ├── order_items   ← sản phẩm/đơn   │
│  ├── fb_ads_data   ← chi phí QC     │
│  ├── product_variations ← SP + giá  │
│  ├── product_stock ← tồn kho        │
│  └── dim_marketer_mapping ← mkter   │
│                                      │
│  VIEWS (bảng ảo, tính toán):        │
│  ├── vw_fact_orders         ← gộp   │
│  ├── vw_fact_ads_performance← ads   │
│  ├── mart_performance_master← P&L   │
│  ├── mart_market_intelligence       │
│  ├── mart_product_insights          │
│  └── vw_fact_daily_pnl_flex         │
└──────────────┬───────────────────────┘
               │
               │  API query (SQL)
               ▼
┌──────────────────────────────────────┐
│         Dashboard Frontend           │
│         (Next.js / React)            │
│                                      │
│  Các tab hiển thị:                   │
│  ├── CEO Overview    (tổng quan)     │
│  ├── Marketing       (ads + đơn)    │
│  ├── Products        (SP + tồn kho) │
│  ├── Market Intel    (theo nước)     │
│  ├── P&L             (lãi lỗ/ngày)  │
│  ├── Marketer Perf   (hiệu suất)   │
│  ├── Customer        (khách hàng)   │
│  └── Ads Command     (chi tiết QC)  │
└──────────────────────────────────────┘
```

### Tóm tắt 1 dòng:
> **POS/Ads → Sync Python → BigQuery Tables → BQ Views tính toán → Frontend hiển thị**

---

## 3. File YAML — Não Của Dự Án

Mỗi dự án có 1 file YAML trong `config/projects/`. Đây là **file quan trọng nhất** — chứa tất cả thông tin cấu hình.

### Cấu trúc file YAML:

```yaml
# ─── 1. THÔNG TIN DỰ ÁN ───
project_id: HNLE
currency: USD              # ⚠️ Tiền tệ ảnh hưởng COGS, revenue, ads
timezone: Asia/Ho_Chi_Minh

# ─── 2. BIGQUERY ───
bigquery:
  project_gcp: "levelup-465304"
  dataset: "HNLE_Dataset"   # ⚠️ Mỗi dự án 1 dataset riêng

# ─── 3. FACEBOOK ADS ───
meta_ads:
  access_token: "EAAQQc..."  # Token Facebook (hết hạn 60 ngày)
  ad_account_ids:
    - "act_850593750862900"   # TUNG TK 05   → marketer TUNGNT
    - "act_1344820070087553"  # TUNG TK 07   → marketer TUNGNT
    - "act_1801091267209683"  # NHAT TK 07   → marketer NHAT
    # ⚠️ Comment ghi tên TK QC → giúp biết account → marketer

# ─── 4. POS (POSCAKE) ───
poscake:
  shops:
    - name: "ME"
      shop_id: "1942963908"   # ⚠️ shop_id xác định thị trường
    - name: "AU"
      shop_id: "1942963943"

# ─── 5. MARKETERS ───
marketers:
  - id: TUNGNT
    name: "Tùng NT"
    campaign_code: TUNGNT     # ⚠️ Phải khớp với tên trong campaign ads
  - id: NHAT
    name: "Nhật"
    campaign_code: NHAT
```

### Khi nào cần sửa YAML?

| Tình huống | Sửa gì |
|-----------|--------|
| Thêm marketer mới | Thêm vào phần `marketers` |
| Thêm tài khoản QC mới | Thêm vào `ad_account_ids` + comment tên |
| Thêm shop/thị trường mới | Thêm vào `poscake.shops` |
| Token Facebook hết hạn | Cập nhật `access_token` |

---

## 4. Database BigQuery — Hiểu Để Debug

### Bảng dữ liệu gốc (BASE TABLES) — được sync từ POS/Ads:

| Bảng | Nguồn | Dữ liệu gì |
|------|-------|-------------|
| `sale_order` | POS | Đơn hàng: trạng thái, giá, khách hàng, ad_id |
| `order_items` | POS | Chi tiết SP trong đơn: SKU, số lượng, giá |
| `fb_ads_data` | Meta | Chi phí QC theo ngày: spend, click, impression |
| `product_variations` | POS | Danh sách SP: tên, giá vốn (imported_price) |
| `product_stock` | POS | Tồn kho hiện tại |
| `dim_marketer_mapping` | Thủ công | Mapping tên marketer ↔ ID ↔ campaign code |
| `cost_exchange_rates` | Thủ công | Tỷ giá (USD→RON, VND→USD...) |

### View quan trọng (bảng ảo tính toán):

| View | Tính gì |
|------|---------|
| `vw_fact_orders` | Gộp sale_order + order_items, tính revenue, marketer, market |
| `vw_fact_ads_performance` | Gộp fb_ads_data + marketer mapping + market detection |
| `mart_performance_master` | **Bảng chính**: gộp orders + ads = P&L theo marketer/ngày |
| `mart_market_intelligence` | P&L theo **thị trường** (nước) |
| `mart_product_insights` | P&L theo **sản phẩm** |
| `vw_fact_daily_pnl_flex` | P&L theo ngày (revenue - COGS - ads - shipping) |

### Mối quan hệ giữa các view:

```
sale_order ──┐
order_items ─┤──→ vw_fact_orders ──┐
             │                      │
fb_ads_data ─┤──→ vw_fact_ads_perf ─┤──→ mart_performance_master
             │                      │──→ mart_market_intelligence
product_var ─┤                      │──→ mart_product_insights
             │                      │
dim_marketer─┘──→ (mapping layer) ──┘──→ vw_fact_daily_pnl_flex
```

> **Nguyên tắc**: Nếu dữ liệu sai ở view "trên" (vw_fact_orders), tất cả view "dưới" (mart_*) cũng sai theo. Luôn debug từ trên xuống.

---

## 5. Dashboard Frontend — Các Tab & Dữ Liệu

Mỗi dự án có ~14 tab. Frontend code nằm trong:
```
dashboard-ui/src/components/{ten-du-an}/tabs/
```

### Tab chính và nguồn dữ liệu:

| Tab | File | BQ View/Query | Hiển thị gì |
|-----|------|---------------|-------------|
| CEO Overview | `ceo-overview-tab.tsx` | `mart_performance_master` + `vw_fact_ads_performance` | Tổng quan: revenue, ads, marketer top, market, stock |
| Marketing | `marketing-tab.tsx` | `mart_performance_master` | Marketer chi tiết: đơn, tỉ lệ TC, ads, ROAS |
| Products | `products-tab.tsx` | `mart_product_insights` | SP: doanh thu, COGS, ads/SP, tồn kho |
| Market Intel | `market-intel-tab.tsx` | `mart_market_intelligence` | Theo nước: đơn, revenue, ads spend |
| P&L | `pnl-tab.tsx` | `vw_fact_daily_pnl_flex` + `vw_fact_ads_performance` | Lãi lỗ hằng ngày: revenue - COGS - ads - shipping |
| Marketer Perf | `marketer-perf-tab.tsx` | `mart_performance_master` | So sánh hiệu suất marketers |
| Customer | `customer-tab.tsx` | `vw_customers_latest` | Danh sách khách hàng |
| Ads Command | `ads-command-tab.tsx` | `vw_fact_ads_performance` | Chi tiết từng ad: spend, ROAS, kill/scale flag |

### File code chia sẻ (dùng chung cho tất cả dự án):

| File | Vai trò |
|------|---------|
| `lib/bq-queries.ts` | **Tất cả câu SQL** — đây là file quan trọng nhất |
| `lib/bq-schema.ts` | Tên bảng/cột BQ (constants) |
| `lib/marketer-map.ts` | Mapping marketer ID ↔ tên hiển thị |
| `lib/bigquery.ts` | Kết nối BigQuery (key file) |

---

## 6. Sync Dữ Liệu — POS & Meta Ads

### Chạy sync:

```bash
# Sync tất cả dự án
python sync/sync_all.py

# Sync 1 dự án
python sync/sync_all.py --project zen8

# Chỉ sync đơn hàng (POS)
python sync/sync_all.py --project hnle --orders

# Chỉ sync ads (Facebook)
python sync/sync_all.py --project hnle --ads

# Sync ads 7 ngày gần nhất
python sync/sync_all.py --project hnle --ads --days 7

# Test kết nối
python sync/sync_all.py --project hnle --test
```

### Kiểm tra sync thành công:
Sau khi sync, hỏi AI:
> "Kiểm tra HNLE_Dataset.sale_order có bao nhiêu đơn hàng hôm nay?"

### Khi nào cần sync lại?
- Dashboard hiển thị **thiếu đơn** (nhất là đơn gần nhất)
- Ads spend hiển thị **$0** trong khi biết có chạy QC
- Thêm **tài khoản QC mới** vào YAML → chạy sync ads

### Token Facebook hết hạn:
Dấu hiệu: Sync ads báo lỗi `Error validating access token`
Cách fix:
1. Vào [Meta Business Suite](https://business.facebook.com/settings)
2. Tạo token mới (System User → Generate Token)
3. Cập nhật vào file YAML: `meta_ads.access_token`

---

## 7. Cách Debug Khi Dashboard Hiển Thị Sai

### Tư duy debug — Đi từ CUỐI ngược lại ĐẦU:

```
Dashboard sai → Kiểm tra SQL query → Kiểm tra BQ View → Kiểm tra bảng gốc → Kiểm tra sync
```

### Bước 1: Xác định vấn đề
Nhìn dashboard, ghi lại CỤ THỂ:
- Tab nào sai?
- Cái gì sai? (revenue sai? marketer Unknown? market Unknown? ads = 0?)
- Thời gian nào? (chọn khoảng thời gian cụ thể)

### Bước 2: Hỏi AI kiểm tra BQ

Ví dụ dashboard hiển thị marketer = "Unknown":

> "Kiểm tra bảng HNLE_Dataset.mart_performance_master, xem marketer_name có bao nhiêu là 'Unknown'"

> "Kiểm tra bảng HNLE_Dataset.vw_fact_orders, xem marketer_id có bao nhiêu là 'UNKNOWN'"

> "Kiểm tra bảng HNLE_Dataset.sale_order, cột marketer có rỗng không"

### Bước 3: Xác định tầng lỗi

| Triệu chứng | Tầng lỗi | Cách xử lý |
|-------------|----------|------------|
| Revenue = 0 tất cả | BQ View `vw_fact_orders` tính sai revenue | Rebuild view |
| Marketer = Unknown | `dim_marketer_mapping` thiếu mapping hoặc `sale_order.marketer` rỗng | Thêm mapping |
| Market = Unknown | Campaign naming ko có pattern hoặc view ko parse đúng | Thêm keyword detection |
| Ads = $0 | `vw_fact_ads_performance` ko match được marketer | Thêm account_id mapping |
| COGS quá lớn | `imported_price` ở tiền tệ khác (VND) với revenue (USD) | Thêm convert tiền |
| Sản phẩm = UNKNOWN | `order_items` ko match `product_variations` (thiếu SP) | Sync thêm SP từ POS |
| Tab trống | Frontend query sai tên cột hoặc filter quá gắt | Sửa frontend |

### Bước 4: Hỏi AI fix

Khi đã biết nguyên nhân, nói cụ thể cho AI:

> "Tab CEO Overview của HNLE hiển thị tất cả marketer là Unknown. Kiểm tra vw_fact_orders.marketer_id có đúng không, nếu sai thì tìm nguyên nhân trong sale_order.marketer và dim_marketer_mapping"

---

## 8. Cách Làm Việc Với AI (Antigravity)

### Nguyên tắc vàng: **Càng cụ thể, AI càng làm đúng**

#### ❌ SAI — quá mơ hồ:
> "Dashboard sai rồi, fix đi"

#### ✅ ĐÚNG — cụ thể:
> "Tab P&L của HNLE hiển thị COGS = $247,000 trong khi revenue chỉ có $21,000. Kiểm tra vw_fact_daily_pnl_flex xem COGS tính từ cột nào, có phải đang dùng imported_price chưa convert tiền không"

### Các câu prompt hiệu quả:

#### 1. Khi muốn kiểm tra dữ liệu:
> "Chạy query: SELECT marketer_id, COUNT(*) FROM HNLE_Dataset.vw_fact_orders GROUP BY 1 — cho tao xem kết quả"

#### 2. Khi muốn so sánh dữ liệu:
> "So sánh tab CEO Overview đang hiển thị revenue $21K với query trực tiếp từ mart_performance_master xem có khớp không"

#### 3. Khi muốn tìm nguyên nhân:
> "Tab Market Intel của HNLE hiển thị trống, tìm nguyên nhân: kiểm tra mart_market_intelligence có dữ liệu không, nếu market_code = XX thì tìm lý do tại sao"

#### 4. Khi muốn thêm tính năng:
> "Thêm cột 'Tỷ lệ hoàn' vào bảng marketer trong tab CEO Overview. Cột này = returned_orders / total_orders * 100. Hiển thị dạng % với 1 số thập phân"

#### 5. Khi muốn fix lỗi BQ view:
> "Rebuild view HNLE_Dataset.vw_fact_ads_performance: thêm mapping account_id → marketer: act_850593750862900 = TUNGNT, act_1344820070087553 = TUNGNT"

#### 6. Khi muốn sync dữ liệu:
> "Chạy sync orders cho HNLE: python sync/sync_all.py --project hnle --orders"

### Quy trình fix lỗi step-by-step:

```
1. Mô tả LỖI cụ thể cho AI (tab nào, cái gì sai, thời gian)
2. AI sẽ kiểm tra BQ data → tìm nguyên nhân
3. AI đề xuất fix → bạn approve
4. AI chạy fix (sửa code hoặc rebuild BQ view)
5. Kiểm tra lại dashboard (Ctrl+Shift+R reload)
6. Nếu vẫn sai → quay lại bước 1 với thông tin chi tiết hơn
```

### Lưu ý quan trọng khi dùng AI:

1. **AI không tự chạy DDL qua API** — Khi cần CREATE/ALTER view, AI phải tạo script Node.js rồi chạy. Nếu AI hỏi approve, hãy đọc mô tả thay đổi trước khi approve.

2. **Luôn verify sau khi fix** — Sau khi AI nói "done", reload dashboard (Ctrl+Shift+R) và kiểm tra data. Đừng tin lời AI 100%.

3. **Cho AI context đầy đủ** — Nếu thêm marketer mới, cho AI biết: tên, campaign code, account_id. Thiếu info = fix sai.

---

## 9. Thêm Tính Năng Mới

### Thêm marketer mới:

1. Cập nhật YAML (`config/projects/{project}.yaml`):
   ```yaml
   marketers:
     - id: NEWMKTER
       name: "Tên đầy đủ"
       campaign_code: NEWMKTER
   ```

2. Nói AI:
   > "Thêm marketer NEWMKTER (Tên đầy đủ) vào dự án HNLE. Account QC: act_123456789. Cập nhật dim_marketer_mapping, marketer-map.ts, và vw_fact_ads_performance"

### Thêm thị trường mới:

1. Cập nhật YAML: thêm shop vào `poscake.shops`
2. Nói AI:
   > "Thêm thị trường Qatar (QA) cho HNLE. Shop ID: 1942964xxx. Cập nhật mart_market_intelligence và CEO tab market codes"

### Thêm tài khoản QC mới:

1. Cập nhật YAML: thêm vào `ad_account_ids`
2. Nói AI:
   > "Thêm account QC act_999888777 (TÊN TK 01) cho marketer NHAT trong HNLE. Cập nhật vw_fact_ads_performance account_id_map"

### Thêm dự án mới:

1. Copy template: `config/projects/_TEMPLATE_.yaml`
2. Điền thông tin: project_id, currency, BQ dataset, ads accounts, POS shops, marketers
3. Nói AI:
   > "Tạo dashboard mới cho dự án XYZ dựa trên template HNLE. File YAML đã chuẩn bị ở config/projects/xyz.yaml. Tạo toàn bộ: BQ views, frontend tabs, sync scripts"

---

## 10. Checklist Fix Lỗi — 8 Điểm Bắt Buộc

Khi fix lỗi cho bất kỳ dự án nào, **kiểm tra 8 điểm này**:

| # | Kiểm tra | Hỏi AI như thế nào |
|---|---------|-------------------|
| 1 | `sale_order.marketer` có rỗng không? | "Kiểm tra {DATASET}.sale_order cột marketer có bao nhiêu dòng rỗng" |
| 2 | Campaign naming format? | "Liệt kê 10 campaign_name trong {DATASET}.fb_ads_data — kiểm tra format có consistent không" |
| 3 | `dim_marketer_mapping` đúng chưa? | "SELECT * FROM {DATASET}.dim_marketer_mapping" |
| 4 | `vw_fact_ads_performance` MATCHED? | "SELECT campaign_mkter_code, COUNT(*) FROM {DATASET}.vw_fact_ads_performance GROUP BY 1" |
| 5 | `mart_market_intelligence` có Unknown? | "SELECT market, market_code, SUM(total_orders) FROM {DATASET}.mart_market_intelligence GROUP BY 1,2" |
| 6 | Products tab column names match? | "Kiểm tra cột delivered_cogs và product_return_rate có tồn tại trong {DATASET}.mart_product_insights không" |
| 7 | CEO tab market codes đúng? | "Kiểm tra ceo-overview-tab.tsx có truyền marketCodes cho queryCeoMarketRanking không" |
| 8 | COGS currency match revenue? | "SELECT AVG(imported_price) FROM {DATASET}.product_variations — so sánh đơn vị với revenue" |

---

## 11. Các Lỗi Phổ Biến & Cách Xử Lý

### Lỗi 1: Tất cả marketer = "Unknown"
**Nguyên nhân**: POS không điền marketer vào đơn hàng
**Fix**: Thêm `account_id_map` vào `vw_fact_ads_performance` — mapping account QC → marketer
**Prompt**: "Tất cả marketer trong HNLE là Unknown. Kiểm tra sale_order.marketer có rỗng không. Nếu rỗng, thêm account_id mapping vào vw_fact_ads_performance"

### Lỗi 2: Market = "Unknown" hoặc "XX"
**Nguyên nhân**: Campaign name không có pattern để parse thị trường
**Fix**: Thêm keyword detection (ksa→SA, Uc→AU) hoặc dùng shop_id
**Prompt**: "Market Intel tab trống/Unknown. Kiểm tra mart_market_intelligence. Thêm keyword-based market detection từ campaign names"

### Lỗi 3: Ads spend = $0
**Nguyên nhân**: `vw_fact_ads_performance.campaign_mkter_code` = UNMATCHED
**Fix**: Thêm account_id fallback into COALESCE chain
**Prompt**: "Ads spend = $0 trên CEO tab. Kiểm tra vw_fact_ads_performance xem bao nhiêu % là UNMATCHED"

### Lỗi 4: COGS > Revenue (vô lý)
**Nguyên nhân**: `imported_price` là VND (90,000) trong khi revenue là USD (95)
**Fix**: Convert currency trong view (chia 25,000 cho VND→USD)
**Prompt**: "COGS lớn hơn revenue trong P&L tab. Kiểm tra imported_price đơn vị gì, có cần convert tiền không"

### Lỗi 5: Tab trống (không có dữ liệu)
**Nguyên nhân**: Frontend query sai tên cột hoặc filter loại hết dữ liệu
**Fix**: So sánh tên cột trong `.tsx` file vs `INFORMATION_SCHEMA.COLUMNS`
**Prompt**: "Tab Products không hiển thị gì. Kiểm tra products-tab.tsx query dùng tên cột nào, so sánh với {DATASET}.mart_product_insights INFORMATION_SCHEMA"

### Lỗi 6: Sync lỗi / không chạy
**Nguyên nhân**: Token Facebook hết hạn, POS API thay đổi, hoặc script lỗi
**Fix**: Kiểm tra log sync
**Prompt**: "Chạy sync cho HNLE và cho tao xem log: python sync/sync_all.py --project hnle --test"

---

## Phụ Lục: Thuật Ngữ

| Thuật ngữ | Nghĩa |
|-----------|-------|
| **BQ / BigQuery** | Database trên Google Cloud, nơi lưu tất cả dữ liệu |
| **View** | Bảng ảo trong BQ — không lưu dữ liệu, chỉ tính toán từ bảng gốc |
| **POS** | Hệ thống quản lý đơn hàng (PosCake/Pancake) |
| **Meta Ads** | Facebook Ads — nền tảng chạy quảng cáo |
| **COGS** | Cost of Goods Sold — giá vốn hàng bán |
| **ROAS** | Return on Ad Spend — doanh thu / chi phí QC |
| **Marketer** | Người chạy quảng cáo Facebook |
| **Campaign** | Chiến dịch quảng cáo trên Facebook |
| **Sync** | Đồng bộ dữ liệu từ POS/Ads vào BigQuery |
| **YAML** | File cấu hình dự án (dạng text có cấu trúc) |
| **Dataset** | Tập hợp các bảng BQ của 1 dự án (VD: HNLE_Dataset) |
| **Frontend** | Giao diện web mà người dùng nhìn thấy |
| **DDL** | Lệnh tạo/sửa cấu trúc database (CREATE, ALTER...) |
| **dim_** | Bảng chiều (dimension) — dữ liệu tham chiếu ít thay đổi |
| **fact_/mart_** | Bảng fact/mart — dữ liệu tính toán từ nhiều nguồn |
| **vw_** | Prefix cho View trong BigQuery |
