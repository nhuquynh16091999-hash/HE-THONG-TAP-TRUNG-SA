# SCHEMA_FROZEN.md — FAOS v6 Data Dictionary

> **⚠️ FROZEN SCHEMA — Effective 2026-03-02**
>
> This document is the single source of truth for all data structures in FAOS v6.
> **No schema changes are permitted without updating this document first** and getting approval from the project lead.

---

## Table of Contents

1. [BigQuery Tables](#1-bigquery-tables)
2. [BigQuery Views](#2-bigquery-views)
3. [FalkorDB Graph Schema](#3-falkordb-graph-schema)
4. [Change Control Policy](#4-change-control-policy)

---

## 1. BigQuery Tables

**Project:** `levelup-465304`
**Datasets:** `STRAMARK_Dataset`, `AUUS1_Dataset`, `TALPHA_Dataset`, `T1_Dataset` (similar schema, separate data)

---

### 1.1 `ai_prediction_log`

> Stores every prediction made by the Executive AI Analyst. Each prediction has a T+1 accuracy evaluation.

| Column | Type | Mode | Description |
|:--|:--|:--|:--|
| `prediction_id` | `STRING` | REQUIRED | PK — `pred_{date}_{seq}` |
| `run_id` | `STRING` | REQUIRED | FK → `agent_run_log.run_id` |
| `project_id` | `STRING` | REQUIRED | `stramark` \| `auus1` \| `zen8` |
| `agent` | `STRING` | REQUIRED | `analyst` |
| `metric` | `STRING` | REQUIRED | Metric name: `total_orders`, `roas`, `cpa`, `revenue`, `ads_spend` |
| `predicted_value` | `FLOAT64` | REQUIRED | The predicted value |
| `actual_value` | `FLOAT64` | NULLABLE | Filled at T+1 reflection |
| `confidence_pct` | `FLOAT64` | NULLABLE | AI confidence 0-100% |
| `accuracy_pct` | `FLOAT64` | NULLABLE | Calculated: `1 - \|predicted-actual\|/actual × 100` |
| `direction_correct` | `BOOL` | NULLABLE | Did AI predict the right direction? (up/down/flat) |
| `reasoning` | `STRING` | NULLABLE | AI reasoning chain |
| `data_snapshot` | `JSON` | NULLABLE | Input data used for prediction |
| `created_at` | `TIMESTAMP` | REQUIRED | When prediction was made |
| `evaluated_at` | `TIMESTAMP` | NULLABLE | When T+1 reflection ran |

**Partition:** `DATE(created_at)` — daily
**Cluster:** `project_id`, `metric`
**Retention:** 365 days (auto-delete)

---

### 1.2 `approval_logs`

> Full audit trail for every AI decision. Tracks the status lifecycle from PENDING → APPROVED/REJECTED → outcome evaluation.

| Column | Type | Mode | Description |
|:--|:--|:--|:--|
| `decision_id` | `STRING` | REQUIRED | PK — `dec_{date}_{seq}` |
| `run_id` | `STRING` | NULLABLE | FK → `agent_run_log.run_id` |
| `project_id` | `STRING` | REQUIRED | `stramark` \| `auus1` |
| `agent` | `STRING` | REQUIRED | `director` |
| `action_type` | `STRING` | REQUIRED | `scale_budget` \| `kill_campaign` \| `pause_adset` \| `new_campaign` \| `update_rule` |
| `campaign_id` | `STRING` | NULLABLE | Meta campaign/adset/ad ID |
| `campaign_name` | `STRING` | NULLABLE | Human-readable name |
| `entity_type` | `STRING` | NULLABLE | `campaign` \| `adset` \| `ad` |
| `status` | `STRING` | REQUIRED | See Status Enum below |
| `risk_level` | `INT64` | NULLABLE | 1-5 (1=safe, 5=dangerous) |
| `percentage_change` | `FLOAT64` | NULLABLE | Budget change %, e.g., +25.0 |
| `value_before` | `FLOAT64` | NULLABLE | Budget before (cents) |
| `value_after` | `FLOAT64` | NULLABLE | Budget after (cents) |
| `reasoning` | `STRING` | NULLABLE | AI reasoning chain |
| `evidence` | `STRING` | NULLABLE | Data metrics supporting decision |
| `decided_by` | `STRING` | NULLABLE | `ai_auto` \| `human:{name}` \| `telegram:{user_id}` |
| `decided_at` | `TIMESTAMP` | NULLABLE | When decision was approved/rejected |
| `channel` | `STRING` | NULLABLE | `auto` \| `telegram` \| `discord` \| `dashboard` |
| `meta_api_response` | `JSON` | NULLABLE | Raw Meta API response |
| `meta_api_success` | `BOOL` | NULLABLE | Did Meta API call succeed? |
| `rollback_snapshot` | `JSON` | NULLABLE | Pre-action state for rollback |
| `outcome_verdict` | `STRING` | NULLABLE | T+24h: `POSITIVE` \| `NEGATIVE` \| `NEUTRAL` |
| `outcome_detail` | `STRING` | NULLABLE | Explanation of outcome |
| `created_at` | `TIMESTAMP` | REQUIRED | When decision was created |

**Status Enum:**
```
PENDING → AUTO_APPROVED → (Meta API) → SUCCESS | FAILED
PENDING → APPROVED (by human) → (Meta API) → SUCCESS | FAILED
PENDING → REJECTED
PENDING → EXPIRED (TTL 4 hours)
ANY → ROLLED_BACK
ANY → EMERGENCY_PAUSED
ANY → STOCK_OUT_PAUSED
```

**Partition:** `DATE(created_at)` — daily
**Cluster:** `project_id`, `status`
**Retention:** 730 days (2 years)

---

### 1.3 `agent_run_log`

> Operational monitoring — tracks every workflow execution with timing, LLM usage, and error details.

| Column | Type | Mode | Description |
|:--|:--|:--|:--|
| `run_id` | `STRING` | REQUIRED | PK — `wf_{date}_{uuid8}` |
| `project_id` | `STRING` | REQUIRED | `stramark` \| `auus1` |
| `agent` | `STRING` | REQUIRED | `analyst` \| `director` \| `workflow` |
| `run_type` | `STRING` | REQUIRED | `full_daily` \| `analyst_only` \| `director_only` \| `reflection` |
| `status` | `STRING` | REQUIRED | `RUNNING` \| `SUCCESS` \| `FAILED` \| `EMERGENCY_HALT` |
| `dry_run` | `BOOL` | REQUIRED | Was this a dry run? |
| `started_at` | `TIMESTAMP` | REQUIRED | Workflow start time |
| `finished_at` | `TIMESTAMP` | NULLABLE | Workflow end time |
| `duration_seconds` | `FLOAT64` | NULLABLE | Total execution time |
| `steps_completed` | `INT64` | NULLABLE | Number of 7-step phases completed |
| `total_steps` | `INT64` | NULLABLE | Total steps attempted |
| `predictions_count` | `INT64` | NULLABLE | Number of predictions generated |
| `decisions_count` | `INT64` | NULLABLE | Number of decisions generated |
| `lessons_count` | `INT64` | NULLABLE | Number of lessons extracted |
| `llm_provider` | `STRING` | NULLABLE | `gemini` \| `openai` \| `rules` |
| `llm_model` | `STRING` | NULLABLE | Model identifier |
| `llm_prompt_tokens` | `INT64` | NULLABLE | Input token count |
| `llm_completion_tokens` | `INT64` | NULLABLE | Output token count |
| `llm_cost_usd` | `FLOAT64` | NULLABLE | Estimated LLM cost |
| `error_message` | `STRING` | NULLABLE | Error detail if status=FAILED |
| `error_step` | `STRING` | NULLABLE | Which step failed |
| `trigger` | `STRING` | NULLABLE | `cron` \| `manual` \| `webhook` |

**Partition:** `DATE(started_at)` — daily
**Cluster:** `project_id`, `agent`, `status`
**Retention:** 365 days

---

### 1.4 `capi_push_log`

> Idempotency table — ensures each POS order is pushed to Meta Conversions API exactly once. Stores hashed PII for audit.

| Column | Type | Mode | Description |
|:--|:--|:--|:--|
| `push_id` | `STRING` | REQUIRED | PK — `capi_{date}_{uuid8}` |
| `project_id` | `STRING` | REQUIRED | `stramark` \| `auus1` |
| `order_id` | `STRING` | REQUIRED | POS order ID (unique per project) |
| `event_name` | `STRING` | REQUIRED | `Purchase` (fixed for COD) |
| `event_time` | `TIMESTAMP` | REQUIRED | Time of purchase event |
| `pixel_id` | `STRING` | REQUIRED | Meta Pixel ID |
| `action_source` | `STRING` | REQUIRED | `system_generated` (server-side) |
| `order_value` | `FLOAT64` | REQUIRED | Order value in local currency |
| `currency` | `STRING` | REQUIRED | `RON` \| `BGN` \| `VND` |
| `customer_phone_hash` | `STRING` | NULLABLE | SHA-256 hashed phone |
| `customer_email_hash` | `STRING` | NULLABLE | SHA-256 hashed email |
| `fbc` | `STRING` | NULLABLE | Facebook click ID (`fbclid`) |
| `fbp` | `STRING` | NULLABLE | Facebook browser pixel ID |
| `external_id_hash` | `STRING` | NULLABLE | SHA-256 hashed customer ID |
| `meta_api_response` | `JSON` | NULLABLE | Raw CAPI response |
| `meta_event_id` | `STRING` | NULLABLE | Meta returned event ID |
| `push_status` | `STRING` | REQUIRED | `SUCCESS` \| `FAILED` \| `SKIPPED` \| `DUPLICATE` |
| `retry_count` | `INT64` | NULLABLE | Number of retry attempts |
| `error_message` | `STRING` | NULLABLE | Error detail if failed |
| `pushed_at` | `TIMESTAMP` | REQUIRED | When push was attempted |

**Partition:** `DATE(pushed_at)` — daily
**Cluster:** `project_id`, `order_id`
**Retention:** 365 days

> **Idempotency Rule:** Before pushing, always check:
> ```sql
> SELECT 1 FROM capi_push_log
> WHERE order_id = @order_id AND project_id = @project_id AND push_status = 'SUCCESS'
> ```
> If exists → `DUPLICATE`, skip push.

---

## 2. BigQuery Views

### 2.1 `vw_daily_momentum`

> Project-level daily KPIs with COD dual revenue, moving averages, and momentum signals.

| Output Column | Source | Description |
|:--|:--|:--|
| `report_date` | `vw_fact_daily_pnl_v2` | Date |
| `total_orders` | PnL | All POS orders |
| `success_orders` | PnL | Delivered orders |
| `ads_spend_ron` | PnL | Meta ad spend |
| `provisional_revenue` | PnL.`revenue_success` | POS orders created today (may include undelivered) |
| `confirmed_revenue` | PnL.`revenue_confirmed` | POS orders delivered + confirmed |
| `provisional_roas` | Calculated | `provisional_revenue / ads_spend` |
| `confirmed_roas` | Calculated | `confirmed_revenue / ads_spend` |
| `total_leads` | `fb_ads_data` | Meta lead form submissions |
| `total_messages` | `fb_ads_data` | Messenger conversations started |
| `total_atc` | `fb_ads_data` | Add-to-cart actions (G3) |
| `total_clicks` | `fb_ads_data` | Total link clicks (G3) |
| `cost_per_lead` | Calculated | `spend / leads` |
| `cost_per_mess` | Calculated | `spend / messages` |
| `avg_cpm` | `fb_ads_data` | Average CPM (G3) |
| `avg_ctr` | `fb_ads_data` | Average CTR (G3) |
| `avg_frequency` | `fb_ads_data` | Average frequency (G3) |
| `avg_cpc` | `fb_ads_data` | Average CPC (G3) |
| `confirmed_roas_ma7` | Window(7d) | **Primary scaling signal** |
| `*_ma3`, `*_ma7` | Window | Moving averages for all metrics |
| `cpm_ma7`, `freq_ma7` | Window(7d) | CPM and Frequency averages (G3) |
| `ctr_ma7`, `cpc_ma7` | Window(7d) | CTR and CPC averages (G3) |
| `roas_momentum` | Comparison | `UPTREND` \| `STABLE` \| `DOWNTREND` |
| `spend_momentum` | Comparison | `UPTREND` \| `STABLE` \| `DOWNTREND` |
| `cpl_momentum` | Comparison | Cost-per-lead trend |
| `cpm_momentum` | Comparison | CPM trend — UPTREND = audience saturation (G3) |
| `frequency_momentum` | Comparison | `SATURATED` (>3) \| `UPTREND` \| `STABLE` \| `DOWNTREND` (G3) |
| `click_to_atc_rate` | Calculated | Funnel: clicks → add-to-cart (G3) |
| `atc_to_lead_rate` | Calculated | Funnel: add-to-cart → lead (G3) |

**Window:** `ROWS BETWEEN 6 PRECEDING AND CURRENT ROW` (7-day)
**Source:** `vw_fact_daily_pnl_v2` LEFT JOIN `fb_ads_data`
**Filter:** Last 90 days

---

### 2.2 `vw_marketer_momentum`

> Per-marketer daily performance with COD-adjusted ROAS and "Bảng Phong Thần" verdict.

| Output Column | Description |
|:--|:--|
| `marketer_name` | Marketer identifier |
| `confirmed_roas_ma7` | 7-day confirmed ROAS (scaling signal) |
| `provisional_roas_ma7` | 7-day provisional ROAS (monitoring) |
| `spend_ma7`, `cpa_ma7` | Moving averages |
| `confirmed_roas_momentum` | `UPTREND` \| `STABLE` \| `DOWNTREND` |
| `verdict` | **`KEO_SO`** (≥2.5) \| **`ON_DINH`** (1.3-2.5) \| **`DOT_TIEN`** (<1.3) |
| `efficiency_score` | `confirmed_roas_ma7 × (success / total orders)` |
| `phantom_revenue_warning` | `TRUE` if provisional >> confirmed (×1.5) |

**Partition by:** `marketer_name` (window)
**Source:** `vw_fact_daily_pnl_marketer`
**Filter:** Last 30 days, `ads_spend > 0`

---

### 2.3 `vw_product_lifecycle`

> BCG Matrix classification per product/campaign based on confirmed revenue.

| Output Column | Description |
|:--|:--|
| `product_code` | Product identifier |
| `campaign_id` | Meta campaign ID |
| `days_active` | Days with ad spend |
| `confirmed_roas_ma7` | Primary signal |
| `confirmed_roas_momentum` | `UPTREND` \| `STABLE` \| `DOWNTREND` |
| `bcg_stage` | **`STAR`** \| **`CASH_COW`** \| **`QUESTION_MARK`** \| **`DOG`** |
| `recommended_action` | `SCALE` \| `MAINTAIN` \| `MONITOR` \| `KILL` \| `LEARNING` |
| `scale_eligible` | Boolean — strict eligibility check |
| `phantom_revenue_warning` | `TRUE` if provisional >> confirmed |
| `success_rate_7d` | 7-day delivery success rate % |

**BCG Thresholds:**

| Stage | ROAS MA7 | Momentum | Days Active | Action |
|:--|:--|:--|:--|:--|
| ⭐ Star | ≥ 3.0 | UPTREND | ≥ 7 | SCALE |
| 🐄 Cash Cow | ≥ 2.5 | STABLE | ≥ 14 | MAINTAIN |
| ❓ Question | any | any | < 7 or borderline | MONITOR |
| 🐕 Dog | < 1.3 | DOWNTREND | ≥ 5 | KILL |

**Scale Eligibility (ALL must be true):**
- `confirmed_roas_ma7 ≥ 3.0`
- `confirmed_roas_ma3 > confirmed_roas_ma7` (UPTREND)
- `days_active ≥ 7`
- `success_rate_7d ≥ 70%`
- No phantom revenue warning

---

### 2.4 `vw_creative_fatigue` (G3 Enhancement)

> Flags ads with creative fatigue signals: dead creative, audience saturation, wearing out.

| Output Column | Description |
|:--|:--|
| `ad_id`, `ad_name` | Ad identifier |
| `adset_id`, `campaign_id` | Parent entities |
| `total_impressions` | Total impressions (30-day) |
| `avg_ctr`, `avg_frequency` | Performance metrics |
| `ctr_last3d`, `ctr_last7d` | CTR trend comparison |
| `fatigue_status` | `DEAD_CREATIVE` \| `AUDIENCE_SATURATED` \| `WEARING_OUT` \| `HEALTHY` |
| `fatigue_severity` | 1-5 (5 = most severe) |
| `recommended_action` | `KILL_AD` \| `REFRESH_CREATIVE` \| `MONITOR_CLOSELY` \| `NO_ACTION` |

**Fatigue Rules:**

| Status | Condition | Severity |
|:--|:--|:--|
| DEAD_CREATIVE | CTR < 0.5% after 2000+ impressions | 5 |
| AUDIENCE_SATURATED | Frequency > 3.0 | 3-4 |
| WEARING_OUT | CTR declining (last3d < last7d × 0.7) | 2 |

**Source:** `fb_ads_data`
**Filter:** Last 30 days, only problematic ads

---

## 3. FalkorDB Graph Schema

**Engine:** FalkorDB (Redis-compatible graph database)
**Graph Name:** `faos_v6`

### 3.1 Node Labels (11)

| Label | Key Properties | Description |
|:--|:--|:--|
| `Campaign` | `id`, `name`, `project`, `status`, `lifecycle_stage` | Meta ad campaign representation |
| `Decision` | `id`, `agent`, `action`, `approval_status`, `timestamp` | AI decision node (linked to approval_logs) |
| `Lesson` | `id`, `category`, `source_agent`, `confidence`, `project_id`, `lesson_text`, `created_at` | AI-learned insight (roas, cpa, budget, creative, targeting, market, product) |
| `SOP` | `id`, `name`, `version`, `title`, `content`, `source`, `project_id` | Standard Operating Procedure document |
| `Prediction` | `id`, `agent`, `metric`, `predicted_value`, `actual_value` | AI prediction node |
| `PersonalityConfig` | `id`, `agent`, `risk_level`, `auto_budget_limit`, `daily_auto_ceiling` | Per-project AI behavior settings |
| `AdAccountConfig` | `id`, `project_id`, `account_id`, `managed_by`, `account_name` | Ad account delegation (AI/HUMAN) |
| `Marketer` | `id`, `marketer_name` | Marketing team member |
| `Product` | `id`, `product_code` | E-commerce product |
| `Market` | `id`, `market_code` | Geographic market (Romania, Bulgaria, etc.) |
| `Event` | `id`, `event_type` | System event log |
| `CPMSnapshot` | `campaign_id`, `date`, `budget_before`, `budget_after`, `change_pct` | CPM tracking after scale actions (G3) |

### 3.2 Edge Types (13)

| Edge Type | From → To | Description |
|:--|:--|:--|
| `HAS_ADSET` | Campaign → Campaign | Parent campaign to adset |
| `PROMOTES` | Campaign → Product | Campaign promotes which product |
| `MANAGED_BY` | Campaign → Marketer | Who runs this campaign |
| `TARGETS` | Campaign → Market | Campaign targets which market |
| `DECIDED_ON` | Decision → Campaign | Decision affects this campaign |
| `CAUSED_BY` | Lesson → Decision | Lesson learned from decision outcome |
| `LED_TO` | Decision → Decision | Decision chain |
| `PREDICTED` | Prediction → Campaign | Prediction about this campaign |
| `VALIDATED_BY` | Prediction → Decision | Prediction validated by real outcome |
| `SUPERSEDES` | SOP → SOP | New SOP version supersedes old |
| `APPLIES_TO` | SOP → Campaign | SOP applies to campaign type |
| `LEARNED_FROM` | Lesson → Event | Lesson learned from event |
| `ROLLED_BACK` | Decision → Decision | Decision was rolled back |

### 3.3 Indexes (27)

All indexes are exact-match indexes on node properties for fast `MATCH` lookups.

```
Campaign:    id, name, project, status, lifecycle_stage  (5)
Decision:    id, agent, action, approval_status, timestamp  (5)
Lesson:      id, category, source_agent, confidence  (4)
SOP:         id, name, version  (3)
Prediction:  id, agent, metric  (3)
PersonalityConfig: id, agent  (2)
AdAccountConfig:   id, project_id, account_id, managed_by  (4)
Marketer:    id, marketer_name  (2)
Product:     id, product_code  (2)
Market:      id, market_code  (2)
Event:       id, event_type  (2)
                                                      ───────
                                              TOTAL:   27 indexes
```

---

## 4. Change Control Policy

> [!CAUTION]
> **This schema is FROZEN as of 2026-03-02.**

### Rules

1. **No column additions/removals** without updating this document first
2. **No type changes** (e.g., STRING→INT64) — create a new column instead
3. **No partition/cluster changes** — requires table recreation
4. **No graph node/edge deletions** — only additions allowed
5. **All changes** require:
   - PR with updated `SCHEMA_FROZEN.md`
   - Review by project lead
   - Migration script in `sql/v6/migrations/`

### Version History

| Date | Version | Change | Author |
|:--|:--|:--|:--|
| 2026-03-02 | 1.0 | Initial freeze — 4 tables, 3 views, 11 nodes, 13 edges | FAOS Team |
| 2026-03-07 | 1.1 | G3 Enhancement: +7 cols in fb_ads_data, +1 view (vw_creative_fatigue), +1 node (CPMSnapshot), momentum signals in vw_daily_momentum | G3 Audit |

---

*Generated: 2026-03-02 | Source: `sql/v6/`, `faos_brain/graph/schema.py`*
