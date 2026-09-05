"""Verify all BQ views are working."""
import os
os.environ['GOOGLE_APPLICATION_CREDENTIALS'] = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'bigquery_key.json')
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '.env'))
from google.cloud import bigquery
from datetime import datetime

P = 'levelup-465304'
client = bigquery.Client(project=P)

def q(sql):
    try:
        rows = list(client.query(sql).result())
        return str(dict(rows[0].items())) if rows else 'empty'
    except Exception as e:
        return f'❌ {str(e)[:120]}'

print('=' * 60)
print(f'  FAOS GUARDIAN — POST-FIX VERIFICATION')
print(f'  Time: {datetime.now().strftime("%Y-%m-%d %H:%M:%S")}')
print('=' * 60)

for ds in ['STRAMARK_Dataset', 'AUUS1_Dataset']:
    name = ds.replace('_Dataset', '')
    print(f'\n─── {name} ───')
    for v in ['vw_sale_order_latest', 'vw_order_items_latest', 'vw_daily_pnl',
              'vw_true_roas', 'vw_fact_ads_performance']:
        r = q(f'SELECT COUNT(*) c FROM `{P}.{ds}.{v}`')
        print(f'  {v}: {r}')

print('\n─── TOKEN EXPIRY ───')
for p, e in [('STRAMARK','2026-04-26'),('AUUS1','2026-04-16')]:
    d = (datetime.strptime(e,'%Y-%m-%d')-datetime.now()).days
    s = '🔴' if d<7 else ('⚠️' if d<14 else '✅')
    print(f'  {p}: {e} — {d}d — {s}')
print('\n' + '=' * 60)
