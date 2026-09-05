# 🎯 AUUS1 — Hướng Dẫn Kiến Trúc & Go-Live (PiAlpha US-AU)

> **Dự án**: PiAlpha (AUUS1)  
> **Ngày tạo**: 2026-02-20  
> **Trạng thái**: ⚠️ XÂY DỰNG LẠI TỪ ĐẦU (Clean Slate)  
> **Config file**: [`config/projects/AUUS1.yaml`](file:///c:/Users/LE%20MO/Desktop/AGENT/config/projects/AUUS1.yaml)  

Tài liệu này là **"Single Source of Truth"** (Nguồn chân lý duy nhất) giải phẫu toàn bộ kiến trúc dữ liệu thực tế của AUUS1 sau khi hệ thống cũ bị xóa sổ. Mọi Agent (CMO, CFO...) và file ETL (N8N, Python) đều phải lấy logic từ đây để phát triển.

---

## 1. TỔNG QUAN DỰ ÁN & THỊ TRƯỜNG

| Thuộc tính | Chi tiết |
|------------|----------|
| **Project ID** | `AUUS1` |
| **Dataset (BQ)** | `AUUS1_Dataset` |
| **Tiền tệ gốc** | **USD** (Tiền Base của Dashboard/Báo cáo) |
| **Thị trường 1 (US)**| Bán tại Mỹ. Thu USD. Warehouse: AMI, NAZA. |
| **Thị trường 2 (AU)**| Bán tại Úc. Thu AUD. Warehouse: NAZA. |
| **Mô hình Cashflow**| **Pre-paid / Card / Thu sau**: 100% giao thành công hệ thống, thu tiền sau 10-20 ngày. Tỉ lệ thu hồi thực tế: 60-80%. |
| **Hệ thống POS** | Poscake (2 Shops riệng biệt) |

---

## 2. METADATA TỪ HỆ THỐNG GỐC (RAW API INSIGHTS)

### 2.1. Cấu trúc Meta Ads (Facebook)
Dữ liệu raw từ API Meta Ads trả về format tên Chiến dịch (Campaign Name) cực kỳ nghiêm ngặt:

**Pattern chuẩn**:
`{MARKET}/{MARKETER}/{PRODUCT}/{PAGE_ID}/{PAGE_NAME}/{DATE}`

**Ví dụ thực tế**:
- `AUS/Kính/Body Lotion/61585337499878/Skin Glow AU/1702`
- `AUS/Thắng/dầu gội Fa Le Mei/61586530110932/Luxe Avenue AU/15022025 - BS`

**Quy tắc Parse (ETL Logic)**:
- Vị trí 0 (`MARKET`): Cần normalize `AUS` → `AU`.
- Vị trí 1 (`MARKETER`): Tên marketer (ví dụ: `Kính`, `Thắng`). Cần registry mapping.
- Vị trí 2 (`PRODUCT`): Tên sản phẩm tự do (`Body Lotion`, `dầu gội Fa Le Mei`). Rất thiếu chuẩn hóa, bám sát Registry để gom nhóm.
- Vị trí 3 & 4: Thông tin Page chạy Ads.

### 2.2. Cấu trúc POS (Poscake API)
Phân tích JSON thực tế từ shop Úc (`1328333296`):
- `total_price`: **Luôn bằng 0**. Tuyệt đối KHÔNG ĐỤNG vào trường này để tính doanh thu.
- `money_to_collect`: **Lưu giá trị ảo**. Ví dụ `29900` thực chất là `299.00` (đơn vị AUD hoặc USD tùy shop).
- `shipping_address.country_code`: Dùng mã quốc gia (`61` cho Úc, `1` cho Mỹ) để định danh chính xác nếu cần.
- `order_currency`: Trả về `AUD` đối với shop Úc, `USD` đối với shop Mỹ.

---

## 3. CÔNG THỨC BUSINESS LOGIC (P&L CORE)

### DÒNG DOANH THU (Revenue)
```sql
-- Công thức doanh thu đơn hàng 
Revenue (Local) = money_to_collect / 100
Revenue (USD Base) = Revenue (Local) / Exchange_Rate_To_USD
```
*Lưu ý*: Với Shop Mỹ thì Local = USD, tỉ giá = 1. Với Shop Úc, Local = AUD, chia tỉ giá AUD->USD từ `.env` để ra USD base.

### DÒNG CHI PHÍ (Costs)
**1. Chi phí QC (Ads Spend)**
- Đã charge bằng USD trực tiếp qua Meta Ads. Không cần convert tiền.

**2. Chi phí Fulfillment (3PL)**
Mô hình AUUS1 đặc biệt KHÔNG tính phí COD hay phí Hoàn trả (Return Fee). Mọi chi phí là fix cost trên đầu đơn:
- **Mỹ (AMI / NAZA)**: Packing = $1.00 USD, Ship = ~$10.00 USD. Tổng chi phí Fulfillment Mỹ = **$11.00 USD / Đơn**.
- **Úc (NAZA)**: Packing = 1.00 AUD, Ship = ~10.00 AUD. Tổng chi phí Fulfillment Úc (Cần convert về USD).

### DÒNG LỢI NHUẬN (Profit)
```sql
Gross_Profit = Revenue (USD) - COGS (USD) - 3PL_Cost (USD)
Net_Profit = Gross_Profit - Ads_Spend (USD)
ROAS = Revenue (USD) / Ads_Spend
```

### HỆ THỐNG ĐÁNH GIÁ SẢN PHẨM TEST (Unmapped Testing)
- Các chiến dịch chạy thử nghiệm (testing content, testing sản phẩm mới, camp rác) sẽ **không bao giờ có doanh thu POS** (hoặc rất hiếm). Do vậy: **KHÔNG CẦN CHỜ MATCH VỚI POS**.
- **Yêu cầu đối với N8N/ETL**: BẮT BUỘC phải kéo 100% dữ liệu Meta Ads (Spend, Impressions, CPC, CTR, CPM...) của các camp rác này hiển thị lên Dashboard.
- **Mục tiêu Dashboard**:
  1. Theo dõi ngân sách test của các Marketer, dập ngay các camp test vượt quá hạn mức (ví dụ: cắn >$1M VND mà không ra số).
  2. Đánh giá chất lượng của Content Test (chỉ số list/click tốt không) để chấm xem Content có win hay không nhằm chốt quy trình nhập hàng.

---

## 4. CHECKLIST XÂY DỰNG DATA PIPELINE MỚI

Nếu các Agent hoặc hệ thống ETL được kích hoạt lại cho dự án AUUS1, hãy bám sát checklist sau:

- [ ] **Tạo Dataset `AUUS1_Dataset`**: Tạo các Data Mart tuân thủ việc quy đổi toàn bộ mọi thứ (Revenue AUD) về **USD**.
- [ ] **N8N Sync Workflows**: Generate luồng workflow n8n (chia làm POS Sync và Ads Sync).
- [ ] **Cập nhật Naming Registry (`auus1_registry.yaml`)**: Viết một script để duyệt qua các tên chiến dịch lịch sử (`Kính`, `Thắng`, `Body Lotion`, v.v.) và khai báo bí danh chuẩn (Aliases).
- [ ] **Products Mapping**: Kéo danh mục sản phẩm từ 2 Shop POS Mỹ và Úc, tạo bảng map giá vốn (COGS) gốc. 
- [ ] **Cross-Currency Dashboard**: Chắc chắn `dashboard-ui/` xử lý hiển thị chuẩn với `CURRENCY_SYMBOL = $` và `PROJECT_CURRENCY = USD`.

## 5. CÁC ĐIỂM "MÙ" CẦN DÈ CHỪNG (RISKS)
1. Doanh thu của AUUS1 trên hệ thống (POS) là **100% giao thành công** (nghĩa là auto gán status thành công). Nhưng tiền thực thu sau 20 ngày chỉ đạt ~60-80%. Báo cáo Dashboard hiện tại sẽ **"ảo tưởng sức mạnh"** (Overestimate) lợi nhuận. Cần tham vấn user thuật toán bù trừ/chết yểu (cancellation offset logic).
2. Tên Marketer và Tên Sản phẩm trong Meta Ads viết hoàn toàn bằng tiếng Việt có dấu (`thắng`, `Kính`). Bắt buộc UTF-8 chuẩn ở mọi nơi.
