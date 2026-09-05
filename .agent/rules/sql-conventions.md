---
paths:
  - "sql/**/*.sql"
---
# SQL Conventions — FAOS v6 BigQuery

## Dialect
- Google BigQuery Standard SQL (KHONG dung Legacy SQL)
- Luon bat dau voi `-- Purpose: {mo ta}` comment

## Join Safety (CRITICAL)
- **LUON** `LOWER(TRIM())` truoc khi join string fields
- **LUON** dung deduplicated subquery khi JOIN voi dim tables:
  ```sql
  LEFT JOIN (
    SELECT LOWER(TRIM(key_col)) AS key, ANY_VALUE(val_col) AS val
    FROM dim_table GROUP BY 1
  ) t ON LOWER(TRIM(main.field)) = t.key
  ```
- **KHONG BAO GIO** direct join voi dim tables (risk nhan doi rows)

## Counting
- Dung `COUNT(DISTINCT id)` hoac `COUNT(DISTINCT order_id)` khi dem don
- Dung `SUM(DISTINCT ...)` can than — thuong sai, prefer subquery

## Currency
- `sale_order.total_price` luu theo **bani** (chia 100 de ra RON)
- Luon ghi comment khi chia: `total_price / 100 AS revenue_ron`

## Naming
- Views: `vw_fact_{topic}` hoac `vw_dim_{topic}`
- Tables: snake_case (`sale_order`, `fb_ads_data`)
- Columns: snake_case, descriptive (`created_at`, `total_price`)

## Safety
- **TUYET DOI KHONG** chay DELETE/DROP/TRUNCATE tren production
- Test queries voi `LIMIT 10` truoc khi chay full
- Luon co WHERE clause khi UPDATE
