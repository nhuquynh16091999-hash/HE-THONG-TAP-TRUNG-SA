---
name: crm-analyst
description: E-commerce CRM Agent (A8) — Customer segmentation (RFM), fraud/boom detection, lifetime value, churn prediction for COD e-commerce.
---

# CRM Analyst (Agent A8)

## Purpose
Customer intelligence for cross-border COD e-commerce. Handles RFM segmentation, fraud/boom detection (customers who refuse delivery), lifetime value analysis, churn prediction, and customer health scoring.

## Domain Knowledge
This agent understands:
- **RFM Model** — Recency (last_order_at), Frequency (order_count), Monetary (purchased_amount)
- **Boom detection** — Customers with high fail rate (reports_by_phone.order_fail)
- **Blacklist management** — is_block flag for known fraud customers
- **Customer lifecycle** — New → Active → Repeat → VIP → Churned
- **COD-specific risks** — Duplicate phones, fake addresses, bomb orders

## Usage

### 1. RFM Segmentation
Score customers using Recency, Frequency, Monetary model.
```bash
python .agent/skills/crm-analyst/scripts/crm.py --action rfm
```

### 2. Fraud Detection
Identify potential boom/fraud customers.
```bash
python .agent/skills/crm-analyst/scripts/crm.py --action fraud
```

### 3. Customer Health
Score customer health and lifecycle stage.
```bash
python .agent/skills/crm-analyst/scripts/crm.py --action health
```

### 4. Churn Analysis
Identify customers at risk of churning.
```bash
python .agent/skills/crm-analyst/scripts/crm.py --action churn
```

### 5. Audience Segment Export
Export customer segments (VIP, At-Risk, Fraud Exclusion) for ad targeting.
```bash
python .agent/skills/crm-analyst/scripts/crm.py --action audience
```

### 6. Schema Review
Review BigQuery schema from CRM perspective.
```bash
python .agent/skills/crm-analyst/scripts/crm.py --action schema-review
```

## Key Metrics

```
Fraud Score   = CASE
                  returned_orders/total_orders > 0.5 → HIGH
                  returned_orders > 3 → MEDIUM
                  is_blocked → BLOCKED
                  ELSE LOW
Customer Health = CASE
                  success ≥ 5 AND last < 30d → active_vip
                  success ≥ 2 AND last < 60d → active_repeat
                  last > 90d → churned
                  ELSE new
LTV Prediction = avg_order_value × predicted_frequency × customer_lifespan
```

## COD-Specific Fraud Signals
| Signal | Field | Threshold |
|--------|-------|-----------|
| 🚫 Boom history | reports_by_phone.order_fail | > 2 fails |
| 📞 Duplicate phone | duplicated_phone | = true |
| 🔒 Blocked | is_block | = true |
| 📊 High return rate | returned_order_count / order_count | > 50% |
| 🆕 New + big order | order_count = 1 AND cod > average × 3 | Flag for review |
