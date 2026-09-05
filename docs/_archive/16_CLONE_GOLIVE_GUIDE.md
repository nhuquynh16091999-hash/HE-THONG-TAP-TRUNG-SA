# 🔧 FAOS — Hướng Dẫn Clone & Go-Live Dự Án Mới

> **Tài liệu này**: Template chuẩn khi clone hệ thống cho dự án mới.  
> **Quy trình tổng**: Form intake (doc 12) → Kickoff verify (doc 14) → **Clone & Go-Live (doc này)** → Dashboard live.  
> **Thời gian ước tính**: 4–8 giờ (tuỳ độ phức tạp dữ liệu).

---

## PHASE 1 — THU THẬP DỮ LIỆU THÔ (30 phút)

### 1.1 Nhận file từ user
User cung cấp file YAML/Sheet chứa:
- Thông tin dự án (tên, mã, ngành)
- Facebook App credentials + Ad Account IDs
- POS tokens / API keys
- Danh sách thị trường, 3PL, team

### 1.2 Tạo config ban đầu
```bash
# Copy template
cp config/projects/_template.yaml config/projects/{project_id}.yaml
```

Điền tất cả field có sẵn từ dữ liệu thô. Ghi `""` cho field thiếu.

### 1.3 Kiểm tra lỗi phổ biến trong dữ liệu thô

| Lỗi | Cách phát hiện | Cách sửa |
|-----|---------------|----------|
| URL POS sai (`api.poscake.vn`) | Grep config | Đổi thành `pos.pages.fm` |
| Dùng JWT token thay API Key | Token bắt đầu `eyJ...` | Yêu cầu API Key (32-char hex) |
| Ad Account ID trùng | Sort + unique | Loại duplicate |
| Shop ID trống | Check config | Lấy từ URL POS |
| Currency sai field | Review YAML | Sửa đúng vị trí |

---

## PHASE 2 — XÁC MINH API (1 giờ)

### 2.1 Facebook Ads API

```powershell
# Test từng ad account
$token = "{ACCESS_TOKEN}"
$accounts = @("{ACC_1}", "{ACC_2}", ...)
foreach($acc in $accounts) {
  $url = "https://graph.facebook.com/v21.0/act_$acc/campaigns?fields=name&limit=5&access_token=$token"
  Invoke-RestMethod -Uri $url
}
```

**Verify**: Tất cả accounts trả về 200 + có data campaigns.

### 2.2 POS API

```powershell
# Test products endpoint (xác nhận API key đúng)
$url = "https://pos.pages.fm/api/v1/shops/{SHOP_ID}/products?api_key={KEY}&per_page=10"
Invoke-RestMethod -Uri $url
```

**Verify**: Trả về danh sách sản phẩm + tên + giá.

> ⚠️ **LƯU Ý QUAN TRỌNG VỀ POS**:
> - Auth = `api_key` as query param (KHÔNG phải header, KHÔNG phải access_token)
> - Nếu lỗi 500 → API key sai hoặc shop bị khóa
> - Mỗi shop có API key riêng
> - Thử cả 2 URL nếu lỗi: `pos.pages.fm` và `api.poscake.vn`

---

## PHASE 3 — MARKETER MAPPING (1 giờ)

### 3.1 Kéo tên marketer từ campaigns

```powershell
# Lấy TẤT CẢ campaigns → extract marketer slugs
foreach($acc in $accounts) {
  GET /act_{acc}/campaigns?fields=name&limit=200
}
# Parse vị trí #2: MARKET/MARKETER/PRODUCT/...
# → Output: unique marketer slugs
```

### 3.2 So sánh với config

| Bước | Hành động |
|------|-----------|
| 1 | List tất cả unique slug từ campaigns |
| 2 | So sánh với `marketers[]` trong config |
| 3 | Hỏi user: slug nào → ID nào? |
| 4 | Marketer lạ → nghỉ việc hay mới? |
| 5 | Ghi TẤT CẢ biến thể tên (hoa/thường/dấu/không dấu) |

### 3.3 Lưu vào naming registry

```yaml
# config/naming/{project_id}_registry.yaml
marketer_aliases:
  "Tên_trong_campaign": "CONFIG_ID"
marketer_ignored:
  - "Tên_MKT_đã_nghỉ"
```

### 3.4 POS marketer names
Kéo orders từ POS → field `marketer.name` → so sánh thêm:
- POS có thể dùng tên đầy đủ (`Sỹ Lộc`) thay vì slug (`LOC`)
- Ghi cả POS name vào registry

---

## PHASE 4 — PRODUCT MAPPING (1–2 giờ)

### 4.1 Kéo danh sách SP từ POS

```powershell
GET /shops/{SHOP_ID}/products?api_key={KEY}&per_page=100
```

**Lưu ý quan trọng**:
- Field `sku` có thể TRỐNG → check mã trong `name` (VD: `005 - Diamond Halo set`)
- Mỗi shop có thể có danh sách SP **khác nhau**
- Naming convention có thể khác giữa shops (có mã số vs free-text)
- Extract SKU bằng regex: `^\d{3}\s*-\s*(.+)$`

### 4.2 Kéo product codes từ campaigns

```powershell
# Parse vị trí #3: MARKET/MARKETER/PRODUCT_CODE/...
# → Output: unique product codes + frequency
```

### 4.3 Auto-mapping

So sánh campaign product codes vs POS product names:
```
Campaign: "VC cream"     → POS: "058 - VC Cream"    ✅ Auto-map
Campaign: "RANGGIA1"     → POS: ???                  ❌ Cần user map
```

**Logic auto-map**:
1. Exact match (case-insensitive)
2. Contains match (slug chứa trong tên POS)
3. SKU number match (campaign có `010` → POS `010 - ...`)
4. Còn lại → yêu cầu user mapping thủ công

### 4.4 Yêu cầu user mapping

List ra TẤT CẢ mã chưa map, sắp xếp theo tần suất xuất hiện:
```
RANGGIA1  (9x)  → SKU: ___
DAUGOI1   (9x)  → SKU: ___
HAITU     (6x)  → SKU: ___
```
User chỉ cần map top 20 (chiếm ~80% data) là đủ go-live.

---

## PHASE 5 — PRICING ANALYSIS (1 giờ)

### 5.1 Kéo orders từ POS

```powershell
GET /shops/{SHOP_ID}/orders?api_key={KEY}&per_page=50&sort=-created_at
```

### 5.2 Xác định cấu trúc giá

> ⚠️ **CẢNH BÁO**: Mỗi dự án có thể lưu giá KHÁC NHAU!

**Kiểm tra các trường hợp**:

| Case | Dấu hiệu | Cách xử lý |
|------|-----------|------------|
| **Giá SP = 0, doanh thu gộp vào ship** | `price=0`, `shipping_fee=99000` | Doanh thu = `COD` hoặc `money_to_collect` |
| **Giá SP đúng, ship riêng** | `price=99`, `shipping_fee=15` | Doanh thu = Σ(price × qty) + ship |
| **Giá ÷ 100** | Giá khổng lồ (10000 cho 1 SP) | Chia cho 100: `10000 → 100.00` |
| **Giá đúng** | Giá hợp lý (99 cho 1 SP) | Dùng trực tiếp |

### 5.3 Phân tích pricing tiers

Group orders theo `total_quantity`, xem `COD`:
```
Qty=1: avg 99, range 89-100 → Giá 1SP = 99
Qty=2: avg 149, range 99-149 → Combo 2 = 149
Qty=3: avg 199 → Combo 3 = 199
```

**Hỏi user xác nhận**:
1. Đơn vị tiền: ÷100 hay không?
2. Giá SP theo tier (1,2,3,4 SP) hay per-item?
3. Combo lớn giá cố định hay tăng?
4. Giá khác nhau theo loại SP không?

### 5.4 Ghi vào config

```yaml
pos_price_divisor: 100  # hoặc 1 nếu giá đúng
pricing_tiers:
  AE:
    1: 99
    2: 149
    3: 199
```

---

## PHASE 6 — 3PL FEES VERIFY (30 phút)

### 6.1 Checklist phí

Với MỖI đối tác 3PL, xác nhận:
- [ ] Phí đóng gói (packing_fee)
- [ ] Phí ship (delivery_fee)
- [ ] Phí COD: **%** hay **flat fee**? (rất quan trọng!)
- [ ] Phí hoàn (return_fee)
- [ ] Currency đúng
- [ ] Valid from/to

### 6.2 Công thức chi phí giao hàng

```
Giao THÀNH CÔNG = packing_fee + delivery_fee + COD_fee
  → COD_fee = revenue × cod_fee_pct  (nếu %)
  → COD_fee = cod_fee_flat            (nếu cố định)
  
Giao THẤT BẠI = packing_fee + return_fee
```

### 6.3 Return policy
Hỏi user: hàng hoàn xử lý thế nào?
- **Re-stock**: Tái nhập kho bán lại → KHÔNG tính mất hàng
- **Dispose**: Bỏ → tính vào chi phí
- **Partial**: Tuỳ tình trạng

---

## PHASE 7 — MARKET NORMALIZE (15 phút)

### 7.1 Extract từ campaigns
```
SAUDI / Saudi / saudi  → SA
UAE / Uae / uae        → AE
```

### 7.2 Ghi vào registry
```yaml
market_aliases:
  SAUDI: SA
  Saudi: SA
  saudi: SA
```

---

## PHASE 8 — CONFIG FINALIZE (30 phút)

### 8.1 Ghi nhận từ user

| Thông tin | Nguồn | Bắt buộc? |
|-----------|-------|-----------|
| ROAS target | User | ✅ |
| Backfill range (ngày) | User | ✅ |
| Return policy | User | ✅ |
| Cost price source | User | ✅ |
| Fixed costs | User | 🟡 Sau |
| Budget ads/tháng | User | ❌ |

### 8.2 Config sections checklist

| # | Section | Bật buộc |
|---|---------|----------|
| 1 | Thông tin dự án | ✅ |
| 2 | BigQuery | ✅ |
| 3 | Facebook Ads (accounts, token) | ✅ |
| 4 | POS (shops, API keys) | ✅ |
| 5 | Campaign types | ✅ |
| 6 | 3PL fees | ✅ |
| 7 | Markets | ✅ |
| 8 | Discord webhooks | 🟡 |
| 9 | Team / Marketers | ✅ |
| 10 | Products + Cost | ✅ |
| 11 | POS shop IDs | ✅ |
| 12 | Exchange rates | ✅ |
| 13 | Pricing tiers | ✅ |
| 14 | KPI targets | ✅ |
| 15 | Operating rules | ✅ |
| 16 | Notes | 🟡 |

---

## PHASE 9 — BIGQUERY + ETL SETUP (1 giờ)

### 9.1 Tạo dataset
```sql
CREATE SCHEMA `{GCP_PROJECT}.{PROJECT_ID}_Dataset`
OPTIONS(location = 'US');
```

### 9.2 Generate N8N workflows
```bash
python tools/generate_n8n_workflows.py --project {project_id}
```

### 9.3 Chạy backfill
```bash
python tools/backfill_data.py --project {project_id} --days {backfill_days}
```

---

## PHASE 10 — DASHBOARD CLONE (1 giờ)

### 10.1 Cập nhật env
```bash
# .env.local
NEXT_PUBLIC_PROJECT_ID={project_id}
NEXT_PUBLIC_DATASET={PROJECT_ID}_Dataset
NEXT_PUBLIC_APP_NAME={project_name}
```

### 10.2 Verify dashboard
```bash
npm run dev
# Check: tất cả tabs load, không 500 error
# Check: BigQuery queries chạy đúng dataset
```

---

## GO-LIVE CHECKLIST ✅

### 🔴 CHẶN go-live (PHẢI có)
- [ ] Tất cả POS API keys hoạt động
- [ ] Facebook Ads token hợp lệ + đủ quyền
- [ ] Marketer mapping 100% đúng
- [ ] Product mapping ≥80% (top frequency)
- [ ] Market normalize đầy đủ
- [ ] Pricing tiers xác định (ít nhất top 3 markets)
- [ ] BigQuery dataset tạo + backfill thành công
- [ ] Dashboard chạy không lỗi

### 🟡 BỔ SUNG SAU (không chặn go-live)
- [ ] Product mapping 100%
- [ ] Return fees đầy đủ
- [ ] Fixed costs
- [ ] Chi tiết warehouse
- [ ] POS product names chuẩn hoá
- [ ] Google Sheet template cho cost update
- [ ] Discord webhooks

---

## LESSONS LEARNED (từ các dự án trước)

### Bẫy hay gặp nhất

| # | Bẫy | Hậu quả | Cách tránh |
|---|-----|---------|------------|
| 1 | POS dùng `access_token` thay `api_key` | Auth fail | Check doc POS, field = `api_key` |
| 2 | URL POS sai (`api.poscake.vn`) | Connection refuse | Dùng `pos.pages.fm` |
| 3 | Giá SP = 0, doanh thu gộp vào shipping | P&L sai | Luôn check `price` vs `cod` trước |
| 4 | POS giá ×100 | Doanh thu ×100 | Kiểm tra giá 1 SP có hợp lý không |
| 5 | Ad account duplicate | Data × 2 | Sort + unique trước |
| 6 | MKT nghỉ việc vẫn còn campaign | Dashboard hiện MKT ma | Hỏi user ai còn active |
| 7 | Product code tiếng Việt | Không map được tự động | Kéo cả POS + campaign rồi so |
| 8 | Mỗi POS shop naming khác | Parse lỗi một số shop | Check TỪNG shop riêng |
| 9 | COD fee % vs flat fee | Tính sai chi phí | Luôn hỏi rõ: % hay cố định? |
| 10 | Combo pricing khác single | Revenue estimate sai | Group orders by qty, phân tích giá |

### Timeline thực tế

```
Bước 1: Nhận data thô + tạo config          ~30 phút
Bước 2: Verify API (Ads + POS)              ~1 giờ
Bước 3: Marketer mapping (kéo + xác nhận)   ~1 giờ
Bước 4: Product mapping (kéo + xác nhận)    ~1-2 giờ ← chậm nhất (chờ user)
Bước 5: Pricing analysis (kéo orders)       ~1 giờ
Bước 6: 3PL + market finalize               ~30 phút
Bước 7: BigQuery + N8N + Dashboard          ~1 giờ
─────────────────────────────────────────────
TỔNG                                        ~6-8 giờ (tính cả chờ user)
```

---

## FILES TEMPLATE

| File | Mục đích |
|------|----------|
| `config/projects/_template.yaml` | Config template trống |
| `config/naming/{project_id}_registry.yaml` | Naming registry (marketer/market/product) |
| `docs/12_NEW_PROJECT_SETUP_FORM.md` | Form thu thập thông tin ban đầu |
| `docs/14_PROJECT_KICKOFF_VERIFICATION.md` | Quy trình verify API chi tiết |
| `docs/16_CLONE_GOLIVE_GUIDE.md` | **File này** — master guide |
