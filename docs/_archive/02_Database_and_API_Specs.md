# 02 — Đặc Tả Dữ Liệu & API (Database & API Specs)

> **Project**: FAOS v6 — Agentic Workflow & Human-in-the-Loop  
> **Version**: 1.0 | **Date**: 2026-03-01  
> **Author**: System Architect  
> **Status**: Draft — Pending Review

---

## Mục Lục

1. [BigQuery Schema (Bảng Mới)](#1-bigquery-schema-bảng-mới)
2. [BigQuery Views (Moving Averages & Momentum)](#2-bigquery-views-moving-averages--momentum)
3. [FalkorDB Graph Schema](#3-falkordb-graph-schema)
4. [API Endpoints](#4-api-endpoints)
5. [Meta Conversions API (CAPI) Payload](#5-meta-conversions-api-capi-payload)
6. [Data Flow Diagrams](#6-data-flow-diagrams)

---

## 1. BigQuery Schema (Bảng Mới)

> GCP Project: `levelup-465304`  
> Datasets: `STRAMARK_Dataset`, `AUUS1_Dataset`, `Zen8_Dataset`

### 1.1 `ai_prediction_log` — Lưu dự đoán của AI & so sánh với thực tế

```sql
CREATE TABLE IF NOT EXISTS `levelup-465304.{DATASET}.ai_prediction_log` (
    -- Primary Key
    prediction_id       STRING NOT NULL,        -- UUID v4
    
    -- Context
    prediction_date     DATE NOT NULL,          -- Ngày dự đoán
    evaluation_date     DATE,                   -- Ngày so sánh kết quả (prediction_date + 1)
    agent               STRING NOT NULL,        -- 'analyst' | 'director'
    project_id          STRING NOT NULL,        -- 'stramark' | 'auus1' | 'zen8'
    run_id              STRING,                 -- Groups predictions from same run
    
    -- Prediction
    metric              STRING NOT NULL,        -- 'roas', 'total_orders', 'revenue', 'cpm', 'cpa'
    entity_type         STRING,                 -- 'project' | 'campaign' | 'marketer' | 'product'
    entity_id           STRING,                 -- campaign_id, marketer_id, product_code; NULL = project-level
    entity_name         STRING,                 -- Human-readable name
    predicted_value     FLOAT64 NOT NULL,       -- Giá trị AI dự đoán
    confidence_pct      FLOAT64,                -- 0-100: độ tự tin của AI
    
    -- Actual (filled in by reflection workflow T+1)
    actual_value        FLOAT64,                -- Giá trị thực tế
    accuracy_pct        FLOAT64,                -- |1 - |predicted - actual| / actual| × 100
    direction_correct   BOOL,                   -- AI dự đoán đúng xu hướng lên/xuống?
    
    -- Reasoning
    reasoning           STRING,                 -- AI reasoning tại sao dự đoán con số này
    reflection_note     STRING,                 -- AI reflection tại sao sai/đúng (filled T+1)
    
    -- Metadata
    created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP(),
    evaluated_at        TIMESTAMP               -- Thời điểm so sánh
);

-- Indexes (BQ clustering)
-- CLUSTER BY prediction_date, agent, project_id
```

#### Sample Data

| prediction_id | prediction_date | agent | project_id | metric | entity_id | predicted_value | actual_value | accuracy_pct | confidence_pct |
|:--|:--|:--|:--|:--|:--|:--|:--|:--|:--|
| `pred_001` | 2026-03-01 | analyst | stramark | roas | Camp_D04 | 3.5 | 3.2 | 91.4 | 80 |
| `pred_002` | 2026-03-01 | analyst | stramark | total_orders | NULL | 50 | 45 | 90.0 | 70 |
| `pred_003` | 2026-03-01 | analyst | auus1 | revenue | NULL | 1200 | 1350 | 88.9 | 60 |

---

### 1.2 `approval_logs` — Lịch sử duyệt lệnh Human-in-the-Loop

```sql
CREATE TABLE IF NOT EXISTS `levelup-465304.{DATASET}.approval_logs` (
    -- Primary Key
    log_id              STRING NOT NULL,        -- UUID v4
    
    -- Decision Reference
    decision_id         STRING NOT NULL,        -- Links to SimpleMem decision
    agent               STRING NOT NULL,        -- 'director'
    project_id          STRING NOT NULL,        -- 'stramark' | 'auus1'
    
    -- Action Details
    action              STRING NOT NULL,        -- 'scale_budget', 'kill_campaign', 'pause_adset',
                                                -- 'new_campaign', 'update_rule', 'realloc_budget'
    entity_type         STRING,                 -- 'campaign' | 'adset' | 'ad'
    entity_id           STRING,                 -- Meta API entity ID
    entity_name         STRING,                 -- Human-readable: "04.02-D04-Romania-CĐ-LC"
    
    -- Change Details
    change_detail       STRING,                 -- 'budget $80→$100 (+25%)'
    change_value_before FLOAT64,                -- 8000 (cents)
    change_value_after  FLOAT64,                -- 10000 (cents)
    change_pct          FLOAT64,                -- 25.0
    
    -- AI Reasoning
    reasoning           STRING,                 -- AI explanation (max 2000 chars)
    evidence            STRING,                 -- Data evidence (metrics, trends)
    risk_level          INT64,                  -- 1-5 (1=safe, 5=dangerous)
    
    -- Approval
    approval_status     STRING NOT NULL,        -- 'PENDING', 'APPROVED', 'REJECTED', 
                                                -- 'ROLLED_BACK', 'AUTO_APPROVED', 'EXPIRED'
    approved_by         STRING,                 -- Username or 'AUTO' or 'SYSTEM_TIMEOUT'
    approval_channel    STRING,                 -- 'telegram' | 'discord' | 'dashboard' | 'auto'
    approved_at         TIMESTAMP,
    
    -- Rollback
    rollback_state_json STRING,                 -- JSON snapshot pre-action state
    rolled_back_at      TIMESTAMP,
    rolled_back_by      STRING,
    
    -- Meta API Response
    meta_api_response   STRING,                 -- Raw API response JSON
    meta_api_success    BOOL,                   -- API call succeeded?
    
    -- Outcome (filled 24h later by auto-review)
    outcome_metric      STRING,                 -- 'roas' | 'cpa' | 'orders'
    outcome_before      FLOAT64,                -- Metric value before action
    outcome_after       FLOAT64,                -- Metric value 24h after
    outcome_verdict     STRING,                 -- 'WIN' | 'LOSS' | 'NEUTRAL'
    
    -- Timestamps
    created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP(),
    expires_at          TIMESTAMP,              -- Timeout deadline
    reviewed_at         TIMESTAMP               -- 24h auto-review timestamp
);
```

#### Sample Data

| log_id | decision_id | action | entity_name | change_detail | approval_status | approved_by | outcome_verdict |
|:--|:--|:--|:--|:--|:--|:--|:--|
| `log_001` | `dec_001` | scale_budget | Camp_D04_RO | $80→$100 (+25%) | APPROVED | @owner_tg | WIN |
| `log_002` | `dec_002` | kill_campaign | Camp_L20_RO | ACTIVE→PAUSED | REJECTED | @owner_tg | — |
| `log_003` | `dec_003` | scale_budget | Camp_NA4 | $50→$55 (+10%) | AUTO_APPROVED | AUTO | WIN |
| `log_004` | `dec_004` | pause_adset | AdSet_X | ACTIVE→PAUSED | EXPIRED | SYSTEM_TIMEOUT | — |

---

### 1.3 `agent_run_log` — Log mỗi lần Agent chạy (cho Live Feed)

```sql
CREATE TABLE IF NOT EXISTS `levelup-465304.{DATASET}.agent_run_log` (
    run_id              STRING NOT NULL,        -- UUID cho mỗi lần chạy
    agent               STRING NOT NULL,        -- 'analyst' | 'director'
    project_id          STRING NOT NULL,
    
    -- Timing
    started_at          TIMESTAMP NOT NULL,
    completed_at        TIMESTAMP,
    duration_seconds    FLOAT64,
    
    -- Result
    status              STRING,                 -- 'SUCCESS', 'ERROR', 'PARTIAL'
    steps_completed     INT64,                  -- Số bước hoàn thành (max 7)
    error_message       STRING,
    
    -- Summary
    decisions_count     INT64,                  -- Số decision generated
    predictions_count   INT64,                  -- Số prediction made
    lessons_count       INT64,                  -- Số lesson learned
    approvals_sent      INT64,                  -- Số approval requests sent
    
    -- Accuracy (only for reflection runs)
    prediction_accuracy FLOAT64,                -- Avg accuracy % cho run này
    
    created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP()
);
```

---

## 2. BigQuery Views (Moving Averages & Momentum)

### 2.1 `vw_daily_momentum` — Moving Averages cho Project-Level

> Dựa trên `vw_fact_daily_pnl_v2` — view đã có sẵn aggregates theo `report_date`.

```sql
CREATE OR REPLACE VIEW `levelup-465304.{DATASET}.vw_daily_momentum` AS
WITH daily AS (
    SELECT
        report_date,
        total_orders,
        success_orders,
        revenue_success,
        ads_spend_ron,
        net_profit,
        roas_l3                   AS roas,
        cpl_ron                   AS cpa,
        return_rate_pct,
        success_rate_pct
    FROM `levelup-465304.{DATASET}.vw_fact_daily_pnl_v2`
)
SELECT
    d.*,

    -- ═══ MOVING AVERAGES ═══
    -- Revenue
    ROUND(AVG(revenue_success) OVER w3, 0)            AS revenue_ma3,
    ROUND(AVG(revenue_success) OVER w7, 0)            AS revenue_ma7,
    -- Orders
    ROUND(AVG(total_orders) OVER w3, 1)               AS orders_ma3,
    ROUND(AVG(total_orders) OVER w7, 1)               AS orders_ma7,
    -- ROAS
    ROUND(AVG(roas) OVER w3, 2)                       AS roas_ma3,
    ROUND(AVG(roas) OVER w7, 2)                       AS roas_ma7,
    -- Ad Spend
    ROUND(AVG(ads_spend_ron) OVER w3, 0)              AS spend_ma3,
    ROUND(AVG(ads_spend_ron) OVER w7, 0)              AS spend_ma7,
    -- CPA
    ROUND(AVG(cpa) OVER w3, 0)                        AS cpa_ma3,
    ROUND(AVG(cpa) OVER w7, 0)                        AS cpa_ma7,
    -- Profit
    ROUND(AVG(net_profit) OVER w3, 0)                 AS profit_ma3,
    ROUND(AVG(net_profit) OVER w7, 0)                 AS profit_ma7,

    -- ═══ MOMENTUM SIGNALS ═══
    -- Rule: MA3 > MA7 → UPTREND, MA3 < MA7 × 0.95 → DOWNTREND, else STABLE
    CASE
        WHEN AVG(revenue_success) OVER w3 > AVG(revenue_success) OVER w7 THEN 'UPTREND'
        WHEN AVG(revenue_success) OVER w3 < AVG(revenue_success) OVER w7 * 0.95 THEN 'DOWNTREND'
        ELSE 'STABLE'
    END AS revenue_momentum,

    CASE
        WHEN AVG(roas) OVER w3 > AVG(roas) OVER w7 THEN 'UPTREND'
        WHEN AVG(roas) OVER w3 < AVG(roas) OVER w7 * 0.95 THEN 'DOWNTREND'
        ELSE 'STABLE'
    END AS roas_momentum,

    CASE
        WHEN AVG(total_orders) OVER w3 > AVG(total_orders) OVER w7 THEN 'UPTREND'
        WHEN AVG(total_orders) OVER w3 < AVG(total_orders) OVER w7 * 0.95 THEN 'DOWNTREND'
        ELSE 'STABLE'
    END AS orders_momentum,

    CASE
        WHEN AVG(cpa) OVER w3 > AVG(cpa) OVER w7 * 1.05 THEN 'UPTREND'   -- CPA tăng = xấu
        WHEN AVG(cpa) OVER w3 < AVG(cpa) OVER w7 THEN 'DOWNTREND'          -- CPA giảm = tốt
        ELSE 'STABLE'
    END AS cpa_momentum,

    -- ═══ DAY-OVER-DAY CHANGE ═══
    ROUND(SAFE_DIVIDE(revenue_success - LAG(revenue_success) OVER wo,
                      NULLIF(LAG(revenue_success) OVER wo, 0)) * 100, 1) AS revenue_dod_pct,
    ROUND(roas - LAG(roas) OVER wo, 2)                                    AS roas_dod_change

FROM daily d
WINDOW
    w3 AS (ORDER BY report_date ROWS BETWEEN 2 PRECEDING AND CURRENT ROW),
    w7 AS (ORDER BY report_date ROWS BETWEEN 6 PRECEDING AND CURRENT ROW),
    wo AS (ORDER BY report_date)
;
```

### 2.2 `vw_marketer_momentum` — Moving Averages per Marketer (Bảng Phong Thần)

> Dựa trên `mart_performance_master` — view chứa dữ liệu per-marketer per-day.

```sql
CREATE OR REPLACE VIEW `levelup-465304.{DATASET}.vw_marketer_momentum` AS
WITH mkter AS (
    SELECT
        report_date,
        marketer_id,
        marketer_name,
        total_orders,
        success_orders,
        returned_orders,
        revenue_success,
        ads_spend_ron,
        net_profit,
        real_roas                 AS roas,
        real_cpa                  AS cpa,
        return_rate_pct,
        diagnosis
    FROM `levelup-465304.{DATASET}.mart_performance_master`
)
SELECT
    m.*,

    -- MAs per marketer
    ROUND(AVG(revenue_success) OVER w3, 0)    AS revenue_ma3,
    ROUND(AVG(revenue_success) OVER w7, 0)    AS revenue_ma7,
    ROUND(AVG(roas) OVER w3, 2)               AS roas_ma3,
    ROUND(AVG(roas) OVER w7, 2)               AS roas_ma7,
    ROUND(AVG(total_orders) OVER w3, 1)       AS orders_ma3,
    ROUND(AVG(total_orders) OVER w7, 1)       AS orders_ma7,

    -- Momentum per marketer
    CASE
        WHEN AVG(roas) OVER w3 > AVG(roas) OVER w7 THEN 'UPTREND'
        WHEN AVG(roas) OVER w3 < AVG(roas) OVER w7 * 0.95 THEN 'DOWNTREND'
        ELSE 'STABLE'
    END AS roas_momentum,

    CASE
        WHEN AVG(revenue_success) OVER w3 > AVG(revenue_success) OVER w7 THEN 'UPTREND'
        WHEN AVG(revenue_success) OVER w3 < AVG(revenue_success) OVER w7 * 0.95 THEN 'DOWNTREND'
        ELSE 'STABLE'
    END AS revenue_momentum,

    -- Efficiency score (Bảng phong thần ranking)
    ROUND(COALESCE(roas, 0) * COALESCE(SAFE_DIVIDE(success_orders, NULLIF(total_orders, 0)), 0), 2)
        AS efficiency_score,

    -- Verdict
    CASE
        WHEN roas >= 3.0 THEN '💰 Kéo số'
        WHEN roas >= 1.5 THEN '📊 Ổn định'
        WHEN roas > 0    THEN '🔥 Đốt tiền'
        ELSE '⚪ Không data'
    END AS marketer_verdict

FROM mkter m
WINDOW
    w3 AS (PARTITION BY marketer_id ORDER BY report_date ROWS BETWEEN 2 PRECEDING AND CURRENT ROW),
    w7 AS (PARTITION BY marketer_id ORDER BY report_date ROWS BETWEEN 6 PRECEDING AND CURRENT ROW)
;
```

### 2.3 `vw_product_lifecycle` — BCG Matrix per Product (Vòng Đời SP)

> Dựa trên `mart_product_insights` — view chứa product-level data.

```sql
CREATE OR REPLACE VIEW `levelup-465304.{DATASET}.vw_product_lifecycle` AS
WITH prod_daily AS (
    SELECT
        report_date,
        product_code,
        ANY_VALUE(product_name)   AS product_name,
        SUM(order_count)          AS total_orders,
        SUM(units_delivered)      AS units_delivered,
        SUM(units_returned)       AS units_returned,
        SUM(delivered_revenue)    AS revenue,
        SUM(ads_spend_ron)        AS ads_spend,
        SUM(gross_profit)         AS gross_profit,
        AVG(product_roas)         AS roas,
        AVG(product_return_rate)  AS return_rate
    FROM `levelup-465304.{DATASET}.mart_product_insights`
    GROUP BY 1, 2
),
prod_with_ma AS (
    SELECT
        pd.*,
        AVG(roas) OVER w3         AS roas_ma3,
        AVG(roas) OVER w7         AS roas_ma7,
        AVG(revenue) OVER w3      AS revenue_ma3,
        AVG(revenue) OVER w7      AS revenue_ma7,
        COUNT(*) OVER (PARTITION BY product_code ORDER BY report_date
                       ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS days_active,
        CASE
            WHEN AVG(roas) OVER w3 > AVG(roas) OVER w7 THEN 'UPTREND'
            WHEN AVG(roas) OVER w3 < AVG(roas) OVER w7 * 0.95 THEN 'DOWNTREND'
            ELSE 'STABLE'
        END AS roas_momentum,
        CASE
            WHEN AVG(revenue) OVER w3 > AVG(revenue) OVER w7 THEN 'UPTREND'
            WHEN AVG(revenue) OVER w3 < AVG(revenue) OVER w7 * 0.95 THEN 'DOWNTREND'
            ELSE 'STABLE'
        END AS revenue_momentum
    FROM prod_daily pd
    WINDOW
        w3 AS (PARTITION BY product_code ORDER BY report_date ROWS BETWEEN 2 PRECEDING AND CURRENT ROW),
        w7 AS (PARTITION BY product_code ORDER BY report_date ROWS BETWEEN 6 PRECEDING AND CURRENT ROW)
)
SELECT
    *,
    -- BCG Matrix Classification
    CASE
        -- ⭐ Star: ROAS cao + đang lên → SCALE
        WHEN roas_ma7 >= 3.0 AND roas_momentum = 'UPTREND'
            THEN '⭐ Star'
        -- 🐄 Cash Cow: ROAS stable, volume cao → MAINTAIN
        WHEN roas_ma7 >= 2.0 AND roas_momentum IN ('STABLE', 'UPTREND') AND days_active >= 14
            THEN '🐄 Cash Cow'
        -- ❓ Question Mark: Mới (<7 ngày) hoặc không ổn định → MONITOR
        WHEN days_active < 7 OR (roas_momentum = 'STABLE' AND roas_ma7 BETWEEN 1.3 AND 3.0)
            THEN '❓ Question Mark'
        -- 🐕 Dog: ROAS thấp + đang xuống > 5 ngày → KILL/CLEAR STOCK
        WHEN roas_ma7 < 1.3 AND roas_momentum = 'DOWNTREND' AND days_active >= 5
            THEN '🐕 Dog'
        -- Default
        ELSE '❓ Question Mark'
    END AS lifecycle_stage,

    CASE
        WHEN roas_ma7 >= 3.0 AND roas_momentum = 'UPTREND' THEN 'SCALE +20%'
        WHEN roas_ma7 >= 2.0 AND roas_momentum IN ('STABLE', 'UPTREND') THEN 'MAINTAIN — DO NOT TOUCH'
        WHEN days_active < 7 THEN 'MONITOR — let Meta learn'
        WHEN roas_ma7 < 1.3 AND roas_momentum = 'DOWNTREND' THEN 'KILL or CLEAR STOCK'
        ELSE 'REVIEW'
    END AS recommended_action

FROM prod_with_ma
;
```

### 2.4 Tạo Bảng & Views — SQL Script Tổng Hợp

File: `sql/v6_new_tables.sql`

```sql
-- ═══════════════════════════════════════════════════
-- FAOS v6 — New Tables & Views
-- Run per dataset: STRAMARK_Dataset, AUUS1_Dataset
-- ═══════════════════════════════════════════════════

-- Tables
-- 1. ai_prediction_log      (xem Section 1.1)
-- 2. approval_logs          (xem Section 1.2)
-- 3. agent_run_log          (xem Section 1.3)

-- Views
-- 4. vw_daily_momentum      (xem Section 2.1)
-- 5. vw_marketer_momentum   (xem Section 2.2)
-- 6. vw_product_lifecycle   (xem Section 2.3)
```

---

## 3. FalkorDB Graph Schema

### 3.1 Node Types — Chi Tiết Properties

#### `Campaign` Node

| Property | Type | Required | Description | Ví dụ |
|:--|:--|:--|:--|:--|
| `id` | STRING | ✅ | Meta campaign ID | `120218674890840` |
| `name` | STRING | ✅ | Campaign name | `04.02-D04-Romania-CĐ-LC` |
| `project` | STRING | ✅ | Project ID | `stramark` |
| `objective` | STRING | | Meta objective | `OUTCOME_SALES` |
| `status` | STRING | ✅ | `ACTIVE`, `PAUSED`, `DELETED` | `ACTIVE` |
| `start_date` | STRING | | ISO date | `2026-02-01` |
| `budget_daily` | FLOAT | | Daily budget (cents) | `8000` |
| `lifetime_spend` | FLOAT | | Total spend to date (RON) | `12500.00` |
| `avg_roas` | FLOAT | | Rolling 7-day ROAS | `3.2` |
| `lifecycle_stage` | STRING | | BCG stage | `Cash Cow` |
| `last_synced` | STRING | | Last BQ sync timestamp | `2026-03-01T08:00:00Z` |

#### `Decision` Node

| Property | Type | Required | Description | Ví dụ |
|:--|:--|:--|:--|:--|
| `id` | STRING | ✅ | UUID | `dec_20260301_001` |
| `timestamp` | STRING | ✅ | ISO timestamp | `2026-03-01T08:15:00Z` |
| `agent` | STRING | ✅ | `analyst` or `director` | `director` |
| `action` | STRING | ✅ | Action type | `scale_budget` |
| `action_display` | STRING | | Human readable | `Scale Budget +25%` |
| `entity_id` | STRING | | Affected entity | `120218674890840` |
| `entity_name` | STRING | | Human readable | `Camp_D04_Romania` |
| `reasoning` | STRING | ✅ | AI reasoning chain | `ROAS 3.5, MA7=3.2...` |
| `confidence` | FLOAT | | 0.0-1.0 | `0.85` |
| `risk_level` | INT | | 1-5 | `2` |
| `approval_status` | STRING | | Status | `APPROVED` |
| `approved_by` | STRING | | Username | `@owner_tg` |
| `change_before` | FLOAT | | Pre-value | `8000` |
| `change_after` | FLOAT | | Post-value | `10000` |
| `outcome_verdict` | STRING | | 24h later | `WIN` |

#### `Lesson` Node

| Property | Type | Required | Description | Ví dụ |
|:--|:--|:--|:--|:--|
| `id` | STRING | ✅ | UUID | `lesson_001` |
| `timestamp` | STRING | ✅ | When learned | `2026-02-25T18:00:00Z` |
| `insight` | STRING | ✅ | Bài học | `Scale >20% → CPM +40%` |
| `evidence` | STRING | ✅ | Dữ liệu chứng minh | `Camp_D04 scaled 25%...` |
| `category` | STRING | | Phân loại | `budget`, `cpm`, `roas`, `creative` |
| `confidence` | STRING | | `HIGH`, `MEDIUM`, `LOW` | `HIGH` |
| `validated_count` | INT | | Số lần validate đúng | `3` |
| `source_agent` | STRING | | Agent nào học | `analyst` |
| `deleted_at` | STRING | | Soft delete | NULL |
| `deleted_by` | STRING | | Ai xóa | NULL |
| `delete_reason` | STRING | | Lý do xóa | NULL |

#### `SOP` Node

| Property | Type | Required | Description | Ví dụ |
|:--|:--|:--|:--|:--|
| `id` | STRING | ✅ | UUID | `sop_roas_v2` |
| `name` | STRING | ✅ | Tên SOP | `ROAS Thresholds` |
| `version` | INT | ✅ | Version number | `2` |
| `rules_json` | STRING | ✅ | JSON rules | `{"danger": 1.3, ...}` |
| `description` | STRING | | Mô tả | `ROAS thresholds for...` |
| `last_updated` | STRING | ✅ | ISO timestamp | `2026-03-01T00:00:00Z` |
| `updated_by` | STRING | | Ai update | `@admin` |

`rules_json` example:

```json
{
    "danger_threshold": 1.3,
    "warning_threshold": 2.0,
    "target_threshold": 2.5,
    "excellent_threshold": 3.0,
    "scale_eligible_min_roas": 3.0,
    "scale_eligible_min_stable_days": 3,
    "kill_min_days_below_danger": 7,
    "max_daily_budget_change_pct": 50,
    "max_daily_scale_pct": 20,
    "new_campaign_learning_days": 7
}
```

#### `Prediction` Node

| Property | Type | Required | Description |
|:--|:--|:--|:--|
| `id` | STRING | ✅ | UUID |
| `timestamp` | STRING | ✅ | When predicted |
| `agent` | STRING | ✅ | `analyst` or `director` |
| `metric` | STRING | ✅ | `roas`, `orders`, `revenue` |
| `predicted_value` | FLOAT | ✅ | Predicted number |
| `actual_value` | FLOAT | | Filled T+1 |
| `accuracy` | FLOAT | | Accuracy % |
| `confidence_pct` | FLOAT | | AI confidence |

#### `PersonalityConfig` Node

| Property | Type | Required | Description | Default |
|:--|:--|:--|:--|:--|
| `id` | STRING | ✅ | `personality_{agent}` | — |
| `agent` | STRING | ✅ | Agent name | — |
| `risk_level` | FLOAT | ✅ | 0.0-1.0 | `0.5` |
| `auto_budget_limit` | INT | ✅ | Cents | `5000` |
| `target_roas` | FLOAT | ✅ | KPI target | `2.5` |
| `max_cpa` | FLOAT | | RON | `15.0` |
| `min_daily_orders` | INT | | Per project | `10` |
| `max_return_rate` | FLOAT | | % | `25.0` |
| `roas_danger` | FLOAT | | Kill threshold | `1.3` |
| `analyst_cron` | STRING | | Schedule analyst | `0 8 * * *` |
| `director_cron` | STRING | | Schedule director | `15 8 * * *` |
| `last_updated` | STRING | | ISO timestamp | — |

#### `Marketer`, `Product`, `Market`, `Event` Nodes

_(Xem chi tiết trong implementation_plan.md — nodes này sync từ BigQuery, properties match tương ứng với các cột trong `mart_performance_master` và `mart_product_insights`.)_

### 3.2 Edge Types — Chi Tiết Properties

| Edge | From → To | Properties | Cypher Query Mẫu |
|:--|:--|:--|:--|
| `HAS_ADSET` | Campaign → AdSet | — | `MATCH (c:Campaign)-[:HAS_ADSET]->(a:AdSet)` |
| `PROMOTES` | Campaign → Product | — | `MATCH (c:Campaign)-[:PROMOTES]->(p:Product)` |
| `MANAGED_BY` | Campaign → Marketer | `since`, `performance_score` | `MATCH (c)-[:MANAGED_BY]->(m:Marketer)` |
| `TARGETS` | Campaign → Market | — | `MATCH (c)-[:TARGETS]->(mk:Market)` |
| `DECIDED_ON` | Decision → Campaign | `result`, `reviewed_at`, `rollback_state` | `MATCH (d:Decision)-[:DECIDED_ON]->(c:Campaign)` |
| `CAUSED_BY` | Decision → Lesson | — | `MATCH (d:Decision)-[:CAUSED_BY]->(l:Lesson)` |
| `LED_TO` | Event → Event | `delay_hours` | `MATCH (e1:Event)-[:LED_TO]->(e2:Event)` |
| `PREDICTED` | Prediction → Campaign | — | `MATCH (p:Prediction)-[:PREDICTED]->(c:Campaign)` |
| `VALIDATED_BY` | Prediction → Prediction | `was_correct` | `MATCH (p1)-[:VALIDATED_BY]->(p2)` |
| `SUPERSEDES` | SOP → SOP | — | `MATCH (s2:SOP)-[:SUPERSEDES]->(s1:SOP)` |
| `APPLIES_TO` | SOP → Market | — | `MATCH (s:SOP)-[:APPLIES_TO]->(m:Market)` |
| `LEARNED_FROM` | Lesson → Decision | — | `MATCH (l:Lesson)-[:LEARNED_FROM]->(d:Decision)` |
| `ROLLED_BACK` | Decision → Decision | `rolled_back_at`, `by_user` | `MATCH (d2)-[:ROLLED_BACK]->(d1)` |

### 3.3 Cypher Query Examples

```cypher
-- 1. Lấy tất cả Lessons liên quan tới Campaign X
MATCH (c:Campaign {name: 'Camp_D04_Romania'})
      <-[:DECIDED_ON]-(d:Decision)
      -[:CAUSED_BY]->(l:Lesson)
RETURN l.insight, l.evidence, l.confidence, l.timestamp
ORDER BY l.timestamp DESC

-- 2. Lấy SOPs cho market Romania
MATCH (s:SOP)-[:APPLIES_TO]->(m:Market {name: 'Romania'})
RETURN s.name, s.rules_json, s.version

-- 3. Win-rate của Director (quyết định đúng?)
MATCH (d:Decision {agent: 'director', approval_status: 'APPROVED'})
WHERE d.outcome_verdict IS NOT NULL
RETURN
  COUNT(*) AS total,
  SUM(CASE WHEN d.outcome_verdict = 'WIN' THEN 1 ELSE 0 END) AS wins,
  ROUND(SUM(CASE WHEN d.outcome_verdict = 'WIN' THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 1) AS win_rate

-- 4. Lấy PersonalityConfig cho Director
MATCH (p:PersonalityConfig {agent: 'director'})
RETURN p.risk_level, p.auto_budget_limit, p.target_roas, p.max_cpa

-- 5. Causal chain: tại sao ROAS giảm?
MATCH path = (e1:Event)-[:LED_TO*1..3]->(e2:Event)
WHERE e2.type = 'ROAS_DROP'
RETURN path
```

---

## 4. API Endpoints

### 4.1 Approval Webhook Endpoints

| Method | URL | Description | Auth |
|:--|:--|:--|:--|
| `POST` | `/api/webhooks/telegram` | Telegram Bot callback (inline keyboard clicks) | Telegram Token verify |
| `POST` | `/api/webhooks/discord` | Discord Bot interactions (button clicks) | Discord signature verify |

#### `POST /api/webhooks/telegram`

```json
// Telegram callback_query payload (incoming):
{
    "update_id": 123456,
    "callback_query": {
        "id": "abc123",
        "from": {"id": 987654, "username": "owner_tg"},
        "data": "approve_dec_20260301_001",
        "message": {"message_id": 555, "chat": {"id": -100123456}}
    }
}

// Bot response actions:
// 1. Parse "approve_" prefix → decision_id
// 2. Execute Meta API action
// 3. answerCallbackQuery → "✅ Lệnh đã được duyệt!"
// 4. editMessageReplyMarkup → remove buttons
// 5. sendMessage → confirm details
// 6. Insert into BQ approval_logs
```

#### `POST /api/webhooks/discord`

```json
// Discord interaction payload (incoming):
{
    "type": 3,
    "data": {"custom_id": "approve_dec_20260301_001"},
    "member": {"user": {"id": "123", "username": "owner_dc"}},
    "token": "webhook_token"
}

// Response (immediate, <3s):
{
    "type": 4,
    "data": {"content": "✅ Lệnh đã được owner_dc duyệt và thực thi!"}
}
```

### 4.2 Agent Control Center API

Base URL: `/api/agent`

#### Live Feed

| Method | URL | Description |
|:--|:--|:--|
| `GET` | `/api/agent/{name}/feed` | SSE stream — realtime agent steps |
| `GET` | `/api/agent/{name}/runs` | List past runs (paginated) |
| `GET` | `/api/agent/{name}/runs/{run_id}` | Get specific run detail |

SSE Event stream format:
```
event: step
data: {"agent":"analyst","step":"STEP_1_FETCH_SOP","status":"start","message":"Fetching SOPs...","run_id":"run_001","timestamp":"2026-03-01T08:00:01Z"}

event: step
data: {"agent":"analyst","step":"STEP_1_FETCH_SOP","status":"success","message":"✅ 12 SOPs loaded","data":{"count":12},"run_id":"run_001","timestamp":"2026-03-01T08:00:03Z"}
```

#### Memory Manager

| Method | URL | Description |
|:--|:--|:--|
| `GET` | `/api/agent/{name}/memory/nodes` | List nodes (`?type=Lesson&search=CPM&limit=20`) |
| `GET` | `/api/agent/{name}/memory/nodes/{id}` | Get single node + related edges |
| `POST` | `/api/agent/{name}/memory/nodes` | Create new node (SOP only) |
| `PUT` | `/api/agent/{name}/memory/nodes/{id}` | Update node |
| `DELETE` | `/api/agent/{name}/memory/nodes/{id}` | Soft delete (`?reason=...` required) |
| `GET` | `/api/agent/{name}/memory/stats` | Node counts by type |

Request/Response examples:

```json
// POST /api/agent/analyst/memory/nodes
{
    "type": "SOP",
    "name": "ROAS Thresholds",
    "version": 3,
    "rules_json": "{\"danger\": 1.3, \"target\": 2.5, \"excellent\": 3.0}",
    "applies_to": ["Romania", "Bulgaria"]
}

// Response 201
{
    "id": "sop_roas_v3",
    "status": "created",
    "edges_created": [
        {"type": "APPLIES_TO", "to": "Romania"},
        {"type": "APPLIES_TO", "to": "Bulgaria"},
        {"type": "SUPERSEDES", "to": "sop_roas_v2"}
    ]
}
```

```json
// DELETE /api/agent/analyst/memory/nodes/lesson_042?reason=Data%20only%202%20days
// Response 200
{
    "id": "lesson_042",
    "status": "soft_deleted",
    "deleted_at": "2026-03-01T10:30:00Z",
    "deleted_by": "admin_dashboard"
}
```

#### Audit Log

| Method | URL | Description |
|:--|:--|:--|
| `GET` | `/api/agent/{name}/audit` | Audit log (`?from=2026-02-01&to=2026-03-01&action=scale_budget`) |
| `GET` | `/api/agent/{name}/audit/stats` | Win-rate summary stats |

```json
// GET /api/agent/director/audit/stats
{
    "period": "last_30_days",
    "total_decisions": 65,
    "approved": 45,
    "rejected": 12,
    "rolled_back": 3,
    "expired": 5,
    "win_rate_approved": 73.3,
    "ai_correct_when_rejected": 66.7,
    "overall_ai_accuracy": 71.5
}
```

#### Personality Settings

| Method | URL | Description |
|:--|:--|:--|
| `GET` | `/api/agent/{name}/personality` | Get current settings |
| `PUT` | `/api/agent/{name}/personality` | Update settings → save to FalkorDB |

```json
// PUT /api/agent/director/personality
{
    "risk_level": 0.6,
    "auto_budget_limit": 5000,
    "target_roas": 2.5,
    "max_cpa": 15.0,
    "roas_danger": 1.3,
    "analyst_cron": "0 8 * * *",
    "director_cron": "15 8 * * *"
}

// Response 200
{
    "status": "updated",
    "agent": "director",
    "changes": ["risk_level: 0.5→0.6", "max_cpa: 12.0→15.0"],
    "effective_from": "next_run"
}
```

### 4.3 Dashboard Data API

| Method | URL | Description |
|:--|:--|:--|
| `GET` | `/api/ai-intelligence/accuracy` | Prediction accuracy over time (`?days=30`) |
| `GET` | `/api/ai-intelligence/outcomes` | Decision outcome distribution |
| `GET` | `/api/ai-intelligence/metrics` | Accuracy per metric type |

---

## 5. Meta Conversions API (CAPI) Payload

### 5.1 Endpoint

```
POST https://graph.facebook.com/v21.0/{PIXEL_ID}/events
Authorization: Bearer {ACCESS_TOKEN}
Content-Type: application/json
```

### 5.2 Purchase Event Payload

```json
{
    "data": [
        {
            "event_name": "Purchase",
            "event_time": 1709313600,
            "event_id": "ORD_STRA_20260301_00142",
            "event_source_url": "https://aurelia-wear.ro/checkout/success",
            "action_source": "website",
            "user_data": {
                "em": ["a1b2c3d4e5f6..."],
                "ph": ["f6e5d4c3b2a1..."],
                "fn": ["d4c3b2a1..."],
                "ln": ["b2a1d4c3..."],
                "ct": ["4f2e..."],
                "st": ["8c1a..."],
                "zp": ["3b7f..."],
                "country": ["ef2d5de..."],
                "external_id": ["abc123hash..."],
                "client_ip_address": "192.168.1.1",
                "client_user_agent": "Mozilla/5.0...",
                "fbc": "fb.1.1709313600.AbC...",
                "fbp": "fb.1.1709313600.XyZ..."
            },
            "custom_data": {
                "value": 189.00,
                "currency": "RON",
                "content_ids": ["D04"],
                "content_type": "product",
                "contents": [
                    {"id": "D04", "quantity": 1, "item_price": 189.00}
                ],
                "order_id": "ORD_STRA_20260301_00142",
                "num_items": 1
            }
        }
    ],
    "access_token": "{SYSTEM_USER_ACCESS_TOKEN}",
    "test_event_code": "TEST12345"
}
```

### 5.3 Hashing Rules (SHA256)

| Field | Input | Hash Algorithm |
|:--|:--|:--|
| `em` (email) | Lowercase, trim | SHA256 |
| `ph` (phone) | Remove +, spaces, leading 0 → format quốc tế | SHA256 |
| `fn` (first name) | Lowercase, trim | SHA256 |
| `ln` (last name) | Lowercase, trim | SHA256 |
| `ct` (city) | Lowercase, remove diacritics | SHA256 |
| `country` | ISO 2-letter lowercase (`ro`, `bg`) | SHA256 |
| `external_id` | Order customer ID | SHA256 |

```python
import hashlib

def hash_field(value: str) -> str:
    """SHA256 hash for Meta CAPI user_data fields."""
    if not value:
        return None
    cleaned = value.strip().lower()
    return hashlib.sha256(cleaned.encode('utf-8')).hexdigest()
```

### 5.4 Dedup Strategy

| Field | Value | Purpose |
|:--|:--|:--|
| `event_id` | `order_id` from BigQuery | Meta dedup cùng event từ browser pixel + CAPI |
| `event_time` | Unix timestamp of order creation | Must be within 7 days |

### 5.5 Data Source Query (BigQuery → CAPI)

```sql
-- Query success orders for CAPI push
SELECT
    o.order_id,
    o.order_date,
    UNIX_SECONDS(TIMESTAMP(o.order_date)) AS event_time,
    o.customer_phone,
    o.customer_email,
    o.customer_name,
    o.customer_city,
    o.customer_country_code,
    o.total_amount_ron              AS value,
    'RON'                           AS currency,
    STRING_AGG(DISTINCT pi.custom_id) AS content_ids,
    COUNT(DISTINCT oi.product_id)   AS num_items
FROM `levelup-465304.{DATASET}.vw_fact_orders` o
JOIN `levelup-465304.{DATASET}.fact_order_items_dedup` oi ON o.order_id = oi.order_id
LEFT JOIN `levelup-465304.{DATASET}.product_template` pi ON oi.product_id = pi.id
WHERE o.status_group = 'success'
  AND o.order_date = @target_date
  AND o.order_id NOT IN (
      -- Skip already-pushed orders (idempotency)
      SELECT event_id FROM `levelup-465304.{DATASET}.capi_push_log`
      WHERE push_date = @target_date
  )
GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10
```

### 5.6 `capi_push_log` Table (Idempotency)

```sql
CREATE TABLE IF NOT EXISTS `levelup-465304.{DATASET}.capi_push_log` (
    event_id        STRING NOT NULL,    -- order_id
    push_date       DATE NOT NULL,
    pixel_id        STRING,
    http_status     INT64,
    events_received INT64,              -- Meta response
    fbtrace_id      STRING,             -- Meta trace ID
    pushed_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP()
);
```

---

## 6. Data Flow Diagrams

### 6.1 Prediction → Evaluation Flow

```
[Day 1 — 08:00]                          [Day 2 — 08:00]
Analyst runs                              Analyst runs
    │                                         │
    ├── Predict: ROAS=3.5, Orders=50         ├── Query actual: ROAS=3.2, Orders=45
    │   confidence: 80%                       │
    │                                         ├── Calculate accuracy:
    ├── Save to BQ:                          │   ROAS: |1-|3.5-3.2|/3.2| × 100 = 90.6%
    │   ai_prediction_log                     │   Orders: |1-|50-45|/45| × 100 = 88.9%
    │   (actual_value = NULL)                 │
    │                                         ├── UPDATE ai_prediction_log
    └── Save to SimpleMem:                   │   SET actual_value, accuracy_pct
        predictions for tomorrow              │
                                              ├── Save Lesson if accuracy < 70%:
                                              │   "Overestimated ROAS by 10% — CPM was higher"
                                              │
                                              └── Emit SSE: "Reflection: 75% accuracy"
```

### 6.2 Approval → Execution → Review Flow

```
[T+0: Decision Made]
Director LLM → "Scale Camp_D04 +25%"
    │
    ├── risk_level = 2, budget change > auto_limit
    │
    ├── Snapshot current state → SimpleMem
    │   {budget: 8000, status: ACTIVE}
    │
    └── Send Telegram + Discord message with buttons
        │
        ├── [User clicks ✅ Duyệt] ──────────────────────┐
        │                                                  │
        │   1. Call Meta API: update budget 8000→10000     │
        │   2. Insert approval_logs (APPROVED)             │
        │   3. Create Decision node in FalkorDB            │
        │   4. Reply: "✅ Done"                            │
        │   5. Schedule review_at = T+24h                  │
        │                                                  │
[T+24h: Auto-Review]                                       │
Director checks:                                           │
    │                                                      │
    ├── Query BQ: ROAS before (3.2) vs after (3.5)        │
    ├── Verdict: WIN                                       │
    ├── UPDATE approval_logs: outcome_verdict = 'WIN'     │
    └── Create Lesson: "Scale 25% on D04 → ROAS +0.3 WIN" │
```
