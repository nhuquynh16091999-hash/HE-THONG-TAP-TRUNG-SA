-- ═══════════════════════════════════════════════════════════════════
-- FAOS v6 — ai_prediction_log
-- ═══════════════════════════════════════════════════════════════════
-- Bảng lưu dự báo của Analyst agent.
-- Mỗi dự báo gồm metric (ROAS, orders, revenue...), giá trị dự đoán,
-- giá trị thực tế (cập nhật T+1), và accuracy %.
--
-- Partition by date để tối ưu scan cost và dễ dàng query theo khoảng ngày.
--
-- Ref: docs/02_Database_and_API_Specs.md Section 1.1
-- Dataset: Replace {DATASET} with STRAMARK_Dataset / AUUS1_Dataset
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS `levelup-465304.{DATASET}.ai_prediction_log` (

    -- ─── Primary Key ───
    prediction_id       STRING        NOT NULL    OPTIONS(description="UUID v4 — unique prediction ID"),

    -- ─── Context ───
    project_id          STRING        NOT NULL    OPTIONS(description="Project: stramark | auus1 | zen8"),
    agent_name          STRING        NOT NULL    OPTIONS(description="Agent that made prediction: analyst | director"),
    run_id              STRING                    OPTIONS(description="Run ID linking to agent_run_log"),

    -- ─── Prediction Data ───
    date                DATE          NOT NULL    OPTIONS(description="The date this prediction is FOR (target day)"),
    metric              STRING        NOT NULL    OPTIONS(description="Metric name: total_orders | revenue | roas | cpa | profit"),
    predicted_value     FLOAT64                   OPTIONS(description="AI predicted value"),
    confidence_pct      FLOAT64                   OPTIONS(description="AI confidence 0-100%"),
    reasoning           STRING                    OPTIONS(description="AI reasoning for this prediction"),

    -- ─── Actual (filled T+1 by reflection workflow) ───
    actual_value        FLOAT64                   OPTIONS(description="Actual observed value (filled next day)"),
    accuracy_pct        FLOAT64                   OPTIONS(description="Accuracy: 100 - |predicted - actual| / actual × 100"),
    direction_correct   BOOL                      OPTIONS(description="Did AI predict correct direction? (UP/DOWN)"),

    -- ─── Metadata ───
    created_at          TIMESTAMP     NOT NULL    DEFAULT CURRENT_TIMESTAMP()
                                                  OPTIONS(description="When prediction was made"),
    updated_at          TIMESTAMP                 OPTIONS(description="When actual_value was filled (T+1 reflection)")
)
PARTITION BY date
CLUSTER BY project_id, metric
OPTIONS(
    description = "FAOS v6 — AI prediction log. Partitioned by date, clustered by project+metric.",
    labels = [("system", "faos_v6"), ("type", "ai_log")]
);
