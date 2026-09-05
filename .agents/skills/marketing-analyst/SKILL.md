---
name: marketing-analyst
description: E-commerce Marketing Agent (G3) — Deep Ads Analytics, Content Performance, P&L Ads, Campaign Optimization for FB/TikTok/Google.
---

# Marketing Analyst (Agent G3)

## Purpose
Performance marketing intelligence for cross-border COD e-commerce. Handles deep ads analytics (FB/TikTok/Google), content performance tracking (Hook Rate, Retention), P&L Ads calculation (real profit after COGS), algorithmic campaign optimization (Kill/Scale rules), and multi-touch attribution.

## Domain Knowledge
This agent understands:
- **Real ROAS** — net of returns/cancellations/COGS, not just gross
- **Platform-specific metrics** — FB (CPM, Frequency), TikTok (Hook Rate, Retention), Google (Quality Score)
- **P&L Ads** — True profit per campaign after deducting COGS, shipping, returns
- **Kill/Scale rules** — Algorithmic logic to pause losers and scale winners
- **Multi-touch attribution** — marketer, ads_source, UTM, fanpage, marketplace
- **Marketplace channels** — Shopee(-3), Lazada(-4), TikTok(-9), Website(-11)
- **Marketer extraction** — JSON_EXTRACT_SCALAR from Pancake marketer object

## Usage

### 1. Deep Ads Analysis (Platform Metrics + P&L)
Analyze ad performance across FB/TikTok/Google with real profit calculation.
```bash
python .agent/skills/marketing-analyst/scripts/marketing.py --action analyze-ads
```

### 2. Campaign Optimization (Kill/Scale/Revive)
Get algorithmic rules to pause bad ads, scale winners, and refresh fatigued creatives.
```bash
python .agent/skills/marketing-analyst/scripts/marketing.py --action optimize-ads
```

### 3. ROAS Analysis
Calculate Gross, Net, Real, and Break-even ROAS.
```bash
python .agent/skills/marketing-analyst/scripts/marketing.py --action roas
```

### 4. Channel Attribution
Analyze traffic source hierarchy and marketplace decode.
```bash
python .agent/skills/marketing-analyst/scripts/marketing.py --action attribution
```

### 5. Schema Review
Review BigQuery schema from marketing/ads perspective.
```bash
python .agent/skills/marketing-analyst/scripts/marketing.py --action schema-review
```

## Key Formulas

```
Gross ROAS       = Revenue / Ad Spend
Net ROAS         = (Revenue - Returns - COGS) / Ad Spend
Real ROAS        = Operating Profit / Ad Spend (TRUE ROI)
Break-even ROAS  = 1 / (Gross Margin % / 100)
Hook Rate        = 3-second video plays / Impressions
Hold Rate        = 15-second video plays / Impressions
ROI              = (Net Profit / Ads Spend) × 100
```

## Kill/Scale Decision Matrix
| Condition | Action |
|-----------|--------|
| Spend > 2x CPA, No Sale | ❌ KILL Ad |
| CTR < 0.5% after 2000 Impr | ❌ KILL Creative |
| ROAS > 2.5x & CPA < Target | ✅ SCALE +20%/day |
| Hook Rate > 30% (TikTok) | ✅ Duplicate AdGroup |
| Frequency > 3 | ♻️ REFRESH Creative |

## Data Sources
- `sale_order` → marketer, ads_source, utm_*, marketplace_id
- `fact_fb_ads` → spend, impressions, clicks, reach per campaign
- `fact_tiktok_ads` → hook_rate, retention, CPA per ad
- `fact_google_ads` → quality_score, conv_rate, cost_per_conv
