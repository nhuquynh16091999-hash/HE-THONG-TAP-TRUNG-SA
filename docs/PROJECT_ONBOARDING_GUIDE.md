# 📋 HƯỚNG DẪN ONBOARDING DỰ ÁN MỚI — FAOS v6

> **Dành cho**: Project Lead (không cần biết code)
> **Mục đích**: Cung cấp đầy đủ thông tin để AI tự động thiết lập hệ thống cho dự án của bạn
> **Thời gian**: 1-2 giờ thu thập thông tin

---

## 📌 Mục lục

1. [Tổng quan kiến trúc hệ thống](#1-tổng-quan-kiến-trúc-hệ-thống)
2. [Checklist thông tin cần cung cấp](#2-checklist-thông-tin-cần-cung-cấp)
3. [Hướng dẫn lấy Facebook/Meta Ads credentials](#3-hướng-dẫn-lấy-facebookmeta-ads-credentials)
4. [Hướng dẫn kết nối POS (Quản lý đơn hàng)](#4-hướng-dẫn-kết-nối-pos-quản-lý-đơn-hàng)
5. [Mapping sản phẩm (Product Mapping)](#5-mapping-sản-phẩm)
6. [Mapping Marketer (Team)](#6-mapping-marketer-team)
7. [Thiết lập thị trường & 3PL](#7-thiết-lập-thị-trường--3pl)
8. [Discord Notifications](#8-discord-notifications)
9. [Google Sheets (Master Data)](#9-google-sheets-master-data)
10. [File ENV — Biến môi trường](#10-file-env--biến-môi-trường)
11. [BigQuery — Kiến trúc dữ liệu](#11-bigquery--kiến-trúc-dữ-liệu)
12. [Xác nhận & Bàn giao cho AI](#12-xác-nhận--bàn-giao-cho-ai)

---

## 1. Tổng quan kiến trúc hệ thống

Hệ thống FAOS hoạt động theo mô hình sau:

```
┌─────────────────┐     ┌──────────────┐     ┌──────────────┐
│  Facebook Ads   │────▶│              │────▶│   Dashboard  │
│  (Meta API)     │     │   BigQuery   │     │   (Web UI)   │
└─────────────────┘     │  (Kho dữ    │     └──────────────┘
                        │   liệu)     │
┌─────────────────┐     │              │     ┌──────────────┐
│  POS System     │────▶│              │────▶│  AI Agents   │
│  (Đơn hàng)    │     └──────────────┘     │ (Phân tích)  │
└─────────────────┘                          └──────────────┘
                        ┌──────────────┐
┌─────────────────┐     │   n8n        │
│  Google Sheets  │────▶│ (Auto Sync)  │────▶ BigQuery
│  (Chi phí)     │     └──────────────┘
└─────────────────┘
```

**Luồng dữ liệu:**
1. **n8n** tự động kéo data từ Facebook Ads + POS mỗi 15 phút → lưu vào **BigQuery**
2. **AI Agents** phân tích data trong BigQuery → đưa ra insights, dự đoán
3. **Dashboard** hiển thị tất cả lên giao diện web để bạn theo dõi

**Bạn cần làm gì?** → Cung cấp thông tin kết nối (API keys, tokens) để hệ thống tự chạy.

---

## 2. Checklist thông tin cần cung cấp

> ✅ = Bắt buộc  |  ⚠️ = Nên có  |  ℹ️ = Tùy chọn

| # | Hạng mục | Mức độ | Đã có? |
|---|----------|--------|--------|
| 1 | Facebook Ads: Access Token + Ad Account IDs | ✅ | ☐ |
| 2 | Facebook Ads: Business Manager ID | ⚠️ | ☐ |
| 3 | Facebook Ads: Pixel ID | ⚠️ | ☐ |
| 4 | POS System: API Token + Shop ID | ✅ | ☐ |
| 5 | Danh sách sản phẩm (tên, giá vốn, SKU) | ✅ | ☐ |
| 6 | Danh sách Marketer (tên, mã 3 ký tự) | ✅ | ☐ |
| 7 | Danh sách thị trường (quốc gia, tiền tệ, kho) | ✅ | ☐ |
| 8 | Đối tác giao hàng 3PL (tên, API nếu có) | ⚠️ | ☐ |
| 9 | Discord Webhook URLs | ⚠️ | ☐ |
| 10 | Google Sheet giá vốn + chi phí cố định | ⚠️ | ☐ |
| 11 | Tỷ giá quy đổi | ✅ | ☐ |
| 12 | Naming convention cho campaigns | ⚠️ | ☐ |

---

## 3. Hướng dẫn lấy Facebook/Meta Ads credentials

### 3.1 Access Token (BẮT BUỘC)

**Đây là gì?** Chìa khóa để hệ thống tự động đọc dữ liệu quảng cáo từ Facebook.

**Các bước:**

1. Truy cập [business.facebook.com/settings](https://business.facebook.com/settings)
2. Menu trái → **Người dùng** → **Người dùng hệ thống** (System Users)
3. Nếu chưa có → bấm **Thêm** → nhập tên (vd: `FAOS Bot`) → role: **Admin**
4. Bấm vào user vừa tạo → **Tạo token mới**
5. Chọn App (nếu chưa có App thì tạo ở bước 3.2)
6. Tick các quyền sau:
   - `ads_management`
   - `ads_read`
   - `business_management`
   - `pages_read_engagement`
7. Bấm **Generate Token** → **copy token** → lưu an toàn

> ⚠️ **CẢNH BÁO**: Token này có quyền truy cập tài khoản quảng cáo. KHÔNG chia sẻ cho người không liên quan.

### 3.2 App ID & App Secret

1. Truy cập [developers.facebook.com/apps](https://developers.facebook.com/apps)
2. Bấm **Create App** → chọn **Business** → đặt tên (vd: `FAOS Zen8`)
3. Sau khi tạo → vào **Settings** → **Basic**
4. Copy **App ID** và **App Secret**

### 3.3 Ad Account IDs (BẮT BUỘC)

**Đây là gì?** ID của từng tài khoản quảng cáo mà dự án đang chạy.

1. Vào [adsmanager.facebook.com](https://adsmanager.facebook.com)
2. Click dropdown góc trên trái → thấy danh sách tài khoản
3. Mỗi tài khoản có ID dạng `act_XXXXXXXXXX`
4. Liệt kê TẤT CẢ tài khoản đang dùng cho dự án

**Điền vào file**: `config/projects/{project_id}.yaml` → mục `meta_ads.ad_account_ids`

```yaml
meta_ads:
  access_token: "EAAxxxxxx..."        # Token từ bước 3.1
  ad_account_ids:
    - "act_123456789"                  # TK QC #1
    - "act_987654321"                  # TK QC #2
  business_id: "123456789"             # Từ Business Settings → Thông tin DN
  pixel_id: "123456789"                # Nếu dùng Pixel
```

### 3.4 Business Manager ID

1. Vào [business.facebook.com/settings](https://business.facebook.com/settings)
2. Menu trái → **Thông tin doanh nghiệp** (Business Info)
3. Copy **Business ID** (dãy số)

### 3.5 Pixel ID (nếu dùng)

1. Vào [business.facebook.com/events_manager](https://business.facebook.com/events_manager)
2. Chọn Pixel → copy **Pixel ID**

---

## 4. Hướng dẫn kết nối POS (Quản lý đơn hàng)

Hệ thống hỗ trợ các POS sau. **Chọn 1 hệ thống đang dùng** và làm theo hướng dẫn.

### 4A. Poscake

1. Đăng nhập [poscake.vn](https://poscake.vn)
2. Vào **Cài đặt** → **API** → bật API
3. Copy **API Token** và **Shop ID**
4. Điền vào YAML:

```yaml
pos_system: poscake
poscake:
  api_url: "https://api.poscake.vn/api/v1"
  api_token: "your_token_here"
  shop_id: "your_shop_id"
```

### 4B. Pancake

1. Đăng nhập Pancake → **Settings** → **Developers**
2. Tạo API Token → copy
3. Lấy danh sách **Page ID** (mỗi Facebook Page kết nối)
4. Điền vào YAML:

```yaml
pos_system: pancake
pancake:
  api_url: "https://pages.fm/api/v1"
  api_token: "your_token_here"
  page_ids:
    - "page_id_1"
    - "page_id_2"
```

### 4C. Haravan

1. Admin Haravan → **Apps** → **Tạo Private App**
2. Copy API URL, Token, Shop Domain
3. Điền vào YAML:

```yaml
pos_system: haravan
haravan:
  api_url: "https://apis.haravan.com"
  api_token: "your_token_here"
  shop_domain: "myshop.haravan.com"
```

### 4D. Shopify

1. Shopify Admin → **Settings** → **Apps and sales channels** → **Develop apps**
2. Tạo app → cấp quyền `read_orders`, `read_products`
3. Copy credentials
4. Điền vào YAML:

```yaml
pos_system: shopify
shopify:
  shop_domain: "myshop.myshopify.com"
  api_key: "your_key"
  api_secret: "your_secret"
  access_token: "your_admin_token"
```

### 4E. Manual (Google Sheets)

Nếu không dùng POS, nhập đơn hàng qua Google Sheets:

```yaml
pos_system: manual
manual:
  google_sheet_id: "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms"
  sheet_name: "Orders"
```

---

## 5. Mapping sản phẩm

### Tại sao cần?

Hệ thống cần biết sản phẩm nào đang bán, giá vốn bao nhiêu, để tính P&L (lãi/lỗ) tự động.

### Cách tạo file Product Mapping

Tạo file `config/projects/{PROJECT_ID}_product_mapping.yaml` với format:

```yaml
# Ví dụ: config/projects/zen8_product_mapping.yaml
products:
  - sku: "ZN8-001"
    name: "Sản phẩm A"
    name_en: "Product A"
    category: "health"             # health / beauty / fashion / electronics / home
    cost_price: 5.00               # Giá vốn (cùng đơn vị currency của dự án)
    selling_price: 29.99           # Giá bán
    weight_kg: 0.5                 # Cân nặng (để tính ship)
    markets:                       # Thị trường bán sản phẩm này
      - "SA"
      - "AE"
    status: active                 # active / discontinued

  - sku: "ZN8-002"
    name: "Sản phẩm B"
    name_en: "Product B"
    category: "beauty"
    cost_price: 3.50
    selling_price: 19.99
    weight_kg: 0.3
    markets: ["SA", "AE", "KW"]
    status: active
```

### Thông tin cần thu thập cho mỗi sản phẩm

| Field | Bắt buộc | Mô tả | Ví dụ |
|-------|----------|-------|-------|
| `sku` | ✅ | Mã sản phẩm duy nhất | `ZN8-001` |
| `name` | ✅ | Tên tiếng Việt | `Kem dưỡng A` |
| `name_en` | ⚠️ | Tên tiếng Anh | `Cream A` |
| `category` | ✅ | Danh mục | `beauty` |
| `cost_price` | ✅ | Giá vốn | `5.00` |
| `selling_price` | ✅ | Giá bán | `29.99` |
| `weight_kg` | ⚠️ | Cân nặng | `0.5` |
| `markets` | ✅ | Thị trường bán | `["SA","AE"]` |
| `status` | ✅ | Trạng thái | `active` |

---

## 6. Mapping Marketer (Team)

### Tại sao cần?

Để hệ thống biết ai đang chạy ads cho dự án, từ đó báo cáo hiệu suất theo từng marketer.

### Cách điền

Trong file `config/projects/{project_id}.yaml` → mục `marketers`:

```yaml
marketers:
  - id: "NHT"                       # Mã 3 ký tự (VIẾT HOA, duy nhất)
    name: "Nguyễn Hoàng Thắng"      # Tên đầy đủ
    role: "lead"                     # lead / senior / junior

  - id: "TVA"
    name: "Trần Văn An"
    role: "senior"

  - id: "LTH"
    name: "Lê Thị Hoa"
    role: "junior"
```

### Quy tắc đặt mã Marketer

- 3 ký tự VIẾT HOA
- Lấy từ tên viết tắt (vd: Nguyễn Hoàng Thắng → NHT)
- Mã này phải **trùng với prefix** trong tên Campaign Facebook Ads

**Ví dụ naming convention cho campaign:**
```
NHT_SA_product-a_conv_broad
│    │   │          │     │
│    │   │          │     └── Targeting type
│    │   │          └── Objective
│    │   └── Sản phẩm
│    └── Thị trường
└── Mã Marketer
```

> ⚠️ Nếu campaign KHÔNG có prefix marketer, hệ thống sẽ không biết ai đang chạy.

---

## 7. Thiết lập thị trường & 3PL

### 7.1 Thị trường (Markets)

Trong file YAML → mục `markets`:

```yaml
markets:
  - code: SA                         # Mã ISO 2 ký tự
    name: Saudi Arabia               # Tên đầy đủ
    currency: SAR                    # Đơn vị tiền tệ
    warehouse: "KSA Central WH"     # Kho phục vụ thị trường này

  - code: AE
    name: UAE
    currency: AED
    warehouse: "Dubai WH"
```

**Danh sách mã quốc gia thường dùng:**

| Code | Quốc gia | Currency |
|------|----------|----------|
| SA | Saudi Arabia | SAR |
| AE | UAE | AED |
| KW | Kuwait | KWD |
| OM | Oman | OMR |
| BH | Bahrain | BHD |
| QA | Qatar | QAR |
| AU | Australia | AUD |
| US | United States | USD |
| RO | Romania | RON |
| HR | Croatia | EUR |
| IT | Italy | EUR |
| BG | Bulgaria | BGN |

### 7.2 Đối tác giao hàng (3PL / Fulfillment)

```yaml
fulfillment:
  primary_3pl: "ajex"                # Tên 3PL chính đang dùng
  api_url: ""                        # URL API (nếu tích hợp tracking)
  api_key: ""                        # API Key (nếu có)
  api_secret: ""                     # API Secret (nếu có)
  tracking_enabled: false            # true = tự động track trạng thái đơn
```

**Các 3PL phổ biến:**

| 3PL | Khu vực | Có API? |
|-----|---------|---------|
| AJEX | Middle East | ✅ |
| Aramex | Middle East | ✅ |
| J&T | SEA, Middle East | ✅ |
| iMile | Middle East | ✅ |
| Naqel | Saudi Arabia | ✅ |
| SPX (Shopee Express) | SEA | ✅ |
| FAN Courier | Romania/EU | ✅ |
| GLS | EU | ✅ |
| Australia Post | Australia | ✅ |
| StarTrack | Australia | ✅ |

---

## 8. Discord Notifications

### Tại sao cần?

Hệ thống gửi báo cáo P&L hàng ngày và cảnh báo (lỗ, hết hàng) qua Discord.

### Cách tạo Discord Webhook

1. Mở **Discord Server** của team
2. Vào **Server Settings** → **Integrations** → **Webhooks**
3. Bấm **New Webhook**
4. Đặt tên (vd: `FAOS Report - Zen8`)
5. Chọn channel nhận thông báo
6. Bấm **Copy Webhook URL**
7. Tạo **2 webhooks** riêng:
   - 1 cho **báo cáo daily** (gửi vào channel `#reports`)
   - 1 cho **cảnh báo** (gửi vào channel `#alerts`)

```yaml
discord:
  webhook_report: "https://discord.com/api/webhooks/xxx/yyy"
  webhook_alert: "https://discord.com/api/webhooks/aaa/bbb"
```

---

## 9. Google Sheets (Master Data)

### Tại sao cần?

Quản lý giá vốn sản phẩm và chi phí cố định (lương, kho bãi, tool) trên Google Sheets.

### 9.1 Sheet Giá vốn sản phẩm

Tạo Google Sheet với các cột:

| SKU | Product Name | Cost Price | Currency | Updated Date |
|-----|-------------|------------|----------|-------------|
| ZN8-001 | Sản phẩm A | 5.00 | USD | 2026-03-01 |
| ZN8-002 | Sản phẩm B | 3.50 | USD | 2026-03-01 |

Copy Sheet ID từ URL:
```
https://docs.google.com/spreadsheets/d/[SHEET_ID_Ở_ĐÂY]/edit
```

### 9.2 Sheet Chi phí cố định

| Expense Type | Amount | Currency | Frequency | Note |
|-------------|--------|----------|-----------|------|
| Lương MKT | 500 | USD | monthly | 2 marketers |
| Kho bãi | 200 | USD | monthly | KSA warehouse |
| Tool/SaaS | 100 | USD | monthly | Spy tools |

```yaml
google_sheets:
  product_cost_sheet_id: "1BxiMVs..."
  fixed_cost_sheet_id: "1CxiMVs..."
```

---

## 10. File ENV — Biến môi trường

Mỗi dự án cần các biến môi trường riêng. Copy template từ `config/LEADER_ENV_TEMPLATE.env` và điền vào.

### Các biến quan trọng nhất

```env
# ── PROJECT ──
PROJECT_ID=zen8                      # Mã dự án (lowercase)

# ── META ADS ──
META_APP_ID=123456789                # Từ bước 3.2
META_APP_SECRET=abcdef123456         # Từ bước 3.2
META_ACCESS_TOKEN=EAAxxxxxx          # Từ bước 3.1 (DÀI, ~200 ký tự)
META_AD_ACCOUNT_IDS=act_111,act_222  # Từ bước 3.3 (phân cách bởi dấu phẩy)

# ── POS ──
POSCAKE_API_TOKEN=pk_xxxx            # Từ bước 4A (hoặc hệ thống POS đang dùng)
POSCAKE_SHOP_ID=shop_xxxx

# ── BIGQUERY ──
BQ_PROJECT_ID=levelup-465304         # GCP Project (giữ nguyên)
BQ_DATASET={PROJECT_ID}_Dataset      # Tự động tạo theo project_id

# ── DISCORD ──
DISCORD_WEBHOOK_URL=https://...      # Từ bước 8
DISCORD_WEBHOOK_ALERT=https://...

# ── GOOGLE SHEETS ──
SHEET_PRODUCT_COST_ID=1BxiMVs...     # Từ bước 9.1
SHEET_FIXED_COST_ID=1CxiMVs...       # Từ bước 9.2
```

> ⚠️ **KHÔNG** commit file `.env` lên Git. File này chứa thông tin nhạy cảm.

---

## 11. BigQuery — Kiến trúc dữ liệu

> **Bạn không cần tự tạo BigQuery.** AI sẽ tạo tự động sau khi bạn cung cấp đủ thông tin.

Mỗi dự án sẽ có 1 BigQuery Dataset riêng:

| Dự án | Dataset Name | Tables |
|-------|-------------|--------|
| zen8 | `ZEN8_Dataset` | orders, ads_insights, products, customers |
| trendify | `TRENDIFY_Dataset` | orders, ads_insights, products, customers |
| hnle | `HNLE_Dataset` | orders, ads_insights, products, customers |

### Các bảng chính trong mỗi Dataset

| Table | Chứa gì | Sync từ |
|-------|---------|---------|
| `orders` | Đơn hàng | POS system |
| `ads_insights` | Chi tiêu & hiệu suất QC | Facebook Ads API |
| `products` | Sản phẩm & giá vốn | Google Sheets / POS |
| `customers` | Khách hàng | POS system |
| `agent_run_log` | Log chạy AI agents | Hệ thống tự ghi |
| `ai_prediction_log` | Dự đoán của AI | AI agents |

---

## 12. Xác nhận & Bàn giao cho AI

### Checklist trước khi bàn giao

Sau khi thu thập xong thông tin, kiểm tra checklist sau:

```
✅ THÔNG TIN BẮT BUỘC
  ☐ Facebook Access Token đã test thành công
  ☐ Ít nhất 1 Ad Account ID
  ☐ POS API Token + Shop ID
  ☐ Danh sách sản phẩm (ít nhất tên + giá vốn + giá bán)
  ☐ Danh sách marketer (tên + mã 3 ký tự)
  ☐ Danh sách thị trường (code + tên + currency)
  ☐ Tỷ giá quy đổi (nếu multi-currency)

⚠️ NÊN CÓ
  ☐ Business Manager ID
  ☐ Pixel ID
  ☐ 3PL name + API (nếu có)
  ☐ Discord Webhook URLs (report + alert)
  ☐ Google Sheet giá vốn + chi phí cố định
  ☐ Naming convention cho campaigns

ℹ️ TÙY CHỌN
  ☐ Haravan/Shopify credentials (nếu dùng)
  ☐ Multiple POS connections
  ☐ Custom thresholds (ROAS, CPA targets)
```

### Cách bàn giao

1. **Điền đầy đủ** file `config/projects/{project_id}.yaml`
2. **Tạo file** `config/projects/{project_id}_product_mapping.yaml`
3. **Điền biến môi trường** vào file `.env` (hoặc gửi riêng cho admin)
4. **Thông báo cho AI agent** bằng cách nói:

> *"Dự án {tên} đã fill xong config. Hãy kiểm tra và thiết lập BigQuery + n8n sync."*

AI sẽ tự động:
- Đọc file YAML config
- Tạo BigQuery Dataset + Tables
- Tạo n8n workflow sync data
- Kích hoạt 3 AI agents cho dự án
- Chạy test sync đầu tiên

---

## 📞 Liên hệ hỗ trợ

Nếu gặp khó khăn trong quá trình thu thập thông tin:

- **Vấn đề Facebook Ads**: Hỏi người quản lý Business Manager
- **Vấn đề POS**: Liên hệ support của POS system đang dùng
- **Vấn đề kỹ thuật**: Báo cho admin hệ thống
- **Câu hỏi khác**: Mở chat với AI agent, hỏi trực tiếp

---

> 📅 **Cập nhật lần cuối**: 2026-03-06
> 📌 **Áp dụng cho**: FAOS v6 — Zen8, Trendify, HNLE
