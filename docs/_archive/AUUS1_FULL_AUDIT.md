# 🔍 AUUS1 — FULL PROJECT AUDIT
> **Date**: 2026-02-20 23:55 ICT  
> **Scope**: BigQuery · n8n · Frontend · Backend · Config · Docs

---

## 📊 Executive Summary

| Layer | Status | Critical Issues | Warnings |
|-------|--------|:-:|:-:|
| BigQuery Tables | ⚠️ | 1 | 3 |
| BigQuery Views | ✅ | 0 | 1 |
| n8n Workflows | 🚨 | 2 | 3 |
| Frontend | ⚠️ | 0 | 3 |
| Config & Security | 🚨 | 2 | 1 |
| Documentation | ⚠️ | 0 | 2 |

---

## 1. 📦 BigQuery — Database Layer

### 1.1 Tables Inventory (14 tables)

| Table | Rows | Size | Status |
|-------|-----:|-----:|--------|
| `sale_order` | 3,763 | 6.25 MB | ✅ Clean |
| `order_items` | 3,956 | 0.95 MB | ✅ Clean |
| `fb_ads_data` | 2,686 | 0.54 MB | ✅ Clean |
| `fb_campaign_data` | 95 | 0.01 MB | ✅ |
| `product_template` | 30 | <0.01 MB | ⚠️ AU only |
| `product_variations` | 30 | 0.01 MB | ✅ |
| `product_stock` | **0** | 0 | 🚨 **EMPTY** |
| `dim_status_mapping` | 12 | <0.01 MB | ✅ |
| `cost_exchange_rates` | 5+ | <0.01 MB | ✅ |
| `page_marketer` | 2 | <0.01 MB | ✅ |
| `staging_sale_order` | 0 | 0 | ✅ Staging |
| `staging_order_items` | 0 | 0 | ✅ Staging |
| `fb_adset_data` | 0 | 0 | ⚠️ Unused |
| `raw_facebook_campaigns` | 0 | 0 | ⚠️ Unused |

### 1.2 Views Inventory (28 views)

| Category | Views | Status |
|----------|-------|--------|
| **Core** (used by dashboard) | `fact_order_items_dedup`, `vw_fact_orders`, `vw_fact_ads_performance` | ✅ Working |
| **Marts** (analytics) | `mart_performance_master`, `mart_market_intelligence`, `mart_product_insights`, `vw_fact_daily_pnl_v2` | ✅ Working |
| **Legacy/Dashboard** | `vw_dashboard_*` (7 views), `vw_daily_pnl`, `vw_true_roas`, etc. | ⚠️ Possibly unused |

### 1.3 Data Quality Issues

> [!CAUTION]
> **231 orders have NO matching items** — `sale_order` rows with no corresponding `order_items`. This affects revenue calculations when using item-level joins.

> [!WARNING]
> **56 "success" orders have $0 revenue** — Orders marked as delivered but with zero `revenue_L3_success`. Possible cause: COD=0 or data entry issue.

> [!WARNING]
> **`product_stock` table is EMPTY** — Stock Intelligence tab and n8n Stock Intelligence workflow will return no data.

> [!NOTE]
> **`product_template` only has AU shop data (30 rows)** — US products are matched via REGEX SKU extraction from `variation_name`. This is a workaround, not a permanent solution.

### 1.4 Data Freshness

| Table | Latest Record |
|-------|--------------|
| `fb_ads_data` | 2026-02-20 ✅ |
| `sale_order` | 2026-02-14 ⚠️ 6 days old |
| `order_items` | 2026-02-14 ⚠️ 6 days old |
| `product_template` | 2026-02-14 ⚠️ 6 days old |

### 1.5 Dedup Status
✅ All tables clean — 0 duplicates across `fb_ads_data`, `sale_order`, `order_items`, `product_template`  
✅ `[AUU] 06 Auto Dedup` workflow active — runs every 4 hours

---

## 2. ⚙️ n8n — Workflow Layer

### 2.1 Workflow Inventory

| Workflow | Active | Credential Status |
|----------|:------:|-------------------|
| `[AUU] 01 POS Full Sync` | 🔴 ×4 copies | 🚨 All placeholder |
| `[AUU] 02 Ads Sync` | 🟢 ×3 copies | 🚨 All placeholder |
| `[AUU] 03 CS Performance` | 🔴 ×2 copies | 🚨 All placeholder |
| `[AUU] 04 Logistics Monitor` | 🔴 ×2 copies | 🚨 All placeholder |
| `[AUU] 05 Stock Intelligence` | 🔴 ×3 copies | 🚨 All placeholder |
| `[AUU] 06 Auto Dedup` | 🟢 ×1 | 🚨 Placeholder |

### 2.2 Critical Issues

> [!CAUTION]
> **ALL credentials are PLACEHOLDERS** — Every n8n node uses `__CREDENTIAL_ID_BQ__`, `__CREDENTIAL_ID_AUU_META__`, `__CREDENTIAL_ID_AUU_POSCAKE__`. This means:
> - **02 Ads Sync**: Cannot actually fetch from Meta API (will fail on first execution)
> - **06 Auto Dedup**: Cannot actually query BigQuery (will fail)
> - **01 POS Full Sync**: Cannot fetch orders from Poscake
>
> **Action**: Map real credential IDs in n8n UI for each node.

> [!CAUTION]
> **14 DUPLICATE workflows deployed** — Each deploy creates NEW workflows instead of updating existing ones. There are 2-4 copies of each workflow, causing confusion.
>
> **Action**: Delete duplicate workflows, keep only the latest version of each.

> [!WARNING]
> **No execution history** — Neither `02 Ads Sync` nor `06 Auto Dedup` have ever executed successfully. They are "active" but will fail due to placeholder credentials.

### 2.3 Recommendations
1. **Map real credentials** in n8n UI (BigQuery SA, Meta Ads API, Poscake API)
2. **Delete duplicate workflows** — keep only 1 copy of each
3. **Test manually** — trigger each workflow once and verify data flows
4. **Update deploy script** — use `PUT` to update existing workflows instead of `POST` to create new ones

---

## 3. 🖥️ Frontend — Dashboard Layer

### 3.1 Tab Inventory (14 tabs)

| Tab | File | Size | Status |
|-----|------|-----:|--------|
| CEO Intelligence | `ceo-overview-tab.tsx` | 36.7KB | ✅ Fixed (product names) |
| Marketing & Ads | `marketing-tab.tsx` | 47.7KB | ✅ Updated (new metrics) |
| Products & Inventory | `products-tab.tsx` | 32.3KB | ✅ Fixed (AU+US) |
| Customer | `customer-tab.tsx` | 28.1KB | ✅ |
| Marketer Performance | `marketer-perf-tab.tsx` | 20.3KB | ✅ |
| Market Intelligence | `market-intel-tab.tsx` | 19.7KB | ✅ |
| Token Cost | `token-cost-tab.tsx` | 19.8KB | ✅ |
| Product P&L | `product-pnl-tab.tsx` | 16.4KB | ✅ |
| Ads Command Center | `ads-command-tab.tsx` | 14.6KB | ✅ |
| P&L | `pnl-tab.tsx` | 14.5KB | ✅ |
| Overview | `overview-tab.tsx` | 12.9KB | ✅ |
| Inventory (Stock) | `inventory-tab.tsx` | 11.7KB | ⚠️ No data (product_stock empty) |
| Executive Report | `executive-report-tab.tsx` | 11.5KB | ✅ |
| Assistant (AI) | `assistant-tab.tsx` | 5.1KB | ✅ |

### 3.2 Frontend Risks

> [!WARNING]
> **All SQL queries run client-side** → BigQuery API key is exposed in browser. Any user can see the full dataset name, project ID, and query patterns. This is acceptable for internal dashboards but NOT for public-facing apps.

> [!WARNING]
> **No error boundaries** per tab — If one query fails, the entire tab may crash without a clear error message.

> [!WARNING]
> **Hardcoded dataset** (`AUUS1_Dataset`) — The dataset name is hardcoded throughout all tab files. Multi-project support requires refactoring.

---

## 4. 🔐 Config & Security

### 4.1 Critical Security Issues

> [!CAUTION]
> **API keys/secrets in YAML config** — `AUUS1.yaml` contains:
> - Meta `app_secret`: `6d6757...`
> - Meta `access_token`: `EAAM3C...`
> - Poscake API keys: `0fe51f...`, `9ab77b...`
> - Discord webhook URLs
>
> **Risk**: If this file is committed to Git or shared, all credentials are exposed.

> [!CAUTION]
> **`.env` contains multiple project credentials** — Both STRAMARK and AUUS1 tokens are in the same `.env` file. The Meta access token expires ~2026-04-16.

### 4.2 Config Completeness

| Config Area | Status |
|-------------|--------|
| BigQuery project/dataset | ✅ Correct |
| Meta Ads accounts | ⚠️ `act_1093049475876128` noted as inaccessible |
| Poscake shops (US + AU) | ✅ Configured |
| Exchange rates | ✅ Updated (2026-02-20) |
| Product costs (COGS) | 🚨 **MISSING** — `products: []` |
| Google Sheets links | ⚠️ Empty |
| Discord webhooks | ✅ Set |
| KPI targets | ✅ ROAS > 5.0 |

---

## 5. 📚 Documentation

### 5.1 Doc Coverage

| Document | Relevant | Up-to-date |
|----------|:--------:|:----------:|
| `00_SYSTEM_OVERVIEW.md` | ✅ | ⚠️ |
| `02_DATABASE_MASTER_SPEC.md` | ✅ | ⚠️ Missing new columns |
| `03_DATA_DICTIONARY.md` | ✅ | ⚠️ Missing new columns |
| `05_N8N_WORKFLOWS.md` | ✅ | ⚠️ Missing 06 Dedup |
| `07_OPERATIONS_RUNBOOK.md` | ✅ | ⚠️ |
| `15_AUUS1_PRE_GOLIVE_GUIDE.md` | ✅ | ✅ |
| `AUDIT_REPORT_DB_N8N.md` | ✅ | ❌ Outdated |

---

## 6. 🎯 Risk Matrix

| # | Risk | Severity | Probability | Impact | Mitigation |
|---|------|:--------:|:-----------:|--------|------------|
| 1 | **n8n credentials are placeholders** — workflows active but will FAIL | 🔴 Critical | 100% | Ads data not syncing | Map real credential IDs in n8n UI |
| 2 | **14 duplicate n8n workflows** | 🟠 High | Already present | Confusion, wrong workflow activated | Delete duplicates, keep latest |
| 3 | **COGS data missing** — `products: []` | 🟠 High | 100% | P&L margins always 0% | Import product costs from Google Sheet |
| 4 | **product_stock empty** | 🟠 High | 100% | Inventory tab shows nothing | Run POS stock sync |
| 5 | **Meta token expiry ~2026-04-16** | 🟡 Medium | 100% (in 55d) | Ads sync stops | Set calendar reminder, renew token |
| 6 | **POS data 6 days stale** (last sync Feb 14) | 🟡 Medium | Already present | Dashboard shows old data | Activate POS Full Sync with real credentials |
| 7 | **231 orders without items** | 🟡 Medium | Already present | Revenue mismatch at item level | Investigate + re-sync missing items |
| 8 | **56 success orders with $0 revenue** | 🟡 Medium | Already present | Understated revenue | Check COD values for these orders |
| 9 | **Credentials in YAML** | 🟡 Medium | If file shared | Full API access exposed | Move to .env, use env vars |
| 10 | **ad account inaccessible** (`act_1093...`) | 🟡 Medium | Already present | Partial ads data | Verify account permissions |
| 11 | **Client-side BigQuery queries** | 🟢 Low | Internal tool | Dataset exposed in browser | Acceptable for internal use |
| 12 | **No automated testing** | 🟢 Low | On any change | Regressions possible | Add basic integration tests |

---

## 7. ✅ Action Items (Priority Order)

### P0 — Do Now
- [ ] **Map n8n credentials** — Replace `__CREDENTIAL_ID_BQ__` and `__CREDENTIAL_ID_AUU_META__` with real IDs
- [ ] **Delete duplicate n8n workflows** — Keep only latest copy of each `[AUU]` workflow
- [ ] **Trigger test execution** of `02 Ads Sync` and `06 Auto Dedup` after credential mapping

### P1 — This Week
- [ ] **Re-sync POS data** — Activate `01 POS Full Sync` with real Poscake credentials
- [ ] **Import COGS** — Populate `products` array in AUUS1.yaml or via Google Sheet
- [ ] **Investigate 231 orders without items** — May need re-sync from Poscake
- [ ] **Fix 56 success orders with $0 revenue** — Check if COD field is populated

### P2 — Next Sprint
- [ ] **Move credentials from YAML to .env** — AUUS1.yaml should reference env vars, not raw keys
- [ ] **Update deploy_n8n.py** to use PUT update instead of POST create (prevent duplicates)
- [ ] **Update docs** — Add new columns to `02_DATABASE_MASTER_SPEC.md`, add `06 Dedup` to `05_N8N_WORKFLOWS.md`
- [ ] **Set Meta token renewal calendar** for 2026-04-10 (6 days before expiry)
- [ ] **Verify `act_1093049475876128`** — Check if this ad account is still accessible

### P3 — Nice to Have
- [ ] Clean up empty/unused tables: `fb_adset_data`, `raw_facebook_campaigns`, `raw_pos_orders`, `sale_combo`
- [ ] Remove legacy `vw_dashboard_*` views if not used
- [ ] Add error boundaries per dashboard tab
- [ ] Add basic integration tests for SQL views
