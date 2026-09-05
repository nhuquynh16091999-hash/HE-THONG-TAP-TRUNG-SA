# FAOS v6 — Agentic AI System

> **AI-powered Facebook Ads Optimization System (FAOS)**  
> Two autonomous agents analyzing and managing cross-border e-commerce ad campaigns.

---

## 📁 Directory Structure

```
Agentic-AI-Levelup/
│
├── faos_brain/                  # 🧠 AI CORE — Two autonomous agents
│   ├── analyst.py               #    Executive Analyst (Pillar 2)
│   ├── marketing_director.py    #    Marketing Director (Pillar 3)
│   ├── runner.py                #    CLI orchestrator (daily heartbeat)
│   ├── state_machine.py         #    3-level state machines
│   ├── config.py                #    Settings from .env
│   ├── llm_client.py            #    Gemini → GPT fallback chain
│   ├── webhook_server.py        #    Telegram callback handler
│   ├── prompts/                 #    System prompts (COD logic, rules)
│   ├── models/                  #    Pydantic models
│   ├── graph/                   #    FalkorDB client + seed data
│   ├── workflows/               #    ForcedWorkflow, CAPI push
│   └── api/                     #    FastAPI endpoints (SSE, audit, memory)
│
├── dashboard-ui/                # 🖥️ FRONTEND — Next.js 15 Dashboard
│   └── src/                     #    Pages: Live Feed, Audit, Memory, Settings
│
├── docs/                        # 📚 DOCUMENTATION (v6 only)
│   ├── AGENT_WORKFLOWS.md       #    Agent workflow handbook
│   ├── SYSTEM_ARCHITECTURE.md   #    Architecture + data flow
│   ├── RUNBOOK_V6.md            #    Operations manual
│   ├── SCHEMA_FROZEN.md         #    BigQuery schema freeze
│   ├── 03_AI_Agent_Master_Manual.md  # Core agent spec
│   ├── 05_System_State_Machines.md   # State machine spec
│   └── _archive/                #    Legacy docs (v1-v5)
│
├── sql/                         # 📊 DATABASE
│   ├── v6/                      #    Active v6 DDL + views
│   ├── tables/                  #    Table definitions
│   └── _legacy/                 #    Old SQL files
│
├── scripts/                     # 🔧 DEPLOYMENT & OPS
│   ├── deploy.sh                #    Full deployment script
│   ├── vps-setup.sh             #    VPS initial setup
│   ├── start_backend.sh         #    PM2 backend starter
│   ├── seed_mock_data.py        #    BQ mock data seeder
│   └── telegram-setup.sh        #    Telegram bot setup
│
├── config/                      # ⚙️ CONFIGURATION
│   ├── projects/                #    Per-project config files
│   ├── naming_registry.yaml     #    Campaign naming convention
│   ├── thresholds.yaml          #    ROAS/CPA thresholds
│   └── schedules.yaml           #    Cron schedule config
│
├── tests/                       # 🧪 TESTS
│
├── _deprecated/                 # 🗄️ LEGACY ARCHIVE (v1-v5 code)
│                                #    All old code preserved here
│
├── .env / .env.example          # Environment config
├── requirements.txt             # Python dependencies
├── docker-compose.ai.yml        # FalkorDB + Redis
└── start_dry_run_cycle.sh       # Cron entry point
```

## 🚀 Quick Start

```bash
# 1. Install
pip install -r requirements.txt
cd dashboard-ui && npm install && cd ..

# 2. Configure
cp .env.example .env
# Edit .env with your API keys

# 3. Start FalkorDB
docker compose -f docker-compose.ai.yml up -d

# 4. Run AI (dry run)
python -m faos_brain.runner --project stramark --dry-run

# 5. Start Dashboard
cd dashboard-ui && npm run dev
```

## 📖 Documentation

| Doc | Purpose |
|:----|:--------|
| [AGENT_WORKFLOWS.md](docs/AGENT_WORKFLOWS.md) | How the 2 AI agents work, COD business logic, 6 routing gates |
| [SYSTEM_ARCHITECTURE.md](docs/SYSTEM_ARCHITECTURE.md) | Data flow, BigQuery/FalkorDB schemas, API routes |
| [RUNBOOK_V6.md](docs/RUNBOOK_V6.md) | VPS deployment, troubleshooting, operations manual |
| [SCHEMA_FROZEN.md](docs/SCHEMA_FROZEN.md) | BigQuery table schema freeze |

## 🏗️ Tech Stack

| Layer | Technology |
|:------|:-----------|
| AI Core | Python 3.12, Google Gemini, OpenAI GPT-4o |
| Backend | FastAPI, Uvicorn |
| Frontend | Next.js 15, React 19, Recharts |
| Data | BigQuery, FalkorDB (graph DB) |
| External | Meta Marketing API, Telegram Bot, Discord Webhook |
| Hosting | Contabo VPS (Ubuntu 22.04) |

---

*FAOS v6 — Documentation Freeze 2026-03-02*
