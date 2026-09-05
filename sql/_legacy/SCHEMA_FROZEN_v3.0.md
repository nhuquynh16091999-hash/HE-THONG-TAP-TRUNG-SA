# ═══════════════════════════════════════════════════════════════
# 🔒 DATABASE SCHEMA — FROZEN at v3.0
# ═══════════════════════════════════════════════════════════════
#
# Frozen date: 2026-02-15T22:40:00+07:00
# Previous version: v2.0 (2026-02-15T21:37:42)
# Git tag: db-architecture-v3.0-FROZEN (create after commit)
#
# ═══════════════════════════════════════════════════════════════
# ⛔ CÁC FILE SAU ĐÂY KHÔNG ĐƯỢC SỬA NẾU THIẾU REVIEW:
# ═══════════════════════════════════════════════════════════════
#
# DDL (Table Schemas):
#   sql/tables/create_poscake_tables.sql     — 5 core tables
#   sql/tables/create_dim_tables.sql         — 5 dim tables
#   sql/tables/create_staging_tables.sql     — 2 staging tables
#   sql/tables/create_reference_tables.sql   — 4 reference tables
#
# Merge Logic:
#   sql/stramark/merge_staging_orders.sql    — staging→main merge
#
# Master Spec:
#   docs/DATABASE_MASTER_SPEC.md             — single source of truth
#
# ═══════════════════════════════════════════════════════════════
# ✅ CÁC FILE SAU ĐÂY ĐƯỢC PHÉP CẬP NHẬT (additive only):
# ═══════════════════════════════════════════════════════════════
#
# Views (logic changes OK, schema changes need review):
#   sql/stramark/01_fact_order_items_dedup.sql  — v3 (SAFE_CAST all STRING)
#   sql/stramark/02_vw_fact_orders.sql          — v3 (fb_adset_data merge, 4-level marketer)
#   sql/stramark/03_mart_performance_master.sql — v1
#   sql/stramark/04_mart_market_intelligence.sql — v1
#   sql/stramark/05_mart_product_insights.sql   — v1
#   sql/stramark/06_vw_fact_daily_pnl_v2.sql    — v1
#
# Deploy script (reads SQL files, applies to BQ):
#   tools/deploy_all_views.py                  — v3 deploy (canonical)
#
# Config (manual data — cập nhật thường xuyên):
#   config/manual_data/*.csv
#   config/manual_data/HUONG_DAN_UTM_FACEBOOK_ADS.md
#
# ═══════════════════════════════════════════════════════════════
# 🔄 CÁCH BACKUP / RESTORE
# ═══════════════════════════════════════════════════════════════
#
# RESTORE về trạng thái hiện tại:
#   git checkout db-architecture-v3.0-FROZEN
#
# Xem diff so với hiện tại:
#   git diff db-architecture-v3.0-FROZEN -- sql/ docs/DATABASE_MASTER_SPEC.md
#
# Tạo branch mới từ milestone:
#   git checkout -b fix/schema-hotfix db-architecture-v3.0-FROZEN
#
# ═══════════════════════════════════════════════════════════════
# 📋 FULL TABLE INVENTORY (v3.0 frozen)
# ═══════════════════════════════════════════════════════════════
#
# Per-project (11):
#   sale_order, order_items, customers, product_template,
#   product_variations, fb_ads_data, fb_adset_data,
#   fb_campaign_data, sale_combo, combo_items, page_marketer
#
# Staging (2):
#   staging_sale_order, staging_order_items
#
# Dim (5):
#   dim_status_mapping, dim_marketer_mapping, dim_marketer,
#   dim_market_mapping, dim_shop_project
#
# Cost (4):
#   cost_exchange_rates, cost_ffm_fees, cost_fixed, cost_shipping
#
# Views (6):
#   fact_order_items_dedup, vw_fact_orders,
#   mart_performance_master, mart_market_intelligence,
#   mart_product_insights, vw_fact_daily_pnl_v2
#
# ═══════════════════════════════════════════════════════════════
# 📊 VERIFICATION RESULTS (v3.0)
# ═══════════════════════════════════════════════════════════════
#
# fact_order_items_dedup:  3,125 rows  ✅
# vw_fact_orders:          3,628 rows  ✅
# mart_performance_master:   312 rows  ✅
# mart_market_intelligence:  511 rows  ✅
# mart_product_insights:     795 rows  ✅
# vw_fact_daily_pnl_v2:       99 rows  ✅
#
# Marketer matching: 96.5% (3,378 matched / 3,628 total)
# Attribution: 44.2% ADSET_MATCH + 49.7% ORGANIC_FB + 5.6% UNKNOWN + 0.5% TIKTOK
# Order dedup: 1.0x (clean)
# Revenue validated: avg 189 RON/order (matches real-world expectation)
#
# ═══════════════════════════════════════════════════════════════
# 🏗️ TEMPLATE FOR NEW PROJECTS
# ═══════════════════════════════════════════════════════════════
#
# To clone for a new project (e.g. AUUS1, pialpha):
#   1. Create dataset: {PROJECT_ID}_Dataset in BigQuery
#   2. Run: sql/tables/create_poscake_tables.sql (replace STRAMARK→PROJECT_ID)
#   3. Run: sql/tables/create_dim_tables.sql
#   4. Run: sql/tables/create_staging_tables.sql
#   5. Populate dim tables (marketer_mapping, market_mapping, shop_project, status_mapping)
#   6. Copy sql/stramark/*.sql → sql/{project_id}/ (replace dataset name)
#   7. Fill config/manual_data/*.csv for new project
#   8. Update config/projects/{project_id}.yaml
#   9. Run tools/deploy_all_views.py (update script for new dataset)
#  10. Set up n8n workflows for order/item sync
#
# IMPORTANT: DO NOT modify original STRAMARK files — COPY them
