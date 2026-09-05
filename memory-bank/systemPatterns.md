# System Patterns: AUUS (FAOS v6)

## Kien truc tong the
5-Layer Architecture:
1. **Data Layer**: BigQuery (ads metrics) + FalkorDB (knowledge graph) + Redis (state/locks)
2. **Orchestration Layer**: `runner.py` — CLI heartbeat, cron scheduling, multi-project routing
3. **AI Agent Layer**: 2 autonomous agents (Analyst + Marketing Director) with 3-level state machines
4. **Execution Layer**: Meta Marketing API calls, CAPI push, Stock management
5. **Governance Layer**: Telegram/Discord approval flow, audit trail, risk controls

## Key Design Decisions
| Quyet dinh | Ly do | Ngay |
|------------|-------|------|
| Init V5.1 Cognitive Consultant | Chong context gap | 2026-03-04 |
| Gemini primary + GPT fallback | Gemini re hon, GPT backup neu fail | 2026-03 |
| FalkorDB cho graph | Temporal knowledge graph, Redis protocol | 2026-03 |
| Pydantic Settings | Type-safe config tu .env | 2026-03 |
| 3-level State Machine | Agent state: DAILY > CAMPAIGN > AD_SET | 2026-03 |
| SSE cho Live Feed | Real-time streaming dashboard updates | 2026-03 |

## Data Flow
```
BigQuery (ads data)
    ↓
Runner.py (orchestrator, cron)
    ↓
Analyst Agent → analyze metrics → generate report
    ↓
Marketing Director Agent → read report → make decisions
    ↓
Meta Marketing API (execute changes) ← approval gate (Telegram/Discord)
    ↓
Audit Trail (BigQuery) + Knowledge Graph (FalkorDB)
```

## Patterns dang dung
- **LLM Fallback Chain**: Gemini → GPT-4o (auto-switch on error)
- **State Machine**: 3-level (Daily → Campaign → AdSet) cho moi agent
- **Config**: Pydantic BaseSettings + .env (singleton pattern)
- **API**: FastAPI + SSE (Server-Sent Events) cho real-time
- **Approval**: Telegram inline keyboard callbacks
- **Multi-project**: Config per-project trong `config/projects/`
---
(Note: Cap nhat khi refactor hoac them module moi.)
