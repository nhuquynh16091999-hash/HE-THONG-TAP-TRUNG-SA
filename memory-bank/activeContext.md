# Active Context: AUUS (FAOS v6)

## Current Focus
- **Phase**: Operational
- **Progress**: 60% (6/10 features)
- **Priority**: P1 — AUUS1 (PiAlpha US-AU)

## Summary
AUUS1 hệ thống đã verified và operational. Dashboard chạy localhost:3000, BigQuery 81 tables với ads+orders data fresh (04-13), 3 BQ views (daily_performance, vw_daily_momentum, vw_product_lifecycle) đã rebuild từ real data, runner dry-run pass 4/4 data gates. FalkorDB running (port 6379). Meta AUUS1 token long-lived.

## System Health (2026-04-14)
| Component | Status |
|-----------|--------|
| Dashboard (Next.js 16) | ✅ localhost:3000 |
| BigQuery (81 tables) | ✅ Fresh (04-13) |
| FalkorDB | ✅ Port 6379 (needs v4.4.1 image) |
| Meta Token (AUUS1) | ✅ Long-lived |
| Runner Dry-run | ✅ 4/4 gates pass |
| Gemini LLM | ⚠️ Key invalid in runner env |
| product_stock | ✅ Synced 04-14 (67 rows) |
| fb_library_ads | ⚠️ Stale since 03-18 |

## Open Items
1. Set GEMINI_API_KEY cho runner (hiện dùng rule-based fallback)
2. ~~FalkorDB image cần v4.4.1~~ ✅ Fixed cả 2 compose files
3. ~~`vw_fact_daily_pnl_marketer` vẫn dummy~~ ✅ Real view deployed + marketer name normalization
4. 2 ad accounts (AU+US phụ) cần token riêng có ads_read permission
5. fb_library_ads stale 27 ngày
6. ~~confirmed_roas = 0~~ ✅ Fixed: dim_status_mapping status 3 ("Đã giao") was wrong group (shipping→success)
7. ~~Marketer duplicate `CHINHTV`~~ ✅ Fixed via dim_marketer_mapping JOIN in view

## Session History (compacted)
### 2026-03-04 - Khởi tạo
Scaffold V5.1, clone FAOS v6, restructure workspace.

### 2026-04-14 - Full Startup & Data Pipeline Fix
6-step startup → sync stock/ads/orders → fix 3 dummy BQ views → runner dry-run 4/4 pass. Script sync_auus1_ads.py fixed (AUUS1 token, INT64 cast, removed dead accounts).

### 2026-04-14 - Marketer View & Status Fix
- FalkorDB: Agentic-AI-Levelup compose fixed (latest→v4.4.1)
- `vw_fact_daily_pnl_marketer`: Replaced dummy with real view from mart_performance_master
- dim_status_mapping: Status 3 "Đã giao" fixed shipping→success (38 orders recovered)
- Marketer name normalization: dim_marketer_mapping JOIN eliminates CHINHTV/Chính TV duplicate
- vw_marketer_momentum: Now working with real data

---
(Note: AI tự cập nhật. KHÔNG ghi từng action nhỏ.)
