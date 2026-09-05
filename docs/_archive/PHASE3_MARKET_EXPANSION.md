# PHASE 3 — MỞ RỘNG THỊ TRƯỜNG HÀN QUỐC / ĐÀI LOAN / NHẬT BẢN

> **Timeline**: Tuần 8–12 | **Priority**: 🟡 High
> **Mục tiêu**: Onboard 3 thị trường Đông Á, setup logistics + compliance + localization

---

## 1. MARKET RESEARCH

### 1.1 So sánh 3 thị trường

| Tiêu chí | 🇰🇷 Hàn Quốc | 🇹🇼 Đài Loan | 🇯🇵 Nhật Bản |
|:---|:---|:---|:---|
| **Dân số** | 52M | 24M | 125M |
| **E-com market size** | $120B | $35B | $150B |
| **Tiền tệ** | KRW | TWD | JPY |
| **Tỷ giá (≈ VND)** | 1 KRW ≈ 19 VND | 1 TWD ≈ 810 VND | 1 JPY ≈ 170 VND |
| **Thanh toán phổ biến** | KakaoPay, Samsung Pay, Credit Card | LinePay, credit card, 7-11 pickup | Konbini, credit card, PayPay |
| **COD phổ biến?** | ❌ Không (< 5%) | ⚠️ Ít (~ 10%) | ⚠️ Ít (~8%, konbini) |
| **3PL phổ biến** | CJ Logistics, Lotte | Black Cat, 7-11, FamilyMart | Yamato, Sagawa, Japan Post |
| **Ads platform chính** | Naver, KakaoTalk, FB, IG | FB, IG, Google, LINE | Yahoo Japan, Google, Twitter/X |
| **Ngôn ngữ** | Korean | Traditional Chinese | Japanese |
| **Thuế nhập khẩu** | VAT 10%, customs > $150 | VAT 5%, customs > TWD 2000 | Consumption tax 10% |

### 1.2 Sản phẩm tiềm năng

| Ngành | 🇰🇷 Hàn | 🇹🇼 Đài | 🇯🇵 Nhật |
|:---|:---|:---|:---|
| Trang sức | ✅ (K-beauty bundling) | ✅ | ✅ (minimalist design) |
| Mỹ phẩm | ⚠️ (cạnh tranh cao) | ✅ | ✅ (quality focus) |
| Health supplement | ✅ | ✅ | ✅ (aging population) |

---

## 2. SETUP KỸ THUẬT CHO MỖI THỊ TRƯỜNG

### 2.1 Project Config Template

```yaml
# config/projects/korea.yaml
project_id: KOREA
project_name: "Korea Market"
currency: KRW
timezone: Asia/Seoul
status: setup

bigquery:
  project_gcp: "levelup-465304"
  dataset: "KOREA_Dataset"

meta_ads:
  ad_account_ids: []           # Tạo mới cho thị trường KR

tiktok_ads:                    # NEW — TikTok for Business
  advertiser_id: ""
  app_id: ""
  access_token: ""

google_ads:                    # NEW — Google Ads
  customer_id: ""
  developer_token: ""
  client_id: ""
  client_secret: ""
  refresh_token: ""

poscake:
  shops:
    - name: "Korea"
      shop_id: ""              # Tạo shop mới trên Poscake

markets:
  - code: KR
    name: "South Korea"
    currency: KRW
    language: ko
    warehouse: ""

fulfillment:
  primary_3pl: "CJ Logistics"
  carriers:
    - partner: "CJ Logistics"
      market_code: 82
      delivery_fee: 3000       # KRW
      return_fee: 3000
      currency: KRW
```

### 2.2 Localization Checklist

| # | Hạng mục | 🇰🇷 KR | 🇹🇼 TW | 🇯🇵 JP |
|:---:|:---|:---:|:---:|:---:|
| 1 | Landing page ngôn ngữ local | [ ] | [ ] | [ ] |
| 2 | Ads creative (local language) | [ ] | [ ] | [ ] |
| 3 | Product naming localized | [ ] | [ ] | [ ] |
| 4 | Payment gateway setup | [ ] | [ ] | [ ] |
| 5 | 3PL contract + API integration | [ ] | [ ] | [ ] |
| 6 | Customer service (local lang) | [ ] | [ ] | [ ] |
| 7 | Legal/compliance (import rules) | [ ] | [ ] | [ ] |
| 8 | Return policy (local regulation) | [ ] | [ ] | [ ] |

---

## 3. LOGISTICS & FULFILLMENT

### 3.1 Recommended 3PL Partners

| Thị trường | 3PL đề xuất | API available? | Giá ước tính |
|:---|:---|:---:|:---|
| 🇰🇷 Hàn Quốc | CJ Logistics / Hanjin | ✅ | ₩3,000–5,000/đơn |
| 🇹🇼 Đài Loan | Black Cat (統一) / Kerry TJ | ✅ | NT$60–100/đơn |
| 🇯🇵 Nhật Bản | Yamato Transport / Sagawa | ✅ | ¥600–1,200/đơn |

### 3.2 Fulfillment Flow

```
Kho VN → Cross-border shipping → Local warehouse → Last mile delivery
         (EMS/DHL/SF Express)    (3PL partner)     (3PL partner)
```

**2 phương án:**
1. **Direct ship từ VN** — Chậm (5–10 ngày), rẻ hơn, phù hợp giai đoạn đầu
2. **Pre-stock local warehouse** — Nhanh (1–3 ngày), đắt hơn, cần forecast volume

---

## 4. ADS STRATEGY PER MARKET

### 4.1 Hàn Quốc (KR)

| Kênh | Budget % | Ghi chú |
|:---|:---:|:---|
| **Facebook/Instagram** | 40% | Targeting: Phụ nữ 25–45, interest jewelry/beauty |
| **Naver Ads** | 30% | Search + Shopping, QUAN TRỌNG tại KR |
| **TikTok** | 20% | Short video, influencer content |
| **KakaoTalk** | 10% | Retargeting, loyal customers |

### 4.2 Đài Loan (TW)

| Kênh | Budget % | Ghi chú |
|:---|:---:|:---|
| **Facebook/Instagram** | 50% | Platform #1 tại TW |
| **Google Ads** | 25% | Search + Shopping |
| **TikTok** | 15% | Growing fast in TW |
| **LINE Ads** | 10% | Retargeting |

### 4.3 Nhật Bản (JP)

| Kênh | Budget % | Ghi chú |
|:---|:---:|:---|
| **Google Ads** | 35% | Search + Shopping + YouTube |
| **Yahoo Japan** | 25% | Vẫn rất lớn tại JP |
| **Facebook/Instagram** | 20% | Thấp hơn KR/TW |
| **TikTok** | 15% | Growing, younger demographic |
| **Twitter/X Ads** | 5% | Niche nhưng active tại JP |

---

## 5. COMPLIANCE & LEGAL

| Hạng mục | 🇰🇷 KR | 🇹🇼 TW | 🇯🇵 JP |
|:---|:---|:---|:---|
| **Business registration** | Cần đại diện pháp lý | Cần đại diện pháp lý | Cần AOR (Attorney) |
| **Thuế nhập khẩu** | VAT 10% + customs | VAT 5% | Consumption 10% |
| **Quy định mỹ phẩm** | MFDS certification | FDA Taiwan | PMDA notification |
| **Quy định trang sức** | Hallmark nếu vàng/bạc | Không bắt buộc | JIS standard |
| **Return policy** | 7 ngày (luật pháp yêu cầu) | 7 ngày | 8 ngày |

---

## 6. IMPLEMENTATION TIMELINE

| Tuần | 🇰🇷 KR | 🇹🇼 TW | 🇯🇵 JP |
|:---:|:---|:---|:---|
| 8 | Legal setup + 3PL contract | Legal setup + 3PL contract | Legal research |
| 9 | Landing page KR + Ads setup | Landing page TW + Ads setup | Legal setup |
| 10 | Test campaign (₩500K/day) | Test campaign (NT$5K/day) | Landing page JP |
| 11 | Optimize + scale | Optimize + scale | Test campaign (¥50K/day) |
| 12 | Full operation + reporting | Full operation + reporting | Optimize + scale |
