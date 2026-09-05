# 🐛 Bug Post-Mortem — DB/N8N Restructuring (2026-02-18/19)

> **Mục đích**: Tổng hợp TẤT CẢ lỗi đã gặp sau khi tái cấu trúc database và N8N, phân tích root cause, và các biện pháp phòng ngừa.

---

## Tổng quan: 15 bugs đã phát hiện và fix

| # | Bug | Severity | Root Cause | Status |
|---|-----|----------|------------|--------|
| 1 | Marketer name duplication | 🔴 High | Thiếu canonical name mapping | ✅ Fixed |
| 2 | Stock data = 0 (lần 1) | 🔴 High | Table `product_stock` không tồn tại | ✅ Fixed |
| 3 | Customer tab hiện sai | 🔴 High | Dùng sai column (`customer_id` rỗng) | ✅ Fixed |
| 4 | Status group mismatch | 🟡 Medium | Code dùng `'delivered'/'returned'` thay vì `'success'/'cancelled'` | ✅ Fixed |
| 5 | N8N template placeholders | 🟡 Medium | `__FILL_SHOP_ID__` chưa được thay | ✅ Fixed |
| 6 | POS API auth confusion | 🟡 Medium | Thử `access_token` thay vì `api_key` | ✅ Fixed |
| 7 | DB spec sai status mapping | 🟡 Medium | Status code 6 ghi sai trong doc | ✅ Fixed |
| 8 | Revenue hiện 0 | 🟡 Medium | Dùng `revenue_L3_success` thay vì `total_price` | ✅ Fixed |
| 9 | Stock data = 0 (lần 2) | 🔴 High | View vẫn đọc table cũ, không đọc `product_stock` | ✅ Fixed |
| 10 | N8N Stock Sync error | 🔴 High | BigQuery node `typeVersion: 2` → cần `2.1` | ✅ Fixed |
| 11 | Turbopack panic (Windows) | 🟡 Medium | Next.js 16 Turbopack crash trên Windows | ✅ Workaround |
| **12** | **COGS overcounting 2x** | **🔴 High** | **COGS tính cho ALL orders (kể cancelled/returned)** | **✅ Fixed** |
| **13** | **Stock 0 — wrong POS field** | **🔴 High** | **Dùng `stock_quantity` (None), đúng: `variations_warehouses[].actual_remain_quantity`** | **✅ Fixed** |
| **14** | **P&L shipping double-count** | **🔴 High** | **P&L trừ cả `shipping_cost` (khách trả) lẫn `fulfillment_cost` (3PL)** | **✅ Fixed** |
| **15** | **Ads spend KPI vs table** | **🟡 Medium** | **KPI dùng mart (48% coverage), table dùng vw_fact_ads (100%)** | **✅ Fixed** |

---

## Bug #1: Marketer Name Duplication

### Triệu chứng
Kim Tu, Kim Tú, TÚ, TUKT = **4 hàng riêng biệt** thay vì 1.

### Root Cause
- `mart_performance_master` ghi `marketer_name = "Kim Tu"`
- `vw_fact_ads_performance` ghi `campaign_mkter_code = "TÚ"`
- Code cũ map `TÚ → "Kim Tú"` (không khớp `"Kim Tu"`)
- **Không có canonical name mapping** thống nhất

### Fix
- Tạo [marketer-map.ts](file:///c:/Users/LE%20MO/Desktop/AGENT/dashboard-ui/src/lib/marketer-map.ts) — shared utility
- ALL variants → canonical name từ `stramark.yaml`
- Apply cho cả `marketing-tab.tsx` và `ceo-overview-tab.tsx`

### Phòng ngừa
> [!IMPORTANT]
> **Rule**: Mọi dashboard component PHẢI dùng `resolveMarketerName()` từ `marketer-map.ts`.
> Khi clone project mới, cập nhật `NAME_VARIANTS` map trong `marketer-map.ts` theo `{project}.yaml` marketers section.

---

## Bug #2: Stock Data = 0

### Triệu chứng
Toàn bộ tồn kho hiện 0 — `vw_stock_levels.stock_qty = 0` cho mọi sản phẩm.

### Root Cause Chain
```
product_variations.remain_quantity = "0" (catalog sync chỉ lấy product info)
        ↓
vw_stock_levels reads remain_quantity → stock_qty = 0
        ↓
product_stock table KHÔNG TỒN TẠI
        ↓
06_stock_sync.json chưa deploy (còn __FILL_SHOP_ID__)
```

### Fix
1. Tạo bảng `product_stock` + `warehouse_list` trong BigQuery
2. Update `vw_stock_levels` → LEFT JOIN product_stock, COALESCE
3. Viết script pull stock data từ POS API → insert vào BigQuery
4. Auth: `api_key` query parameter (không phải `access_token`)

### Phòng ngừa
> [!IMPORTANT]
> **Rule**: Khi clone project mới, tạo bảng `product_stock` + `warehouse_list` TRƯỚC khi deploy N8N workflows.
> Checklist: verify bảng tồn tại → deploy N8N → verify data ≠ 0.

---

## Bug #3: Customer Tab Hiện Sai

### Triệu chứng
- Customers = 1 (thay vì 1,334)
- Revenue = 0
- Province chart trống

### Root Cause
| Field dùng sai | Giá trị thực | Field đúng |
|----------------|--------------|------------|
| `customer_id` | `""` (rỗng 100%) | `bill_phone_number` |
| `customer_name` | `""` (rỗng 100%) | `bill_full_name` |
| `shipping_province` | `""` (rỗng 100%) | `derived_market` |
| `status_group = 'delivered'` | Không tồn tại | `status_group = 'success'` |
| `revenue_L3_success` | Chỉ đơn delivered | `total_price` (khi success) |

### Fix
Rewrite toàn bộ 5 queries trong `customer-tab.tsx`.

### Phòng ngừa
> [!IMPORTANT]
> **Rule**: Trước khi viết query cho tab mới, chạy kiểm tra:
> ```sql
> SELECT column_name, COUNT(DISTINCT NULLIF(column_value,'')) 
> FROM table GROUP BY 1
> ```
> Verify column THỰC SỰ có data, không giả định từ tên column.

---

## Bug #4: Status Group Mismatch

### Triệu chứng
Dashboard filter `status_group = 'delivered'` → 0 rows.

### Root Cause
`vw_fact_orders` dùng `dim_status_mapping` để map:

| Code | Trong VW | Dashboard code cũ dùng |
|------|----------|----------------------|
| 6 | `success` + `delivered` | `'delivered'` ❌ |
| 16 | `success` + `completed` | `'delivered'` ❌ |
| 8 | `cancelled` | `'returned'` ❌ |

Dashboard phải filter theo `status_group`, KHÔNG phải `status_name`.

### Fix
Sửa tất cả queries dùng `status_group = 'success'` / `'cancelled'`.

### Phòng ngừa
> [!IMPORTANT]
> **Rule**: Luôn verify status_group values bằng:
> ```sql
> SELECT status_group, status_name, COUNT(*) FROM vw_fact_orders GROUP BY 1,2 ORDER BY cnt DESC
> ```

---

## Bug #5: N8N Template Placeholders

### Triệu chứng
Stock sync workflow không chạy.

### Root Cause
`06_stock_sync.json` và `05_poscake_catalog_sync.json` còn:
- `shop_id: '__FILL_SHOP_ID__'`
- `api_url: 'https://api.poscake.vn/api/v1'` (sai domain)

### Fix
Thay bằng `shop_id: '1635307570'`, `api_url: 'https://pos.pages.fm/api/v1'`

### Phòng ngừa
> [!IMPORTANT]
> **Rule**: Sau khi clone N8N templates, chạy grep kiểm tra:
> ```bash
> grep -r "__FILL_" n8n/{project_id}/
> grep -r "api.poscake.vn" n8n/{project_id}/  # Wrong domain
> ```

---

## Bug #6: POS API Auth Confusion

### Root Cause
- Config ghi `api_key: "6b8bd..."` 
- Code thử `access_token` query param → "invalid token"
- Đúng ra phải dùng `api_key` query param

### Phòng ngừa
> [!TIP]
> POS API (pos.pages.fm) sử dụng `?api_key=xxx` — KHÔNG phải `?access_token=xxx`.

---

## Bug #7: DB Spec Sai Status Mapping

### Root Cause
`DATABASE_MASTER_SPEC.md` Section 5.2 ghi:
- Code 3 = delivered = success ❌
- Code 6 = canceled ❌

**Thực tế từ POS data:**
- Code 6 = delivered = success ✅
- Code 8 = cancelled ✅
- Code 16 = completed = success ✅

### Action
Cần update `DATABASE_MASTER_SPEC.md` Section 5.2.

---

## Bug #8: Revenue = 0 khi dùng revenue_L3_success

### Root Cause
`revenue_L3_success` chỉ populated cho orders đã delivered.
Nhiều đơn có `total_price > 0` nhưng `revenue_L3_success = 0`.

### Fix
Dùng `total_price` với filter `status_group = 'success'` cho revenue thực.

---

## Bug #9: Stock Data = 0 (Lần 2) — View không cập nhật

### Triệu chứng
Sau khi fix Bug #2 (tạo bảng `product_stock` + sync data từ POS API thành công), dashboard vẫn hiện tồn kho = 0.

### Root Cause Chain
```
product_stock table CÓ data (78 rows, 3,322 units) ✅
        ↓
vw_stock_levels KHÔNG ĐỌC từ product_stock ❌
        ↓
View vẫn đọc từ vw_variations_latest → product_variations.remain_quantity = 0
        ↓
Lý do: View chỉ được CREATE OR REPLACE trong code/script, 
       nhưng CHƯA BAO GIỜ thực sự chạy lệnh đó trên BigQuery
```

### Nguyên nhân gốc rễ
**Tách rời giữa "viết SQL" và "deploy SQL"** + **BigQuery `CREATE OR REPLACE VIEW` thất bại thầm lặng**:
- Lần fix đầu: script viết SQL đúng nhưng KHÔNG chạy trên BigQuery
- Lần fix thứ 2: chạy `CREATE OR REPLACE VIEW` → BigQuery **báo success nhưng view KHÔNG thay đổi** (vẫn đọc từ `vw_variations_latest`)
- Phải dùng `DROP VIEW IF EXISTS` + `CREATE VIEW` riêng biệt mới thực sự cập nhật

### Fix
1. Changed CEO tab query to read **directly from `product_stock`** — bypass view hoàn toàn
2. Force `DROP + CREATE` view (không dùng `CREATE OR REPLACE`)
3. Verify via `INFORMATION_SCHEMA.VIEWS` sau khi deploy

### Kết quả sau fix
| Product | Stock |
|---------|-------|
| V10 Colier | 758 |
| V09 Colier Grația | 687 |
| V02 Colier | 652 |
| B1 Levelup | 466 |
| **Total** | **3,322** |

### Phòng ngừa
> [!CAUTION]
> **Rule**: Sau khi tạo/thay đổi bảng nguồn, PHẢI verify rằng tất cả VIEWs phụ thuộc đã được **thực sự deploy** trên BigQuery.
> Checklist bắt buộc:
> ```sql
> -- Verify view definition đã đúng
> SELECT view_definition 
> FROM {dataset}.INFORMATION_SCHEMA.VIEWS 
> WHERE table_name = 'vw_stock_levels';
>
> -- Verify data ≠ 0
> SELECT SUM(stock_qty) FROM {dataset}.vw_stock_levels;
> ```
> **Không bao giờ giả định view đã cập nhật chỉ vì code SQL đã viết.**

---

## Tổng hợp Rules cho Clone Project Mới

1. ✅ Tạo bảng `product_stock` + `warehouse_list` TRƯỚC khi deploy N8N
2. ✅ **Sau khi tạo bảng, LUÔN chạy lại CREATE OR REPLACE VIEW** cho tất cả views phụ thuộc
3. ✅ **Verify view definition + data ≠ 0** bằng INFORMATION_SCHEMA query
4. ✅ Verify `customer_id` / `customer_name` có data hay phải dùng `bill_phone_number` / `bill_full_name`
5. ✅ Verify `status_group` values thực tế (success/cancelled, KHÔNG phải delivered/returned)
6. ✅ Grep `__FILL_` trong N8N templates sau khi clone
7. ✅ POS API auth = `?api_key=xxx`
8. ✅ Update `marketer-map.ts` theo project's marketers config
9. ✅ Chạy data validation queries TRƯỚC khi deploy dashboard
10. ✅ Update `DATABASE_MASTER_SPEC.md` status mapping
11. ✅ **BigQuery node `typeVersion` PHẢI = `2.1`** trong N8N workflow JSON
12. ✅ **Dashboard chạy với `--webpack`** (Turbopack panic trên Windows)
13. ✅ **Ads Command Center cần FastAPI backend** chạy trên port 8000

---

## Bug #10: N8N Stock Sync Error — BQ typeVersion

**Ngày:** 2026-02-19
**Severity:** 🔴 High
**Triệu chứng:** N8N Stock Sync workflow chạy nhưng error ngay tại BQ node.

**Error message:**
```
Node does not have any credentials set for "googleBigQueryOAuth2Api"
```

**Root cause:** BigQuery node `typeVersion: 2` không đọc được `googleApi` credential key. Tất cả workflow khác dùng `typeVersion: 2.1`.

**Fix:**
```powershell
# GET workflow → update BQ nodes typeVersion → PUT
$wf.nodes | ForEach-Object {
    if ($_.type -eq "n8n-nodes-base.googleBigQuery") { $_.typeVersion = 2.1 }
}
```

**Phòng ngừa:**
- ✅ Template JSON phải dùng `typeVersion: 2.1` cho mọi BQ node
- ✅ Verify sau khi deploy: check execution status trong 5 phút

---

## Bug #11: Turbopack Panic on Windows

**Ngày:** 2026-02-19
**Severity:** 🟡 Medium
**Triệu chứng:** `npm run dev` crash với `FATAL: An unexpected Turbopack error occurred`

**Root cause:** Next.js 16 default Turbopack crash trên Windows do path handling issue.

**Workaround:**
```bash
npm run dev -- --webpack
```

**Đã làm:**
- Thêm `turbopack: {}` trong `next.config.mjs` (silence lỗi Turbopack/webpack conflict)
- Dùng `--webpack` flag khi chạy dev

---

## Bug #12: COGS Overcounting 2x

**Ngày:** 2026-02-24
**Severity:** 🔴 High
**Triệu chứng:** COGS hiện ~124K RON, thực tế chỉ ~62K RON (đơn success).

**Root cause:** `order_cogs` CTE trong `mart_performance_master` không filter status → tính COGS cho cả đơn cancelled và returned.

**Fix:** Thêm `WHERE o.status_group = 'success'` vào CTE `order_cogs`.

**Phòng ngừa:**
> [!CAUTION]
> COGS phải match với revenue: nếu revenue chỉ tính success orders, COGS cũng CHỈ tính success orders.

---

## Bug #13: Stock = 0 — Wrong POS API Field (Lần 3!)

**Ngày:** 2026-02-24
**Severity:** 🔴 High
**Triệu chứng:** `product_stock.quantity_on_hand = 0` cho toàn bộ 78 variants.

**Root cause chain:**
```
Sync script dùng `v.get('stock_quantity')` → None (field không tồn tại)
        ↓
Kết luận sai: "POS không quản lý tồn kho"
        ↓
Thực tế: Stock nằm trong NESTED OBJECT:
  variant.variations_warehouses[].actual_remain_quantity = 3
        ↓
Sau fix: 22/78 variants có stock, tổng 3,257 units
```

**Pattern lặp lại:** Giống Bug COGS (`imported_price=0` nhưng `average_imported_price=5181`).

**Fix:** Dùng `variations_warehouses[].actual_remain_quantity` trong sync script.

**Phòng ngừa:**
> [!CAUTION]
> **KHÔNG BAO GIỊ** kết luận "POS không có data" chỉ vì BQ hiện 0.
> **LUÔN dump ALL fields** từ API response để tìm đúng field name.
> **Check nested objects** — data có thể nằm trong arrays/dicts con.
> Xem `docs/POS_API_FIELD_REFERENCE.md` cho mapping đầy đủ.

---

## Bug #14: P&L Shipping Double-Count

**Ngày:** 2026-02-24
**Severity:** 🔴 High
**Triệu chứng:** Lãi ròng P&L tab thấp hơn CEO tab.

**Root cause:**
| Column | Ý nghĩa | Dùng trong P&L? |
|---|---|---|
| `shipping_cost` | Phí ship **khách trả** (POS fee) | ❌ SAI — đã trừ sai |
| `fulfillment_cost` | Chi phí **3PL gửi hàng** (euShipments) | ✅ Nên trừ |
| `return_fulfillment_cost` | Chi phí **3PL hoàn** | ✅ Nên trừ |

**Fix:** Bỏ `shipping_cost` khỏi P&L tab, gộp `fulfillment + return` thành "Ship/FFM (3PL)".

**Phòng ngừa:**
> [!WARNING]
> `shipping_cost` = phí ship khách trả, KHÔNG phải business expense.
> Chỉ trừ `fulfillment_cost + return_fulfillment_cost` trong P&L.

---

## Bug #15: Ads Spend KPI vs Table Mismatch

**Ngày:** 2026-02-24
**Severity:** 🟡 Medium
**Triệu chứng:** CEO top KPI = 114,8tr VND, Marketer table TỔNG = 238,4M VND.

**Root cause:**
| Nguồn | Coverage | Tổng (RON) |
|---|---|---|
| `mart_performance_master.ads_spend_ron` | ~48% | 18,523 |
| `vw_fact_ads_performance.spend_ron` | 100% | 38,457 |

Mart bị thiếu ~50% campaigns không match được marketer qua 3-level fallback.

**Fix:** CEO KPI lấy ads total từ marketer table (vw_fact_ads = 100% coverage).

**Phòng ngừa:**
> [!IMPORTANT]
> Dùng `vw_fact_ads_performance` cho tổng ads spend (100% coverage).
> Mart chỉ match ~48% campaigns do unmatched: `TA-pixelnew`, `LC trondoi`, `TA-lich`.
