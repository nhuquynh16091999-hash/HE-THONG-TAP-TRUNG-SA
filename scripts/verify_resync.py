"""Check fb_ads_data coverage for Sep-Dec 2025."""
from google.cloud import bigquery
from google.oauth2 import service_account

c = service_account.Credentials.from_service_account_file("bigquery_key.json")
bq = bigquery.Client(project="levelup-465304", credentials=c)

q = """
SELECT
  FORMAT_DATE('%Y-%m', CAST(date AS DATE)) as month,
  COUNT(*) as row_count,
  COUNT(DISTINCT campaign_name) as campaigns,
  ROUND(SUM(spend), 2) as total_spend_usd,
  MIN(date) as min_date,
  MAX(date) as max_date
FROM `levelup-465304.STRAMARK_Dataset.fb_ads_data`
WHERE CAST(date AS DATE) BETWEEN '2025-09-01' AND '2026-01-31'
GROUP BY 1
ORDER BY 1
"""

print("=== fb_ads_data coverage Sep 2025 - Jan 2026 ===")
for r in bq.query(q).result():
    print(f"  {r.month}: {r.row_count} rows, {r.campaigns} campaigns, ${r.total_spend_usd} spend, dates {r.min_date}→{r.max_date}")

# Also check mart_performance_master ads_spend
q2 = """
SELECT
  FORMAT_DATE('%Y-%m', report_date) as month,
  ROUND(SUM(ads_spend_usd), 2) as ads_spend_usd,
  ROUND(SUM(ads_spend_ron), 0) as ads_spend_ron,
  ROUND(SUM(delivered_revenue), 0) as revenue_ron
FROM `levelup-465304.STRAMARK_Dataset.mart_performance_master`
WHERE report_date BETWEEN '2025-09-01' AND '2026-01-31'
GROUP BY 1
ORDER BY 1
"""

print()
print("=== mart_performance_master ads_spend Sep 2025 - Jan 2026 ===")
for r in bq.query(q2).result():
    status = "✅" if r.ads_spend_ron > 0 else "❌ ads=0"
    print(f"  {r.month}: ads ${r.ads_spend_usd} / {r.ads_spend_ron} RON, revenue {r.revenue_ron} RON  {status}")
