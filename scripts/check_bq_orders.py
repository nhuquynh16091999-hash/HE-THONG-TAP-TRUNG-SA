import os
os.environ['GOOGLE_APPLICATION_CREDENTIALS'] = 'bigquery_key.json'
from google.cloud import bigquery

client = bigquery.Client(project='levelup-465304')

q = client.query("""
    SELECT MAX(updated_at) as last_ts, MAX(inserted_at) as last_insert 
    FROM `levelup-465304.STRAMARK_Dataset.sale_order`
""")
for row in q:
    print(f'Last updated_at: {row.last_ts}')
    print(f'Last inserted_at: {row.last_insert}')

q2 = client.query("""
    SELECT DATE(PARSE_TIMESTAMP('%Y-%m-%dT%H:%M:%E*S', inserted_at)) as dt, COUNT(*) as cnt
    FROM `levelup-465304.STRAMARK_Dataset.sale_order`
    WHERE DATE(PARSE_TIMESTAMP('%Y-%m-%dT%H:%M:%E*S', inserted_at)) >= '2026-04-18'
    GROUP BY dt
    ORDER BY dt DESC
""")
print('\nOrders by inserted date:')
for row in q2:
    print(f'  {row.dt}: {row.cnt} orders')
