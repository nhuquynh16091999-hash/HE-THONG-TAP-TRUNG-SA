# Project Onboarding Guide

> Step-by-step guide to add a **new e-commerce project** to the FAOS system. Each project is fully isolated with its own config, n8n workflows, and Discord channels.

> [!IMPORTANT]
> **Xem thêm**: `docs/PROJECT_CLONE_GUIDE.md` — Hướng dẫn chi tiết hơn bao gồm DDL scripts, data validation queries, và common gotchas.
> **Xem thêm**: `docs/BUG_POSTMORTEM_20260219.md` — Tổng hợp 8 bugs đã gặp khi restructure STRAMARK.

## Prerequisites

Before onboarding, prepare:
- [ ] Poscake POS account with API token
- [ ] Pancake CRM account (if using)
- [ ] Facebook Business Manager access + system user token
- [ ] Discord server with dedicated channel for alerts
- [ ] Product list (will be auto-synced from POS)

## Step 1: Create Project Config

Copy the template and fill in your project details:

```bash
cp config/projects/_template.yaml config/projects/{project_id}.yaml
```

**Required fields to fill:**

```yaml
# ─── 1. PROJECT INFO ───
project_id: myproject        # Unique short ID (lowercase, no spaces)
project_name: "My Project"   # Display name
currency: USD                # Primary currency
status: active               # active / paused / archived

# ─── 2. FACEBOOK ADS ───
meta_ads:
  access_token: "EAAx..."   # System user access token
  ad_account_ids:
    - "act_123456789"        # Ad account IDs

# ─── 3. POS (Poscake) ───
poscake:
  api_token: "abc123"        # From POS → Settings → API
  shop_ids:                  # POS shop IDs for this project
    - "12345678"

# ─── 6. DISCORD ───
discord:
  webhook_report: "https://discord.com/api/webhooks/..."
  webhook_alert: "https://discord.com/api/webhooks/..."
```

## Step 2: Add to POS Shop Mapping

Add the new shop(s) to BigQuery `pos_shop_list`:

```sql
INSERT INTO `levelup-465304.Zen8_Dataset.pos_shop_list`
VALUES ('12345678', 'MyShop Name', 'MYPROJ', 'US');
```

Update `PROJECT_ID_NORMALIZE` in `tools/sync_products.py` if the project_id in pos_shop_list differs from the config project_id.

## Step 3: Sync Products

```bash
python tools/sync_products.py --apply
```

This will:
1. Pull products from POS for the new shop
2. Generate product codes
3. Update `config/naming_registry.yaml`

## Step 4: Create n8n Workflows

Create project folder:
```bash
mkdir n8n/{project_id}
```

Import workflow templates from `n8n/_shared/` into n8n, then customize:
1. **POS Full Sync** — set API token and shop_id
2. **Ads Sync** — set ad account IDs and access token
3. **CS Performance** — configure team members
4. **Logistics Monitor** — set carrier preferences
5. **Stock Intelligence** — set stock thresholds

Export customized workflows as JSON to `n8n/{project_id}/`.

## Step 5: Update Environment

Add project-specific secrets to `.env`:
```bash
# New project
MYPROJ_POSCAKE_API_TOKEN=abc123
MYPROJ_META_ACCESS_TOKEN=EAAx...
MYPROJ_DISCORD_WEBHOOK=https://discord.com/api/webhooks/...
```

## Step 6: Deploy SQL Views

```bash
python sql/deploy.py --project myproject
```

This creates the computed views filtered for the new project.

## Step 7: Verify

```bash
# Test agent for new project
python run_all.py --project myproject --dry-run

# Check product sync
python tools/sync_products.py

# Verify data in BigQuery
# SELECT COUNT(*) FROM Zen8_Dataset.sale_order
# JOIN pos_shop_list ON shop_id = pos_shop_id
# WHERE project_id = 'MYPROJ'
```

## Step 8: Brief the Team

Share with marketers:
- `docs/03_NAMING_CONVENTION.md` — campaign naming rules
- Product codes from `config/naming_registry.yaml`
- Their marketer code

## Onboarding Checklist

```
[ ] config/projects/{id}.yaml created and filled
[ ] pos_shop_list updated in BigQuery
[ ] Products synced (sync_products.py --apply)
[ ] n8n workflows created and running
[ ] .env updated with project secrets
[ ] SQL views deployed
[ ] Dry-run successful
[ ] Discord channel receiving alerts
[ ] Marketing team briefed on naming convention
```
