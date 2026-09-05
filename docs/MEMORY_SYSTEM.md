# MEMORY_SYSTEM.md — Hybrid Memory Architecture

> Hệ thống memory/context của FAOS v6, kết hợp best practices từ Claude Code + V5.1 Cognitive Consultant.

## Architecture Overview

```
┌──────────────────────────────────────────────────────┐
│                   AGENTS.md (Kernel)                 │
│          Gatekeeper + Meta-Prompting + Sentinel      │
├──────────────────────────────────────────────────────┤
│                                                      │
│  ┌─────────────────┐  ┌──────────────────────────┐  │
│  │  Memory Bank     │  │  Auto Memory             │  │
│  │  (Human-managed) │  │  (AI-generated)          │  │
│  │                  │  │                           │  │
│  │  context.md      │  │  INDEX.md (always load)   │  │
│  │  techContext.md   │  │  {topic}.md (on-demand)   │  │
│  │  systemPatterns  │  │                           │  │
│  │  activeContext   │  │  Trigger: corrections,     │  │
│  │  progress.md     │  │  preferences, session end  │  │
│  └─────────────────┘  └──────────────────────────┘  │
│                                                      │
│  ┌─────────────────┐  ┌──────────────────────────┐  │
│  │  Context System  │  │  Path-Scoped Rules       │  │
│  │                  │  │  (.agent/rules/)          │  │
│  │  CONTEXT_INDEX   │  │                           │  │
│  │  .context/       │  │  python-conventions.md    │  │
│  │  current/        │  │  frontend-conventions.md  │  │
│  │  parked/         │  │  sql-conventions.md       │  │
│  └─────────────────┘  │  bigquery_data_rules.md   │  │
│                       └──────────────────────────┘  │
│                                                      │
│  ┌─────────────────┐  ┌──────────────────────────┐  │
│  │  Workflows (20+) │  │  Skills (16+)            │  │
│  │  /context-refresh│  │  api-designer             │  │
│  │  /memory-check   │  │  tech-lead                │  │
│  │  /auto-memory    │  │  test-generator           │  │
│  │  /session-compact│  │  ...                      │  │
│  └─────────────────┘  └──────────────────────────┘  │
└──────────────────────────────────────────────────────┘
```

## File Map

### Memory Bank (`memory-bank/` — 5 files)
| File | Mục đích | Khi nào đọc |
|------|---------|-------------|
| `context.md` | Project brief + Product context | Đầu session hoặc lạc context |
| `techContext.md` | Tech stack, dependencies, env vars | Khi cần biết tech details |
| `systemPatterns.md` | Architecture, design decisions, modules | Khi cần navigate codebase |
| `activeContext.md` | Current focus, milestones, next steps | **Luôn đọc đầu session** |
| `progress.md` | Feature tracker, sprint log, commits | Khi cần check progress |

### Auto Memory (`.auto-memory/` — AI-generated)
| File | Mục đích | Khi nào đọc |
|------|---------|-------------|
| `INDEX.md` | Index of all learnings (max 50 lines) | **Luôn đọc đầu session** |
| `{topic}.md` | Chi tiết theo topic (debugging, prefs...) | Khi topic liên quan |

### Path-Scoped Rules (`.agent/rules/` — auto-apply)
| File | Paths | Mục đích |
|------|-------|---------|
| `bigquery_data_rules.md` | `sql/**/*.sql`, `faos_brain/**/*.py` | BQ join safety, currency rules |
| `python-conventions.md` | `faos_brain/**/*.py`, `tests/**/*.py` | Python coding standards |
| `frontend-conventions.md` | `dashboard-ui/**/*.tsx` | React/Next.js conventions |
| `sql-conventions.md` | `sql/**/*.sql` | BigQuery SQL standards |

### Context System (`.context/`)
| File/Dir | Mục đích |
|----------|---------|
| `CONTEXT_INDEX.md` | Semantic lookup table — tra cứu trước khi đọc files |
| `current/` | Active Master Prompts (task specs đang làm) |
| `parked/` | Completed/paused task specs |

## Setup Guide — New Leader

### Bước 1: Copy local templates
```bash
cp memory-bank/activeContext.local.md.example memory-bank/activeContext.local.md
cp .agent/rules/per-leader-rules.local.md.example .agent/rules/per-leader-rules.local.md
```

### Bước 2: Customize local files
- Edit `activeContext.local.md`: Điền tên, role, project focus
- Edit `per-leader-rules.local.md`: Điền preferences cá nhân

### Bước 3: Start working
- AI sẽ tự động load: `activeContext.md` + `.auto-memory/INDEX.md` + local files
- Path-scoped rules tự apply theo file đang edit
- Dùng `/context-refresh` nếu bị mất context

## Import Reference Convention
Trong memory/context files, dùng `@path/to/file` để tham chiếu file khác:
```
Xem @docs/SCHEMA_FROZEN.md cho BigQuery schema.
Config tại @config/projects/stramark.yaml
```
AI sẽ đọc file được tham chiếu khi cần, KHÔNG load mặc định.

## Key Workflows
| Command | Mô tả |
|---------|-------|
| `/context-refresh` | Load context đầu session |
| `/memory-check` | Verify integrity of all memory files |
| `/auto-memory-save` | AI ghi nhớ learnings vào `.auto-memory/` |
| `/session-compact` | Compact context cho session mới |
| `/scan-repo` | Regenerate REPO_GRAPH.md |

## 13 Criteria Coverage

| # | Tiêu chí | ✅ How |
|---|---------|-------|
| 1 | Setup complexity | `MEMORY_SYSTEM.md` + templates |
| 2 | Auto-learning | `.auto-memory/` + `/auto-memory-save` |
| 3 | Path-scoped rules | YAML `paths:` frontmatter |
| 4 | Active context | `activeContext.md` |
| 5 | Progress tracking | `progress.md` |
| 6 | Session persistence | `/session-compact` + `/context-refresh` |
| 7 | Integrity checking | `/memory-check` |
| 8 | Semantic search | ChromaDB knowledge base |
| 9 | Workflow orchestration | Gatekeeper + Mental Sandbox |
| 10 | Team scalability | `.local.md` + shared rules |
| 11 | Maintenance cost | 5 files (merged from 6) |
| 12 | Import/reference | `@path/to/file` convention |
| 13 | Domain-specific guards | FAOS rules (BQ, LLM, COD) |
