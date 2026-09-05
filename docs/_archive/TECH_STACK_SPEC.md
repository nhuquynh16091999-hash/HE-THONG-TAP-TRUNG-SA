# TECH STACK & TOOLS — Chi tiết Công nghệ Triển khai

> **Phạm vi**: Toàn bộ stack công nghệ cho dự án mở rộng FAOS
> **Nguyên tắc**: Tận dụng tối đa stack hiện tại, chỉ thêm mới khi cần thiết

---

## 1. TECH STACK TỔNG HỢP

| Layer | Hiện tại | Thêm mới | Lý do |
|:---|:---|:---|:---|
| **Data Warehouse** | BigQuery | — | Giữ nguyên, thêm datasets |
| **Orchestration** | n8n (self-hosted) | — | Thêm workflows cho TikTok/Google |
| **Backend / Agents** | Python 3.11 + Pydantic | google-ads-api, tiktok-business-api | Thêm SDK mới |
| **Dashboard** | Next.js (App Router) | — | Thêm pages/components |
| **LLM** | Gemini / OpenAI | — | Giữ nguyên |
| **Notifications** | Discord Webhooks | Telegram (optional) | Thêm Telegram cho team KR/JP |
| **Config** | YAML files | — | Thêm fields cho multi-channel |
| **Version Control** | Git / GitHub | — | Giữ nguyên |
| **CSS Framework** | TailwindCSS | — | Giữ nguyên |
| **Deployment** | Vercel (FE), Local (BE) | Cloud Run (optional) | Cho scheduled agents |

---

## 2. API INTEGRATIONS

### 2.1 Hiện có (Đang hoạt động)

| API | Version | SDK/Library | Rate Limit |
|:---|:---|:---|:---|
| **Meta Marketing API** | v21.0 | `requests` (direct) | 200 req/h/account |
| **Poscake POS API** | v1 | `requests` (direct) | ~100 req/min |
| **Pancake CRM API** | v1 | `requests` (direct) | Không rõ |
| **BigQuery API** | v2 | `google-cloud-bigquery` | 100 concurrent queries |
| **Discord Webhook** | — | `requests` (direct) | 30 req/min/webhook |

### 2.2 Cần thêm mới

| API | Version | SDK/Library | Rate Limit | Docs |
|:---|:---|:---|:---|:---|
| **TikTok Marketing API** | v1.3 | `business-api-client-python` | 10 req/s | [docs](https://business-api.tiktok.com/portal/docs) |
| **TikTok Shop API** | v202309 | `tiktok-shop-python` | 100 req/10s | [docs](https://partner.tiktokshop.com) |
| **Google Ads API** | v17 | `google-ads-python` | 15,000 ops/day | [docs](https://developers.google.com/google-ads/api) |
| **Google Merchant Center** | Content API v2.1 | `google-api-python-client` | 7,000 req/day | [docs](https://developers.google.com/shopping-content) |
| **Exchange Rate API** | — | `exchangerate-api` | 1,500 req/mo (free) | [docs](https://www.exchangerate-api.com) |

### 2.3 Cài đặt Dependencies

```bash
# Thêm vào requirements.txt
google-ads==24.1.0              # Google Ads API
google-api-python-client==2.0   # Google Merchant Center
tiktok-business-api==0.1.0      # TikTok Marketing API (hoặc requests direct)
exchangerates==0.3.0            # Exchange rate sync
```

---

## 3. BIGQUERY SCHEMA MỞ RỘNG

### 3.1 Datasets mới cần tạo

```
levelup-465304/
├── shared_dims/           ← NEW: Unified dimensions
│   ├── dim_channel
│   ├── dim_market_master
│   ├── dim_currency
│   └── dim_platform
├── STRAMARK_Dataset/      ← Existing
├── AUUS1_Dataset/         ← Existing
├── TALPHA_Dataset/        ← Existing
├── KOREA_Dataset/         ← NEW
├── TAIWAN_Dataset/        ← NEW
└── JAPAN_Dataset/         ← NEW
```

### 3.2 Mỗi project dataset chứa

```
{PROJECT}_Dataset/
├── fact_orders              ← Unified schema (all sources)
├── fact_ads_unified         ← FB + TikTok + Google
├── fact_order_items         ← Product-level detail
├── staging_sale_order       ← Staging (dedup)
├── staging_order_items      ← Staging (dedup)
├── mart_performance_master  ← Tier 1 aggregation
├── mart_market_intelligence ← Tier 2 aggregation
├── mart_product_insights    ← Tier 3 aggregation
├── vw_fact_daily_pnl_v2     ← P&L view
├── dim_marketer             ← Project-specific
├── dim_status_mapping       ← Project-specific
└── ads_action_log           ← NEW: auto ads actions
```

---

## 4. N8N WORKFLOW MỞ RỘNG

### 4.1 Workflows mới cần tạo

| # | Workflow | Schedule | Source → Target |
|:---:|:---|:---|:---|
| 1 | `[{PROJECT}] TikTok Ads Sync` | Every 2h | TikTok API → fact_ads_unified |
| 2 | `[{PROJECT}] Google Ads Sync` | Every 2h | Google API → fact_ads_unified |
| 3 | `[{PROJECT}] TikTok Shop Orders` | Every 15m | TikTok Shop → fact_orders |
| 4 | `[SHARED] Exchange Rate Sync` | Daily 00:00 | API → dim_currency |
| 5 | `[{PROJECT}] Ads Auto Care` | Every 2h | Rules engine → API actions |
| 6 | `[{PROJECT}] Google Product Feed` | Daily 06:00 | BQ → Merchant Center |

### 4.2 Template Structure

```
n8n/
├── _shared/
│   ├── template_pos_sync.json
│   ├── template_fb_ads_sync.json
│   ├── template_tiktok_ads_sync.json  ← NEW
│   ├── template_google_ads_sync.json  ← NEW
│   ├── template_tiktok_shop_sync.json ← NEW
│   └── template_exchange_rate.json    ← NEW
├── korea/                             ← NEW
├── taiwan/                            ← NEW
└── japan/                             ← NEW
```

---

## 5. AGENT SYSTEM MỞ RỘNG

### 5.1 Agents hiện tại (giữ nguyên)

| Agent | Vai trò | Cần update? |
|:---|:---|:---:|
| Profit Guardian | ROAS + P&L monitoring | ✅ Thêm multi-channel |
| Ops Watchdog | Stock + stuck orders | ❌ Giữ nguyên |
| Daily Briefer | Daily summary (LLM) | ✅ Thêm channel breakdown |
| CS Coach | CS performance | ❌ Giữ nguyên |
| Logistics Optimizer | Carrier monitoring | ✅ Thêm 3PL mới |

### 5.2 Agents mới

| Agent | Vai trò | Priority |
|:---|:---|:---:|
| **Ads Optimizer** | Auto care ads (pause/scale/alert) | 🔴 Phase 2 |
| **Market Expander** | Monitor new market KPIs | 🟡 Phase 3 |
| **Channel Manager** | Cross-channel attribution | 🟡 Phase 4 |

---

## 6. DASHBOARD MỞ RỘNG

### 6.1 Pages mới

| # | Page | Nội dung | Priority |
|:---:|:---|:---|:---:|
| 1 | **Channel Overview** | So sánh FB vs TikTok vs Google | Phase 4 |
| 2 | **Auto Ads Log** | Lịch sử actions tự động | Phase 2 |
| 3 | **Market Heatmap** | Performance theo thị trường | Phase 3 |
| 4 | **Cross-Project Compare** | So sánh tất cả projects | Phase 1 |
| 5 | **Budget Allocation** | Chi tiêu theo channel/market | Phase 4 |

---

## 7. MONITORING & ALERTING

| Tool | Mục đích | Setup |
|:---|:---|:---|
| **Discord** | Alerts + daily reports | Existing ✅ |
| **BigQuery Scheduled Queries** | Health check SQL | Daily |
| **n8n Error Handler** | Workflow failures | Per workflow |
| **Uptime monitor** | Dashboard availability | Cron job |

---

## 8. SECURITY NOTES

| # | Concern | Solution |
|:---:|:---|:---|
| 1 | API tokens in config files | `.env` file, KHÔNG commit git |
| 2 | BigQuery access | Service account with least privilege |
| 3 | Ads API write access | Rate limit + action log + approval queue |
| 4 | PII (customer data) | Hash phone/email trong BQ |
| 5 | Token expiry | Health check agent alerts khi < 7 ngày |
