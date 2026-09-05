-- ═══════════════════════════════════════════════════════════════════
-- FAOS v6 — AI Tables
-- ═══════════════════════════════════════════════════════════════════
-- Run: bq query --nouse_legacy_sql < create_ai_tables.sql
-- Dataset: Replace {DATASET} with STRAMARK_Dataset / AUUS1_Dataset
--
-- Ref: docs/02_Database_and_API_Specs.md Section 1.1-1.3
-- ═══════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────
-- 1. ai_prediction_log
-- Lưu dự đoán AI & so sánh T+1 actual
-- ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS `levelup-465304.{DATASET}.ai_prediction_log` (
    -- Primary Key
    prediction_id       STRING NOT NULL,          -- UUID v4

    -- Context
    prediction_date     DATE NOT NULL,            -- Ngày dự đoán
    evaluation_date     DATE,                     -- Ngày so sánh (prediction_date + 1)
    agent               STRING NOT NULL,          -- 'analyst' | 'director'
    project_id          STRING NOT NULL,          -- 'stramark' | 'auus1' | 'zen8'
    run_id              STRING,                   -- Groups predictions from same workflow run

    -- Prediction
    metric              STRING NOT NULL,          -- 'roas', 'total_orders', 'revenue', 'cpm', 'cpa'
    entity_type         STRING,                   -- 'project' | 'campaign' | 'marketer' | 'product'
    entity_id           STRING,                   -- campaign_id, marketer_id, etc. NULL = project-level
    entity_name         STRING,                   -- Human-readable name
    predicted_value     FLOAT64 NOT NULL,         -- Giá trị AI dự đoán
    confidence_pct      FLOAT64,                  -- 0-100: độ tự tin

    -- Actual (filled T+1 by DailyReviewWorkflow)
    actual_value        FLOAT64,                  -- Giá trị thực tế
    accuracy_pct        FLOAT64,                  -- |1 - |predicted-actual|/actual| × 100
    direction_correct   BOOL,                     -- AI dự đoán đúng xu hướng?

    -- Reasoning
    reasoning           STRING,                   -- AI reasoning chain (max 2000 chars)
    reflection_note     STRING,                   -- AI reflection tại sao sai/đúng (filled T+1)

    -- Metadata
    created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP(),
    evaluated_at        TIMESTAMP                 -- Thời điểm so sánh T+1
)
PARTITION BY prediction_date
CLUSTER BY agent, project_id, metric
OPTIONS(
    description = 'FAOS v6: AI prediction log with T+1 evaluation. Each row = 1 prediction for 1 metric.',
    labels = [("system", "faos"), ("version", "6")]
);


-- ───────────────────────────────────────
-- 2. approval_logs
-- Lịch sử duyệt lệnh Human-in-the-Loop
-- ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS `levelup-465304.{DATASET}.approval_logs` (
    -- Primary Key
    log_id              STRING NOT NULL,           -- UUID v4

    -- Decision Reference
    decision_id         STRING NOT NULL,           -- Links to SimpleMem decision snapshot
    agent               STRING NOT NULL,           -- 'director'
    project_id          STRING NOT NULL,           -- 'stramark' | 'auus1'

    -- Action Details
    action              STRING NOT NULL,           -- 'scale_budget', 'kill_campaign', 'pause_adset',
                                                   -- 'new_campaign', 'update_rule', 'realloc_budget'
    entity_type         STRING,                    -- 'campaign' | 'adset' | 'ad'
    entity_id           STRING,                    -- Meta API entity ID
    entity_name         STRING,                    -- Human-readable: "04.02-D04-Romania-CĐ-LC"

    -- Change Details
    change_detail       STRING,                    -- 'budget $80→$100 (+25%)'
    change_value_before FLOAT64,                   -- Pre-action value (cents)
    change_value_after  FLOAT64,                   -- Post-action value (cents)
    change_pct          FLOAT64,                   -- 25.0

    -- AI Reasoning
    reasoning           STRING,                    -- AI explanation (max 2000 chars)
    evidence            STRING,                    -- Data evidence: metrics, trends
    risk_level          INT64,                     -- 1-5 (1=safe, 5=dangerous)

    -- Approval
    approval_status     STRING NOT NULL,           -- 'PENDING', 'APPROVED', 'REJECTED',
                                                   -- 'ROLLED_BACK', 'AUTO_APPROVED', 'EXPIRED',
                                                   -- 'EMERGENCY_PAUSED', 'STOCK_OUT_PAUSED'
    approved_by         STRING,                    -- Username, 'AUTO', 'SYSTEM_TIMEOUT',
                                                   -- 'SYSTEM_INTRADAY', 'SYSTEM_STOCK_CHECK'
    approval_channel    STRING,                    -- 'telegram' | 'discord' | 'dashboard' | 'auto'
    approved_at         TIMESTAMP,

    -- Rollback
    rollback_state_json STRING,                    -- JSON snapshot pre-action state
    rolled_back_at      TIMESTAMP,
    rolled_back_by      STRING,

    -- Meta API Response
    meta_api_response   STRING,                    -- Raw API response JSON
    meta_api_success    BOOL,                      -- API call succeeded?

    -- Outcome (filled 24h later by DailyReviewWorkflow)
    outcome_metric      STRING,                    -- 'roas' | 'cpa' | 'orders'
    outcome_before      FLOAT64,                   -- Metric before action
    outcome_after       FLOAT64,                   -- Metric 24h after
    outcome_verdict     STRING,                    -- 'WIN' | 'LOSS' | 'NEUTRAL'

    -- Timestamps
    created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP(),
    expires_at          TIMESTAMP,                 -- Timeout deadline
    reviewed_at         TIMESTAMP                  -- 24h auto-review timestamp
)
PARTITION BY DATE(created_at)
CLUSTER BY project_id, approval_status, action
OPTIONS(
    description = 'FAOS v6: Human-in-the-Loop approval log. Each row = 1 decision lifecycle.',
    labels = [("system", "faos"), ("version", "6")]
);


-- ───────────────────────────────────────
-- 3. agent_run_log
-- Log mỗi lần Agent chạy (cho Live Feed)
-- ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS `levelup-465304.{DATASET}.agent_run_log` (
    run_id              STRING NOT NULL,            -- UUID per run
    agent               STRING NOT NULL,            -- 'analyst' | 'director'
    project_id          STRING NOT NULL,

    -- Timing
    started_at          TIMESTAMP NOT NULL,
    completed_at        TIMESTAMP,
    duration_seconds    FLOAT64,

    -- Result
    status              STRING,                     -- 'SUCCESS', 'ERROR', 'PARTIAL', 'HALTED'
    steps_completed     INT64,                      -- 0-7 (forced workflow steps)
    error_message       STRING,

    -- Summary
    decisions_count     INT64,                      -- Decisions generated
    predictions_count   INT64,                      -- Predictions made
    lessons_count       INT64,                      -- Lessons learned
    approvals_sent      INT64,                      -- Approval requests sent

    -- Accuracy (reflection runs only)
    prediction_accuracy FLOAT64,                    -- Avg accuracy % for this run

    created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP()
)
PARTITION BY DATE(started_at)
CLUSTER BY agent, project_id, status
OPTIONS(
    description = 'FAOS v6: Agent workflow execution log. Each row = 1 agent run.',
    labels = [("system", "faos"), ("version", "6")]
);


-- ───────────────────────────────────────
-- 4. capi_push_log
-- Log Meta CAPI push events
-- ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS `levelup-465304.{DATASET}.capi_push_log` (
    push_id             STRING NOT NULL,            -- UUID
    push_date           DATE NOT NULL,              -- Date orders were pushed
    project_id          STRING NOT NULL,

    -- Stats
    orders_found        INT64,                      -- Total eligible orders
    orders_pushed       INT64,                      -- Successfully pushed
    orders_skipped      INT64,                      -- Already pushed (dedup)
    orders_failed       INT64,                      -- API errors

    -- Meta Response
    events_received     INT64,                      -- Meta's reported count
    fbtrace_id          STRING,                     -- For debugging with Meta

    -- Timing
    started_at          TIMESTAMP NOT NULL,
    completed_at        TIMESTAMP,
    duration_seconds    FLOAT64,

    -- Status
    status              STRING,                     -- 'SUCCESS', 'PARTIAL', 'FAILED'
    error_message       STRING,

    created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP()
)
PARTITION BY push_date
CLUSTER BY project_id, status
OPTIONS(
    description = 'FAOS v6: Meta CAPI push execution log. Each row = 1 daily push.',
    labels = [("system", "faos"), ("version", "6")]
);
