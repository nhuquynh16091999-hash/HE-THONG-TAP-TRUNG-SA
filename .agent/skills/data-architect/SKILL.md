---
name: data-architect
description: BigQuery Data Architect — Schema design, partitioning strategy, query cost optimization, view design for e-commerce analytics.
---

# Data Architect (Database Agent)

## Purpose
Database architecture intelligence for BigQuery-based e-commerce analytics. Handles schema design, partitioning/clustering strategy, query cost optimization, view design patterns, and data quality rules.

## Domain Knowledge
This agent understands:
- **BigQuery** pricing model ($5/TB scanned) and optimization techniques
- **Star schema** design — fact tables + dimension tables
- **View strategy** — views vs materialized views vs stored tables
- **Deduplication** patterns using ROW_NUMBER() OVER (PARTITION BY)
- **Pancake POS** data model and ETL conventions (÷100 for monetary fields)
- **Cross-border** multi-currency, multi-shop data design

## Usage

### 1. Schema Design
Generate optimized BigQuery schema for e-commerce entities.
```bash
python .agent/skills/data-architect/scripts/architect.py --action schema
```

### 2. Partitioning Strategy
Recommend partition and cluster keys for cost optimization.
```bash
python .agent/skills/data-architect/scripts/architect.py --action partitioning
```

### 3. Query Cost Analysis
Estimate and optimize query costs.
```bash
python .agent/skills/data-architect/scripts/architect.py --action cost
```

### 4. View Design
Generate CREATE VIEW SQL with dedup, computed columns, and proper typing.
```bash
python .agent/skills/data-architect/scripts/architect.py --action views
```

### 5. Data Quality Rules
Generate data validation rules and anomaly detection.
```bash
python .agent/skills/data-architect/scripts/architect.py --action quality
```

### 6. Schema Review
Comprehensive schema review against best practices.
```bash
python .agent/skills/data-architect/scripts/architect.py --action schema-review
```

## BigQuery Best Practices

```
1. PARTITION BY date columns (order_date, ad_date)
   → Reduces scan cost by 10-100x for date-filtered queries

2. CLUSTER BY high-cardinality filter columns (shop_id, status_group)
   → Further reduces scan within partitions

3. Use VIEWs for computed columns (profit, margin, flags)
   → No storage cost, always fresh

4. Use MATERIALIZED VIEWs for heavy aggregations
   → Pre-computed, auto-refreshed

5. FLOAT64 for monetary fields (not INT64)
   → Already ÷100 from ETL

6. STRING for IDs (not INT64)
   → Pancake uses string IDs that may change format

7. ROW_NUMBER() for dedup
   → BigQuery may have duplicate rows from incremental loads
```
