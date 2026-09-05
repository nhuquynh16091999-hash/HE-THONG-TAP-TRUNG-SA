# 🎯 TALPHA — Hướng Dẫn Trước Khi Go-Live

> **Dự án**: Tiểu Alpha (TALPHA)  
> **Ngày tạo**: 2026-02-19  
> **Trạng thái**: ⚠️ PRE-LIVE — Cần hoàn tất checklist trước khi bật hệ thống  
> **Config file**: [`config/projects/talpha.yaml`](file:///c:/Users/LE%20MO/Desktop/AGENT/config/projects/talpha.yaml)  
> **Naming registry**: [`config/naming/talpha_registry.yaml`](file:///c:/Users/LE%20MO/Desktop/AGENT/config/naming/talpha_registry.yaml)

---

## 1. TỔNG QUAN DỰ ÁN

| Field | Value |
|-------|-------|
| **Project ID** | `talpha` |
| **BigQuery Dataset** | `TALPHA_Dataset` |
| **Currency chính** | AED (UAE Dirham) |
| **Timezone** | `Asia/Dubai` (UTC+4) |
| **Thị trường** | 6 nước GCC: SA, AE, KW, QA, OM, BH |
| **Ngành hàng** | Trang sức + Mỹ phẩm (target phụ nữ Philippines tại GCC) |
| **Team** | 7 marketers |
| **Ad accounts** | 8 tài khoản Facebook |
| **POS** | Poscake (6 shops — mỗi thị trường 1 shop) |
| **3PL** | iMile (SA, AE, QA, OM) + PostaPlus (KW) + Aramex (BH) |

---

## 2. CẤU TRÚC DỮ LIỆU — LOGIC CỐT LÕI

### 2.1 POS — Cách tính doanh thu

```
⚠️ QUAN TRỌNG: POS TALPHA lưu giá KHÁC chuẩn!
```

| Rule | Chi tiết |
|------|----------|
| **Giá ÷ 100** | POS lưu `10000` = thực tế `100.00 AED`. Luôn chia cho 100 |
| **Giá SP = 0** | Tất cả sản phẩm trên POS có `price = 0`, `retail_price = 0` |
| **Doanh thu = COD** | Lấy field `cod` hoặc `money_to_collect` làm tổng doanh thu đơn |
| **Giá gộp đơn** | Giá là tổng đơn hàng, KHÔNG tách được per-item |
| **Không có giá bán trên POS** | Giá bán theo pricing tiers (combo), không set trên sản phẩm |

### 2.2 Pricing Tiers — Giá bán theo số lượng SP

Giá bán phụ thuộc vào **tổng số SP trong đơn**, không phải từng SP:

#### UAE (AED)
| Combo | Giá | Phạm vi thực tế | Mẫu (50 đơn) |
|-------|-----|-----------------|---------------|
| 1 SP | **99** | 89 – 100 | 18 đơn |
| 2 SP | **149** | 99 – 149 | 18 đơn |
| 3 SP | **199** ❓ | Cần xác nhận | 0 đơn |
| 4 SP | **149** | 99 – 149 | 6 đơn |
| 7-8 SP | **149** | 149 | 6 đơn |

> 💡 Combo lớn (4+ SP) **KHÔNG tăng giá** — vẫn 149 AED. Đây là upsale strategy: thêm SP miễn phí để tăng perceived value.

#### Kuwait (KWD)
| Combo | Giá | Phạm vi thực tế |
|-------|-----|-----------------|
| 1 SP | **9** | 8 – 11 |
| 2 SP | **13** | 8 – 14 |
| 3 SP | **13** | 13 (1 mẫu) |
| 4 SP | **14** | 11 – 19 |

#### Oman (OMR)
| Combo | Giá | Phạm vi thực tế |
|-------|-----|-----------------|
| 1 SP | **12** | 10 – 12 |
| 2 SP | **12** | 11 – 24 |

> ⚠️ Saudi, Qatar, Bahrain **chưa có data** — cần fix POS/thêm API key.

### 2.3 Công thức tính P&L

```
Revenue     = COD ÷ 100                    (từ POS)
COGS        = Σ(cost_price × qty)           (từ config/Google Sheet, đơn vị VND)
COGS_local  = COGS ÷ exchange_rate          (VND → local currency)
Ads_cost    = spend                         (từ Meta Ads API)
3PL_cost:
  ✅ Giao TC = packing_fee + delivery_fee + COD_fee
  ❌ Giao TB = packing_fee + return_fee
Gross_Profit = Revenue - COGS_local - 3PL_cost
Net_Profit   = Gross_Profit - Ads_cost - Fixed_costs
ROAS         = Revenue ÷ Ads_cost           (target: > 4.0)
```

---

## 3. MARKETER MAPPING

### 3.1 Danh sách active (7 người)

| Config ID | Tên trong Campaign | Họ tên | POS Name |
|-----------|-------------------|--------|----------|
| **SSL** | `LOC` | Hồ Sỹ Lộc | Sỹ Lộc |
| **CTT** | `C.Thuy` | Chu Thị Thuý | — |
| **HTTN** | `NHUNG` | Hoàng Thị Thuỳ Nhung | — |
| **PHTM** | `MAI` | Phạm Hà Thục Mai | Thục Mai |
| **LTB** | `Bình` / `bình` | Lê Thục Bình | Marketing Bình |
| **TNT** | `N.THE` | Trần Ngọc Thế | Trần Thế |
| **SSA** | `S.ANH` | Hồ Sỹ Anh | — |

### 3.2 Đã nghỉ (bỏ qua khi gặp)
- **Vinh** — nghỉ việc
- **PHUC** — nghỉ việc (chỉ 2 campaign cũ)

### 3.3 Quy tắc normalize
- Case-insensitive: `LOC` = `Loc` = `loc`
- Dấu chấm: `C.Thuy` → `CTT`, `N.THE` → `TNT`, `S.ANH` → `SSA`
- Tiếng Việt unicode: `Bình` / `bình` → `LTB`

---

## 4. CAMPAIGN NAMING — Pattern hiện tại

### 4.1 Format thực tế
```
{THỊ_TRƯỜNG}/{MARKETER}/{SẢN_PHẨM_VN}/{PAGE_ID}/{PAGE_NAME}/{NGÀY}
```
Ví dụ:
```
SAUDI/LOC/RANGGIA1/985622541297798/SmileCare Denture/18-2
UAE/ MAI/ Golden Bloom Necklace/ 837115656161301/ CF Jewelry UAE/ 18.2/m
KUWAIT/NHUNG/TRANG DA VC/979250028604122/GlowMuse Lab/5-2
```

### 4.2 Biến thể thị trường (cần normalize)
```
SAUDI / Saudi / saudi  → SA
UAE / Uae / uae        → AE
KUWAIT / Kuwait        → KW
QATAR / Qatar / qatar  → QA
OMAN / Oman            → OM
BAHRAIN / Bahrain      → BH
```

### 4.3 Sản phẩm trong campaign
- **~15%** dùng mã SKU: `010 - Birth Stone Set`, `072 - Couple Ring`
- **~85%** dùng viết tắt tiếng Việt: `RANGGIA`, `DAUGOI1`, `KEMGHE`
- **Auto-mapped**: 9 mã (VC cream → 058, snail cream → 066...)
- **Pending mapping**: 84 mã (chờ user xác nhận)

---

## 5. POS PRODUCTS — SKU System

### 5.1 SKU format
POS product names chứa mã số đầu tên: `{SKU_3digits} - {English_Name}`
```
005 - Diamond Halo set
010 - Birth Stone Set
113 - Turkish Set
```
- Field `sku` trống ở 100% sản phẩm
- Extract mã bằng regex: `^\d{3}\s*-\s*(.+)$`

### 5.2 Khác biệt giữa shops
| Shop | Products | Có mã số? |
|------|----------|-----------|
| UAE | 30 | ✅ Có (`005 - ...`) |
| Kuwait | 27 | ✅ Có |
| Oman | 24 | ❌ KHÔNG — dùng free-text (`Diamond Halo set`) |
| Saudi | ❌ Lỗi 500 | — |

> ⚠️ **Oman shop cần chuẩn hóa** — thêm mã số vào tên sản phẩm.

### 5.3 Giá vốn
- 23/27 SKU đã có giá vốn (VND) trong config
- Thiếu: `KNK`, `KSC`, `BHS`, `BYL`
- Nguồn cập nhật: POS (khi nhập kho) + Google Sheet (upload vào config)

---

## 6. 3PL FEES — Chi tiết theo đối tác

### iMile (SA, AE, QA, OM) — Phí theo %

| Market | Đóng gói | Ship | COD | Hoàn | Currency |
|--------|----------|------|-----|------|----------|
| **SA** | 2.5 | 15.0 | 3% | 5.0 | SAR |
| **AE** | 3.0 | 12.0 | 3% | 0.0 | AED |
| **QA** | 3.0 | 17.0 | 4% | 5.0 | QAR |
| **OM** | 0.4 | 2.0 | 4% | ❌ | OMR |

### PostaPlus (KW) — Phí cố định

| Phí | Giá trị | Ghi chú |
|-----|---------|---------|
| Đóng gói | 0.2 KWD | Phí thao tác |
| Ship | 0.9 KWD | /đơn |
| COD | 0.25 KWD | **Cố định**, không theo % |
| Hoàn | 0.25 KWD | /đơn hoàn |

### Aramex (BH)

| Phí | Giá trị |
|-----|---------|
| Đóng gói | 0.4 BHD |
| Ship | 2.0 BHD |
| COD | 5% |
| Hoàn | ❌ Chưa có |

### Công thức chi phí giao hàng
```
Giao THÀNH CÔNG = packing_fee + delivery_fee + COD_fee(revenue)
Giao THẤT BẠI   = packing_fee + return_fee
Hàng hoàn       → Tái nhập kho, bán lại (KHÔNG tính mất hàng)
```

> ⚠️ PostaPlus COD = **flat fee** (0.25 KWD), các đối tác khác COD = **% doanh thu**

---

## 7. META ADS — 8 Ad Accounts

| # | Account ID | Tên gợi nhớ | MKT chính |
|---|-----------|-------------|-----------|
| 1 | `855567553811483` | Tiểu Alpha 1 | LOC |
| 2 | `848995974322757` | Tiểu Alpha 2 | C.Thuy |
| 3 | `719840753771124` | Tiểu Alpha 4 | LOC, Vinh (nghỉ) |
| 4 | `833593695771745` | Tiểu Alpha 5 | NHUNG, C.Thuy |
| 5 | `3534017756739334` | Tiểu Alpha 3 | MAI |
| 6 | `1119368126847210` | Tiểu Alpha 6 | Bình, MAI |
| 7 | `703242242813144` | Tiểu Alpha 7 | MAI, Bình, PHUC (nghỉ) |
| 8 | `1503790877534258` | Tiểu Alpha 8 | LOC, N.THE, S.ANH, NHUNG |

- **Business ID**: `1356322402694811`
- **KPI Target**: ROAS > 4.0
- **Backfill**: 60 ngày (từ ~21/12/2025)
- **Tổng campaigns**: 729 (512 trong 90 ngày gần nhất)

---

## 8. EXCHANGE RATES (VND)

| Từ | → VND | Valid |
|----|-------|-------|
| SAR | 6,850 | 01/02/2026 |
| AED | 7,010 | 01/02/2026 |
| KWD | 83,000 | 01/02/2026 |
| QAR | 7,050 | 01/02/2026 |
| BHD | 68,000 | 01/02/2026 |
| OMR | 66,700 | 01/02/2026 |
| USD | 25,700 | 01/02/2026 |

> Tỷ giá cập nhật thủ công trong config. Chưa có lịch tự động.

---

## 9. QUY TẮC VẬN HÀNH

| Rule | Chi tiết |
|------|----------|
| **Hàng hoàn** | Tái nhập kho → bán tiếp (re-stock) |
| **Giá vốn** | Nguồn 1: POS (khi nhập kho/SP mới). Nguồn 2: Google Sheet upload |
| **Chi phí cố định** | Chưa mapping — sẽ bổ sung sau |
| **Budget ads** | Không có con số cố định |
| **Doanh thu** | = field `COD` trên POS ÷ 100 |

---

## 10. CHECKLIST TRƯỚC GO-LIVE

### ✅ Đã hoàn thành
- [x] Config `talpha.yaml` — 16 sections
- [x] Naming registry `talpha_registry.yaml`
- [x] 7 marketer mapping (+ 2 resigned excluded)
- [x] 6 market slug normalize
- [x] 4/6 POS API Keys (Saudi, UAE, Kuwait, Oman)
- [x] 3PL phí chi tiết 3 đối tác
- [x] Pricing tiers 3 markets (AE, KW, OM)
- [x] Tỷ giá 7 currencies → VND
- [x] 23/27 giá vốn sản phẩm
- [x] KPI target (ROAS > 4)
- [x] Backfill range (60 ngày)
- [x] Quy trình verify API (doc 14)

### 🔴 Chặn go-live
- [ ] **Saudi POS fix** — API key trả 500, không load được SP/đơn
- [ ] **Product alias mapping** — 84 mã chờ user xác nhận
- [ ] **BigQuery dataset** — chưa tạo `TALPHA_Dataset`
- [ ] **N8N workflows** — chưa generate

### 🟡 Cần bổ sung (không chặn go-live)
- [ ] Qatar + Bahrain POS API keys
- [ ] Oman + Bahrain return_fee
- [ ] Saudi, Qatar, Bahrain pricing tiers
- [ ] Giá vốn 4 SKU: KNK, KSC, BHS, BYL
- [ ] Oman POS products chuẩn hóa tên (thêm mã số)
- [ ] Chi phí cố định mapping
- [ ] Warehouse names cho KW, BH, OM, QA
- [ ] Google Sheet template cho cost upload
- [ ] Giá bán combo 3SP UAE (xác nhận 199 AED?)
- [ ] Pricing tiers theo **loại sản phẩm** hay **chung cho tất cả**?

---

## 11. FILES LIÊN QUAN

| File | Mục đích |
|------|----------|
| [`talpha.yaml`](file:///c:/Users/LE%20MO/Desktop/AGENT/config/projects/talpha.yaml) | Config chính — 16 sections |
| [`talpha_registry.yaml`](file:///c:/Users/LE%20MO/Desktop/AGENT/config/naming/talpha_registry.yaml) | Mapping marketer/market/product aliases |
| [`14_PROJECT_KICKOFF_VERIFICATION.md`](file:///c:/Users/LE%20MO/Desktop/AGENT/docs/14_PROJECT_KICKOFF_VERIFICATION.md) | Quy trình verify API cho mọi dự án |
| [`12_NEW_PROJECT_SETUP_FORM.md`](file:///c:/Users/LE%20MO/Desktop/AGENT/docs/12_NEW_PROJECT_SETUP_FORM.md) | Form intake thông tin dự án mới |
| [`TALPHA_SETUP_CHECKLIST.md`](file:///c:/Users/LE%20MO/Desktop/AGENT/docs/TALPHA_SETUP_CHECKLIST.md) | Checklist ban đầu (đã outdated, thay bởi guide này) |
