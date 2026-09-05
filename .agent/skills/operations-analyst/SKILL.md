---
name: operations-analyst
description: E-commerce Operations Agent (A9) — Return analysis, SLA monitoring, fulfillment bottleneck detection, carrier performance for COD logistics.
---

# Operations Analyst (Agent A9)

## Purpose
Operations intelligence for cross-border COD e-commerce. Handles return root cause analysis, delivery SLA monitoring, stale order detection, fulfillment pipeline optimization, and carrier performance tracking.

## Domain Knowledge
This agent understands:
- **18 order status codes** and the fulfillment pipeline flow
- **Return detection** patterns — early warning from status 4 (Returning)
- **Partial returns** (status 15) — new category requiring special handling
- **SLA monitoring** using `estimate_delivery_date` vs actual delivery
- **Fulfillment bottlenecks** — orders stuck in processing stages
- **Carrier analytics** — GHN, GHTK, J&T, Ninja Van performance comparison

## Usage

### 1. Return Analysis
Analyze return patterns, root causes, and carrier correlation.
```bash
python .agent/skills/operations-analyst/scripts/operations.py --action returns
```

### 2. SLA Monitoring
Check delivery SLA compliance and identify breaches.
```bash
python .agent/skills/operations-analyst/scripts/operations.py --action sla
```

### 3. Stale Orders
Find orders stuck in processing for too long.
```bash
python .agent/skills/operations-analyst/scripts/operations.py --action stale
```

### 4. Fulfillment Pipeline
Analyze order flow through processing stages.
```bash
python .agent/skills/operations-analyst/scripts/operations.py --action pipeline
```

### 5. Demand Forecasting
Predict reorder points, safety stock, and stockout dates.
```bash
python .agent/skills/operations-analyst/scripts/operations.py --action forecast
```

### 6. Order Lifecycle
View the full order lifecycle with status codes and alert rules.
```bash
python .agent/skills/operations-analyst/scripts/operations.py --action lifecycle
```

### 7. Schema Review
Review BigQuery schema from operations perspective.
```bash
python .agent/skills/operations-analyst/scripts/operations.py --action schema-review
```

## Key Metrics

```
Delivery Rate    = Success Orders / (Success + Returned + Shipped) × 100
Return Rate      = (Returned + Partial Return) / Total Orders × 100
SLA Breach Rate  = Orders Overdue / Total Shipped × 100
Stale Order Rate = Orders stuck >48h in processing / Total Processing
Avg Fulfillment  = AVG(shipped_at - confirmed_at) in hours
Carrier Score    = Delivery Rate per carrier × (1 - avg_delay_days)
```

## Order Lifecycle Flow
```
New(0) → WaitConfirm(17) → Confirmed(1) → Purchased(20)
    → Restock(11) → WaitPrint(12) → Printed(13) → Packaging(8)
    → WaitPickup(9) → Shipped(2) → Received(3) → Collected(16)
                                  → Returning(4) → Returned(5)
                                  → PartialReturn(15)
    → Canceled(6)
    → Deleted(7) [excluded]
```
