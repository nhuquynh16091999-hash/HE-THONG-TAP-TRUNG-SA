-- ═══════════════════════════════════════════════════════════════════
-- FAOS v6 — capi_push_log
-- ═══════════════════════════════════════════════════════════════════
-- Bảng lưu lịch sử đẩy sự kiện Purchase lên Meta CAPI.
-- Dùng để: Chống trùng lặp (idempotency) — mỗi order_id chỉ push 1 lần.
--
-- Workflow: capi_push.py query BQ → hash PII → POST Meta CAPI → log ở đây.
-- Lần chạy tiếp theo sẽ EXCLUDE order_id đã có trong bảng này.
--
-- Ref: docs/02_Database_and_API_Specs.md Section 5 (CAPI)
-- Dataset: Replace {DATASET} with STRAMARK_Dataset / AUUS1_Dataset
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS `levelup-465304.{DATASET}.capi_push_log` (

    -- ─── Primary Key ───
    push_id             STRING        NOT NULL    OPTIONS(description="UUID v4 — unique push record"),

    -- ─── Context ───
    project_id          STRING        NOT NULL    OPTIONS(description="Project: stramark | auus1 | zen8"),
    run_id              STRING                    OPTIONS(description="CAPI workflow run_id"),

    -- ─── Order Reference ───
    order_id            STRING        NOT NULL    OPTIONS(description="POS order ID — dedup key"),
    order_date          DATE                      OPTIONS(description="Date the order was placed"),
    order_value         FLOAT64                   OPTIONS(description="Order value in local currency"),
    currency            STRING        DEFAULT "RON"
                                                  OPTIONS(description="Currency code: RON | BGN | EUR"),

    -- ─── Hashed PII (for audit, NOT raw PII) ───
    hashed_email        STRING                    OPTIONS(description="SHA256 of lowercase trimmed email"),
    hashed_phone        STRING                    OPTIONS(description="SHA256 of normalized phone (40...)"),
    hashed_fn           STRING                    OPTIONS(description="SHA256 of lowercase first name"),
    hashed_ln           STRING                    OPTIONS(description="SHA256 of lowercase last name"),

    -- ─── Meta API Response ───
    event_id            STRING                    OPTIONS(description="Meta event_id (= order_id for dedup)"),
    pixel_id            STRING                    OPTIONS(description="Meta Pixel ID used"),
    meta_response_code  INT64                     OPTIONS(description="HTTP response code from Meta"),
    meta_events_received INT64                    OPTIONS(description="events_received count from Meta"),
    meta_error          STRING                    OPTIONS(description="Error message if push failed"),
    push_success        BOOL          NOT NULL    DEFAULT FALSE
                                                  OPTIONS(description="Did Meta accept the event?"),

    -- ─── Timing ───
    pushed_at           TIMESTAMP     NOT NULL    DEFAULT CURRENT_TIMESTAMP()
                                                  OPTIONS(description="When event was pushed to Meta")
)
PARTITION BY DATE(pushed_at)
CLUSTER BY project_id, order_id
OPTIONS(
    description = "FAOS v6 — CAPI push log. Idempotency table for Meta Conversions API. Each order pushed exactly once.",
    labels = [("system", "faos_v6"), ("type", "capi_log")]
);
