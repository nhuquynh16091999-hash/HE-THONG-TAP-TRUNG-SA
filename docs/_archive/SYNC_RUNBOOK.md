# 📘 FAOS Data Sync — Operations Runbook

## Overview

Data pipeline syncs from Poscake (POS) + Facebook Ads → BigQuery,
running on VPS `164.68.101.179` via cron.

## Architecture

```
[Poscake API] ──────→ sale_order + order_items    (WRITE_TRUNCATE)
[Facebook Ads API] ──→ fb_ads_data + fb_adset_data (DELETE+APPEND)
[Product API] ──────→ product_stock + product_cogs (WRITE_TRUNCATE)
```

## VPS Paths

| Item | Path |
|------|------|
| Project | `/opt/faos/` |
| Python venv | `/opt/faos/venv/` |
| Sync scripts | `/opt/faos/sync/` |
| Logs | `/opt/faos/logs/` |
| BQ Key | `/opt/faos/bigquery_key.json` |
| .env | `/opt/faos/.env` |

## Cron Schedule (UTC)

| Job | Schedule | What |
|-----|----------|------|
| STRAMARK orders | `0 */2 * * *` | Every 2h — full reload |
| STRAMARK ads | `30 */4 * * *` | Every 4h — DELETE+APPEND |
| STRAMARK full | `0 2 * * *` | Daily 2AM — orders+ads+stock+cogs |
| AUUS1 ads | `30 1,5,9,13,17,21 * * *` | Every 4h — DELETE+APPEND |
| AUUS1 full | `0 3 * * *` | Daily 3AM — ads (+orders when POS ready) |
| TALPHA | `0 4 * * *` | Daily 4AM |
| Log cleanup | `0 0 * * 0` | Weekly — delete 7d+ old logs |

## Anti-Duplicate Strategy

| Data | Strategy | Why |
|------|----------|-----|
| Orders | `WRITE_TRUNCATE` | Full table reload each run → impossible to dupe |
| FB Ads | `DELETE range + APPEND` | Remove date range first → no dupes |
| Stock/COGS | `WRITE_TRUNCATE` | Snapshot data → always latest state |

## Manual Commands

```bash
# SSH into VPS
ssh root@164.68.101.179

# Activate venv
cd /opt/faos && source venv/bin/activate

# Test connections
python sync/stramark_sync.py --test
python sync/auus1_sync.py --test

# Run specific syncs
python sync/stramark_sync.py --orders     # Orders only
python sync/stramark_sync.py --ads        # FB Ads only
python sync/stramark_sync.py --ads --days 7  # Backfill 7 days ads
python sync/stramark_sync.py              # Full sync

# Check cron
crontab -l

# Check logs
tail -50 /opt/faos/logs/stramark_sync.log
tail -50 /opt/faos/logs/auus1_sync.log

# Check recent log files
ls -la /opt/faos/logs/
```

## Troubleshooting

### Sync not running → Check venv
```bash
/opt/faos/venv/bin/python --version
# If "not found" → recreate:
cd /opt/faos && python3 -m venv venv
source venv/bin/activate
pip install requests python-dotenv google-cloud-bigquery
```

### Orders data stale → Run manual sync
```bash
cd /opt/faos && source venv/bin/activate
python sync/stramark_sync.py --orders
```

### FB Ads missing days → Backfill
```bash
python sync/stramark_sync.py --ads --days 30  # Last 30 days
python sync/auus1_sync.py --ads --days 30
```

### Token expired → Update .env
Edit `/opt/faos/.env`, update `META_ACCESS_TOKEN` or `AUUS1_META_ACCESS_TOKEN`.

### BQ Key expired → Replace key
```bash
scp bigquery_key.json root@164.68.101.179:/opt/faos/bigquery_key.json
```

## Known Issues

### AUUS1 POS Orders
- AUUS1 has 2 POS API keys (US + AU) but API returns empty shop_id
- **Status**: FB Ads sync works, order sync needs shop_id investigation
- **Workaround**: Orders from old N8N sync still in BQ (2,986 rows from Feb 14)

### BQ Views Broken
- `vw_daily_pnl` — `project_id` column missing from source table
- `vw_true_roas` — INT64 vs STRING type mismatch
- `vw_fact_ads_performance` — AUUS1 `link_clicks` column missing
- **Impact**: Agent M2-M5 queries fail on these views
- **Fix needed**: Rebuild views with correct column references

## Credentials (DO NOT COMMIT)

- VPS: `root@164.68.101.179`
- BQ Project: `levelup-465304`
- STRAMARK dataset: `STRAMARK_Dataset`
- AUUS1 dataset: `AUUS1_Dataset`
- Meta tokens: in `.env` file
- POS API keys: in `.env` file
