# PHASE 1 — CHUẨN HÓA DỮ LIỆU (Data Standardization)

> **Timeline**: Tuần 1–3 | **Priority**: 🔴 Critical
> **Mục tiêu**: Unified data model cho TẤT CẢ projects, phục vụ reporting chính xác real-time

---

## 1. VẤN ĐỀ HIỆN TẠI

| # | Vấn đề | Ảnh hưởng |
|:---:|:---|:---|
| 1 | Mỗi project dataset khác schema | Không so sánh cross-project được |
| 2 | Giá trị tiền tệ chưa thống nhất (bani/cent) | Report sai 100x nếu quên ÷100 |
| 3 | Ads attribution chỉ 26% (STRAMARK) | 74% orders = Unknown |
| 4 | STRING columns thay vì proper types | SAFE_CAST overhead + lỗi tiềm ẩn |
| 5 | Thiếu multi-channel tracking | Chỉ có Facebook, chưa TikTok/Google |
| 6 | Exchange rate hardcode | Sai khi tỷ giá biến động |

---

## 2. UNIFIED DATA MODEL

### 2.1 Dimension Tables (Shared across ALL projects)

```sql
-- ═══ dim_channel ═══ (NEW — multi-platform tracking)
CREATE TABLE `{PROJECT}.shared_dims.dim_channel` (
  channel_id STRING,        -- 'facebook', 'tiktok', 'google', 'organic'
  channel_name STRING,      -- Tên hiển thị
  channel_type STRING,      -- 'paid_social', 'paid_search', 'organic'
  api_version STRING,       -- 'v21.0', 'v1.3', 'v17'
  is_active BOOL
);

-- ═══ dim_market_master ═══ (NEW — all markets, all projects)
CREATE TABLE `{PROJECT}.shared_dims.dim_market_master` (
  market_code STRING,       -- 'KR', 'TW', 'JP', 'RO', 'SA'...
  market_name STRING,       -- 'South Korea', 'Taiwan', 'Japan'
  region STRING,            -- 'East Asia', 'Europe', 'GCC'
  currency_code STRING,     -- 'KRW', 'TWD', 'JPY'
  timezone STRING,          -- 'Asia/Seoul'
  language_code STRING,     -- 'ko', 'zh-TW', 'ja'
  is_active BOOL
);

-- ═══ dim_currency ═══ (NEW — dynamic exchange rates)
CREATE TABLE `{PROJECT}.shared_dims.dim_currency` (
  currency_code STRING,     -- 'KRW', 'TWD', 'JPY'
  currency_name STRING,
  to_usd_rate FLOAT64,     -- Tỷ giá quy đổi sang USD
  to_vnd_rate FLOAT64,     -- Tỷ giá quy đổi sang VND
  rate_date DATE,           -- Ngày cập nhật
  source STRING             -- 'exchangerate-api', 'manual'
);

-- ═══ dim_platform ═══ (NEW — sales platforms)
CREATE TABLE `{PROJECT}.shared_dims.dim_platform` (
  platform_id STRING,       -- 'poscake', 'tiktok_shop', 'shopee'
  platform_name STRING,
  platform_type STRING,     -- 'pos', 'marketplace', 'direct'
  commission_rate FLOAT64,  -- % hoa hồng sàn
  is_active BOOL
);
```

### 2.2 Fact Tables — Chuẩn hóa Schema

```sql
-- ═══ fact_orders (unified) ═══
-- Mọi project PHẢI có cùng schema này
CREATE TABLE `{PROJECT}.{DATASET}.fact_orders` (
  -- Keys
  order_id STRING NOT NULL,
  project_id STRING NOT NULL,
  shop_id STRING,
  -- Timestamps
  created_at TIMESTAMP,
  shipped_at TIMESTAMP,
  delivered_at TIMESTAMP,
  -- Status (INT, NOT STRING)
  status INT64,
  status_group STRING,         -- 'processing','shipped','success','returned','cancelled'
  -- Revenue (ĐÃ chia 100, local currency)
  revenue_gross FLOAT64,       -- total_price / 100
  revenue_net FLOAT64,         -- total_price_after_sub_discount / 100
  revenue_cod FLOAT64,         -- cod / 100 (tiền thực thu)
  discount FLOAT64,            -- total_discount / 100
  -- Costs (local currency)
  shipping_fee FLOAT64,
  partner_fee FLOAT64,
  return_fee FLOAT64,
  marketplace_fee FLOAT64,
  surcharge FLOAT64,
  cogs FLOAT64,                -- Từ order_items join
  -- Attribution
  channel STRING,              -- 'facebook', 'tiktok', 'google', 'organic'
  campaign_id STRING,
  adset_id STRING,
  ad_id STRING,
  utm_source STRING,
  utm_medium STRING,
  utm_campaign STRING,
  -- Market
  market_code STRING,          -- 'KR', 'JP', 'RO'...
  currency_code STRING,        -- 'KRW', 'JPY', 'RON'...
  revenue_usd FLOAT64,        -- Auto-converted
  -- Customer
  customer_id STRING,
  customer_phone STRING,
  -- Marketer
  marketer_id STRING,
  marketer_name STRING,
  -- Meta
  sync_time TIMESTAMP,
  source_platform STRING       -- 'poscake', 'tiktok_shop'
);

-- ═══ fact_ads_unified ═══ (FB + TikTok + Google — CÙNG schema)
CREATE TABLE `{PROJECT}.{DATASET}.fact_ads_unified` (
  -- Keys
  ad_date DATE NOT NULL,
  project_id STRING NOT NULL,
  channel STRING NOT NULL,     -- 'facebook', 'tiktok', 'google'
  account_id STRING,
  campaign_id STRING,
  campaign_name STRING,
  adset_id STRING,
  adset_name STRING,
  ad_id STRING,
  ad_name STRING,
  -- Spend (LUÔN USD)
  spend_usd FLOAT64,
  spend_local FLOAT64,
  spend_currency STRING,
  -- Performance
  impressions INT64,
  reach INT64,
  clicks INT64,
  ctr FLOAT64,
  cpc FLOAT64,
  cpm FLOAT64,
  -- Conversions (platform-reported)
  conversions INT64,
  conversion_value FLOAT64,
  -- Meta
  sync_time TIMESTAMP
);
```

### 2.3 ETL Pipeline Chuẩn hóa

```
RAW DATA (API response) 
  → STAGING (dedup, type cast) 
    → CLEAN (÷100, currency convert, status mapping)
      → MART (aggregated, business logic)
        → REPORT (dashboard-ready)
```

**Quy tắc ETL bắt buộc:**

| # | Quy tắc | Áp dụng |
|:---:|:---|:---|
| 1 | Mọi giá trị tiền ÷ `pos_price_divisor` tại STAGING | Tất cả project |
| 2 | Status PHẢI cast INT64, KHÔNG để STRING | Tất cả project |
| 3 | Dedup bằng staging → merge (KHÔNG WRITE_APPEND) | Tất cả project |
| 4 | Exchange rate lấy từ `dim_currency` (KHÔNG hardcode) | Tất cả project |
| 5 | Channel attribution = 'facebook'/'tiktok'/'google'/'organic' | Tất cả project |
| 6 | Timestamp = UTC, convert theo `dim_market.timezone` khi report | Tất cả project |

---

## 3. REPORTING LAYER

### 3.1 Dashboard Reports Cần Có

| # | Report | Freq | Nguồn | Output |
|:---:|:---|:---|:---|:---|
| 1 | **Daily P&L** | Daily | fact_orders + fact_ads_unified | Dashboard + Discord |
| 2 | **ROAS by Channel** | Daily | fact_ads_unified + fact_orders | Dashboard |
| 3 | **Market Performance** | Daily | fact_orders GROUP BY market | Dashboard |
| 4 | **Product Performance** | Daily | fact_order_items | Dashboard |
| 5 | **Marketer Scorecard** | Weekly | All facts | PDF + Discord |
| 6 | **Cross-project Compare** | Weekly | All datasets | Dashboard |

### 3.2 Real-time KPIs

```
┌─────────────────────────────────────────────────┐
│              REAL-TIME DASHBOARD                 │
├──────────┬──────────┬──────────┬────────────────┤
│ Revenue  │ Orders   │ ROAS     │ Delivery Rate  │
│ (Today)  │ (Today)  │ (7-day)  │ (7-day)        │
├──────────┼──────────┼──────────┼────────────────┤
│ Ads Spend│ CPO      │ AOV      │ Return Rate    │
│ (Today)  │ (7-day)  │ (7-day)  │ (7-day)        │
├──────────┴──────────┴──────────┴────────────────┤
│ Charts: Revenue trend, Channel mix, Market heat │
└─────────────────────────────────────────────────┘
```

---

## 4. IMPLEMENTATION CHECKLIST

- [ ] Tạo `shared_dims` dataset trong BigQuery
- [ ] Tạo 4 dim tables (channel, market, currency, platform)
- [ ] Seed data cho dim tables
- [ ] Tạo exchange rate sync workflow (daily, từ API)
- [ ] Migrate schema `sale_order` → `fact_orders` (per project)
- [ ] Migrate schema `fb_ads_data` → `fact_ads_unified`
- [ ] Update tất cả SQL views dùng unified schema
- [ ] Update dashboard API endpoints
- [ ] Test cross-project reporting
- [ ] Deploy + verify
