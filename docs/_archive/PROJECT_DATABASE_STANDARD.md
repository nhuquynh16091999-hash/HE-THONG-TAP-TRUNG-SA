# FAOS Database Standard & Onboarding Guide

> **Version**: 2.0 (2026-02-14)
> **Status**: Production Standard
> **Owner**: Data Architecture Team

This document defines the **standard database architecture** for all new projects onboarding to the FAOS system. All new projects MUST follow this structure to ensure compatibility with the Agentic Workflow, automated reporting, and cross-project analytics.

---

## 1. Dataset Architecture

### Naming Convention
Every project gets its own dedicated BigQuery dataset.
- **Format**: `[PROJECT_CODE]_Dataset`
- **Example**: `STRAMARK_Dataset`, `AUUS1_Dataset`, `ZEN8_Dataset`
- **Location**: `US` (Required for cross-project queries)

### Table Types
Each dataset contains **3 layers** of data:
1. **Raw Tables**: Data synced directly from source (Poscake, Meta, Tikok).
2. **Dimension Tables**: Reference data (products, exchange rates, status mapping).
3. **Analytical Views**: Business logic layer (formatted as `vw_fact_*`).

---

## 2. Standard Schema (Must-Have Tables)

### A. Raw Data (Transactional)

| Table Name | Source | Description | Update Strategy |
|---|---|---|---|
| `sale_order` | Poscake API | Orders, status, customer info | Dedup (Latest by `sync_time`) |
| `order_items` | Poscake API | Product details per order | Dedup (Latest by `sync_time`) |
| `fb_ads_data` | Meta API | Ad spend, impressions, clicks | Dedup (Daily snapshot) |
| `tiktok_ads_data` | TikTok API | Ad spend, impressions, clicks | Dedup (Daily snapshot) |
| `customers` | Poscake API | CRM data | Dedup (Latest by `sync_time`) |

### B. Reference Data (Configuration)

| Table Name | Source | Description |
|---|---|---|
| `dim_shop_project` | Config | Maps Shop ID → Project, Market, Currency |
| `dim_status_mapping` | Config | Unified status (New, Processing, Delivered, Returned, Cancelled, Loss) |
| `dim_marketer` | Config | Maps Marketer Code → Full Name (Team allocation) |
| `product_template` | Poscake | Master product list |
| `product_variations` | Poscake | Price, COGS, Weight |

### C. Cost Data (Input)

| Table Name | Description |
|---|---|
| `cost_exchange_rates` | Currency conversion rates (e.g., RON → USD) |
| `cost_ffm_fees` | 3PL & Fulfillment fees per market |
| `cost_fixed` | Fixed OpEx (Salaries, Rent, Tools) |
| `cost_shipping` | Shipping cost matrix (Warehouse → Market) |

---

## 3. Standard Analytical Views

Do not query raw tables for reporting. Use these standard views:

### `vw_fact_orders`
- **Purpose**: Clean order list with standardized status and currency.
- **Key Logic**: 
  - Joins `sale_order` + `dim_status_mapping` + `dim_marketer`
  - Normalizes currency to project base currency

### `vw_fact_ads_performance`
- **Purpose**: Ad-level performance with Dual Attribution.
- **Key Logic**: 
  - **Match 1 (Mess Ads)**: `order.ad_id == fb.ad_id`
  - **Match 2 (Web Ads)**: `order.adset_id == fb.adset_id` (fallback)
  - Calculates `ROAS`, `CPA`
  - Decisions: `KILL` (<1.5), `MONITOR` (1.5-3.0), `SCALE` (>3.0)

### `vw_fact_daily_pnl_v2`
- **Purpose**: Financial P&L Breakdown per day.
- **Logic**: Revenue - COGS - Ads - Shipping - FFM - Fixed Costs = **Net Profit**

### `vw_fact_product_perf`
- **Purpose**: Product-level margin analysis.
- **Logic**: Sales - Returns - COGS = **Gross Product Profit**

### `vw_fact_marketer_perf`
- **Purpose**: Team performance scoreboard.

---

## 4. Onboarding Checklist for New Project

When adding a new project (e.g. `PROJECT_X`), follow these steps:

### Step 1: Create Dataset
1. Create BQ Dataset `PROJECT_X_Dataset` (Location: `US`).
2. Run standard DDL script: [`create_poscake_tables.sql`](../sql/tables/create_poscake_tables.sql).

### Step 2: Configure Dimensions
1. Add entry to `dim_shop_project`:
   ```sql
   INSERT INTO `PROJECT_X_Dataset.dim_shop_project` 
   VALUES ('SHOP_ID', 'PROJECT_X', 'Pro X', 'US', 'USA', 'USD', 1, 'poscake', 'America/New_York', TRUE);
   ```
2. Populate `dim_status_mapping` (Standard static values).

### Step 3: Configure Costs
1. Insert `cost_exchange_rates` (if not USD).
2. Insert `cost_fixed` (Monthly budget).
3. Insert `cost_shipping` & `cost_ffm_fees` (Courier rates).

### Step 4: Setup Sync
1. Configure `full_sync.py` with Shop ID & API Key.
2. Enable **Anti-Duplicate Procedure**:
   ```sql
   CREATE OR REPLACE PROCEDURE `PROJECT_X_Dataset.sp_dedup_all`() ...
   ```

### Step 5: Deploy Views
1. Run standard View DDLs (replace `PROJECT_ID` with `PROJECT_X`).

---

## 5. Maintenance & Quality Control

- **Anti-Duplication**: Always run `sp_dedup_all()` after sync.
- **Schema Changes**: Never change raw tables without updating views.
- **Timestamps**: Always enforce `inserted_at` (String) and `sync_time` (Timestamp).
