# PHASE 4 — KÊNH BÁN HÀNG MỚI (TikTok Shop + Google Shopping)

> **Timeline**: Tuần 10–14 | **Priority**: 🟡 High
> **Mục tiêu**: Mở rộng từ Facebook-only → Multi-channel (TikTok, Google), bán hàng qua ads là chính

---

## 1. TỔNG QUAN KÊNH MỚI

| Kênh | Loại | Phương thức | Thế mạnh |
|:---|:---|:---|:---|
| **TikTok Ads** | Paid Social | Video ads → Landing page / TikTok Shop | Reach gen Z+Millennials, viral potential |
| **TikTok Shop** | Marketplace | In-app shopping (live + video) | Conversion cao, impulse buying |
| **Google Shopping** | Paid Search | Product listing ads (PLA) | High-intent buyers, search-based |
| **Google Search** | Paid Search | Text ads (SEM) | Brand + product keywords |
| **Google Display** | Paid Display | Banner ads (GDN) | Retargeting, brand awareness |
| **Google YouTube** | Paid Video | Video ads (pre-roll, discovery) | Product demo, storytelling |

---

## 2. TIKTOK ADS — QUY TRÌNH TRIỂN KHAI

### 2.1 Setup

```
1. Tạo TikTok for Business Account → business-api.tiktok.com
2. Tạo Advertiser Account cho mỗi thị trường
3. Cài TikTok Pixel trên landing page
4. Tạo Product Catalog (cho Dynamic Ads)
5. Apply TikTok Shop Seller (nếu thị trường hỗ trợ)
```

### 2.2 Campaign Structure

```
TikTok Campaign
├── Objective: Website Conversions / Catalog Sales
├── Ad Group 1: [Market] - [Product] - Broad
│   ├── Targeting: Country, Age 25-45, Female
│   ├── Budget: $50/day
│   └── Ads: 3-5 video creatives (9:16 format)
├── Ad Group 2: [Market] - [Product] - Interest
│   ├── Targeting: Interest (jewelry, beauty, fashion)
│   └── Budget: $30/day
└── Ad Group 3: [Market] - Retargeting
    ├── Audience: Website visitors (pixel), Engagers
    └── Budget: $20/day
```

### 2.3 TikTok Shop Integration

```python
# Sync sản phẩm lên TikTok Shop
# API: TikTok Shop Open Platform

# 1. Product upload
POST /api/products/upload
{
    "product_name": "Diamond Halo Set",
    "description": "...",
    "price": {"amount": 9900, "currency": "KRW"},
    "images": ["url1", "url2"],
    "category_id": "jewelry"
}

# 2. Order sync (TikTok Shop → BigQuery)
GET /api/orders/search
# → Parse response → Insert vào fact_orders (source = 'tiktok_shop')

# 3. Inventory sync
PUT /api/products/{id}/stocks
```

### 2.4 Data Flow: TikTok → BigQuery

```
TikTok Ads API ──→ n8n workflow (2h) ──→ BQ: fact_ads_unified (channel='tiktok')
TikTok Shop API ──→ n8n workflow (15m) ──→ BQ: fact_orders (source='tiktok_shop')
```

---

## 3. GOOGLE ADS — QUY TRÌNH TRIỂN KHAI

### 3.1 Setup

```
1. Tạo Google Ads Account (MCC nếu nhiều project)
2. Link Google Merchant Center (cho Shopping Ads)
3. Upload Product Feed (tiêu chuẩn Google)
4. Cài Google Tag (conversion tracking)
5. Setup Google Analytics 4 (GA4)
```

### 3.2 Campaign Types

| Type | Mục tiêu | KPI chính | Budget |
|:---|:---|:---|:---|
| **Shopping (PLA)** | Bán hàng trực tiếp | ROAS, CPO | 40% budget |
| **Search (SEM)** | High-intent keywords | CPA, conversion rate | 25% budget |
| **Performance Max** | All channels tự động | ROAS | 20% budget |
| **YouTube Ads** | Product demo | View rate, CPV | 10% budget |
| **Display (GDN)** | Retargeting | CTR, conversions | 5% budget |

### 3.3 Google Merchant Center — Product Feed

```xml
<!-- Product Feed Format (TSV hoặc XML) -->
<item>
  <g:id>SKU-005</g:id>
  <g:title>Diamond Halo Set</g:title>
  <g:description>Premium diamond jewelry set...</g:description>
  <g:link>https://shop.example.com/diamond-halo</g:link>
  <g:image_link>https://cdn.example.com/005.jpg</g:image_link>
  <g:price>99.00 AED</g:price>
  <g:availability>in_stock</g:availability>
  <g:condition>new</g:condition>
  <g:brand>Tiểu Alpha</g:brand>
  <g:shipping>
    <g:country>AE</g:country>
    <g:price>0 AED</g:price>
  </g:shipping>
</item>
```

### 3.4 Data Flow: Google → BigQuery

```
Google Ads API ──→ n8n workflow (2h) ──→ BQ: fact_ads_unified (channel='google')
GA4 ──→ BigQuery Export (auto) ──→ BQ: ga4_events (supplementary)
```

---

## 4. UNIFIED CHANNEL ATTRIBUTION

```sql
-- Tất cả channels cùng 1 bảng fact_ads_unified
SELECT
  ad_date,
  channel,  -- 'facebook', 'tiktok', 'google'
  SUM(spend_usd) AS total_spend,
  SUM(impressions) AS total_impressions,
  SUM(clicks) AS total_clicks,
  -- Cross-channel ROAS
  SAFE_DIVIDE(
    (SELECT SUM(revenue_usd) FROM fact_orders o
     WHERE o.channel = a.channel
     AND o.created_at BETWEEN a.ad_date AND a.ad_date + 7),
    SUM(spend_usd)
  ) AS roas_7d
FROM fact_ads_unified a
GROUP BY 1, 2
ORDER BY 1 DESC, 3 DESC;
```

---

## 5. CAMPAIGN NAMING CONVENTION (Multi-Channel)

```
[DATE]_[PRODUCT]_[MARKET]_[CHANNEL]_[TYPE]_[MARKETER]

Ví dụ:
• 23.02_D05_KR_FB_CBO_SSA      → Facebook CBO tại Hàn Quốc
• 23.02_D05_TW_TT_VIDEO_CTT    → TikTok video ad tại Đài Loan
• 23.02_D05_JP_GG_SHOP_SSL     → Google Shopping tại Nhật
• 23.02_D05_SA_TT_LIVE_TNT     → TikTok Live tại Saudi
```

---

## 6. IMPLEMENTATION CHECKLIST

### TikTok
- [ ] Đăng ký TikTok for Business
- [ ] Tạo advertiser accounts (per market)
- [ ] Cài TikTok Pixel
- [ ] Build n8n workflow: TikTok Ads → BigQuery
- [ ] Test campaign (1 market, $50/day)
- [ ] TikTok Shop seller registration (nếu available)
- [ ] Build order sync: TikTok Shop → BigQuery

### Google
- [ ] Tạo Google Ads MCC account
- [ ] Setup Google Merchant Center
- [ ] Upload product feed
- [ ] Cài Google Tag + setup GA4
- [ ] Build n8n workflow: Google Ads → BigQuery
- [ ] Test Shopping campaign (1 market)
- [ ] Test Search campaign (brand keywords)
