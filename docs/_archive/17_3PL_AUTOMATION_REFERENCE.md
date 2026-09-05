# 3PL Order Automation — Complete Reference
## Meta Ads → POS (Poscake) → 3PL (euShipments) — STRAMARK

> **Version:** 1.0 — DEFINITIVE  
> **Date:** 2026-02-24  
> **Purpose:** Self-contained reference cho AI agent. Đọc FILE NÀY = đủ context để tiếp tục xây dựng hệ thống automation mà KHÔNG cần đọc lại raw API docs.  
> **⚠️ File này là SINGLE SOURCE OF TRUTH cho mọi thông tin liên quan 3PL automation.**

---

## 1. HỆ THỐNG TỔNG QUAN

### 1.1 Ba Nguồn Dữ Liệu

| # | Source | System | Role | API Base |
|---|--------|--------|------|----------|
| 1 | **Meta Ads** | Facebook Graph API v21.0 | Chạy quảng cáo → đổ lead về POS | `https://graph.facebook.com/v21.0` |
| 2 | **POS** | Poscake (Pancake POS) | Quản lý đơn hàng, khách hàng, sản phẩm | `https://pos.pages.fm/api/v1` |
| 3 | **3PL** | euShipments (InOut BG) | Fulfillment: đóng gói, gửi hàng, tracking | `https://api1.inout.bg/api/v1` |

### 1.2 Quy Trình End-to-End

```
Meta Ads chạy quảng cáo
    ↓ (Lead đổ về qua landing page + UTM params)
POS nhận lead mới (status=0: new)
    ↓ (Telesale gọi xác nhận)
POS đơn xác nhận (status=1: confirmed)
    ↓ (Chuyển trạng thái)
POS cần đóng gói (status=8: packing) ← TRIGGER POINT
    ↓ (🤖 AUTOMATION: Tạo đơn 3PL tự động)
3PL nhận đơn → pick + pack tại kho
    ↓ (3PL giao cho courier)
Courier giao hàng → tracking update
    ↓ (🤖 AUTOMATION: Poll tracking mỗi 2h)
POS cập nhật status (delivered/returned/...)
    ↓ (🤖 AUTOMATION: Sync BQ + P&L)
Dashboard hiển thị realtime
```

---

## 2. 3PL — euShipments API (CHI TIẾT ĐẦY ĐỦ)

### 2.1 Thông Tin Kết Nối

| Key | Value |
|-----|-------|
| **Production Base URL** | `https://api1.inout.bg/api/v1` |
| **Test Base URL** | `https://test-api.inout.bg/api/v1` |
| **Auth Header** | `Authorization: Bearer 0XEmpcYJAf7wWIbXGnk4PiYfSVpYDr2k48lxzoUeP9jE0Io56kJYm1AhHPdw` |
| **Client Dashboard** | `https://clients2.inout.bg/cabinet/login` |
| **Dashboard Login** | User: `aurelia` / Pass: `12aurelia34` |
| **Client Name** | RO - SI_COMERZ - Aurelia Wear |
| **API Docs** | `https://documenter.getpostman.com/view/26992907/2s93Y2S2Q8` |
| **Test Mode** | Hầu hết POST request có field `testMode: true/false` (1/0) |

### 2.2 Verified Account Data (Đã test 2026-02-24)

**Company:**
```json
{
    "ID": 3248,
    "NAME": "RO - SI_COMERZ - Aurelia Wear (aurelia)",
    "BULSTAT": "202407717H",
    "ADDRESS": "138 ROBINSON ROAD 02-50 OXLEY TOWER, SINGAPORE (068906)",
    "MOL": "Pham Thi Phuong Anh"
}
```

**Couriers (7 available for sender 3248):**

| ID | Name | To Office | To Address | Country | Currency |
|:--:|------|:---------:|:----------:|---------|:--------:|
| **8** | Romania Cargus | ✅ | ✅ | Romania | RON |
| **17** | Romania FAN Courier | ❌ | ✅ | Romania | RON |
| **750** | Romania SameDay | ✅ | ✅ | Romania | RON |
| **812** | Romania GLS | ✅ | ✅ | Romania | RON |
| **838** | Bulgaria Express One | ❌ | ✅ | Bulgaria | EUR |
| **651** | Croatia DPD | ❌ | ✅ | Croatia | EUR |
| **741** | Slovakia GLS | ❌ | ✅ | Slovakia | EUR |

> `TO_OFFICE = true` → courier hỗ trợ giao đến điểm nhận hàng (PuDo/Locker)  
> `TO_OFFICE = false` → chỉ giao đến địa chỉ nhà

**Courier Cost (Romania, 20% discount đã áp dụng, EUR):**

| Courier | ≤1kg | ≤2kg | ≤3kg | ≤5kg | COD Fee |
|---------|:----:|:----:|:----:|:----:|---------|
| Cargus | €2.33 | €2.33 | €2.33 | €2.42 | €0.35 min |
| Cargus PuDo | €2.26 | €2.26 | €2.26 | €2.26 | €0.35 min |
| FAN | €2.74 | €2.74 | €2.98 | €3.47 | €0.40 min |
| Sameday RO | €2.46 | €2.46 | €2.64 | €3.00 | €0.33 min |
| EasyBox Locker | €2.14 | €2.14 | €2.32 | €2.69 | 1.1% |
| GLS RO | €2.72 | €2.72 | €2.84 | €3.24 | €0.40 min |
| GLS RO PuDo | €2.12 | €2.12 | €2.12 | €2.12 | €0.22 min |

**Products in 3PL Warehouse (HelpShip Oradea, verified 2026-02-24):**

| # | Reference Number | Product Name | Available Qty |
|---|-----------------|--------------|:---:|
| 1 | D02-NEGRU | Rochie plisată cu decolteu rotund – negru (D02) | 18 |
| 2 | D02-VIȘINIU ELEGANT | Rochie plisată cu decolteu rotund – vișiniu elegant | varies |
| 3 | D04-NEGRU | Rochie plisată cu decolteu rotund – negru (D04) | varies |
| 4 | D04-ROȘU | Rochie plisată cu decolteu în V – roșu (D04) | varies |
| 5 | D04-VERDE | Rochie plisată cu decolteu rotund – verde (D04) | varies |
| 6 | D04-VIOLET | Rochie plisată cu decolteu – violet (D04) | varies |
| 7 | MK01TITANIUM | MK01TITANIUM | 149 |
| ... | ... | (thêm SKU khác) | ... |

> **Warehouse Name:** HelpShip Oradea  
> **Total SKUs:** ~12 products registered  
> **Note:** Gọi `GET /fulfilment/get-prod-avails` để có số lượng realtime

### 2.3 API Endpoints — Chi Tiết Từng Service

#### Service 1: Companies (GET)

```
GET /get-user-companies
Header: Authorization: Bearer {token}

Response:
{
    "ID": 3248,                    ← dùng làm senderId
    "NAME": "RO - SI_COMERZ...",
    "BULSTAT": "202407717H",
    "ADDRESS": "138 ROBINSON ROAD...",
    "MOL": "Pham Thi Phuong Anh"
}
```

#### Service 2: Couriers (GET)

```
GET /couriers/{senderId}
Header: Authorization: Bearer {token}
Path: senderId = 3248

Response: Array of:
{
    "ID": 8,           ← dùng làm courierId khi tạo đơn
    "NAME": "Romania Cargus",
    "TO_OFFICE": true,  ← hỗ trợ giao điểm nhận
    "TO_ADDRESS": true, ← hỗ trợ giao tận nhà
    "COUNTRY": "Romania",
    "CURRENCY": "RON"
}
```

#### Service 3: Product Creation (POST)

```
POST /fulfilment/create-product
Header: Authorization: Bearer {token}
Content-Type: application/json

Body:
{
    "testMode": false,
    "companyId": 3248,
    "product": {
        "name": "Rochie plisată D04 Negru",
        "barcode": "D04-NEGRU-M",
        "refNumber": "D04-NEGRU",        ← UNIQUE reference, dùng trong order
        "barcodeType": "EAN-13",
        "description": "Rochie plisată...",
        "length": 30,                     ← cm
        "width": 20,                      ← cm
        "height": 5,                      ← cm
        "weight": 0.5,                    ← kg
        "hsCode": "6204430000"            ← HS code cho customs
    }
}

Response:
{
    "productId": 12345,
    "error": false
}
```

> **Khi nào dùng:** Khi thêm sản phẩm mới vào kho 3PL. Chỉ cần tạo 1 lần rồi dùng `refNumber` trong create-order.

#### Service 4: Booking Request (POST) — Inbound Stock

```
POST /fulfilment/create-request
Header: Authorization: Bearer {token}
Content-Type: application/json

Body:
{
    "testMode": false,
    "companyId": 3248,
    "warehouseId": <warehouse_id>,      ← lấy từ company info hoặc API
    "products": [
        {"refNumber": "D04-NEGRU", "quantity": 100},
        {"refNumber": "MK01TITANIUM", "quantity": 200}
    ]
}

Response:
{
    "requestId": 56789,
    "error": false
}
```

> **Khi nào dùng:** Khi gửi hàng mới vào kho 3PL. Thông báo cho kho biết sẽ nhận hàng.

#### Service 5: Order Creation (POST) — ⭐ CORE SERVICE

```
POST /fulfilment/create-order
Header: Authorization: Bearer {token}
Content-Type: application/json

Body:
{
    "testMode": false,                       ← true khi test
    "senderId": 3248,                        ← Company ID
    "courierId": 8,                          ← Courier ID (Cargus=8)
    "waybillAvailableDate": "2026-02-24",    ← YYYY-MM-DD
    "serviceName": "crossborder",            ← "" cho Romania nội địa
    "recipient": {
        "name": "Ion Popescu",               ← từ POS bill_full_name
        "countryIsoCode": "RO",              ← từ POS address
        "cityName": "București",             ← từ POS bill_city
        "zipCode": "010101",                 ← từ POS bill_district
        "streetName": "Strada Victoriei 1",  ← từ POS bill_address
        "phoneNumber": "+40712345678",       ← từ POS bill_phone_number
        "email": "ion@email.com"             ← từ POS customer_email
    },
    "shipmentInventory": [                   ← từ POS order_items
        {"itemSku": "D04-NEGRU", "itemQuantity": 1},
        {"itemSku": "MK01TITANIUM", "itemQuantity": 2}
    ],
    "shipmentCOD": {                         ← từ POS cod ÷ 100
        "amount": 156.32,                    ← RON (đã ÷100 từ bani)
        "currency": "RON"
    },
    "shipmentWeight": 1.5,                   ← kg ước tính
    "shipmentContent": "Clothing",           ← mô tả nội dung
    "clientReference": "STR-12345"           ← POS order ID
}

Response (success):
{
    "orderId": 98765,      ← 3PL internal order ID
    "code": 200,
    "error": false
}

Response (error):
{
    "orderId": null,
    "code": 400,
    "error": "Insufficient stock for item D04-NEGRU"
}
```

> **⚠️ CRITICAL RULES:**
> - `senderId` PHẢI = 3248 (company ID đã verify)
> - `shipmentInventory[].itemSku` PHẢI khớp với `refNumber` đã register qua create-product
> - `shipmentCOD.amount` = POS `cod` field ÷ 100 (bani → RON)
> - `clientReference` = POS order ID, dùng prefix "STR-" để dễ track
> - Kiểm tra stock availability trước khi tạo đơn (`get-prod-avails`)

#### Service 6: Orders History (POST) — Tracking

```
POST /fulfilment/orders-history
Header: Authorization: Bearer {token}
Content-Type: application/json

Body:
{
    "testMode": false,
    "orders": [
        {"refNum": "STR-12345"},
        {"refNum": "STR-12346"},
        {"refNum": "STR-12347"}
    ]
}

Response (per order):
{
    "refNum": "STR-12345",
    "awb": "RO1234567890",      ← Tracking/Air Waybill number
    "status": "delivered",       ← Current status
    "error": false
}
```

> **Dùng để:** Poll tracking mỗi 2h. Gửi batch các `clientReference` đã tạo, nhận lại status + AWB.

#### Service 7: Product Availability (GET)

```
GET /fulfilment/get-prod-avails
Header: Authorization: Bearer {token}

Response: Array of:
{
    "AVAIL_DATE": null,
    "STORE_NAME": "HelpShip Oradea",       ← Tên kho
    "ART_NAME": "Rochie plisată...",        ← Tên sản phẩm
    "ART_LNG_DESC": null,
    "ART_SH_DESC": "",
    "CUST_NAME": "RO - SI_COMERZ...",
    "REFERENCE_NUMBER": "D04-NEGRU",        ← SKU reference
    "COURIER_ITEM_CODE": null,
    "AVAIL_QTY": 18                         ← Số lượng available
}
```

> **Dùng để:** Check stock trước khi tạo đơn. Nếu `AVAIL_QTY = 0` → không tạo đơn → alert.

---

## 3. POS — Poscake API (CHI TIẾT ĐẦY ĐỦ)

### 3.1 Thông Tin Kết Nối

| Key | Value |
|-----|-------|
| **API Base URL** | `https://pos.pages.fm/api/v1` |
| **API Key** | `6b8bd8cdfeac486c9e49002600e49d03` |
| **Shop ID** | `1635307570` |
| **Shop Name** | EU |
| **Currency** | RON (stored as **bani** = 1/100 RON, PHẢI ÷100) |

### 3.2 API Endpoints Đang Sử Dụng

| Endpoint | Method | Params | Usage |
|----------|--------|--------|-------|
| `/shops/{shop_id}/orders` | GET | `api_key`, `page`, `sort`, `status` | Fetch orders |
| `/shops/{shop_id}/products` | GET | `api_key`, `per_page` | Product catalog |
| `/shops/{shop_id}/stock` | GET | `api_key`, `per_page` | Stock levels |
| `/shops/{shop_id}/customers` | GET | `api_key`, `per_page` | Customer data |
| `/shops/{shop_id}/warehouses` | GET | `api_key`, `per_page`, `includes=products` | Warehouse list |

### 3.3 Order Status Codes (SOURCE OF TRUTH)

| Code | status_name | Ý nghĩa | Group | Revenue? |
|:----:|-------------|---------|-------|:--------:|
| **0** | `new` | Đơn mới (lead từ Meta) | 🔵 New | ❌ |
| **1** | `confirmed` / `submitted` | Telesale đã xác nhận | 🔵 Confirmed | ❌ |
| **8** | `packing` | **Cần đóng gói** ← TRIGGER 3PL | 🔵 Processing | ❌ |
| **9** | `pending` | Chờ xử lý | 🔵 Processing | ❌ |
| **11** | `waitting` | Chờ hàng | 🔵 Processing | ❌ |
| **20** | `ordered` | Đã đặt NCC | 🔵 Processing | ❌ |
| **2** | `shipped` | Đang giao | 🟡 In Transit | ❌ |
| **3** | `delivered` | Đã giao thành công | 🟢 **Success (L3)** | ✅ |
| **16** | `received_money` | Đã nhận tiền COD | 🟢 **Success (L4)** | ✅ |
| **4** | `returning` | Đang chuyển hoàn | 🟠 Returning | ❌ |
| **5** | `returned` | Đã hoàn | 🔴 Returned | ❌ |
| **6** | `canceled` | Đã hủy | ⚫ Cancelled | ❌ |

### 3.4 Order Object — Key Fields

```json
{
    "id": "ORDER_ID",
    "system_id": 123456,
    "shop_id": "1635307570",
    "status": 8,                                  // ← INT
    "status_name": "packing",
    
    // ─── CUSTOMER INFO (dùng cho 3PL recipient) ───
    "customer_name": "Ion Popescu",
    "bill_full_name": "Ion Popescu",              // ← recipient.name
    "bill_phone_number": "+40712345678",          // ← recipient.phoneNumber  
    "bill_address": "Strada Victoriei 1",         // ← recipient.streetName
    "bill_city": "București",                     // ← recipient.cityName
    "bill_district": "Sector 1",                  // ← recipient.zipCode (cần map)
    "bill_country": "RO",                         // ← recipient.countryIsoCode
    "customer_email": "ion@email.com",            // ← recipient.email
    
    // ─── FINANCIAL (TẤT CẢ BẰNG BANI, PHẢI ÷100) ───
    "cod": 15632,                                 // → 156.32 RON (COD thu hộ)
    "total_price": 19900,                         // → 199.00 RON (giá gốc)
    "total_price_after_sub_discount": 15632,      // → 156.32 RON (sau giảm giá)
    "total_discount": 4268,                       // → 42.68 RON
    "shipping_fee": 0,                            // → 0 RON (shop chịu)
    "partner_fee": 1200,                          // → 12.00 RON (phí 3PL)
    "return_fee": 0,                              // → 0 RON
    "surcharge": 35,                              // → 0.35 RON (COD fee)
    "money_to_collect": 15632,                    // → 156.32 RON
    "order_currency": "RON",
    
    // ─── ADS ATTRIBUTION (dùng cho matching) ───
    "ad_id": "",                                  // ⚠️ LUÔN RỖNG cho STRAMARK
    "adset_id": "120212345678901234",             // Có ~86% orders
    "ads_source": "04.02 - D04 - Romania...",     // Campaign name text
    "page_id": "112233445566",
    "p_utm_source": "fb",
    "p_utm_campaign": "04.02 - D04 - Romania...",
    "p_utm_medium": "120212345678901234",         // ← chứa adset_id!
    "p_utm_term": "120299887766554433",           // ← chứa ad_id!
    
    // ─── PRODUCT INFO ───
    "marketer": "{'name': 'Nguyễn Tuấn Anh'}",   // JSON string
    "partner": "TCE",                             // 3PL hiện tại
    "tracking_link": "https://...",
    "inserted_at": "2026-02-24T10:30:00",
    "time_send_partner": "2026-02-24T11:00:00"
}
```

### 3.5 Order Items — Key Fields

```json
{
    "item_id": "ITEM_ID",
    "order_id": "ORDER_ID",
    "note_product": "Rochie plisată D04",         // Product name
    "variation_info": {
        "name": "Rochie plisată D04 - Negru - M",
        "barcode": "D04-NEGRU-M",                 // ← map to 3PL SKU
        "retail_price": 19900,                     // bani ÷100
        "avg_price": 5000                          // bani ÷100 = COGS
    },
    "quantity": 1,
    "return_quantity": 0,
    "discount_each_product": 4268,                 // bani ÷100
    "is_bonus_product": false
}
```

> **SKU Mapping POS → 3PL:**
> POS `variation_info.barcode` (e.g., "D04-NEGRU-M") → 3PL `itemSku` / `refNumber` (e.g., "D04-NEGRU")
> Cần tạo mapping table vì format có thể khác.

---

## 4. META ADS — Facebook Graph API (CHI TIẾT ĐẦY ĐỦ)

### 4.1 Thông Tin Kết Nối

| Key | Value |
|-----|-------|
| **API Version** | v21.0 |
| **Access Token** | Trong `config/projects/stramark.yaml` → `meta_ads.access_token` |
| **Ad Account IDs** | `act_817501334775697`, `act_1369010934859968` |
| **Business ID** | `774351398645109` |
| **Pixel ID** | `765924812818271` |

> **⚠️ Token hết hạn thường xuyên (60-90 ngày).** Check trước mỗi session bằng:
> `GET /v21.0/me?access_token={token}`

### 4.2 API Endpoints Đang Sử Dụng

| # | Endpoint | Level | Fields |
|---|----------|-------|--------|
| 1 | `GET /{account_id}/insights?level=ad` | Ad | spend, impressions, cpm, cpc, ctr, actions, campaign_name, adset_id, ad_id |
| 2 | `GET /{account_id}/insights?level=adset` | Adset | spend, impressions, reach, clicks, adset_id, campaign_id |
| 3 | `GET /{account_id}/campaigns` | Campaign | campaign_id, campaign_name, daily_budget, status |
| 4 | `GET /{ad_id}?fields=name,campaign_id,adset_id,account_id` | Ad lookup | Resolve unknown ad_id to campaign |

### 4.3 Ad Attribution Logic (3-Pass, existing in `/api/stramark/realtime`)

```
PASS 1 — Exact ad_id match:
    POS order.utm_ad_id (from p_utm_term) → fb_ads_data.ad_id
    → Direct match, highest confidence

PASS 2 — Adset match:
    2a. Graph API lookup: order.utm_ad_id → GET /{ad_id} → get adset_id
        → Find highest-spend active ad in same adset
    2b. Direct: order.utm_adset_id (from p_utm_medium) → fb_ads.adset_id
        → Attribute to highest-spend ad in adset

PASS 3 — Campaign name fallback:
    order.utm_campaign → campaign_name text match
    → Campaign-level attribution only (no ad/adset)

UNMATCHED:
    Orders without UTM params or no campaign match
    → Reported separately in dashboard
```

### 4.4 Rate Limit Protection (existing in code)

- HTTP 429 → exponential backoff (1s → 2s → 4s → ... max 30s)
- Error code 4/17/32 → rate limit, backoff
- Error code 190 → token expired
- Error code 200 → BM blocked
- Monitor headers: `x-business-use-case-usage`, `x-ad-account-usage`
- If usage > 75% → slow down (3s delay), > 90% → pause (10s)

---

## 5. EXISTING SYSTEM ARCHITECTURE (FAOS v3)

### 5.1 Data Pipeline

```
API Sources → n8n Workflows → Staging Tables → Merge → Raw Tables → Views → Marts → Dashboard
```

| Layer | Tables | Sync |
|-------|--------|------|
| **Staging** | `staging_sale_order`, `staging_order_items` | n8n → merge daily |
| **Raw** | `sale_order`, `order_items`, `fb_ads_data`, `fb_adset_data`, `fb_campaign_data` | Via staging or delete+insert |
| **Dim** | `dim_status_mapping`, `dim_marketer_mapping`, `dim_market_mapping`, `page_marketer` | Manual SQL |
| **Views** | `vw_fact_orders`, `fact_order_items_dedup` | Auto-compute |
| **Marts** | `mart_performance_master`, `mart_market_intelligence`, `mart_product_insights` | Auto-compute |

### 5.2 BigQuery Config

| Key | Value |
|-----|-------|
| GCP Project | `levelup-465304` |
| Dataset | `STRAMARK_Dataset` |
| Region | US |
| Credential | `bigquery_key.json` |

### 5.3 n8n Workflows Hiện Có (STRAMARK)

| # | Workflow | Trigger | Status |
|---|----------|---------|--------|
| 01 | POS Full Sync | Every 15 min | ✅ Active (writes to staging) |
| 02 | Ads Sync | Every 2 hours | ✅ Active (delete+insert) |
| 06 | Stock Sync | Every 6 hours | ✅ Active (ID: lIqFXldaeDQjb7Id) |
| 07 | **Fulfillment Sync** | **TBD** | 🔴 **NEEDS CREATION** |
| 08 | **Tracking Poll** | **Every 2 hours** | 🔴 **NEEDS CREATION** |

### 5.4 Dashboard Routes Hiện Có

| Route | Purpose |
|-------|---------|
| `/api/stramark/realtime` | Hybrid Meta+POS data, multi-pass attribution |
| `/api/stramark/realtime/pnl` | P&L from BigQuery |
| `/api/stramark/fulfillment/` | **NEW — cần tạo** |

### 5.5 Key Formulas

```sql
-- Revenue (success only, bani → RON)
SUM(CASE WHEN status IN (3, 16) THEN cod / 100.0 ELSE 0 END)

-- ROAS (RON revenue → USD, ads already USD)
revenue_RON / 4.6 / ads_spend_USD

-- Delivery Rate
COUNTIF(status IN (3,16)) / NULLIF(COUNTIF(status IN (2,3,4,5,16)), 0)

-- Return Rate
COUNTIF(status IN (4,5)) / NULLIF(COUNTIF(status IN (2,3,4,5,16)), 0)
```

---

## 6. FULFILLMENT CHI PHÍ (ĐÃ VERIFY)

### 6.1 Chi Phí Fulfillment WH Oradea (EUR, 20% discount)

| Item | Cost (EUR) | Note |
|------|:---:|------|
| Order fulfillment (pick+pack, ≤5kg, ≤2 items) | **€0.90** | Main fee |
| Extra item per order | €0.35 | If > 2 items |
| Extra 5kg | €0.65 | If > 5kg |
| Courier bag A4 | €0.08 | Standard |
| Courier bag A3 | €0.13 | Large |
| Reverse fulfillment (return) | €0.50 | Return processing |
| RMA fee | €1.00 | Return management |
| COD refund | €3.50 | Refund already collected COD |
| Storage per pallet/month | €17 | Per pallet |
| Min monthly fee (< 300 orders) | €165 | Waived if > 300 orders/month |

### 6.2 Chi Phí Điển Hình Per Order (Romania, Cargus)

```
Pick + Pack:    €0.90
Courier Bag:    €0.08
Shipping:       €2.33  (Cargus ≤2kg)
COD Fee:        €0.35  (minimum)
────────────────────────
TOTAL:          €3.66  (~18 RON)

Nếu hoàn trả thêm:
Return Ship:    €2.33
Reverse FFM:    €0.50
RMA Fee:        €1.00
────────────────────────
RETURN COST:    €3.83  (~19 RON)
TOTAL IF FAIL:  €7.49  (~37 RON)
```

---

## 7. POS ↔ 3PL FIELD MAPPING (PRODUCTION-READY)

### 7.1 Order Creation Mapping

| # | POS Field (Poscake) | Transform | 3PL Field (euShipments) |
|---|---------------------|-----------|------------------------|
| 1 | `id` | Prefix "STR-" | `clientReference` |
| 2 | — | Fixed: `3248` | `senderId` |
| 3 | — | Auto-select | `courierId` |
| 4 | — | Today YYYY-MM-DD | `waybillAvailableDate` |
| 5 | `bill_full_name` | Direct | `recipient.name` |
| 6 | `bill_country` or "RO" | ISO code | `recipient.countryIsoCode` |
| 7 | `bill_city` | Direct | `recipient.cityName` |
| 8 | `bill_district` | Extract/lookup | `recipient.zipCode` |
| 9 | `bill_address` | Direct | `recipient.streetName` |
| 10 | `bill_phone_number` | Ensure +40 prefix | `recipient.phoneNumber` |
| 11 | `customer_email` | Direct | `recipient.email` |
| 12 | `order_items[].barcode` | Map to 3PL SKU | `shipmentInventory[].itemSku` |
| 13 | `order_items[].quantity` | Direct | `shipmentInventory[].itemQuantity` |
| 14 | `cod / 100` | Bani → RON | `shipmentCOD.amount` |
| 15 | `order_currency` | Direct ("RON") | `shipmentCOD.currency` |
| 16 | estimated | From product weight | `shipmentWeight` |
| 17 | — | Fixed: "Clothing" | `shipmentContent` |

### 7.2 Status Sync Mapping (3PL → POS)

| 3PL Event | POS Status Code | POS Status Name | Action |
|-----------|:---:|--------------|--------|
| Order created/accepted | 2 | shipped | Update POS + save AWB |
| In transit | 2 | shipped | Update tracking only |
| Out for delivery | 2 | shipped | Update tracking only |
| **Delivered** | **3** | **delivered** | ✅ Success → count revenue |
| **COD collected** | **16** | **received_money** | ✅ COD confirmed |
| Delivery failed 1st attempt | 2 | shipped | Alert + schedule retry |
| **Returned to sender** | **5** | **returned** | 🔴 Failed delivery |
| Order cancelled | 6 | canceled | Cancel in POS |

---

## 8. AUTOMATION MODULES — IMPLEMENTATION SPEC

### Module 1: Lead-to-Order (Meta → POS) — ĐÃ CÓ ✅

- Meta sync: n8n every 2h → BigQuery
- POS sync: n8n every 15 min → BigQuery via staging
- Realtime route: `/api/stramark/realtime` → hybrid BQ+API
- Attribution: 3-pass (ad_id → adset_id → campaign_name)

### Module 2: Order Automation (POS → 3PL) — CẦN XÂY ⭐

**Trigger:** POS order status changes to `8` (packing)
**Detection method:** Poll POS orders every 5 min OR webhook (nếu POS hỗ trợ)
**Algorithm:**

```python
# Pseudo-code for order automation
def process_new_packing_orders():
    # 1. Fetch POS orders with status=8
    orders = pos_api.get_orders(status=8)
    
    # 2. Filter: only orders not yet sent to 3PL
    new_orders = [o for o in orders if not already_in_fulfillment_table(o.id)]
    
    for order in new_orders:
        # 3. Validate
        errors = validate_order(order)  # address, phone, SKU exists
        if errors:
            alert_discord(f"Order {order.id} validation failed: {errors}")
            continue
        
        # 4. Check 3PL stock
        stock = tpl_api.get_prod_avails()
        for item in order.items:
            sku = map_pos_sku_to_3pl(item.barcode)
            if stock[sku].available < item.quantity:
                alert_discord(f"Out of stock: {sku}")
                continue
        
        # 5. Select courier
        courier = select_optimal_courier(order)
        
        # 6. Create 3PL order
        result = tpl_api.create_order(
            senderId=3248,
            courierId=courier.id,
            recipient=map_recipient(order),
            inventory=map_inventory(order.items),
            cod={"amount": order.cod / 100, "currency": "RON"},
            clientReference=f"STR-{order.id}"
        )
        
        # 7. Update POS status
        if result.error is False:
            pos_api.update_order(order.id, status=2)  # → shipped
            save_to_bq(order.id, result.orderId, courier)
            log_success(order.id, result.orderId)
        else:
            alert_discord(f"3PL order failed: {result.error}")
```

### Module 3: Tracking Poller (3PL → POS) — CẦN XÂY

**Trigger:** Every 2 hours
**Algorithm:**

```python
def poll_tracking():
    # 1. Get all active orders (status=2 in POS, not yet delivered/returned)
    active_orders = bq.query("SELECT pos_order_id FROM fulfillment_orders WHERE status NOT IN ('delivered','returned','cancelled')")
    
    # 2. Batch query 3PL
    refs = [{"refNum": o.pos_order_id} for o in active_orders]
    results = tpl_api.orders_history(orders=refs)
    
    # 3. Process each
    for result in results:
        old_status = get_current_status(result.refNum)
        new_status = map_3pl_to_pos_status(result.status)
        
        if old_status != new_status:
            # Update POS
            pos_api.update_order(result.refNum, status=new_status)
            
            # Update BQ
            bq.update_fulfillment_order(result.refNum, new_status, result.awb)
            bq.insert_tracking_event(result.refNum, new_status, timestamp)
            
            # Alert if needed
            if new_status in [4, 5]:  # returning/returned
                alert_discord(f"🔴 Order {result.refNum} status: {result.status}")
        
        # Check stuck
        if order_age(result.refNum) > 48 * 3600 and result.status == 'in_transit':
            alert_discord(f"⚠️ Order {result.refNum} stuck > 48h")
```

### Module 4: COD Reconciliation — CẦN XÂY

**Trigger:** Daily 08:00
**Logic:** Match POS cod amounts with 3PL payment reports

### Module 5: Delivery Optimization — CẦN XÂY

**Strategies:**
- Pre-delivery SMS confirmation
- Address validation (check format before creating AWB)
- Smart retry (re-attempt delivery after 2 days)
- Customer blacklist (block customers who returned > 3 orders)

---

## 9. NEW BIGQUERY TABLES NEEDED

### 9.1 fulfillment_orders

```sql
CREATE TABLE IF NOT EXISTS `levelup-465304.STRAMARK_Dataset.fulfillment_orders` (
    pos_order_id STRING NOT NULL,
    tpl_order_id INT64,
    awb STRING,
    courier_name STRING,
    courier_id INT64,
    warehouse STRING DEFAULT 'HelpShip Oradea',
    recipient_name STRING,
    recipient_phone STRING,
    recipient_city STRING,
    recipient_country STRING DEFAULT 'RO',
    cod_amount_ron FLOAT64,           -- RON (already ÷100)
    shipping_cost_eur FLOAT64,
    ffm_cost_eur FLOAT64,
    total_3pl_cost_eur FLOAT64,
    weight_kg FLOAT64,
    items_count INT64,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP(),
    status STRING DEFAULT 'created',
    last_status_update TIMESTAMP,
    error_message STRING,
    is_test BOOL DEFAULT FALSE,
    shop_id STRING DEFAULT '1635307570',
    project_id STRING DEFAULT 'STRAMARK'
);
```

### 9.2 fulfillment_tracking

```sql
CREATE TABLE IF NOT EXISTS `levelup-465304.STRAMARK_Dataset.fulfillment_tracking` (
    pos_order_id STRING NOT NULL,
    tpl_order_id INT64,
    status STRING,
    status_detail STRING,
    event_timestamp TIMESTAMP,
    location STRING,
    synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP()
);
```

### 9.3 cod_reconciliation

```sql
CREATE TABLE IF NOT EXISTS `levelup-465304.STRAMARK_Dataset.cod_reconciliation` (
    pos_order_id STRING NOT NULL,
    pos_cod_ron FLOAT64,
    tpl_cod_ron FLOAT64,
    difference_ron FLOAT64,
    difference_pct FLOAT64,
    status STRING DEFAULT 'pending',  -- pending/matched/discrepancy
    reconciled_at TIMESTAMP
);
```

---

## 10. FILE STRUCTURE (MODULES CẦN TẠO)

```
AGENT/
├── modules/fulfillment/                # NEW MODULE
│   ├── __init__.py
│   ├── eushipments_client.py           # 3PL API client (wrapper)
│   ├── order_automation.py             # POS → 3PL order sync
│   ├── tracking_poller.py              # 3PL → POS status sync
│   ├── courier_selector.py             # Auto-select cheapest courier
│   ├── cod_reconciler.py               # COD matching
│   ├── address_validator.py            # Validate address format
│   ├── sku_mapper.py                   # Map POS SKU → 3PL refNumber
│   └── blacklist_manager.py            # Block frequent returners
│
├── dashboard-ui/src/app/api/stramark/
│   └── fulfillment/
│       ├── route.ts                    # Fulfillment status dashboard API
│       └── create-order/route.ts       # Manual order push API
│
├── sql/stramark/
│   ├── 07_fulfillment_orders.sql       # Fulfillment fact view
│   └── 08_vw_delivery_rate.sql         # Delivery rate analytics
│
├── config/projects/stramark.yaml       # UPDATE: Add 3PL API config
└── docs/17_3PL_AUTOMATION_REFERENCE.md # THIS FILE
```

---

## 11. STRAMARK.YAML — CẦN CẬP NHẬT

Hiện tại `stramark.yaml` chưa có api_url và api_token cho 3PL. Cần update:

```yaml
# ─── 5. FULFILLMENT (3PL) ─── (CẬP NHẬT)
fulfillment:
  primary_3pl: "euShipments"
  platform: "eushipments.com (InOut BG)"
  client_dashboard: "https://clients2.inout.bg/cabinet"
  client_username: "${STRAMARK_FFM_USERNAME}"   # see .env (rotated 2026-04-08)
  client_password: "${STRAMARK_FFM_PASSWORD}"   # see .env (rotated 2026-04-08)
  api_url: "https://api1.inout.bg/api/v1"
  api_token: "${STRAMARK_FFM_API_TOKEN}"        # see .env (rotated 2026-04-08)
  api_docs: "https://documenter.getpostman.com/view/26992907/2s93Y2S2Q8"
  company_id: 3248
  company_name: "RO - SI_COMERZ - Aurelia Wear (aurelia)"
  tracking_enabled: true
  
  # Automation config
  auto_create_order: true
  trigger_status: 8
  tracking_poll_interval_hours: 2
  stuck_order_threshold_hours: 48
  default_shipment_content: "Clothing / Fashion"
  client_reference_prefix: "STR"
  test_mode: true   # SET TO FALSE WHEN GOING LIVE

  warehouse_primary:
    name: "HelpShip Oradea"
    country: Romania

  couriers_available:
    - {id: 8, name: "Romania Cargus", to_office: true, to_address: true, currency: "RON"}
    - {id: 17, name: "Romania FAN Courier", to_office: false, to_address: true, currency: "RON"}
    - {id: 750, name: "Romania SameDay", to_office: true, to_address: true, currency: "RON"}
    - {id: 812, name: "Romania GLS", to_office: true, to_address: true, currency: "RON"}
    - {id: 838, name: "Bulgaria Express One", to_office: false, to_address: true, currency: "EUR"}
    - {id: 651, name: "Croatia DPD", to_office: false, to_address: true, currency: "EUR"}
    - {id: 741, name: "Slovakia GLS", to_office: false, to_address: true, currency: "EUR"}
```

---

## 12. PHASED ROLLOUT

| Phase | Duration | What | Deliverables |
|-------|:--------:|------|-------------|
| **1. Foundation** | Week 1-2 | Update YAML, build API client, test all endpoints | `eushipments_client.py`, updated `stramark.yaml`, BQ tables |
| **2. Auto Orders** | Week 3-4 | Order automation + courier selection | `order_automation.py`, `courier_selector.py`, `sku_mapper.py` |
| **3. Tracking** | Week 5-6 | Status sync + alerts | `tracking_poller.py`, Discord alerts, BQ tracking |
| **4. Finance** | Week 7-8 | COD reconciliation + P&L | `cod_reconciler.py`, dashboard fulfillment tab |
| **5. Optimize** | Week 9-10 | Delivery rate optimization | `address_validator.py`, `blacklist_manager.py`, SMS |

---

## 13. VERIFIED FACTS (Không cần verify lại)

| # | Fact | Verified Date |
|---|------|:---:|
| 1 | 3PL API token works | 2026-02-24 |
| 2 | Company ID = 3248 | 2026-02-24 |
| 3 | 7 couriers available | 2026-02-24 |
| 4 | ~12 products in stock at HelpShip Oradea | 2026-02-24 |
| 5 | MK01TITANIUM has 149 qty | 2026-02-24 |
| 6 | POS shop_id = 1635307570 | Previously verified |
| 7 | POS prices in bani (÷100) | Previously verified |
| 8 | Meta uses ad_account act_817501334775697, act_1369010934859968 | Previously verified |
| 9 | Cheapest courier = GLS PuDo (€2.12/kg) | From price list |
| 10 | FFM cost = €0.90/order + €2.33 shipping + €0.35 COD ≈ €3.66 total | Calculated |
