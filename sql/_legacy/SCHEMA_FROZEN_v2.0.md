# ═══════════════════════════════════════════════════════════════
# 🔒 DATABASE SCHEMA — FROZEN at v2.0
# ═══════════════════════════════════════════════════════════════
#
# Frozen date: 2026-02-15T21:37:42+07:00
# Git tag: db-architecture-v2.0-FROZEN
# Git commit: 7c9baf0
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
#   sql/stramark/01_fact_order_items_dedup.sql
#   sql/stramark/02_vw_fact_orders.sql
#   sql/stramark/03_mart_performance_master.sql
#   sql/stramark/04_mart_market_intelligence.sql
#   sql/stramark/05_mart_product_insights.sql
#   sql/stramark/06_vw_fact_daily_pnl_v2.sql
#
# Config (manual data — cập nhật thường xuyên):
#   config/manual_data/*.csv
#
# ═══════════════════════════════════════════════════════════════
# 🔄 CÁCH BACKUP / RESTORE
# ═══════════════════════════════════════════════════════════════
#
# RESTORE về trạng thái hiện tại:
#   git checkout db-architecture-v2.0-FROZEN
#
# Xem diff so với hiện tại:
#   git diff db-architecture-v2.0-FROZEN -- sql/ docs/DATABASE_MASTER_SPEC.md
#
# Tạo branch mới từ milestone:
#   git checkout -b fix/schema-hotfix db-architecture-v2.0-FROZEN
#
# ═══════════════════════════════════════════════════════════════
# 📋 FULL TABLE INVENTORY (frozen)
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
