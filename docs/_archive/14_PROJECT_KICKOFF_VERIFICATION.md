# 🔍 PROJECT KICKOFF — Quy Trình Xác Minh Thông Tin Dự Án

> **Mục đích**: Sau khi nhận dữ liệu thô từ team, Agent/Tech chạy quy trình này để **xác minh, làm sạch, và bổ sung** trước khi khởi tạo hệ thống.
>
> **Khi nào chạy**: Sau khi có `config/projects/{project_id}.yaml` ban đầu (từ form 12).

---

## PHASE 1 — Xác Minh API Credentials ⚡

### 1.1 Facebook Ads API

**Kiểm tra tự động**:
```bash
# Test access token + liệt kê ad accounts
curl "https://graph.facebook.com/v21.0/me?access_token={TOKEN}"
curl "https://graph.facebook.com/v21.0/act_{ACC_ID}/campaigns?fields=name&limit=5&access_token={TOKEN}"
```

**Checklist**:
- [ ] Access token hợp lệ (không 401/403)
- [ ] Tất cả ad_account_ids trả về data (không 500)
- [ ] Business ID khớp với accounts
- [ ] Kiểm tra trùng account ID (loại duplicate)
- [ ] Ghi lại số lượng campaigns có data

**Lỗi thường gặp**:
| Lỗi | Nguyên nhân | Cách sửa |
|-----|-------------|----------|
| `(#100) Invalid parameter` | Account ID sai | Kiểm tra lại ID trên Ads Manager |
| `Error validating access token` | Token hết hạn | Tạo System User Token mới |
| `(#10) Permission denied` | Thiếu quyền `ads_read` | Thêm quyền qua Business Settings |

---

### 1.2 POS (Poscake) API

**Kiểm tra tự động**:
```bash
# Test api_key + load products
curl "https://pos.pages.fm/api/v1/shops/{SHOP_ID}/products?api_key={API_KEY}&per_page=10"
```

**Checklist**:
- [ ] API key hoạt động trên **TẤT CẢ** shops (mỗi shop 1 key)
- [ ] Thử cả 2 URL nếu lỗi: `pos.pages.fm` và `api.poscake.vn`
- [ ] Endpoint `/products` trả về danh sách sản phẩm
- [ ] Endpoint `/orders` trả về đơn hàng (test 5 đơn gần nhất)
- [ ] Ghi lại SKU format: mã số trong tên (`005 - ...`) hay field `sku` riêng

**Lỗi thường gặp**:
| Lỗi | Nguyên nhân | Cách sửa |
|-----|-------------|----------|
| 500 Internal Server Error | API key sai hoặc shop bị khóa | User kiểm tra lại trên POS Settings |
| `Missing access_token` | Dùng sai endpoint hoặc sai field auth | Dùng `api_key` param, KHÔNG phải `access_token` |
| 404 Not Found | Shop ID sai | Nhìn URL khi đăng nhập POS |

---

## PHASE 2 — Trích Xuất & Xác Minh Dữ Liệu 📊

### 2.1 Marketer Mapping

**Bước 1**: Kéo TẤT CẢ campaign names từ Meta Ads (8 accounts):
```bash
# Lấy campaign names → extract vị trí #2 (marketer slug)
GET /act_{ACC_ID}/campaigns?fields=name&limit=200
→ Parse: MARKET/MARKETER/PRODUCT/.../DATE
→ Output: danh sách unique marketer slugs
```

**Bước 2**: So sánh với config `marketers[]`:
```
Tìm được: LOC, C.Thuy, NHUNG, MAI, Bình, N.THE, S.ANH
Config:    SSL, CTT,    HTTN,  PHTM, LTB,  TNT,   SSA
```

**Bước 3**: Yêu cầu user xác nhận:
- [ ] Mapping marketer slug → config ID đúng 100%
- [ ] Không có marketer "lạ" chưa biết (kiểm tra nghỉ việc)
- [ ] Liệt kê TẤT CẢ biến thể tên (hoa/thường, có/không dấu chấm)
- [ ] Ghi vào file `config/naming/marketer_aliases.yaml`

---

### 2.2 Product Mapping

**Bước 1**: Kéo danh sách sản phẩm từ POS (tất cả shops):
```bash
GET /shops/{SHOP_ID}/products?api_key={KEY}&per_page=100
→ Output: product_id, name, sku, price
```

**Bước 2**: So sánh POS products vs Config products:
- [ ] POS products có mã SKU (field `sku`) hay mã trong tên (`005 - ...`)?
- [ ] Mỗi shop có cùng danh sách SP không? (thường khác nhau!)
- [ ] SP trong config có tương ứng POS 100% không?

**Bước 3**: Kéo campaign product codes (vị trí #3 trong tên campaign):
```bash
→ Parse: MARKET/MARKETER/PRODUCT_CODE/.../DATE
→ So sánh PRODUCT_CODE vs POS product names
→ Tách thành: auto-mapped vs unmapped
```

**Bước 4**: Yêu cầu user mapping thủ công cho product codes chưa map:
```
Ví dụ:
RANGGIA1  (9x) → SKU: 105 (Neslemy Dentures)
DAUGOI1   (9x) → SKU: 111 (Hair Growth Shampoo)  
HKNK      (5x) → SKU: 011 (Heart of Ocean)
```

- [ ] Ghi vào `config/naming/product_aliases.yaml`

---

### 2.3 Market / Thị Trường Mapping

**Bước 1**: Extract market slugs từ campaign names (vị trí #1):
```
Tìm được: SAUDI, Saudi, saudi, UAE, Uae, KUWAIT, Kuwait, Qatar, QATAR, Oman, OMAN, Bahrain
```

**Bước 2**: Normalize → config code:
```yaml
market_aliases:
  SAUDI: SA
  Saudi: SA
  saudi: SA
  UAE: AE
  Uae: AE
  # ...
```

- [ ] Tất cả biến thể đã normalize
- [ ] Ghi vào `config/naming/market_aliases.yaml`

---

### 2.4 Tỷ Giá & Giá Vốn

- [ ] Bảng tỷ giá đủ cho TẤT CẢ currency → VND (hoặc base currency)
- [ ] Giá vốn (cost_price) cho TẤT CẢ SP trong danh mục
- [ ] Nếu thiếu → ghi rõ SP nào thiếu, yêu cầu user bổ sung

---

### 2.5 Phí 3PL

Xác nhận công thức tính phí theo từng đối tác:
```
✅ Giao THÀNH CÔNG = packing_fee + delivery_fee + COD_fee
❌ Giao THẤT BẠI   = packing_fee + return_fee
```

- [ ] COD fee là **%** hay **cố định**? (VD: iMile=3%, PostaPlus=0.25 KWD)
- [ ] return_fee cho TẤT CẢ thị trường
- [ ] valid_from / valid_to (phí có thay đổi theo thời gian?)
- [ ] Kho hàng (warehouse) mỗi thị trường

---

## PHASE 3 — Tạo Naming Registry 📝

Kết hợp tất cả mapping thành file trung tâm:

```yaml
# config/naming/{project_id}_registry.yaml

project_id: talpha

marketer_aliases:
  LOC: SSL
  C.Thuy: CTT
  NHUNG: HTTN
  MAI: PHTM
  Bình: LTB
  N.THE: TNT
  S.ANH: SSA

market_aliases:
  SAUDI: SA
  saudi: SA
  Saudi: SA
  UAE: AE
  # ...

product_aliases:
  RANGGIA: "105"
  RANGGIA1: "105"
  DAUGOI1: "111"
  # ...

campaign_name_pattern: "{MARKET}/{MARKETER}/{PRODUCT}/{PAGE_ID}/{PAGE_NAME}/{DATE}"
pos_sku_pattern: "{SKU_NUM} - {PRODUCT_NAME}"
```

---

## PHASE 4 — Pre-Launch Checklist ✅

### API & Data
- [ ] Facebook Ads API: tất cả accounts hoạt động
- [ ] POS API: tất cả shops trả data
- [ ] BigQuery dataset đã tạo
- [ ] Naming registry hoàn tất

### Mapping
- [ ] 100% marketer đã map (loại nghỉ việc)
- [ ] ≥80% product codes đã map (top frequency)
- [ ] 100% market slugs đã normalize
- [ ] Tỷ giá + giá vốn đầy đủ

### Config
- [ ] `config/projects/{project_id}.yaml` hoàn chỉnh
- [ ] `config/naming/{project_id}_registry.yaml` hoàn chỉnh
- [ ] `.env` cho dashboard đã cập nhật
- [ ] N8N workflows generated cho project mới

### Quy Chuẩn Mới (từ giờ trở đi)
- [ ] Đặt tên campaign theo format mới: `{MARKET}/{MKT_CODE}/{SKU}-{SP_NAME}/{PAGE_ID}/{PAGE_NAME}/{DATE}`
- [ ] POS sản phẩm phải có mã SKU chuẩn
- [ ] Team đã được training quy tắc đặt tên

---

## PHASE 5 — Những Thông Tin Cần Xác Nhận Bổ Sung 🔎

| # | Thông tin | Lý do cần | Từ ai |
|---|-----------|-----------|-------|
| 1 | **Giá bán mỗi SP theo thị trường** | Tính doanh thu, margin | POS hoặc user |
| 2 | **Tỷ lệ hoàn (return rate) trung bình** | Forecast, KPI | User/Ops |
| 3 | **Budget quảng cáo hàng tháng** | Dashboard KPI, ROAS target | User |
| 4 | **KPI targets** (ROAS, CPA, CPC mục tiêu) | Dashboard alerts | User/CMO |
| 5 | **Chi phí cố định hàng tháng** | P&L dashboard | User/Finance |
| 6 | **Lịch đổi tỷ giá** | Cập nhật tự động hay thủ công? | User |
| 7 | **Quy trình xử lý hoàn** | Map status POS → logic dashboard | User/Ops |
| 8 | **Múi giờ report** | UTC+4 (Dubai) hay UTC+7 (VN)? | User |
| 9 | **Ngày bắt đầu đổ data** | Backfill từ ngày nào? | User |
| 10 | **Google Sheets master data** | Product cost, fixed cost cập nhật bằng gì? | User |
