# Master Prompt — FAOS Ads Optimization Intelligence (v6 Final)

> **Status**: Production — M1+M2+M3 Complete, Dashboard AI Command Center ✅
> **Template**: STRAMARK first → replicate to other projects
> **Updated**: 2026-03-08

---

## NGỮ CẢNH
- **Dự án**: FAOS v6 — FB Ads Optimization cho COD e-commerce
- **Stack**: Python (faos_brain/) + BigQuery + FalkorDB + GPT-4o + Telegram + Next.js 15 Dashboard
- **Template**: STRAMARK → AUUS1, TALPHA, T1, zen8, hnle, trendify
- **Phase hiện tại**: Production — Dashboard AI Command Center hoàn thiện

## KIẾN TRÚC — 3 MODULES + DASHBOARD

```
┌─────────────────────────────────────────┐
│ M1: SYNC DATA (cron, 4 tiers)          │
│ fb_ads_data → fact_ads_optimization     │
│ Meta API → video metrics + creative     │
│ sale_order → revenue mapping            │
├─────────────────────────────────────────┤
│ M2: AI PHÂN TÍCH (daily 6AM)           │
│ diagnostic.py (5 signals) +            │
│ content_analyzer.py (creative DNA) +   │
│ GPT-4o narrative → Telegram + JSON     │
├─────────────────────────────────────────┤
│ M3: AI HỌC HỎI (daily 6:30AM)         │
│ pattern_engine.py (5 extractors) →     │
│ BQ ai_pattern_library + FalkorDB       │
│ → JSON → feeds back to M2             │
└─────────────────────────────────────────┘
         ↓ 3 APIs ↓
┌─────────────────────────────────────────┐
│ DASHBOARD — AI COMMAND CENTER           │
│ /api/ai-brain/diagnostic → BQ real-time│
│ /api/ai-brain/insights   → M2+M3 JSON │
│ /api/ai-brain/patterns   → BQ + Falkor│
│                                         │
│ CampaignDiagnostic.tsx — 8 sections:   │
│ ① Anomaly Banner ② KPI + Sparklines   │
│ ③ Marketing Funnel ④ AI Insights GPT   │
│ ⑤ Health Check ⑥ Campaign Scorecard    │
│ ⑦ Content Scoreboard ⑧ Marketer LB    │
│ ⑨ Pattern Library                      │
└─────────────────────────────────────────┘
```

## SCOPE DEFINITION (v6)

### ✅ Thuộc module Ads Optimization:
- Spend → Clicks → Đơn hàng tạo mới → Revenue* (giá trị đơn tạo)
- ROAS* = Revenue đơn tạo / Spend (gần realtime)
- CPO = Spend / Số đơn tạo mới
- AI recommendation: PAUSE / REDUCE / MONITOR / KEEP / SCALE
- Content DNA: phân tích creative_type, marketer, creative_id
- Pattern Learning: mỗi ngày AI học thêm patterns mới
- Hook rate / Hold rate: từ video metrics (Meta API)

### ❌ KHÔNG thuộc module này (→ Operations module):
- Giao hàng thành công / thất bại
- Tỷ lệ hoàn (return rate)
- Doanh thu thực (confirmed delivery revenue)

## CRON SCHEDULE
```
*/30 * * * *  HOT sync (BQ ETL, free)
0 */6 * * *   WARM sync (Meta API: hook_rate/hold_rate)
0 5 * * *     COLD sync (revenue from orders)
30 5 * * *    ONCE sync (creative metadata)
0 6 * * *     M2: GPT-4o → Telegram + JSON
30 6 * * *    M3: Pattern Learning → BQ + FalkorDB + JSON
```

## KEY FILES
| File | Lines | Module | Purpose |
|------|-------|--------|---------|
| sync.py | 657 | M1 | SmartSync 4-tier ETL |
| diagnostic.py | 544 | M2 | 5-signal campaign scorer |
| content_analyzer.py | 242 | M2 | Creative DNA analysis |
| run_daily_diagnostic.py | 402 | M2 | GPT-4o + Telegram runner |
| funnel.py | 153 | M2 | Ads funnel calculator |
| reporter.py | 184 | M2 | Report formatting |
| pattern_engine.py | 486 | M3 | 5 pattern extractors |
| run_pattern_learning.py | 92 | M3 | Daily pattern runner |
| config.py | 117 | All | Project config |
| run_ads_sync.py | 108 | M1 | Sync runner with --date |

## DASHBOARD — 3 APIs

| API Endpoint | Method | Data Source | Heavy BQ? |
|-------------|--------|-------------|-----------|
| `/api/ai-brain/diagnostic` | GET | BQ `fact_ads_optimization` | ✅ Yes (5 queries) |
| `/api/ai-brain/insights` | GET | VPS JSON (M2+M3 files via SSH) | ❌ No |
| `/api/ai-brain/patterns` | GET | BQ `ai_pattern_library` | ✅ Yes |
| `/api/ai-brain/patterns` | POST | BQ + FalkorDB (validate) | Minimal |
| `/api/ai-brain/diagnostic` | POST | Override file (approve/dismiss) | ❌ No |

## DASHBOARD — 9 UI SECTIONS

### ① Anomaly Banner
- **Source**: M2 JSON `anomalies[]`
- **Logic**: Nếu có anomalies → show amber warning banner
- **Display**: Mỗi anomaly 1 dòng text

### ② KPI Cards + Sparklines (F1)
- **Source**: `/api/ai-brain/diagnostic` → `funnel` + `trend`
- **5 cards**: Tổng Chi, Đơn Tạo Mới, CPO, Revenue*, ROAS*
- **Sparkline**: 7-day mini chart (custom SVG inline, zero deps)
- **Trend**: Arrow ↑↓ so sánh day-over-day (% change)

### ③ Marketing Funnel
- **Source**: `/api/ai-brain/diagnostic` → `funnel`
- **Logic**: Impressions → Clicks → Đơn hàng → Revenue
- **Bottleneck**: Red bar + warning khi CTR < 0.5% hoặc CR < 1%
- **Rates**: CTR (clicks/impressions), CR (orders/clicks), AOV (revenue/orders)

### ④ AI Insights (GPT-4o)
- **Source**: M2 JSON `ai_narrative`
- **Display**: Purple-bordered panel, scrollable, Vietnamese narrative
- **Content**: GPT-4o daily analysis (ROAS trends, top wins, recommendations)

### ⑤ Health Check (F8 Benchmarks)
- **Logic**: So sánh metrics hiện tại vs industry benchmarks
- 4 metrics với progress bars:
  - CTR: tốt ≥ 1.5%
  - Hook Rate: tốt ≥ 25% (video views p25/impressions)
  - CPO: tốt ≤ $5 (inverted — thấp hơn = tốt hơn)
  - Frequency: tốt ≤ 3x (inverted — thấp hơn = tốt hơn)

### ⑥ Campaign Scorecard
- **Source**: `/api/ai-brain/diagnostic` → `campaigns`
- **Columns**: Campaign Name, Status, Đơn, CPO, Rev*, ROAS*, Freq, AI Rec, Root Cause, Action
- **Signal dots**: 🟢 Pass / 🟡 Warn / 🔴 Fail — hover để xem reason
- **Frequency (F5)**: Color-coded: <3 green, 3-5 amber, >5 red + fatigue tooltip
- **AI Recommendation badges**: SCALE (green) / KEEP (gray) / MONITOR (yellow) / REDUCE (amber) / KILL (red)
- **Human-in-the-Loop**: Duyệt / Bỏ qua buttons — không auto-execute
- **Expandable**: Click row → accordion ad-level detail (ad name, spend, clicks, CTR, orders, ROAS, Win/Lose)

### ⑦ Content Scoreboard (F2 Hook/Hold)
- **Source**: `/api/ai-brain/diagnostic` → `contentMetrics` (BQ real-time)
- **Display**: Card per creative type (🎬 VIDEO, 🖼️ IMAGE)
- **Metrics**: CTR, Hook Rate, Hold Rate, ROAS, Win%
- **Benchmarks**: Hook ≥25% = ✅, Hold ≥10% = ✅, CTR ≥1.5% = ✅

### ⑧ Marketer Leaderboard (F4)
- **Source**: M2 JSON `content_dna.by_marketer`
- **Display**: 🥇🥈🥉 medals, win% progress bars
- **Data**: Label, ads count, orders, revenue, win rate %

### ⑨ Pattern Library
- **Source**: M3 JSON patterns (via `/api/ai-brain/insights`)
- **Display**: Cards with type badge, outcome (WIN/FAIL), confidence level
- **Actions**: [Approve] button → POST `/api/ai-brain/patterns` → update BQ + FalkorDB
- **Types**: CREATIVE / MARKETER / FATIGUE / FUNNEL / AUDIENCE

## OPERATIONAL RULES
1. ✅ MERGE key = report_date + ad_id → zero duplicates
2. ✅ Revenue = ALL orders created (not delivered)
3. ✅ CTR/CPM/CPC computed from clicks/impressions/spend (not raw nullable)
4. ✅ hook_rate = video_views_p25 / impressions (WARM sync)
5. ✅ LEARNING mode: < 7 days = observe only
6. ✅ Pattern validation: ≥ 3 occurrences = validated
7. ✅ Human-in-the-loop: RECOMMEND_ONLY (user clicks Duyệt/Bỏ qua)

## ✅ COMPLETED
- [x] M1: Smart Sync 4-tier ETL
- [x] M2: AI Diagnostic + Content DNA + GPT-4o + Telegram
- [x] M3: Pattern Learning → BQ + FalkorDB + JSON
- [x] Dashboard: AI Command Center with 9 sections
- [x] F1: KPI Sparklines (7-day trend)
- [x] F2: Content Scoreboard (Hook/Hold/CTR/ROAS by type)
- [x] F4: Marketer Leaderboard (medals, win%, progress bars)
- [x] F5: Frequency column (fatigue indicator)
- [x] F8: Health Check (benchmark progress bars)
