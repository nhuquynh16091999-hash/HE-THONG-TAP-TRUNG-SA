# Repository Graph: AUUS (FAOS v6)
<!-- Auto-generated 2026-04-14. Cap nhat bang /scan-repo -->

## Nodes (Key Entities)

### Backend — faos_brain/ (Python)
| Module | Path | Type | Description |
|--------|------|------|-------------|
| config | faos_brain/config.py | Config | FAOSSettings (Pydantic) |
| **API** | faos_brain/api/ | FastAPI | 15 endpoint files |
| api/main | faos_brain/api/main.py | Server | FastAPI app entry |
| api/dashboard | faos_brain/api/dashboard_api.py | Route | Dashboard BQ queries |
| api/ads_spy | faos_brain/api/ads_spy_api.py | Route | Ads Library + PiPiAds |
| api/live_ads | faos_brain/api/live_ads_api.py | Route | Live scraper control |
| api/budget | faos_brain/api/budget_api.py | Route | Budget management |
| api/alert | faos_brain/api/alert_api.py | Route | Alert notifications |
| api/briefing | faos_brain/api/briefing_api.py | Route | Morning briefing AI |
| api/scorecard | faos_brain/api/scorecard_api.py | Route | Marketer scorecards |
| api/creative | faos_brain/api/creative_api.py | Route | Creative fatigue |
| api/product_test | faos_brain/api/product_test_api.py | Route | Product testing |
| api/inventory | faos_brain/api/inventory_api.py | Route | Poscake stock |
| api/competitor | faos_brain/api/competitor_api.py | Route | Competitor watcher |
| api/autoscale | faos_brain/api/autoscale_api.py | Route | Auto-scale engine |
| api/ad_accounts | faos_brain/api/ad_accounts_api.py | Route | Meta ad accounts |
| **Services** | faos_brain/services/ | Service | 6 service modules |
| svc/autoscale | faos_brain/services/autoscale_engine.py | Service | Auto budget scaling |
| svc/roi_watcher | faos_brain/services/roi_watcher.py | Service | ROI monitoring |
| svc/briefing | faos_brain/services/morning_briefing.py | Service | AI morning briefing |
| svc/creative_fatigue | faos_brain/services/creative_fatigue.py | Service | Creative fatigue detection |
| svc/competitor | faos_brain/services/competitor_watcher.py | Service | Competitor tracking |
| svc/inventory | faos_brain/services/poscake_inventory.py | Service | Poscake stock check |
| **Ads Spy** | faos_brain/ads_spy/ | Crawler | 5 crawler modules |
| spy/crawler | faos_brain/ads_spy/crawler.py | Crawler | Base crawler |
| spy/fb_library | faos_brain/ads_spy/fb_ad_library_api.py | API | Facebook Ad Library |
| spy/live_scraper | faos_brain/ads_spy/live_scraper.py | Scraper | Live ad scraping |
| spy/pipiads | faos_brain/ads_spy/pipiads_crawler.py | Crawler | PiPiAds (TikTok) |
| spy/tiktok_cc | faos_brain/ads_spy/tiktok_cc_crawler.py | Crawler | TikTok CC |
| **Optimization** | faos_brain/optimization/ | Engine | Ads optimization |
| opt/sync | faos_brain/optimization/sync.py | Sync | Meta → BQ sync engine |
| opt/run | faos_brain/optimization/run_ads_sync.py | CLI | Sync runner |
| **Graph** | faos_brain/graph/ | Service | FalkorDB client |
| **Models** | faos_brain/models/ | Pydantic | Data models |
| **Workflows** | faos_brain/workflows/ | Handler | CAPI push, forced actions |

### Backend — Agentic-AI-Levelup/faos_brain/ (Python, Original)
| Module | Path | Type | Description |
|--------|------|------|-------------|
| analyst | Agentic-AI-Levelup/faos_brain/analyst.py | Agent | Executive Analyst (42KB) |
| marketing_director | Agentic-AI-Levelup/faos_brain/marketing_director.py | Agent | Marketing Director (52KB) |
| runner | Agentic-AI-Levelup/faos_brain/runner.py | CLI | Orchestrator + daily cycle |
| state_machine | Agentic-AI-Levelup/faos_brain/state_machine.py | Module | 3-level state machines |
| llm_client | Agentic-AI-Levelup/faos_brain/llm_client.py | Service | Gemini → GPT fallback chain |
| webhook_server | Agentic-AI-Levelup/faos_brain/webhook_server.py | Server | Telegram callback handler |
| api | Agentic-AI-Levelup/faos_brain/api/ | FastAPI | Dashboard endpoints |

### Scaling Ads — scaling-ads/ (TypeScript/Express)
| Module | Path | Type | Description |
|--------|------|------|-------------|
| index | scaling-ads/index.ts | Server | Express entry (port 4000) |
| **Routes** | scaling-ads/src/routes/ | Express | 9 route files |
| r/campaigns | scaling-ads/src/routes/campaigns.ts | Route | Campaign CRUD (16KB) |
| r/auth | scaling-ads/src/routes/auth.ts | Route | JWT auth (14KB) |
| r/broadcasts | scaling-ads/src/routes/broadcasts.ts | Route | Messenger broadcasts |
| r/accounts | scaling-ads/src/routes/accounts.ts | Route | Ad account mgmt |
| r/creatives | scaling-ads/src/routes/creatives.ts | Route | Creative uploads |
| r/fanpages | scaling-ads/src/routes/fanpages.ts | Route | Fanpage PSID |
| r/insights | scaling-ads/src/routes/insights.ts | Route | Performance data |
| r/rules | scaling-ads/src/routes/rules.ts | Route | Scaling rules |
| r/setup | scaling-ads/src/routes/setup.ts | Route | Initial setup |
| **Services** | scaling-ads/src/services/ | Service | 3 service modules |
| s/facebook | scaling-ads/src/services/facebook.ts | Service | Meta Marketing API (28KB) |
| s/poscake | scaling-ads/src/services/poscake.ts | Service | Poscake order API |
| s/ai | scaling-ads/src/services/ai.ts | Service | Gemini AI analysis |
| **Workers** | scaling-ads/src/workers/ | Worker | 4 background workers |
| w/ruleEngine | scaling-ads/src/workers/ruleEngine.ts | Worker | Auto-scaling engine (25KB) |
| w/insightsScanner | scaling-ads/src/workers/insightsScanner.ts | Worker | Periodic data scan |
| w/broadcastRunner | scaling-ads/src/workers/broadcastRunner.ts | Worker | Messenger broadcast |
| w/telegramBot | scaling-ads/src/workers/telegramBot.ts | Worker | Telegram notifications |
| prisma | scaling-ads/prisma/ | Schema | Supabase DB schema |

### Frontend — dashboard-ui/ (Next.js 16 + Tailwind)
| Module | Path | Type | Description |
|--------|------|------|-------------|
| layout | dashboard-ui/src/app/layout.tsx | Layout | Root layout |
| page | dashboard-ui/src/app/page.tsx | Page | Home redirect |
| globals.css | dashboard-ui/src/app/globals.css | Style | Global CSS (8KB) |
| **API Routes** | dashboard-ui/src/app/api/ | Next.js API | 18 API route dirs |
| api/auus1 | dashboard-ui/src/app/api/auus1/ | Route | AUUS1-specific queries |
| api/query | dashboard-ui/src/app/api/query/ | Route | Generic BQ query |
| api/sync-bq | dashboard-ui/src/app/api/sync-bq/ | Route | BQ data sync trigger |
| api/sync-all | dashboard-ui/src/app/api/sync-all/ | Route | Full sync orchestrator |
| api/sync-status | dashboard-ui/src/app/api/sync-status/ | Route | Sync job status |
| api/meta | dashboard-ui/src/app/api/meta/ | Route | Meta API proxy |
| api/scaling | dashboard-ui/src/app/api/scaling/ | Route | Scaling API proxy |
| api/ai-insights | dashboard-ui/src/app/api/ai-insights/ | Route | AI analysis |
| api/ai-brain | dashboard-ui/src/app/api/ai-brain/ | Route | AI brain endpoint |
| api/agent | dashboard-ui/src/app/api/agent/ | Route | Agent interaction |
| api/executive-report | dashboard-ui/src/app/api/executive-report/ | Route | CEO reports |
| api/ad-accounts | dashboard-ui/src/app/api/ad-accounts/ | Route | Ad account data |
| api/auth | dashboard-ui/src/app/api/auth/ | Route | NextAuth |
| api/users | dashboard-ui/src/app/api/users/ | Route | User mgmt |
| api/eushipments | dashboard-ui/src/app/api/eushipments/ | Route | EU shipping |
| api/talpha | dashboard-ui/src/app/api/talpha/ | Route | TAlpha queries |
| api/stramark | dashboard-ui/src/app/api/stramark/ | Route | Stramark queries |
| api/hnle | dashboard-ui/src/app/api/hnle/ | Route | HNLE queries |
| **Project Pages** | | Page | Multi-project |
| pg/auus1 | dashboard-ui/src/app/auus1/ | Page | AUUS1 dashboard |
| pg/t1 | dashboard-ui/src/app/t1/ | Page | T1 dashboard |
| pg/talpha | dashboard-ui/src/app/talpha/ | Page | TAlpha dashboard |
| pg/stramark | dashboard-ui/src/app/stramark/ | Page | Stramark dashboard |
| pg/hnle | dashboard-ui/src/app/hnle/ | Page | HNLE dashboard |
| pg/trendify | dashboard-ui/src/app/trendify/ | Page | Trendify dashboard |
| pg/zen8 | dashboard-ui/src/app/zen8/ | Page | Zen8 dashboard |
| pg/ads-command-center | dashboard-ui/src/app/ads-command-center/ | Page | Ads Command Center |
| pg/admin | dashboard-ui/src/app/admin/ | Page | Admin panel |
| pg/login | dashboard-ui/src/app/login/ | Page | Login page |
| **Components** | dashboard-ui/src/components/ | React | UI components |
| c/admin-home | dashboard-ui/src/components/admin-home.tsx | Component | Admin dashboard (24KB) |
| c/auus1 | dashboard-ui/src/components/auus1/ | Components | AUUS1 tabs + shell |
| c/ads-cmd-center | dashboard-ui/src/components/ads-command-center/ | Components | Ads CMD center |
| c/war-room | dashboard-ui/src/components/war-room/ | Components | War Room |
| c/ui | dashboard-ui/src/components/ui/ | Components | shadcn/ui primitives |
| **Lib** | dashboard-ui/src/lib/ | Util | 8 utility files |
| lib/bq-queries | dashboard-ui/src/lib/bq-queries.ts | Queries | BQ SQL templates (23KB) |
| lib/bq-schema | dashboard-ui/src/lib/bq-schema.ts | Schema | BQ table schemas (7KB) |
| lib/bigquery | dashboard-ui/src/lib/bigquery.ts | Client | BQ client wrapper |
| lib/marketer-map | dashboard-ui/src/lib/marketer-map.ts | Config | Marketer ID mapping (11KB) |
| lib/auth | dashboard-ui/src/lib/auth.ts | Auth | NextAuth config |
| lib/constants | dashboard-ui/src/lib/constants.ts | Config | App constants |
| lib/utils | dashboard-ui/src/lib/utils.ts | Util | clsx + helpers |

### Data Sync — sync/ (Python)
| Module | Path | Type | Description |
|--------|------|------|-------------|
| sync_all | sync/sync_all.py | Orchestrator | Daily sync coordinator (8KB) |
| config_loader | sync/config_loader.py | Util | YAML config loader |
| order_sync_utils | sync/order_sync_utils.py | Util | Shared order sync logic |
| sync/auus1 | sync/auus1/ | Module | AUUS1-specific sync |
| sync/t1 | sync/t1/ | Module | T1 sync |
| sync/talpha | sync/talpha/ | Module | TAlpha sync |
| sync/stramark | sync/stramark/ | Module | Stramark sync |
| sync/zen8 | sync/zen8/ | Module | Zen8 sync |
| sync/trendify | sync/trendify/ | Module | Trendify sync |
| sync/hnle | sync/hnle/ | Module | HNLE sync |

### SQL — sql/ (BigQuery DDL + Views)
| Module | Path | Type | Description |
|--------|------|------|-------------|
| auus1 | sql/auus1/ | SQL | 6 AUUS1-specific views |
| v6 | sql/v6/ | SQL | V6 standard views |
| tables | sql/tables/ | SQL | Table DDL |
| _legacy | sql/_legacy/ | SQL | Legacy views (frozen) |

### Scripts — scripts/ (Shell/Python)
| Module | Path | Type | Description |
|--------|------|------|-------------|
| deploy | scripts/deploy.sh | Shell | VPS deploy (10KB) |
| setup-dev | scripts/setup-dev.sh | Shell | Dev env setup |
| daily_sync | scripts/daily_sync.sh | Shell | Cron daily sync |
| sync_auus1_ads | scripts/sync_auus1_ads.py | Python | AUUS1 Meta → BQ (10KB) |
| sync_auus1_orders | scripts/sync_auus1_orders.py | Python | AUUS1 Poscake → BQ (29KB) |
| sync_auus1_stock | scripts/sync_auus1_stock.py | Python | AUUS1 stock sync |
| sync_meta_to_bq | scripts/sync_meta_to_bq.py | Python | Generic Meta sync |
| init_project_dataset | scripts/init_project_dataset.py | Python | New project BQ init |
| seed_ads_spy | scripts/seed_ads_spy.py | Python | Ads spy seed data |
| validate_queries | scripts/validate-dashboard-queries.py | Python | BQ query validator |

### Config — config/
| Module | Path | Type | Description |
|--------|------|------|-------------|
| AUUS1.yaml | config/projects/AUUS1.yaml | Config | AUUS1 project config (183 lines) |
| thresholds | config/thresholds.yaml | Config | Alert thresholds |
| schedules | config/schedules.yaml | Config | Cron schedules |
| naming_registry | config/naming_registry.yaml | Config | Campaign naming rules |
| project_aliases | config/project_aliases.yaml | Config | Project ID aliases |
| users.json | config/users.json | Config | Dashboard users |
| cost_*.csv | config/cost_*.csv | Data | Cost tables (4 files) |

---

## Edges (Relationships)

### Core Data Flow
| From | To | Type |
|------|-----|------|
| scripts/sync_auus1_ads | BigQuery (fb_ads_data) | writes |
| scripts/sync_auus1_orders | BigQuery (sale_order) | writes |
| sync/sync_all | sync/{project}/ | orchestrates |
| sql/auus1/*.sql | BigQuery views | creates |
| dashboard-ui/api/query | BigQuery | reads |
| dashboard-ui/api/auus1 | BigQuery (AUUS1_Dataset) | reads |
| dashboard-ui/lib/bq-queries | BigQuery | SQL templates |

### Dashboard ↔ Backend
| From | To | Type |
|------|-----|------|
| dashboard-ui/api/scaling | scaling-ads (port 4000) | HTTP proxy |
| dashboard-ui/api/meta | Meta Marketing API | HTTP proxy |
| dashboard-ui/api/ai-insights | Gemini API | calls |
| dashboard-ui/api/sync-bq | scripts/sync_*  | triggers |
| dashboard-ui/components/auus1 | dashboard-ui/api/auus1 | fetches |

### Scaling Ads (Beer Ads)
| From | To | Type |
|------|-----|------|
| scaling-ads/routes/* | scaling-ads/services/* | calls |
| scaling-ads/services/facebook | Meta Marketing API | HTTP |
| scaling-ads/services/poscake | Poscake API | HTTP |
| scaling-ads/workers/ruleEngine | scaling-ads/services/facebook | auto-scale |
| scaling-ads/workers/telegramBot | Telegram API | notifications |
| scaling-ads/workers/broadcastRunner | Meta Send API | messenger |
| scaling-ads/prisma | Supabase (PostgreSQL) | ORM |

### FAOS Brain (AI Agents)
| From | To | Type |
|------|-----|------|
| faos_brain/api/main | faos_brain/services/* | imports |
| faos_brain/services/* | BigQuery | reads |
| faos_brain/services/autoscale | Meta Marketing API | writes |
| faos_brain/ads_spy/* | Meta/PiPiAds/TikTok | crawls |
| Agentic-AI-Levelup/runner | Agentic-AI-Levelup/analyst | calls |
| Agentic-AI-Levelup/runner | Agentic-AI-Levelup/marketing_director | calls |
| Agentic-AI-Levelup/analyst | Gemini/GPT | LLM calls |
| Agentic-AI-Levelup/marketing_director | Telegram | approvals |

### External Services
| Service | Purpose | Config |
|---------|---------|--------|
| BigQuery (levelup-465304) | Data warehouse | AUUS1_Dataset |
| Meta Marketing API | Ads management | 3 ad accounts |
| Poscake API | Order/stock data | US + AU shops |
| Gemini API | AI analysis | gemini-2.5-flash |
| Telegram Bot | Notifications | Bot 8763663929 |
| Supabase | Scaling ads DB | Prisma schema |
| Discord | Webhooks | Report + Alert |

---

## Query Guide
| Can tim gi | Dung tool nao |
|-------------|---------------|
| Cau truc 1 file | view_file |
| Tim file theo ten | list_dir hoac grep_search |
| Tim noi dung function X | grep_search voi query X |
| Tim imports/deps | grep_search 'import\|from' |
| Check BQ queries | view dashboard-ui/src/lib/bq-queries.ts |
| Check marketer mapping | view dashboard-ui/src/lib/marketer-map.ts |
| Check project config | view config/projects/AUUS1.yaml |
