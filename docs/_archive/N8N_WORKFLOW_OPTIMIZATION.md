# N8N WORKFLOW OPTIMIZATION SPEC — FAOS

> **Source:** `config/tl.docx` (36 workflows documented) + current FAOS implementation
> **Date:** 2026-02-15
> **Goal:** Identify gaps, fix integration issues, and optimize n8n ETL for the definitive database

---

## 1. Current vs Required Workflow Matrix

### Legend
- ✅ = Exists and OK
- ⚠️ = Exists but NEEDS FIX
- 🔴 = MISSING — Must Create
- 🟡 = OPTIONAL (nice to have)

| # | Workflow Name | Dev (tl.docx) | Our FAOS | Status | Fix Required |
|---|---|---|---|---|---|
| **1** | **Lấy đơn hàng (Order Sync)** | ✅ staging→merge | ⚠️ WRITE_APPEND | ⚠️ FIX | Change target to `staging_sale_order` |
| **2** | **POS_webhook (Realtime orders)** | ✅ webhook→staging | ⚠️ WRITE_APPEND | ⚠️ FIX | Change target to `staging_sale_order` |
| **3** | **Order Items Sync** | ✅ part of order sync | ⚠️ WRITE_APPEND | ⚠️ FIX | Change target to `staging_order_items` |
| **4** | **Merge Staging → Main** | ✅ after each sync | 🔴 MISSING | 🔴 CREATE | Run `merge_staging_orders.sql` after sync |
| **5** | Lấy DS_ads chung | ✅ Cron, delete+insert | ✅ Same | ✅ OK | |
| **6** | Sub_Lấy DS_ads chung | ✅ Sub-workflow | ✅ Same | ✅ OK | |
| **7** | Lấy DS_adset chung | ✅ Cron, delete+insert | ✅ Same | ✅ OK | |
| **8** | Lấy DS_campaign chung | ✅ Cron, delete+insert | ✅ Same | ✅ OK | |
| **9** | **Lấy dữ liệu ads TKQC chi tiêu** | ✅ ad-level daily | ✅ Same | ✅ OK | |
| **10** | **Lấy dữ liệu adset TKQC** | ✅ adset-level daily | 🔴 MISSING | 🔴 CREATE | Clone ads workflow, change level=adset |
| **11** | Update DS TKQC lên BQ | ✅ ads_account sync | ✅ Same | ✅ OK | |
| **12** | Lấy danh sách combo | ✅ combo_list sync | ✅ Same | ✅ OK | |
| **13** | **Combo → Order mapping** | ✅ part of order sync | 🔴 MISSING | 🔴 CREATE | Extract combo JSON from order response |
| **14** | Lấy SP từ Poscake | ✅ product sync | ✅ Same | ✅ OK | |
| **15** | Lấy tồn kho sản phẩm | ✅ stock sync | ✅ Same | ✅ OK | |
| **16** | Lấy poscake_page | ✅ page list sync | ✅ Same | ✅ OK | |
| **17** | **Page-MKT mapping sync** | ✅ Google Sheet→BQ | 🔴 MISSING | 🔴 CREATE | Weekly Sheet→page_marketer table |
| **18** | MKT Report (Discord) | ✅ Daily report | ✅ Same | ✅ OK | |
| **19** | Push Sale_KPIs | ✅ Sheet→BQ | 🟡 Optional | 🟡 | Phase 2 |
| **20** | Webhook_Update đơn hàng | ✅ webhook→staging | ⚠️ WRITE_APPEND | ⚠️ FIX | Target → staging |

---

## 2. Critical Fixes (Must Do)

### Fix 1: Order Sync → Staging Pattern
**Current:** n8n writes directly to `sale_order` with WRITE_APPEND → 8x duplication
**Fix:** Change BigQuery node target table to `staging_sale_order`

```
BEFORE:
n8n Poscake API → BigQuery INSERT → sale_order (WRITE_APPEND)
                                     ↑ duplicates accumulate

AFTER:
n8n Poscake API → BigQuery INSERT → staging_sale_order (WRITE_APPEND is OK here)
                                     ↓
              n8n Schedule Trigger → Execute merge_staging_orders.sql
                                     ↓
                                  sale_order (clean, deduped)
```

**n8n Implementation Steps:**
1. Open workflow "[MãDA]-Lấy đơn hàng hàng ngày"
2. Find the BigQuery node that writes to `sale_order`
3. Change table name to `staging_sale_order`
4. Add a new workflow/sub-workflow: "Merge Staging"
   - Trigger: Schedule (runs 5 min after order sync)
   - Node 1: BigQuery Execute Query → Run contents of `merge_staging_orders.sql` (Part 1)
   - Node 2: BigQuery Execute Query → Run contents of `merge_staging_orders.sql` (Part 2)
5. Same for `order_items` → `staging_order_items`

### Fix 2: POS Webhook → Staging
**Current:** POS webhook writes directly to `sale_order`
**Fix:** Change target to `staging_sale_order`, merge runs on schedule

**n8n Implementation:**
1. Open workflow "POS_webhook" / "Webhook_Update đơn hàng"
2. Change BigQuery target table from `sale_order` to `staging_sale_order`
3. No other changes needed — merge workflow handles dedup

### Fix 3: Create `fb_adset_data` Sync Workflow
**New workflow needed.** Clone from existing "Lấy dữ liệu ads TKQC chi tiêu" with these changes:

```
Workflow Name: [MãDA]-Lấy dữ liệu adset TKQC chi tiêu
Trigger: Cron (daily, same schedule as ads data)

Changes from ads workflow:
1. HTTP Request node: Change level=ad → level=adset in API URL
2. Fields: adset_id, adset_name, spend, impressions, reach, clicks, 
           cpm, cpc, ctr, campaign_id, campaign_name, account_id
3. BigQuery node: Target table = fb_adset_data
4. Delete pattern: Same date range delete-before-insert
```

**Meta API endpoint:**
```
GET https://graph.facebook.com/v21.0/{ad_account_id}/insights
?level=adset
&fields=adset_id,adset_name,spend,impressions,reach,clicks,cpm,cpc,ctr,campaign_id,campaign_name,account_id
&time_range={"since":"YYYY-MM-DD","until":"YYYY-MM-DD"}
&time_increment=1
&limit=500
```

---

## 3. New Workflows to Create

### Workflow A: Merge Staging (Critical)
```
Name: [MãDA]-Merge-Staging
Trigger: Schedule (every 30 min, or right after order sync)
 
Node 1: BigQuery Execute Query
  SQL: DELETE FROM sale_order WHERE CONCAT(id,'|',shop_id) IN 
       (SELECT CONCAT(id,'|',shop_id) FROM staging_sale_order)
       
Node 2: BigQuery Execute Query
  SQL: INSERT INTO sale_order SELECT * FROM staging_sale_order
  
Node 3: BigQuery Execute Query
  SQL: TRUNCATE TABLE staging_sale_order

Node 4-6: Same for order_items (staging_order_items)

Node 7: Discord Webhook
  Message: "✅ Staging merge complete. Orders: {count}, Items: {count}"
```

### Workflow B: Adset Data Sync (Critical)
Clone from ads data workflow, change `level=ad` → `level=adset`, target table `fb_adset_data`.

### Workflow C: Page-Marketer Sync (Medium)
```
Name: [MãDA]-Sync-Page-Marketer
Trigger: Schedule (weekly)

Node 1: Google Sheets (Read page-marketer mapping sheet)
Node 2: Set node (transform columns to match page_marketer schema)
Node 3: BigQuery WRITE_TRUNCATE → page_marketer table
Node 4: Discord notification
```

### Workflow D: Combo Extraction (Medium)
```
Name: [MãDA]-Extract-Combo-Data
Trigger: Part of order sync (or separate cron)

Logic:
1. For each synced order, check if order has combo data in response
2. Extract combo_id, combo_name, quantity, value
3. Write to sale_combo table
4. Separately: Google Sheet for combo_items config → BQ

Note: Combo items (which product gets revenue) is a CONFIG table,
      managed by project team via Google Sheet, NOT API-synced.
```

---

## 4. Optimization Recommendations

### 4.1 Token Expiry (from tl.docx: "Access Token max 2 tháng")

**Current issue:** FB token expired → only 2 days of ads data in STRAMARK
**Dev solution (tl.docx):** "Cần định kỳ tạo access token mới"

**Recommended n8n implementation:**
```
Workflow: Token-Health-Check
Trigger: Daily at 8am

Node 1: HTTP Request → GET /me?access_token={token}
Node 2: IF error → Discord alert "⚠️ FB TOKEN EXPIRED — renew now"
Node 3: IF success → Check token_info.data_access_expires_at
Node 4: IF < 7 days remaining → Discord warning "🟡 Token expires in {N} days"
```

### 4.2 Rate Limiting (from tl.docx: "wait 60 phút khi bị limit")

**n8n implementation:**
- In sub-workflows that call FB API, add error handling:
  - IF HTTP 429 → Wait 60 min → Retry (max 3 retries)
  - Log rate limit events to Discord
  
### 4.3 Pagination (from tl.docx: "dùng Pagination để xử lý lấy toàn bộ")

**Already implemented in most workflows.** Verify:
- ads/adset/campaign list workflows use cursor-based pagination
- Product list uses offset pagination
- Orders use date-range pagination

### 4.4 Delete-Before-Insert Pattern

**All FB data workflows should use this pattern:**
```
Step 1: BigQuery DELETE FROM fb_*_data WHERE date BETWEEN '{start}' AND '{end}'
Step 2: HTTP GET FB API for date range
Step 3: BigQuery INSERT INTO fb_*_data
```

This prevents duplicates without needing staging tables (FB data is date-keyed).

### 4.5 Webhook Dedup (from tl.docx: "1 Webhook duy nhất cho tất cả shops")

**Current:** Single POS webhook for all shops
**Best practice:** 
- Webhook writes to `staging_sale_order` (not direct)
- Include `shop_id` in header for routing
- Merge workflow handles dedup

---

## 5. Workflow Schedule Summary

| Time | Workflow | Frequency |
|---|---|---|
| Every 15min | POS Webhook → staging_sale_order | Real-time |
| Every 30min | Merge Staging → sale_order | Automated |
| 00:00 daily | Order batch sync → staging | Backfill |
| 01:00 daily | FB ads data sync (delete+insert) | Daily |
| 01:30 daily | FB adset data sync (delete+insert) | NEW |
| 02:00 daily | FB campaign data sync | Daily |
| 06:00 daily | Product/stock sync (truncate+insert) | Daily |
| 08:00 daily | Token health check | Daily |
| 09:00 daily | MKT Report (Discord) | Daily |
| Weekly Sun | Page-marketer sync (Sheet→BQ) | Weekly |
| Weekly Sun | Combo items sync (Sheet→BQ) | Weekly |
| Weekly Sun | Ads/adset/campaign list sync | Weekly |

---

## 6. Data Completeness Checklist

After all workflows are running, verify:

| Table | Expected Data | Check Query |
|---|---|---|
| `sale_order` | 2000+ rows, 0 duplicates | `SELECT COUNT(*), COUNT(DISTINCT CONCAT(id, shop_id)) FROM sale_order` |
| `order_items` | 2900+ rows, 0 duplicates | Same pattern |
| `fb_ads_data` | 90+ days of data | `SELECT MIN(date), MAX(date), COUNT(*) FROM fb_ads_data` |
| `fb_adset_data` | 90+ days of data | Same pattern |
| `page_marketer` | 1+ rows per active page | `SELECT COUNT(*) FROM page_marketer WHERE is_active` |
| `sale_combo` | Rows for combo orders | `SELECT COUNT(*) FROM sale_combo` |
| `combo_items` | All combos mapped | `SELECT cl.combo_id FROM combo_list cl LEFT JOIN combo_items ci ON cl.combo_id = ci.combo_id WHERE ci.combo_id IS NULL` |
