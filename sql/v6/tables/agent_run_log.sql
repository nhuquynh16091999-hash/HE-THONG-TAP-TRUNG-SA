-- ═══════════════════════════════════════════════════════════════════
-- FAOS v6 — agent_run_log
-- ═══════════════════════════════════════════════════════════════════
-- Bảng lưu trạng thái mỗi lần chạy agent.
-- Mỗi lần runner.py khởi chạy → 1 dòng.
-- Dùng để: Monitor uptime, debug crashes, performance tracking.
--
-- Ref: docs/02_Database_and_API_Specs.md Section 1.3
-- Dataset: Replace {DATASET} with STRAMARK_Dataset / AUUS1_Dataset
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS `levelup-465304.{DATASET}.agent_run_log` (

    -- ─── Primary Key ───
    run_id              STRING        NOT NULL    OPTIONS(description="Unique run ID: {agent}_{date}_{hash}"),

    -- ─── Context ───
    project_id          STRING        NOT NULL    OPTIONS(description="Project: stramark | auus1 | zen8"),
    agent_name          STRING        NOT NULL    OPTIONS(description="Agent: analyst | director | capi_push | daily_review"),
    run_mode            STRING                    OPTIONS(description="full | analysis_only | dry_run"),

    -- ─── Execution State ───
    status              STRING        NOT NULL    OPTIONS(description="SUCCESS | ERROR | HALTED | RUNNING | TIMEOUT"),
    current_step        STRING                    OPTIONS(description="Current/last step: data_gates | analysis | decisions | execution"),
    steps_completed     INT64                     OPTIONS(description="Number of steps completed"),
    steps_total         INT64                     OPTIONS(description="Total steps in workflow"),

    -- ─── Error Details ───
    error_message       STRING                    OPTIONS(description="Error message if status = ERROR"),
    error_step          STRING                    OPTIONS(description="Step that failed"),
    error_traceback     STRING                    OPTIONS(description="Python traceback (truncated to 4000 chars)"),

    -- ─── Performance ───
    duration_seconds    FLOAT64                   OPTIONS(description="Total wall-clock time"),
    llm_calls           INT64                     OPTIONS(description="Number of LLM API calls made"),
    llm_provider_used   STRING                    OPTIONS(description="Primary LLM provider: gemini | openai | rules"),
    llm_tokens_used     INT64                     OPTIONS(description="Total token usage"),

    -- ─── Output Summary ───
    decisions_count     INT64                     OPTIONS(description="Number of decisions generated (director)"),
    predictions_count   INT64                     OPTIONS(description="Number of predictions made (analyst)"),
    auto_executed       INT64                     OPTIONS(description="Decisions auto-executed"),
    pending_approval    INT64                     OPTIONS(description="Decisions sent for approval"),

    -- ─── Timing ───
    started_at          TIMESTAMP     NOT NULL    OPTIONS(description="When run started"),
    completed_at        TIMESTAMP                 OPTIONS(description="When run finished (NULL if still running)")
)
PARTITION BY DATE(started_at)
CLUSTER BY project_id, agent_name, status
OPTIONS(
    description = "FAOS v6 — Agent run log. Tracks every workflow execution with timing and error details.",
    labels = [("system", "faos_v6"), ("type", "ops_log")]
);
