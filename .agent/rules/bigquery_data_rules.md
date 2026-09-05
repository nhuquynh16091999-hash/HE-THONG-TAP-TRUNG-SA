---
paths:
  - "sql/**/*.sql"
  - "faos_brain/**/*.py"
  - "sync/**/*.py"
---
# BigQuery Data Quality Rules — STRAMARK_Dataset

> **CRITICAL**: Luôn tuân thủ các quy tắc này khi query BigQuery. Vi phạm sẽ gây sai doanh thu/đơn hàng.

## Quy tắc bắt buộc

### 1. Luôn query bảng gốc
- ✅ `sale_order` — đơn hàng (từ POS, chuẩn 100%)
- ✅ `fb_ads_data` — chi phí quảng cáo (từ Meta API, chuẩn 100%)
- ⚠️ `vw_fact_orders` — OK nếu cần thông tin enriched (marketer, market, attribution)
- ⚠️ `vw_fact_ads_performance` — OK cho ad performance tổng hợp

### 2. Đơn vị tiền tệ
- `sale_order.total_price` lưu theo **bani** (đơn vị nhỏ nhất). **Luôn chia 100** để ra RON.
- `currency_divisor = 100` (lưu trong `dim_shop_project`)
- Giá POS hợp lệ: **89–553 RON** (fashion Romania)

### 3. Chống trùng dữ liệu
- Luôn dùng `COUNT(DISTINCT id)` hoặc `COUNT(DISTINCT order_id)` khi đếm đơn
- Khi JOIN với bảng dim, **LUÔN** dùng subquery đã GROUP BY:
  ```sql
  -- ✅ ĐÚNG: Deduplicated subquery
  LEFT JOIN (
      SELECT LOWER(TRIM(raw_market)) AS key, ANY_VALUE(market_name) AS val
      FROM dim_market_mapping
      GROUP BY 1
  ) mkt ON LOWER(TRIM(field)) = mkt.key
  
  -- ❌ SAI: Direct join (nếu dim có duplicate → nhân bội dòng)
  LEFT JOIN dim_market_mapping mkt ON LOWER(field) = LOWER(mkt.raw_market)
  ```

### 4. Attribution (gán đơn hàng cho campaign)
- Đơn hàng KHÔNG có `ad_id`, chỉ có `adset_id`
- Join qua `sale_order.adset_id` → `fb_ads_data.adset_id`
- 1 adset có nhiều ads → dùng `COUNT(DISTINCT order_id)` hoặc gán cho top-spend ad

### 5. Thêm dữ liệu vào bảng dim
- **LUÔN** `LOWER(TRIM())` trước khi insert vào `dim_market_mapping`, `dim_marketer_mapping`
- Kiểm tra duplicate trước khi insert:
  ```sql
  SELECT * FROM dim_market_mapping WHERE LOWER(raw_market) = LOWER('new_value')
  ```

## Bảng dim hiện tại

| Bảng | Key | Trạng thái |
|------|-----|-----------|
| `dim_market_mapping` | `raw_market` (lowercase) | ✅ Clean (3 rows) |
| `dim_marketer_mapping` | `raw_name` | ✅ Clean |
| `dim_status_mapping` | `status_code` | ✅ Clean |
| `page_marketer` | `page_id` (is_active=TRUE) | ✅ Clean |

## Lịch sử sự cố

| Ngày | Lỗi | Nguyên nhân | Khắc phục |
|------|------|-------------|-----------|
| 2026-02-17 | Doanh thu x2 | `dim_market_mapping` có 'Romania' + 'romania' → JOIN LOWER() match cả 2 → nhân đôi | Normalize lowercase + safeguard GROUP BY trong view |
| 2026-02-17 | ROAS 1000x | `vw_fact_ads_performance` OR join → 1 order match N ads | Gán order cho top-spend ad per adset |
