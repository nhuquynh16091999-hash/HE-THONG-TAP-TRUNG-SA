# PHASE 2 — AUTO ADS CARE (Tự động quản lý Quảng cáo)

> **Timeline**: Tuần 4–7 | **Priority**: 🔴 Critical
> **Mục tiêu**: Tự động monitor + optimize ads trên Facebook, TikTok, Google

---

## 1. TỔNG QUAN HỆ THỐNG

```
┌─────────────────────────────────────────────────────┐
│              ADS COMMAND CENTER                      │
│                                                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────┐  │
│  │ FB Ads   │  │ TikTok   │  │ Google Ads       │  │
│  │ Manager  │  │ Ads Mgr  │  │ Manager          │  │
│  └────┬─────┘  └────┬─────┘  └────┬─────────────┘  │
│       │              │              │                │
│       ▼              ▼              ▼                │
│  ┌──────────────────────────────────────────────┐   │
│  │        UNIFIED ADS OPTIMIZER (AI Agent)       │   │
│  │                                                │   │
│  │  Monitor → Analyze → Decide → Execute         │   │
│  │                                                │   │
│  │  Rules Engine:                                  │   │
│  │  • ROAS < 2.0 → Pause ad                       │   │
│  │  • ROAS > 5.0 → Scale budget +20%              │   │
│  │  • CPC > threshold → Alert                     │   │
│  │  • Frequency > 3.0 → Refresh creative           │   │
│  │  • Spend > daily_limit → Pause campaign         │   │
│  └──────────────────────────────────────────────┘   │
│       │              │              │                │
│       ▼              ▼              ▼                │
│  ┌──────────────────────────────────────────────┐   │
│  │            ACTION LOG + DISCORD ALERTS         │   │
│  └──────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

---

## 2. QUY TẮC TỰ ĐỘNG (Rules Engine)

### 2.1 Facebook Ads Rules

| # | Điều kiện | Hành động | Cần approve? |
|:---:|:---|:---|:---:|
| 1 | ROAS 7d < 1.5 AND spend > $50 | ⏸️ Pause ad | ❌ Auto |
| 2 | ROAS 7d > 5.0 AND spend > $20 | 📈 Scale +20% budget | ✅ Manual |
| 3 | CPC > $3.0 (liên tục 3 ngày) | ⚠️ Alert + suggest pause | ❌ Auto alert |
| 4 | CTR < 0.5% (liên tục 3 ngày) | ⏸️ Pause ad | ❌ Auto |
| 5 | Frequency > 3.0 | ⚠️ Alert: cần refresh creative | ❌ Auto alert |
| 6 | Daily spend > budget_limit | ⏸️ Pause campaign | ❌ Auto |
| 7 | No conversion 48h AND spend > $30 | ⏸️ Pause adset | ❌ Auto |
| 8 | CPO < target AND volume > 5 orders | 📈 Suggest scale | ✅ Manual |

### 2.2 TikTok Ads Rules

| # | Điều kiện | Hành động |
|:---:|:---|:---|
| 1 | CPA > 2x target | Pause ad group |
| 2 | CTR < 0.3% sau 24h | Pause ad |
| 3 | Video view rate < 15% | Alert: creative yếu |
| 4 | Conversion cost giảm 30% | Suggest tăng budget |

### 2.3 Google Ads Rules

| # | Điều kiện | Hành động |
|:---:|:---|:---|
| 1 | Search impression share < 50% | Tăng bid |
| 2 | Quality Score < 5 | Alert: cải thiện landing page |
| 3 | CPA > 2x target | Pause keyword/ad group |
| 4 | ROAS > target | Tăng budget |

---

## 3. TÍCH HỢP API

### 3.1 Facebook Marketing API

```python
# Endpoint chính
BASE_URL = "https://graph.facebook.com/v21.0"

# Read operations (mỗi 2h)
GET /{ad_account_id}/insights        # Performance data
GET /{ad_account_id}/campaigns       # Campaign list
GET /{ad_account_id}/adsets          # Adset list
GET /{ad_account_id}/ads            # Ad list

# Write operations (auto care)
POST /{campaign_id}  {"status": "PAUSED"}     # Pause campaign
POST /{adset_id}     {"daily_budget": 5000}   # Update budget (cents)
POST /{ad_id}        {"status": "PAUSED"}     # Pause ad
```

### 3.2 TikTok Marketing API

```python
# Endpoint chính
BASE_URL = "https://business-api.tiktok.com/open_api/v1.3"

# Read
GET /report/integrated/get/    # Performance reports
GET /campaign/get/             # Campaign list
GET /adgroup/get/              # Ad group list

# Write
POST /campaign/status/update/   # Pause/Enable campaign
POST /adgroup/budget/update/    # Update budget
POST /ad/status/update/         # Pause/Enable ad

# Auth: Access Token từ TikTok for Business
# Rate limit: 10 requests/second
```

### 3.3 Google Ads API

```python
# Sử dụng google-ads-python library
from google.ads.googleads.client import GoogleAdsClient

# Read: GoogleAdsService.SearchStream (GAQL)
query = """
  SELECT campaign.id, campaign.name, 
         metrics.cost_micros, metrics.conversions
  FROM campaign 
  WHERE segments.date DURING LAST_7_DAYS
"""

# Write: CampaignService, AdGroupService
# Mutate operations cho pause/enable/budget
```

---

## 4. ADS OPTIMIZER AGENT

```python
# agents/ads_optimizer.py — Cấu trúc chính

class AdsOptimizerAgent:
    """
    Chạy mỗi 2h, thực hiện:
    1. Fetch metrics từ tất cả channels
    2. Evaluate rules engine
    3. Execute auto actions (pause/alert)
    4. Log actions + notify Discord
    """
    
    def run(self, project_id: str):
        # Step 1: Fetch latest metrics
        fb_metrics = self.fetch_facebook_metrics(project_id)
        tt_metrics = self.fetch_tiktok_metrics(project_id)
        gg_metrics = self.fetch_google_metrics(project_id)
        
        # Step 2: Evaluate rules
        actions = self.evaluate_rules(fb_metrics + tt_metrics + gg_metrics)
        
        # Step 3: Execute auto actions
        for action in actions:
            if action.auto_execute:
                self.execute_action(action)
            else:
                self.queue_for_approval(action)
        
        # Step 4: Report
        self.send_discord_summary(project_id, actions)
        self.log_to_bigquery(actions)
```

---

## 5. SAFETY CONTROLS

| # | Biện pháp | Mô tả |
|:---:|:---|:---|
| 1 | **Daily spend cap** | KHÔNG vượt quá budget/ngày được set trong config |
| 2 | **Action log** | MỌI thay đổi đều log vào BigQuery + Discord |
| 3 | **Approval queue** | Scale budget > 20% cần human approve |
| 4 | **Rollback** | Có thể undo action trong 1h |
| 5 | **Kill switch** | Có thể disable auto care per project/channel |
| 6 | **Rate limiting** | FB: 200 req/h, TikTok: 10 req/s, Google: 15k ops/day |

---

## 6. IMPLEMENTATION CHECKLIST

- [ ] Tạo `modules/ads-command-center/` structure
- [ ] Implement Facebook Ads read/write wrapper
- [ ] Implement TikTok Ads read/write wrapper
- [ ] Implement Google Ads read/write wrapper
- [ ] Build rules engine (configurable per project)
- [ ] Build action executor with safety controls
- [ ] Add Discord notification integration
- [ ] Add BigQuery action logging
- [ ] Add approval queue (Discord buttons hoặc Dashboard)
- [ ] Test với 1 project (dry-run mode)
- [ ] Deploy production
