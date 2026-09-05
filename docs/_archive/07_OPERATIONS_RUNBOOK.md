# Operations Runbook

> Standard operating procedures for daily, weekly, and monthly operations across all projects.

## Daily Operations

### Morning (08:00)
1. **Stock Intelligence** (automated via n8n)
   - Check `product_stock.remain_quantity` vs `selling_avg`
   - Alert products with < 14 days stock
   - Suggest reorder quantities

2. **Logistics Optimizer** runs (automated)
   - Late delivery alerts
   - COD reconciliation check
   - Carrier performance summary

### Mid-day (10:00)
3. **Profit Guardian** runs (automated)
   - Morning ROAS check
   - P&L snapshot
   - Marketer performance alerts

### Afternoon (17:00)
4. **Profit Guardian** runs again (automated)
   - End-of-day ROAS
   - Full afternoon P&L

### Evening (23:00)
5. **Daily Briefer** runs (automated)
   - Full day summary → Discord
   - AI-generated narrative with key insights

6. **CS Coach** runs (automated, 23:30)
   - CS staff leaderboard
   - Conversion rates (inbox → orders)
   - KPI tracking

## Weekly Operations (Monday 09:00)

| Task | Owner | Tool |
|:---|:---|:---|
| Review weekly ROAS trends | Manager | Looker Studio |
| Sync products from POS | System/Manual | `python tools/sync_products.py --apply` |
| Review return rate by product | Manager | Agent #2 weekly digest |
| COD reconciliation follow-up | Finance | Agent #5 report |
| Update exchange rates if needed | Finance | `config/cost_exchange_rates.csv` |

## Monthly Operations (1st of month)

| Task | Owner | Tool |
|:---|:---|:---|
| Update fixed costs | Finance | `config/cost_fixed.csv` |
| Update shipping rates if changed | Operations | `config/cost_shipping.csv` |
| Review marketer KPIs | Manager | `sale_KPIs` table |
| Product profitability review | CEO | Agent #1 monthly report |
| Carrier contract review | Operations | Agent #5 monthly data |

## Data Sync Status

| Source | Destination | Frequency | Via |
|:---|:---|:---|:---|
| Poscake → sale_order | BigQuery | Every 15 min | n8n |
| Poscake → product_stock | BigQuery | Every 15 min | n8n |
| Poscake → customer | BigQuery | Every 15 min | n8n |
| Meta Ads → fb_ads_data | BigQuery | Every 2 hours | n8n |
| Pancake → pancake_data | BigQuery | Every 30 min | n8n |
| Poscake → product_cogs | BigQuery | Manual/daily | `sync_cogs.py` |
| POS → naming_registry | Local YAML | Manual/weekly | `sync_products.py` |

## Troubleshooting

### Agent not sending alerts
1. Check `.env` for `DISCORD_WEBHOOK_URL`
2. Check project config: `config/projects/{project_id}.yaml` → `discord.webhook_report`
3. Run manually: `python -c "from agents.profit_guardian import ProfitGuardian; ProfitGuardian('zen8').run()"`

### Data not syncing
1. Check n8n workflow status
2. Verify API tokens in project config
3. Check BigQuery access: `python tools/bq_client.py --test`

### Wrong project data
1. Verify `pos_shop_list` mapping: shop_id → project_id
2. Run: `python tools/sync_products.py` to verify product-project mapping
