# ETL Best Practices — Tránh lỗi trùng lặp dữ liệu BigQuery

> **Tài liệu này ghi lại bài học kinh nghiệm từ lỗi duplicate data**
> phát hiện ngày 2026-02-21, ảnh hưởng đến cả STRAMARK và AUUS1.

---

## 1. Vấn đề: N8N INSERT gây trùng lặp

### Triệu chứng
- Dashboard hiển thị số lượng bán sai (L20: 53,578 thay vì 98)
- Bảng phình to bất thường (78K rows thay vì 2K)

### Nguyên nhân gốc
N8N workflow sync dữ liệu bằng **`INSERT`** (append) thay vì **`MERGE`** (upsert).
Mỗi lần workflow chạy → INSERT lại toàn bộ records → duplicate.

```
Lần sync 1: INSERT 2,000 rows  →  2,000 rows
Lần sync 2: INSERT 2,000 rows  →  4,000 rows (đã trùng)
...
Lần sync 39: INSERT 2,000 rows → 78,000 rows (39x duplicate!)
```

### Bảng bị ảnh hưởng (audit 2026-02-21)

| Dataset | Table | Rows | Unique | Ratio |
|---------|-------|------|--------|-------|
| STRAMARK | `order_items` | 78,528 | 2,010 | **39x** 🔴 |
| AUUS1 | `customers` | 23,091 | 3,273 | **7x** 🔴 |

### Workflow gây ra duplicate (đã fix 2026-02-21)

| Workflow | Vấn đề | Fix |
|----------|--------|-----|
| `[STRAMARK] 01 POS Full Sync` | INSERT trực tiếp vào `order_items` + `customers` | Đổi target sang `staging_order_items` + `staging_customers` |
| `[TEMP] Insert 78 rows` | INSERT trực tiếp vào `order_items` | **Deactivated** |
| `[STR] 03 Merge & Dedup` | Thiếu MERGE cho customers | Thêm node `Merge Customers` + Truncate `staging_customers` |

### Kiến trúc đúng (đã có sẵn, chỉ bị bypass)
```
POS API → [STR] 01 Order Sync → staging_order_items
                                 staging_sale_order
                                 staging_customers
         → [STR] 03 Merge & Dedup → MERGE vào production tables
                                    → Integrity Check
                                    → Auto Dedup Safety
                                    → TRUNCATE staging
```

---

## 2. Giải pháp: Pattern MERGE/UPSERT

### 2.1 Trong N8N Workflow

Thay vì dùng BigQuery node "Insert Rows", sử dụng **"Execute Query"** với MERGE:

```sql
-- Pattern: Staging → MERGE
-- Bước 1: Insert vào staging table
INSERT INTO `project.dataset.staging_order_items` (...)
VALUES (...);

-- Bước 2: MERGE từ staging vào production
MERGE INTO `project.dataset.order_items` AS target
USING `project.dataset.staging_order_items` AS source
ON target.item_id = source.item_id
WHEN MATCHED THEN
    UPDATE SET
        quantity = source.quantity,
        return_quantity = source.return_quantity,
        sync_time = source.sync_time
WHEN NOT MATCHED THEN
    INSERT (item_id, order_id, product_id, quantity, ...)
    VALUES (source.item_id, source.order_id, source.product_id, source.quantity, ...);

-- Bước 3: Truncate staging
TRUNCATE TABLE `project.dataset.staging_order_items`;
```

### 2.2 Primary Keys cho từng bảng

| Table | Primary Key | Dedup Column |
|-------|------------|--------------|
| `order_items` | `item_id` | `sync_time` |
| `sale_order` | `id` | `sync_time` |
| `fb_ads_data` | `ad_id + date` | `sync_time` |
| `customers` | `id` | `sync_time` |
| `product_template` | `id` | — |
| `product_stock` | `product_id + variation_id` | `sync_time` |

### 2.3 Fallback: Dedup tại VIEW Layer

Nếu chưa sửa được N8N, tạo VIEW với dedup:

```sql
CREATE OR REPLACE VIEW `dataset.vw_order_items_dedup` AS
SELECT * EXCEPT(rn) FROM (
    SELECT *, ROW_NUMBER() OVER (
        PARTITION BY item_id
        ORDER BY sync_time DESC
    ) as rn
    FROM `dataset.order_items`
) WHERE rn = 1;
```

**Dashboard queries PHẢI dùng VIEW dedup**, không query trực tiếp vào raw table.

---

## 3. Checklist khi tạo dự án mới

### 3.1 Thiết kế BigQuery Schema
- [ ] Xác định **Primary Key** cho mỗi bảng
- [ ] Tạo cột `sync_time TIMESTAMP` ở mỗi bảng
- [ ] Tạo `staging_*` table cho mỗi bảng production

### 3.2 Thiết kế N8N Workflow
- [ ] **KHÔNG BAO GIỜ** dùng INSERT trực tiếp vào production table
- [ ] Dùng pattern: API → Staging Table → MERGE → Truncate Staging
- [ ] Thêm node "Check Row Count" sau sync để phát hiện anomaly

### 3.3 Dashboard Queries
- [ ] Dashboard queries **luôn** dùng dedup VIEW, không query raw table
- [ ] Thêm `COUNT(DISTINCT primary_key)` assertion trong development
- [ ] Test với data thực trước khi deploy

### 3.4 Monitoring
- [ ] Tạo scheduled query kiểm tra: `COUNT(*) / COUNT(DISTINCT pk)` < 1.1
- [ ] Alert nếu ratio > 1.5 (có thể duplicate đang xảy ra)

---

## 4. Scripts tham khảo

### 4.1 Audit Script
File: [`scripts/cleanup_duplicates.py`](file:///c:/Users/LE MO/Desktop/AGENT/scripts/cleanup_duplicates.py)

### 4.2 Fix VIEW Script
File: [`scripts/fix_dedup_views.py`](file:///c:/Users/LE MO/Desktop/AGENT/scripts/fix_dedup_views.py)

### 4.3 One-time Cleanup SQL
```sql
-- Dedup một bảng bất kỳ
CREATE OR REPLACE TABLE `dataset.table_name` AS
SELECT * EXCEPT(rn) FROM (
    SELECT *, ROW_NUMBER() OVER (
        PARTITION BY primary_key_col
        ORDER BY sync_time DESC
    ) as rn
    FROM `dataset.table_name`
) WHERE rn = 1;
```

---

## 5. Tóm tắt quy tắc vàng

> ⚠️ **Rule #1**: Mỗi bảng BigQuery PHẢI có Primary Key rõ ràng

> ⚠️ **Rule #2**: KHÔNG BAO GIỜ INSERT trực tiếp — luôn dùng MERGE/UPSERT

> ⚠️ **Rule #3**: Dashboard queries PHẢI dùng dedup VIEW

> ⚠️ **Rule #4**: Audit dedup ratio định kỳ (hàng tuần)
