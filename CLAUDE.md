# FAOS v6 — Claude Code Instructions

> Đọc `AGENTS.md` để hiểu toàn bộ workflow của project trước khi làm bất cứ thứ gì.

## Superpowers System

Project này dùng `.agent/skills/` — **LUÔN** follow skill triggers trong `AGENTS.md`:

- Feature mới → `brainstorming` → `writing-plans` → `executing-plans` + TDD
- Bug/Error → `systematic-debugging` → TDD
- Review → `requesting-code-review` + `receiving-code-review`
- Done → `verification-before-completion` → `finishing-a-development-branch`

## Commands nhanh

| Command          | Mô tả                         |
| ---------------- | ----------------------------- |
| `/debug`         | Debug theo 4-phase root cause |
| `/plan`          | Lập kế hoạch feature mới      |
| `/commit`        | Commit chuẩn                  |
| `/review-pr`     | Review trước khi merge        |
| `/scan-security` | Quét bảo mật                  |

## Build & Run

```bash
# Backend (Python)
cd faos_brain && python -m venv venv && source venv/bin/activate
pip install -r ../requirements.txt
python runner.py --dry-run     # LUÔN dùng --dry-run trước

# Frontend (Next.js)
cd dashboard-ui && npm install && npm run dev

# Full stack
docker-compose -f docker-compose.ai.yml up
pm2 status                     # Kiểm tra services
```

## Tech Stack

- **AI Agents**: `faos_brain/analyst.py`, `faos_brain/marketing_director.py`
- **LLM Chain**: Gemini → GPT fallback (xem `faos_brain/llm_client.py`)
- **API**: FastAPI (`faos_brain/api/`)
- **Frontend**: Next.js 15 + React 19 + TailwindCSS (`dashboard-ui/`)
- **DB**: BigQuery + FalkorDB (`faos_brain/graph/`)
- **Infra**: PM2 + Docker

## Critical Guards — KHÔNG BAO GIỜ vi phạm

- **BigQuery**: KHÔNG auto-run DELETE/DROP/TRUNCATE
- **LLM**: Mọi call phải có fallback chain (Gemini → GPT → Error)
- **Runner**: `faos_brain.runner` KHÔNG chạy không có `--dry-run` lần đầu
- **Schema**: `docs/SCHEMA_FROZEN.md` là source of truth, KHÔNG alter
- **Secrets**: KHÔNG commit `.env`, `bigquery_key.json`

## Memory System

```
memory-bank/          — Project context (human-managed)
.auto-memory/         — AI learnings (tự động)
.agent/rules/         — Path-scoped coding rules
.agent/skills/        — Workflow skills
```

## Path-Scoped Rules (tự động load)

- `faos_brain/**/*.py` → `.agent/rules/python-conventions.md`
- `dashboard-ui/**/*.tsx` → `.agent/rules/frontend-conventions.md`
- `sql/**/*.sql` → `.agent/rules/bigquery_data_rules.md`

## Architecture

Xem `docs/SYSTEM_ARCHITECTURE.md` và `REPO_GRAPH.md` để hiểu codebase.
