# 📘 Project Clone Guide — FAOS Platform

> **Version**: 2.0 | **Updated**: 2026-02-19
> **Scope**: Hướng dẫn clone dự án E-commerce mới (từ STRAMARK template) — từ A-Z
> **⚠️ Đọc BUG_POSTMORTEM_20260219.md để hiểu TẠI SAO các bước này quan trọng.**

---

## Tổng quan Flow

```
1. Config YAML ──► 2. BigQuery Tables ──► 3. BigQuery Views ──► 4. N8N Workflows
       │                   │                      │                       │
       ▼                   ▼                      ▼                       ▼
5. Data Validation ──► 6. Dashboard ──► 7. Marketer Map ──► 8. Final Verify
```

---

## Bước 1: Tạo Project Config

```bash
cp config/projects/_template.yaml config/projects/{project_id}.yaml
```

### Điền đầy đủ các field REQUIRED:

```yaml
# 1. Project Info
project_id: "myproject"
project_name: "My Project"
currency: RON                    # RON/USD/AUD — ảnh hưởng ÷100 logic!
timezone: Asia/Ho_Chi_Minh

# 2. BigQuery
bigquery:
  project_gcp: "levelup-465304"
  dataset: "MYPROJECT_Dataset"   # ⚠️ Dataset riêng cho mỗi project!

# 3. Facebook Ads
meta_ads:
  access_token: "EAAx..."
  ad_account_ids: ["act_xxx"]
  business_id: "xxx"

# 4. POS (Poscake/Pancake)
poscake:
  shops:
    - name: "Main"
      api_url: "https://pos.pages.fm/api/v1"  # ⚠️ KHÔNG phải api.poscake.vn!
      api_key: "xxx"                           # ⚠️ Dùng api_key, KHÔNG phải access_token
      shop_id: "xxx"

# 9. Team — QUAN TRỌNG cho marketer-map.ts
marketers:
  - id: "ANHNT"
    name: "Nguyễn Tuấn Anh"
  - id: "TUKT"
    name: "Kim Thanh Tú"
```

> [!CAUTION]
> **POS Auth**: Pancake POS dùng `?api_key=xxx` query parameter.
> KHÔNG dùng `?access_token=xxx` (sẽ báo "access_token is invalid").

---

## Bước 2: Tạo BigQuery Dataset + Tables

### 2.1 Tạo Dataset
```sql
CREATE SCHEMA IF NOT EXISTS `levelup-465304.MYPROJECT_Dataset`;
```

### 2.2 Tạo Core Tables (11 tables)

> [!IMPORTANT]
> **PHẢI tạo trong đúng thứ tự sau** — bảng `product_stock` và `warehouse_list` hay bị quên!

```sql
-- 1. sale_order (core)
CREATE TABLE IF NOT EXISTS `MYPROJECT_Dataset.sale_order` (
  id STRING, shop_id STRING, status INT64, status_name STRING,
  total_price FLOAT64, cod FLOAT64, total_discount FLOAT64,
  shipping_fee FLOAT64, partner_fee FLOAT64, return_fee FLOAT64,
  surcharge FLOAT64, money_to_collect FLOAT64, total_quantity INT64,
  marketer STRING, ad_id STRING, adset_id STRING, ads_source STRING,
  page_id STRING, post_id STRING,
  p_utm_source STRING, p_utm_campaign STRING, p_utm_medium STRING,
  p_utm_content STRING, p_utm_term STRING, p_utm_id STRING,
  order_currency STRING, customer_id STRING, customer_name STRING,
  bill_full_name STRING, bill_phone_number STRING,
  shipping_address STRING, shipping_province STRING, shipping_district STRING,
  shipping_carrier STRING, warehouse_id STRING,
  tracking_link STRING, order_date STRING,
  inserted_at STRING, updated_at STRING,
  time_send_partner STRING, estimate_delivery_date STRING,
  note STRING, tags STRING, order_link STRING, sync_time STRING
);

-- 2. staging_sale_order (mirror of sale_order)
CREATE TABLE IF NOT EXISTS `MYPROJECT_Dataset.staging_sale_order` AS
SELECT * FROM `MYPROJECT_Dataset.sale_order` WHERE FALSE;

-- 3. order_items
CREATE TABLE IF NOT EXISTS `MYPROJECT_Dataset.order_items` (
  order_id STRING, product_id STRING, variation_id STRING,
  quantity INT64, price FLOAT64, discount FLOAT64,
  product_name STRING, variation_name STRING, barcode STRING,
  shop_id STRING, combo_id STRING, sync_time STRING
);

-- 4. staging_order_items
CREATE TABLE IF NOT EXISTS `MYPROJECT_Dataset.staging_order_items` AS
SELECT * FROM `MYPROJECT_Dataset.order_items` WHERE FALSE;

-- 5. product_template
CREATE TABLE IF NOT EXISTS `MYPROJECT_Dataset.product_template` (
  id STRING, shop_id STRING, shop_name STRING, name STRING,
  custom_id STRING, category STRING, is_hidden STRING,
  inserted_at STRING, sync_time STRING
);

-- 6. product_variations
CREATE TABLE IF NOT EXISTS `MYPROJECT_Dataset.product_variations` (
  id STRING, product_id STRING, shop_id STRING, display_id STRING,
  barcode STRING, retail_price STRING, average_imported_price STRING,
  remain_quantity STRING, stock_quantity STRING,
  is_hidden STRING, is_locked STRING, sync_time STRING
);

-- ⚠️ 7. product_stock — KHÔNG ĐƯỢC QUÊN!
CREATE TABLE IF NOT EXISTS `MYPROJECT_Dataset.product_stock` (
  product_id STRING, variation_id STRING,
  product_name STRING, variation_name STRING, barcode STRING,
  warehouse_id STRING, warehouse_name STRING,
  quantity_on_hand STRING, quantity_available STRING,
  quantity_incoming STRING, quantity_outgoing STRING,
  quantity_committed STRING, avg_cost STRING, retail_price STRING,
  shop_id STRING, sync_time STRING
);

-- ⚠️ 8. warehouse_list — KHÔNG ĐƯỢC QUÊN!
CREATE TABLE IF NOT EXISTS `MYPROJECT_Dataset.warehouse_list` (
  warehouse_id STRING, warehouse_name STRING,
  address STRING, province STRING, district STRING,
  is_default STRING, status STRING, shop_id STRING, sync_time STRING
);

-- 9. customers
CREATE TABLE IF NOT EXISTS `MYPROJECT_Dataset.customers` (
  id STRING, name STRING, phone STRING, email STRING,
  address STRING, province STRING, district STRING,
  total_orders INT64, total_revenue FLOAT64,
  shop_id STRING, sync_time STRING
);

-- 10. fb_ads_data
CREATE TABLE IF NOT EXISTS `MYPROJECT_Dataset.fb_ads_data` (
  ad_id STRING, ad_name STRING, date STRING,
  spend FLOAT64, impressions INT64, reach INT64, clicks INT64,
  campaign_id STRING, campaign_name STRING,
  adset_id STRING, account_id STRING
);

-- 11. fb_adset_data
CREATE TABLE IF NOT EXISTS `MYPROJECT_Dataset.fb_adset_data` (
  adset_id STRING, adset_name STRING, date STRING,
  spend FLOAT64, impressions INT64, reach INT64, clicks INT64,
  campaign_id STRING, campaign_name STRING, account_id STRING
);
```

### 2.3 Tạo Dimension Tables

```sql
-- dim_status_mapping
CREATE TABLE IF NOT EXISTS `MYPROJECT_Dataset.dim_status_mapping` (
  status_code INT64, status_name STRING,
  status_group STRING, status_display STRING,
  revenue_impact STRING
);

-- ⚠️ INSERT đúng mapping — verify từ POS data thực tế!
INSERT INTO `MYPROJECT_Dataset.dim_status_mapping` VALUES
(0, 'new', 'new', 'New', 'pending'),
(1, 'confirmed', 'confirmed', 'Confirmed', 'pending'),
(2, 'picking', 'processing', 'Picking', 'pending'),
(3, 'shipping', 'shipping', 'Shipping', 'pending'),
(4, 'packing', 'processing', 'Packing', 'pending'),
(5, 'packed', 'processing', 'Packed', 'pending'),
(6, 'delivered', 'success', 'Delivered', 'positive'),
(8, 'cancelled', 'cancelled', 'Cancelled', 'none'),
(11, 'waitting', 'processing', 'Waiting', 'pending'),
(16, 'completed', 'success', 'Completed', 'positive');
```

> [!CAUTION]
> **Status Mapping PHẢI verify từ dữ liệu thực tế của POS.**
> Code 6 = `delivered` = `success` (KHÔNG phải `cancelled`).
> Chạy query kiểm tra sau khi có data:
> ```sql
> SELECT status, status_name, COUNT(*) FROM sale_order GROUP BY 1,2 ORDER BY 1
> ```

---

## Bước 3: Clone và Deploy SQL Views

Copy views từ project reference (stramark):
```bash
cp -r sql/stramark/ sql/{project_id}/
```

Sửa dataset name trong mỗi file:
```bash
sed -i 's/STRAMARK_Dataset/MYPROJECT_Dataset/g' sql/{project_id}/*.sql
```

Deploy theo thứ tự:
```
01_fact_order_items_dedup.sql
02_vw_fact_orders.sql           ← Core view, dashboard phụ thuộc
03_mart_performance_master.sql
04_mart_market_intelligence.sql
05_mart_product_insights.sql
06_vw_fact_daily_pnl_v2.sql
```

> [!CAUTION]
> **BigQuery View Rules (Bug #9 lesson):**
> - **LUÔN dùng `DROP VIEW IF EXISTS` + `CREATE VIEW`** — KHÔNG dùng `CREATE OR REPLACE VIEW` (fail silently!)
> - **Verify sau deploy:** `SELECT * FROM INFORMATION_SCHEMA.VIEWS WHERE table_name = 'view_name'`
> - **Dashboard query `product_stock` trực tiếp** — KHÔNG qua `vw_stock_levels` view

> [!IMPORTANT]
> **Sau khi deploy views, PHẢI verify:**
> ```sql
> -- Check status_group values thực tế
> SELECT status_group, status_name, COUNT(*) FROM vw_fact_orders GROUP BY 1,2
>
> -- Check customer identity fields
> SELECT
>   COUNT(DISTINCT NULLIF(customer_id,'')) as by_id,
>   COUNT(DISTINCT NULLIF(bill_phone_number,'')) as by_phone,
>   COUNT(DISTINCT NULLIF(bill_full_name,'')) as by_name
> FROM vw_fact_orders
>
> -- Check revenue columns
> SELECT ROUND(SUM(total_price),0), ROUND(SUM(revenue_L3_success),0)
> FROM vw_fact_orders WHERE status_group = 'success'
> ```

---

## Bước 4: Clone N8N Workflows

```bash
mkdir n8n/{project_id}
cp n8n/stramark/*.json n8n/{project_id}/
```

### 4.1 Sửa SHOP CONFIG trong TỪNG file

Mở mỗi file JSON, tìm `Shop Config` node, sửa:

```json
{
  "shop_id": "{REAL_SHOP_ID}",        // Từ project config
  "shop_name": "{PROJECT_NAME}",
  "api_url": "https://pos.pages.fm/api/v1"  // ⚠️ KHÔNG phải api.poscake.vn!
}
```

### 4.2 Verify không còn placeholder

```bash
grep -r "__FILL_" n8n/{project_id}/
grep -r "api.poscake.vn" n8n/{project_id}/
grep -r "placeholder" n8n/{project_id}/
# ↑ KẾT QUẢ PHẢI = 0 dòng
```

### 4.3 Sửa BigQuery nodes

Trong mỗi workflow, update:
- `projectId: "levelup-465304"`
- `datasetId: "MYPROJECT_Dataset"`
- Bảng target name (nếu khác)

### 4.4 Deploy Stock Sync (06) via N8N API

```powershell
# 1. Tạo credential Poscake trong N8N
$headers = @{ "X-N8N-API-KEY" = "{N8N_API_KEY}"; "Content-Type" = "application/json" }
$credBody = @{ name="[{PREFIX}] Poscake API"; type="httpHeaderAuth"; data=@{name="api_key"; value="{POSCAKE_API_KEY}"} } | ConvertTo-Json
$cred = Invoke-RestMethod -Method POST -Uri "{N8N_HOST}/api/v1/credentials" -Headers $headers -Body $credBody

# 2. Update credential ID trong template JSON  
$json = Get-Content n8n/{project_id}/06_stock_sync.json -Raw
$json = $json -replace '__CREDENTIAL_ID_STR_POSCAKE__', $cred.id
$json = $json -replace '__CREDENTIAL_ID_BQ__', '{BQ_CREDENTIAL_ID}'  # Shared across projects

# 3. Deploy workflow
$wf = Invoke-RestMethod -Method POST -Uri "{N8N_HOST}/api/v1/workflows" -Headers $headers -Body $json

# 4. Activate
Invoke-RestMethod -Method POST -Uri "{N8N_HOST}/api/v1/workflows/$($wf.id)/activate" -Headers $headers
```

> [!NOTE]
> BigQuery credential ID is shared across all projects: `KnoFebrfXG4Q9zcZ`

---

## Bước 5: Data Validation (CRITICAL!)

> [!CAUTION]
> **Steps 5.1–5.4 PHẢI pass TRƯỚC khi deploy dashboard.**

### 5.1 Pull Stock Data

Stock data tự động sync mỗi 6h bởi `[STR] 06 Stock Sync` workflow (Bước 4.4).
Manual pull (nếu cần):
```javascript
const url = `${API_URL}/shops/${SHOP_ID}/products?api_key=${API_KEY}&per_page=50&includes=variations`;
```

Verify:
```sql
SELECT COUNT(*), SUM(SAFE_CAST(quantity_on_hand AS INT64))
FROM MYPROJECT_Dataset.product_stock
-- Kết quả PHẢI > 0
```

### 5.2 Verify Customer Identity

```sql
-- Field nào có data?
SELECT
  COUNT(DISTINCT NULLIF(customer_id,'')) as by_customer_id,
  COUNT(DISTINCT NULLIF(bill_phone_number,'')) as by_phone,
  COUNT(DISTINCT NULLIF(customer_name,'')) as by_name,
  COUNT(DISTINCT NULLIF(bill_full_name,'')) as by_bill_name
FROM MYPROJECT_Dataset.vw_fact_orders
```

**Kết quả quyết định dashboard dùng field nào:**
- Nếu `by_customer_id = 0` → dùng `bill_phone_number`
- Nếu `by_name = 0` → dùng `bill_full_name`

### 5.3 Verify Status Groups

```sql
SELECT status_group, status_name, status_code, COUNT(*)
FROM MYPROJECT_Dataset.vw_fact_orders
GROUP BY 1,2,3 ORDER BY 4 DESC
```

Confirm values: `success`, `shipping`, `processing`, `confirmed`, `new`, `cancelled`
**KHÔNG phải**: `delivered`, `returned`

### 5.4 Verify Revenue

```sql
SELECT
  ROUND(SUM(total_price),0) as total_price_sum,
  ROUND(SUM(revenue_L3_success),0) as L3_sum,
  ROUND(SUM(CASE WHEN status_group='success' THEN total_price ELSE 0 END),0) as success_revenue
FROM MYPROJECT_Dataset.vw_fact_orders
-- success_revenue PHẢI > 0
```

---

## Bước 6: Dashboard Setup

### 6.1 Update Marketer Map

Mở `dashboard-ui/src/lib/marketer-map.ts`, thêm mapping cho project mới:

```typescript
const NAME_VARIANTS: Record<string, string> = {
    // Từ {project}.yaml marketers section
    "Raw Name 1": "Canonical Full Name",
    "Campaign Code": "Canonical Full Name",
    "Short Name": "Canonical Full Name",
    // ...
};
```

### 6.2 Update Queries (nếu cần)

Dựa trên kết quả Bước 5.2, update queries trong các tab:
- `customer-tab.tsx` — dùng field identity đúng
- `marketing-tab.tsx` — dùng `resolveMarketerName()`
- `ceo-overview-tab.tsx` — dùng `resolveMarketerName()`

### 6.3 Currency Handling

| Project | Currency | Stored As | Display |
|---------|----------|-----------|---------|
| STRAMARK | RON | Bani (÷100) | `value / 100.0` |
| AUUS1 | USD | Full | `value` |
| Zen8 | USD | Full | `value` |

---

## Bước 7: Final Verification Checklist

```
[ ] config/projects/{id}.yaml — ĐẦY ĐỦ thông tin
[ ] BigQuery Dataset tạo xong
[ ] 11 tables tạo xong (ĐẶC BIỆT: product_stock + warehouse_list)
[ ] Dimension tables populated (dim_status_mapping, dim_marketer_mapping)
[ ] SQL Views deploy xong (6 views theo thứ tự)
[ ] N8N workflows: KHÔNG còn __FILL_ placeholder
[ ] N8N workflows: API URL = pos.pages.fm (KHÔNG phải api.poscake.vn)
[ ] N8N BQ nodes: typeVersion = 2.1 (KHÔNG phải 2)
[ ] Stock data pulled + verified > 0
[ ] Customer identity verified (customer_id vs bill_phone_number)
[ ] Status group values verified (success/cancelled, KHÔNG delivered/returned)
[ ] Revenue verified > 0
[ ] marketer-map.ts updated
[ ] Dashboard queries dùng đúng field
[ ] TypeScript compile: 0 errors
[ ] Dashboard: `npm run dev -- --webpack` (KHÔNG dùng Turbopack trên Windows)
[ ] Ads Command Center: FastAPI backend chạy trên port 8000
[ ] Dashboard loads without errors
```

---

## Quick Reference: Common Gotchas

| Gotcha | Hậu quả | Fix |
|--------|---------|-----|
| Quên tạo `product_stock` | Tồn kho = 0 | Tạo bảng + deploy stock_sync |
| Dùng `access_token` thay `api_key` | "Invalid token" | Đổi sang `?api_key=xxx` |
| `customer_id` rỗng | Customers = 1 | Dùng `bill_phone_number` |
| `customer_name` rỗng | Tên = N/A | Dùng `bill_full_name` |
| Filter `status_group = 'delivered'` | 0 results | Dùng `'success'` |
| `shipping_province` rỗng | Chart trống | Dùng `derived_market` |
| N8N còn `__FILL_SHOP_ID__` | Workflow fail | Grep + replace |
| Marketer name variants | Duplicate rows | Update `marketer-map.ts` |
| `revenue_L3_success = 0` | Revenue hiện 0 | Dùng `total_price` + filter |
| `CREATE OR REPLACE VIEW` | View không update | Dùng `DROP + CREATE` |
| Query `vw_stock_levels` | Stock = 0 | Query `product_stock` trực tiếp |
| **BQ node typeVersion = 2** | **Credential error** | **Đổi sang `2.1`** |
| **Turbopack (Windows)** | **Dev server crash** | **Dùng `--webpack` flag** |
| **Thiếu FastAPI backend** | **Ads Command = trống** | **Chạy uvicorn port 8000** |
