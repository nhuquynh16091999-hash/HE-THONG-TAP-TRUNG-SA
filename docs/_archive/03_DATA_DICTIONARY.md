# Data Dictionary — BigQuery Tables & Views

> All data resides in a **single shared BigQuery project** `levelup-465304` across two datasets: `Zen8_Dataset` (raw operational data synced from POS/Ads) and `FAOS_V2` (computed views for agents). Multi-project isolation is achieved via `shop_id` → `project_id` mapping through the `pos_shop_list` table.

## Dataset: Zen8_Dataset

### Order Management

#### sale_order (25,233 rows)
Primary order table synced from Poscake POS. One row per order.

| Column | Type | Description |
|:---|:---|:---|
| order_id | STRING | PK. Unique order ID |
| status | STRING | Order status: new, packing, printed, submitted, shipped, delivered, received_money, returning, returned, canceled, removed |
| total_product_quantity | INT64 | Total items in order |
| currency | STRING | Order currency (SAR, AED, USD...) |
| cod | FLOAT64 | Cash on delivery amount |
| money_to_collect | FLOAT64 | Amount to collect from customer |
| carrier_fee_paid | FLOAT64 | Shipping cost paid to carrier |
| prepaid_amount | FLOAT64 | Amount customer prepaid |
| exchange_amount | FLOAT64 | Exchange/refund amount |
| cod_reconciled | FLOAT64 | COD amount reconciled from carrier |
| reconciliation_date | DATE | Date COD was reconciled |
| tracking_number | STRING | Carrier tracking number |
| shipping_carrier_name | STRING | Carrier name (J&T, Aramex, AJEX...) |
| shipping_carrier_id | STRING | Carrier ID |
| expected_delivery_date | DATE | Expected delivery date |
| customer_id | STRING | FK → customer |
| recipient_name | STRING | Recipient name |
| shipping_address | STRING | Full shipping address |
| district | STRING | District |
| province_city | STRING | Province/City |
| region_code | STRING | Country/region code |
| created_by_id | STRING | User who created the order |
| created_at | DATETIME | Order creation timestamp |
| warehouse_id | STRING | FK → warehouse_list |
| warehouse_name | STRING | Warehouse name |
| order_source_name | STRING | Source (Pancake, Manual...) |
| ads_id | STRING | Associated ad ID |
| ads_source | STRING | Ad source |
| post_id | STRING | Facebook post ID |
| page_name | STRING | Facebook page name |
| page_id | STRING | FK → Page_List |
| marketer | STRING | Marketer name (display name) |
| marketer_id | STRING | Marketer user ID |
| cs_staff | STRING | Customer service staff name |
| cs_staff_id | STRING | CS staff user ID |
| confirming_staff | STRING | Staff who confirmed order |
| customer_type_new_returning | STRING | "new" or "returning" |
| return_reason | STRING | Return reason code |
| return_reason_name | STRING | Return reason description |
| shop_id | STRING | FK → pos_shop_list. **Use this for project isolation** |
| SO_id | STRING | Sale order internal ID |
| shipping_fee_from_customer | FLOAT64 | Shipping fee charged to customer |
| customer_refund | STRING | Refund info |
| last_updated_at | TIMESTAMP | Last sync timestamp |
| merged_at | TIMESTAMP | Merge timestamp |

**Key relationships:**
- `shop_id` → `pos_shop_list.pos_shop_id` → `project_id` (project isolation)
- `customer_id` → `customer.customer_id`
- `page_id` → `Page_List.page_id`
- `warehouse_id` → `warehouse_list.warehouse_id`

---

#### sale_order_line (40,233 rows)
Order line items. One row per product-variant in an order.

| Column | Type | Description |
|:---|:---|:---|
| sale_order_line_id | STRING | PK |
| order_id | STRING | FK → sale_order |
| product_id | STRING | FK → product_template |
| product_display_id | STRING | Product code (e.g. "084") |
| product_name | STRING | Product name (e.g. "084 - Bra Flight Attendants L") |
| product_varient_id | STRING | Variant UUID |
| product_varient_name | STRING | Variant display name |
| quantity | INT64 | Quantity ordered |
| added_to_cart_quantity | INT64 | Cart quantity |
| return_quantity | INT64 | Returned quantity |
| returning_quantity | INT64 | Currently returning quantity |
| total_discount | FLOAT64 | Discount applied |
| total_weight | FLOAT64 | Total weight (grams) |
| shop_id | STRING | FK → pos_shop_list |

---

#### sale_combo (6,501 rows)
Combo/bundle sales tracking.

| Column | Type | Description |
|:---|:---|:---|
| combo_id | STRING | FK → combo_list |
| order_id | STRING | FK → sale_order |
| id | STRING | PK |
| quantity | INT64 | Combo quantity |
| shop_id | STRING | FK → pos_shop_list |

---

### Customer Data

#### customer (5,882 rows)
Customer master data. **Future DataHub source** for cross-project analytics.

| Column | Type | Description |
|:---|:---|:---|
| customer_id | STRING | PK |
| customer_name | STRING | Full name |
| customer_gender | STRING | Gender |
| customer_email | STRING | Email |
| customer_phone | STRING | Phone number |
| customer_birthday | STRING | Date of birth |
| customer_level | STRING | Customer tier/level |
| from_page_id | STRING | Acquisition page |
| from_shop_id | STRING | FK → pos_shop_list |
| succeed_order_count | INT64 | # of successful orders |
| purchased_amount | FLOAT64 | Total purchase amount |
| order_count | INT64 | Total order count |
| currency | STRING | Currency |
| created_at | TIMESTAMP | Customer created date |

---

### Product & Inventory

#### product_template (167 rows)
Product master data from Poscake.

| Column | Type | Description |
|:---|:---|:---|
| product_id | STRING | PK (UUID) |
| product_custom_id | STRING | SKU code (e.g. "009", "KIN") |
| product_name | STRING | Product name |
| create_at | DATE | Creation date |
| product_note | STRING | Notes |
| product_attributes | STRING | JSON attributes |
| shop_id | STRING | FK → pos_shop_list |

#### product_stock (78 rows) — STRAMARK_Dataset
Inventory per variant. Synced daily by `stramark_daily_sync.py`.

> [!IMPORTANT]
> POS source field: `variant.variations_warehouses[].actual_remain_quantity`
> (NOT `stock_quantity` which is always None)
> Prices are already in RON (divided by 100 during sync).

| Column | Type | Description |
|:---|:---|:---|
| product_id | STRING | FK → product_template |
| variation_id | STRING | Variant UUID |
| product_code | STRING | SKU code (e.g. "V09", "D04") |
| product_name | STRING | Product name |
| variation_name | STRING | Variant display name |
| quantity_on_hand | INT64 | Current stock quantity (sum across all warehouses) |
| retail_price | FLOAT64 | Retail price per unit (**RON**, already ÷100) |
| avg_cost | FLOAT64 | Average import cost per unit (**RON**, already ÷100) |
| stock_value | FLOAT64 | qty × avg_cost (**RON**) |
| status | STRING | `in_stock` or `out_of_stock` |
| warehouse_count | INT64 | Number of warehouses holding stock |
| sync_time | STRING | Last sync timestamp |

#### product_cogs (32 rows) — STRAMARK_Dataset
Product cost data. Synced daily by `stramark_daily_sync.py`.

> [!IMPORTANT]
> POS source field: `variant.average_imported_price` (in bani = RON × 100)
> (NOT `imported_price` which is always 0)

| Column | Type | Description |
|:---|:---|:---|
| variation_id | STRING | Variant UUID |
| cost_raw | FLOAT64 | Raw cost from POS (**bani** = RON × 100) |
| cost_ron | FLOAT64 | Cost in RON (cost_raw ÷ 100) |
| source | STRING | Data source (`pos_api`) |
| sync_time | STRING | Last sync timestamp |

#### combo_list (216 rows)
Product combo/bundle definitions.

| Column | Type | Description |
|:---|:---|:---|
| combo_custom_id | STRING | Combo code |
| combo_name | STRING | Combo name |
| combo_id | STRING | PK |
| combo_value | FLOAT64 | Combo price value |
| product_custom_id | STRING | Products in combo |
| shop_id | STRING | FK → pos_shop_list |
| currency_code | STRING | Currency |

#### pos_stock_in-out_history (67,350 rows)
Inventory movement log.

| Column | Type | Description |
|:---|:---|:---|
| warehouse_id | STRING | FK → warehouse_list |
| date | TIMESTAMP | Movement timestamp |
| varient_id | STRING | Product variant UUID |
| change_quantity | INT64 | +incoming / -outgoing |
| remain_quantity | INT64 | Remaining after change |
| actual_remain_quantity | INT64 | Actual remaining |
| order_id | STRING | Associated order (if outgoing) |

#### warehouse_list (9 rows)
Warehouse master data.

| Column | Type | Description |
|:---|:---|:---|
| warehouse_id | STRING | PK |
| custom_id | STRING | Short code |
| warehouse_name | STRING | Name (e.g. "KSA Warehouse") |
| address | STRING | Address |
| country_code | STRING | Country |
| shop_id | STRING | FK → pos_shop_list |

---

### Marketing & Ads

#### fb_ads_data (6,866 rows)
Daily Facebook ad-level performance metrics.

| Column | Type | Description |
|:---|:---|:---|
| ad_id | STRING | PK (with date) |
| ad_name | STRING | Ad name |
| adset_id | STRING | FK → adset_list |
| campaign_id | STRING | FK → campaign_list |
| date | DATE | Reporting date |
| spend | FLOAT64 | Ad spend (ad account currency) |
| reach | INT64 | Unique users reached |
| impressions | INT64 | Total impressions |
| messaging_conversation_started | INT64 | Conversations started (leads) |
| messaging_conversation_replies | INT64 | Replies to conversations |
| cost_per_result | FLOAT64 | Cost per primary result |
| page_id | STRING | Facebook page ID |
| status | STRING | Ad status |

#### fb_campaign_data (389 rows)
Campaign-level data with objectives and budgets.

| Column | Type | Description |
|:---|:---|:---|
| campaign_id | STRING | PK (with date) |
| campaign_name | STRING | Campaign name → parse with name_parser |
| bid_strategy | STRING | Bidding strategy |
| daily_budget | FLOAT64 | Daily budget |
| objective | STRING | Campaign objective |
| spend | FLOAT64 | Total spend |
| account_id | STRING | FK → ads_account |
| date | DATE | Reporting date |

#### ads_account (11 rows)
Meta ad accounts.

| Column | Type | Description |
|:---|:---|:---|
| account_id | STRING | PK (e.g. "act_123") |
| account_name | STRING | Account name |
| project_id | STRING | Project mapping |
| currency_id | STRING | Account currency |
| status | STRING | Account status |

---

### Human Resources & Mapping

#### employee_info (26 rows)
Master employee/team member list.

| Column | Type | Description |
|:---|:---|:---|
| id | STRING | PK |
| name | STRING | Full name |
| project_id | STRING | Associated project |
| role | STRING | Role (marketer, cs, admin) |
| email | STRING | Email |
| poscake_user_id | STRING | Poscake user ID mapping |

#### page-MKT (298 rows)
Facebook Page ↔ Marketer assignment over time.

| Column | Type | Description |
|:---|:---|:---|
| page_id | STRING | Facebook page ID |
| mkt_name | STRING | Marketer name |
| employee_code | STRING | FK → employee_info |
| started_at | DATE | Assignment start |
| end_at | DATE | Assignment end |

#### page-product (76 rows)
Facebook Page ↔ Product assignment.

| Column | Type | Description |
|:---|:---|:---|
| pos_page_id | STRING | POS page ID |
| product_template_display_id | STRING | Product code |
| project_id | STRING | Project |
| market_id | STRING | Market |
| country_code | STRING | Country |

#### pos_shop_list (10 rows)
**Critical mapping table** — links POS shops to projects.

| Column | Type | Description |
|:---|:---|:---|
| pos_shop_id | STRING | PK. Poscake shop ID |
| pos_shop_name | STRING | Shop display name |
| project_id | STRING | Project ID (PIANPHA, ZN8, SRN, TDF) |
| market_id | STRING | Primary market |

**Current mappings:**
| shop_id | Shop Name | project_id | Normalized |
|:---|:---|:---|:---|
| 714234971 | ZEN8-ME | ZN8 | ZN8 |
| 1328205216 | SAUDI | PIANPHA | PIA |
| 1328205226 | KUWAIT | PIANPHA | PIA |
| 1328333296 | Australia | PIANPHA | PIA |
| 1635200759 | UAE | PIANPHA | PIA |
| 100197417 | USA | PIANPHA | PIA |
| 1021271617 | QATAR | PIANPHA | PIA |
| 100293585 | JAPAN | PIANPHA | PIA |
| 407925623 | SORINA-Romania | SRN | SRN |
| 407220179 | TRENDIFY-US | TDF | TDF |

---

### Reports & Aggregated Sources

#### mkter-datasource_v2 (1,378 rows)
Pre-computed marketer daily performance. **Primary source for marketer reporting.**

| Column | Type | Description |
|:---|:---|:---|
| ma_du_an | STRING | Project code |
| ngay | DATE | Date |
| marketer | STRING | Marketer full name |
| ma_nhan_su | STRING | Employee code |
| ma_san_pham | STRING | Product code |
| ten_san_pham | STRING | Product name |
| ma_quoc_gia | STRING | Country code |
| sl_* | INT64 | Order count by status (delivered, shipped, returned, canceled...) |
| rev_* | FLOAT64 | Revenue by status (VND) |
| chi_phi_ads | FLOAT64 | Ads spend (VND) |
| so_lead | INT64 | Number of leads |
| tong_so_mess_toi | INT64 | Total incoming messages |
| impressions | INT64 | Ad impressions |
| reach | INT64 | Ad reach |

#### report-sale-datasource (9,310 rows)
Pre-computed CS (sales) daily performance.

| Column | Type | Description |
|:---|:---|:---|
| sale | STRING | CS staff name |
| employee_code | STRING | Employee code |
| ma_san_pham | STRING | Product code |
| sl_* | INT64 | Order count by status |
| rev_* | INT64 | Revenue by status |
| nguon_don | STRING | Order source |

#### pancake_data (16,396 rows)
Pancake CRM daily inbox metrics per sales person per page.

| Column | Type | Description |
|:---|:---|:---|
| date | DATE | Date |
| page_id | STRING | Facebook page |
| sale_name | STRING | Sales person name |
| data | INT64 | Data points received |
| inbox | INT64 | Total inbox conversations |

---

## Dataset: FAOS_V2 (Computed Views)

#### vw_daily_pnl (768 rows)
Daily Profit & Loss per project per market.

| Column | Type | Description |
|:---|:---|:---|
| date | DATE | Date |
| project_id | STRING | Project |
| market | STRING | Market code |
| order_revenue | FLOAT64 | Revenue from ordered |
| collected_revenue | FLOAT64 | Revenue from delivered/collected |
| returned_revenue | FLOAT64 | Revenue lost to returns |
| ads_spend | FLOAT64 | Facebook ads spend |
| total_orders | INT64 | Total orders placed |
| delivered_orders | INT64 | Successfully delivered |
| returned_orders | INT64 | Returned orders |
| messages | INT64 | Inbox messages |
| ffm_cost | FLOAT64 | Fulfillment cost |
| gross_profit | FLOAT64 | Gross profit |
| roas_order | FLOAT64 | ROAS on orders |
| roas_collected | FLOAT64 | ROAS on collected |
| return_rate | FLOAT64 | Return rate % |

#### vw_true_roas (8,941 rows)
Ad-level True ROAS (connecting ad spend to actual order revenue).

| Column | Type | Description |
|:---|:---|:---|
| ad_id | STRING | Ad identifier |
| ad_name | STRING | Ad name |
| date | DATE | Date |
| project_id | STRING | Project |
| spend | FLOAT64 | Ad spend |
| order_revenue | FLOAT64 | Revenue from orders |
| collected_revenue | FLOAT64 | Revenue collected |
| returned_revenue | FLOAT64 | Revenue returned |
| roas_order | FLOAT64 | ROAS on orders |
| roas_collected | FLOAT64 | ROAS on collected |
| return_rate | FLOAT64 | Return rate |
| total_ffm_cost | FLOAT64 | FFM cost |
| total_cod_cost | FLOAT64 | COD collection cost |
| marketer | STRING | Marketer name |
| market | STRING | Market |

#### vw_marketer_performance
Marketer performance aggregation.

| Column | Type | Description |
|:---|:---|:---|
| marketer | STRING | Marketer name |
| project_id | STRING | Project |
| date | DATE | Date |
| ads_spend | FLOAT64 | Total spend |
| order_revenue | FLOAT64 | Order revenue |
| collected_revenue | FLOAT64 | Collected revenue |
| total_orders | INT64 | Orders |
| delivered_orders | INT64 | Delivered |
| returned_orders | INT64 | Returned |
| return_rate | FLOAT64 | Return % |
| roas_on_order | FLOAT64 | ROAS |
| market | STRING | Market |
| total_ffm_cost | FLOAT64 | FFM cost |
| total_cod_cost | FLOAT64 | COD cost |

---

## Key Queries for Common Use Cases

### 1. Get orders for a specific project today
```sql
SELECT o.*
FROM `Zen8_Dataset.sale_order` o
JOIN `Zen8_Dataset.pos_shop_list` s ON o.shop_id = s.pos_shop_id
WHERE s.project_id = 'ZN8'
  AND DATE(o.created_at) = CURRENT_DATE()
```

### 2. Product P&L (requires product_cogs table)
```sql
SELECT
  sol.product_display_id,
  sol.product_name,
  SUM(sol.quantity) as qty_sold,
  SUM(o.cod) as revenue,
  SUM(sol.quantity * c.cost_price) as cogs,
  SUM(o.cod) - SUM(sol.quantity * c.cost_price) as gross_margin
FROM `Zen8_Dataset.sale_order_line` sol
JOIN `Zen8_Dataset.sale_order` o ON sol.order_id = o.order_id
LEFT JOIN `Zen8_Dataset.product_cogs` c ON sol.product_id = c.product_id
WHERE o.status = 'delivered'
GROUP BY 1, 2
```

### 3. CS Conversion Rate
```sql
SELECT
  p.sale_name as cs_staff,
  SUM(p.inbox) as total_inbox,
  COUNT(DISTINCT o.order_id) as orders_created,
  SAFE_DIVIDE(COUNT(DISTINCT o.order_id), SUM(p.inbox)) as conversion_rate
FROM `Zen8_Dataset.pancake_data` p
LEFT JOIN `Zen8_Dataset.sale_order` o
  ON p.sale_name = o.cs_staff AND p.date = DATE(o.created_at)
WHERE p.date = CURRENT_DATE()
GROUP BY 1
ORDER BY conversion_rate DESC
```

### 4. Carrier Performance
```sql
SELECT
  shipping_carrier_name,
  COUNT(*) as total_orders,
  COUNTIF(status = 'delivered') as delivered,
  COUNTIF(status IN ('returned', 'returning')) as returned,
  SAFE_DIVIDE(COUNTIF(status IN ('returned','returning')), COUNT(*)) as return_rate,
  AVG(carrier_fee_paid) as avg_carrier_fee
FROM `Zen8_Dataset.sale_order`
WHERE created_at >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
GROUP BY 1
ORDER BY total_orders DESC
```
