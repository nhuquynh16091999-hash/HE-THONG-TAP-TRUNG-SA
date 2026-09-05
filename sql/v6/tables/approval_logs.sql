-- ═══════════════════════════════════════════════════════════════════
-- FAOS v6 — approval_logs
-- ═══════════════════════════════════════════════════════════════════
-- Bảng lưu toàn bộ lịch sử duyệt lệnh (Approve/Reject/Rollback).
-- Mỗi decision của Director → 1 dòng log.
-- Trạng thái: PENDING → APPROVED / REJECTED / ROLLED_BACK / EXPIRED / AUTO_APPROVED
--
-- Dùng để: Audit trail, win-rate chart, AI vs Human comparison.
--
-- Ref: docs/02_Database_and_API_Specs.md Section 1.2
-- Dataset: Replace {DATASET} with STRAMARK_Dataset / AUUS1_Dataset
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS `levelup-465304.{DATASET}.approval_logs` (

    -- ─── Primary Key ───
    log_id              STRING        NOT NULL    OPTIONS(description="UUID v4"),

    -- ─── Decision Reference ───
    decision_id         STRING        NOT NULL    OPTIONS(description="Links to DirectorDecision.id"),
    project_id          STRING        NOT NULL    OPTIONS(description="Project: stramark | auus1 | zen8"),
    agent               STRING        NOT NULL    DEFAULT "director"
                                                  OPTIONS(description="Agent that generated decision"),
    run_id              STRING                    OPTIONS(description="Run ID linking to agent_run_log"),

    -- ─── Action Details ───
    action              STRING        NOT NULL    OPTIONS(description="scale_budget | kill_campaign | pause_adset | new_campaign | update_rule"),
    entity_type         STRING                    OPTIONS(description="campaign | adset | ad"),
    entity_id           STRING                    OPTIONS(description="Meta API entity ID"),
    entity_name         STRING                    OPTIONS(description="Human-readable campaign/adset name"),
    account_id          STRING                    OPTIONS(description="Meta Ad Account ID (for delegation matrix)"),

    -- ─── Change Details ───
    change_detail       STRING                    OPTIONS(description="Human-readable: 'Budget $80→$100 (+25%)'"),
    change_value_before FLOAT64                   OPTIONS(description="Pre-action value (cents or %)"),
    change_value_after  FLOAT64                   OPTIONS(description="Post-action value (cents or %)"),
    change_pct          FLOAT64                   OPTIONS(description="Percentage change"),

    -- ─── AI Reasoning ───
    reasoning           STRING                    OPTIONS(description="AI reasoning chain for this decision"),
    risk_level          INT64                     OPTIONS(description="1=safe, 5=dangerous"),
    confidence_pct      FLOAT64                   OPTIONS(description="AI confidence 0-100%"),

    -- ─── Approval Flow ───
    approval_status     STRING        NOT NULL    OPTIONS(description="PENDING | APPROVED | REJECTED | ROLLED_BACK | AUTO_APPROVED | EXPIRED | EMERGENCY_PAUSED | STOCK_OUT_PAUSED"),
    approval_reason     STRING                    OPTIONS(description="Why approval was needed"),
    approved_by         STRING                    OPTIONS(description="User who approved: 'boss' | 'auto' | NULL"),
    approval_channel    STRING                    OPTIONS(description="telegram | discord | auto"),
    approved_at         TIMESTAMP                 OPTIONS(description="When approval action was taken"),

    -- ─── Execution Result ───
    meta_api_response   STRING                    OPTIONS(description="Raw Meta API response JSON"),
    meta_api_success    BOOL                      OPTIONS(description="Did Meta API call succeed?"),
    rollback_state      STRING                    OPTIONS(description="JSON snapshot of pre-action state for rollback"),

    -- ─── Outcome (filled T+24h by reflection) ───
    outcome_verdict     STRING                    OPTIONS(description="POSITIVE | NEGATIVE | NEUTRAL — post-action assessment"),
    outcome_detail      STRING                    OPTIONS(description="Explanation of outcome after 24h"),

    -- ─── Metadata ───
    created_at          TIMESTAMP     NOT NULL    DEFAULT CURRENT_TIMESTAMP()
                                                  OPTIONS(description="When decision was generated")
)
PARTITION BY DATE(created_at)
CLUSTER BY project_id, approval_status
OPTIONS(
    description = "FAOS v6 — Approval audit log. Full decision lifecycle tracking.",
    labels = [("system", "faos_v6"), ("type", "audit_log")]
);
