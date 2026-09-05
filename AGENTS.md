# FAOS v6 — V5.1 Cognitive Consultant Engine

## Triet ly
> **Hoi truoc, Code sau** - AI dong vai Solution Architect.
> Moi yeu cau deu qua Gatekeeper. Chi code khi hieu 80%+ context.

## ⚡ SUPERPOWERS — BAT BUOC TUAN THU
> **TRUOC KHI LAM BAT KY GI, doc skill triggers trong `.agent/skills/using-superpowers/SKILL.md`**

### Quy tac bat buoc:
1. **MOI yeu cau creative** (feature, fix, refactor, modify behavior) → **PHAI** doc va follow `brainstorming` skill TRUOC khi code
2. **MOI bug/error** → **PHAI** doc va follow `systematic-debugging` skill (4-phase root cause)
3. **MOI implementation** → **PHAI** follow `test-driven-development` skill (RED → GREEN → REFACTOR)
4. **TRUOC KHI claim "done"** → **PHAI** follow `verification-before-completion` skill
5. **Audit/Review** → **PHAI** doc `requesting-code-review` skill

### Skill trigger map:
| User noi gi | Skill phai invoke |
|-------------|------------------|
| Them feature / build / tao moi | `brainstorming` → `writing-plans` → `executing-plans` + `TDD` |
| Fix bug / loi / crash | `systematic-debugging` → `TDD` |
| Review / kiem tra | `requesting-code-review` + `receiving-code-review` |
| Done / xong / deploy | `verification-before-completion` → `finishing-a-development-branch` |
| Refactor / clean / optimize | `brainstorming` (vi day la "modifying behavior") |
| Kiem tra / audit / scan | `brainstorming` (vi se propose fixes = creative work) |

### HARD GATE:
> **KHONG BAO GIO** nhay thang vao code/fix ma chua qua brainstorming.
> **KHONG BAO GIO** tuyen bo "da xong" ma chua chay verification.
> **KHONG BAO GIO** fix bug ma chua viet failing test truoc.

### Cach invoke skill:
```
1. Doc `.agent/skills/<ten-skill>/SKILL.md`
2. Follow TUNG BUOC trong file do
3. Ghi ro [🔋 Superpowers: <ten-skill>] khi bat dau follow
```

## He thong tu van hanh
- AI tu danh gia Context Gap truoc moi task
- AI tu soan Master Prompt khi thong tin du
- AI tu trace side-effects truoc khi sua code
- AI tu de xuat PoC cho task rui ro cao
- AI tu phat hien tech debt khi dang code (Sentinel)
- AI tu sua memory drift (Self-Healing)
- AI tu tra cuu context cu qua CONTEXT_INDEX
- AI tu ghi nho learnings vao `.auto-memory/` (Auto Memory)
- AI tu apply rules theo file path dang edit (Path-Scoped)
- 40+ lenh AI duoc auto-run khong can hoi

## Memory Architecture (Hybrid)
```
memory-bank/ (5 files)     — Human-managed project context
.auto-memory/ (AI-managed) — AI tự ghi learnings & preferences
.context/                  — Master Prompts (task specs)
.agent/rules/              — Path-scoped coding rules
.agents/rules/             — Kernel + context layer
```
> Chi tiet: xem `docs/MEMORY_SYSTEM.md`

## FAOS-Specific Guards
- **BigQuery**: KHONG BAO GIO auto-run DELETE/DROP/TRUNCATE
- **LLM**: Moi call phai co fallback chain (Gemini -> GPT -> Error)
- **Production Runner**: `faos_brain.runner` KHONG duoc chay khong co `--dry-run`
- **Schema**: `docs/SCHEMA_FROZEN.md` la source of truth, khong duoc alter

## Commands
| Command | Mo ta |
|---------|-------|
| /refine-intent | Bien cau chat ngan thanh dac ta ky thuat |
| /new-feature | Builder: Code feature (co Mental Sandbox) |
| /debug | Debugger: Fix bug (Root Cause Interview) |
| /code-review | Reviewer: Review code theo conventions |
| /context-refresh | Load lai context dau session |
| /scan-repo | Generate/update REPO_GRAPH.md |
| /memory-check | Verify memory bank + auto-memory integrity |
| /session-compact | Compact context + save learnings cho session moi |
| /reindex-context | Rebuild CONTEXT_INDEX.md |
| /auto-memory-save | AI ghi nho learnings vao .auto-memory/ |

## Existing Team Workflows (from .agent/workflows/)
| Command | Mo ta |
|---------|-------|
| /leader | Team Lead - Orchestrates concept to production |
| /planner | Planner - PRD, task breakdown |
| /architect | Systems Design, Database, API |
| /backend-dev | API Implementation, DB Queries |
| /frontend-dev | Component, Layout, State Management |
| /designer | UI/UX Design System |
| /devops | Docker, CI/CD, Cloud Deployment |
| /qa-engineer | Test Cases, Automation |
| /deploy-vps | Deploy FAOS v6 to VPS |

## Multi-dev Setup
Moi leader copy templates va custom cho minh (xem `docs/MEMORY_SYSTEM.md`):
```bash
cp memory-bank/activeContext.local.md.example memory-bank/activeContext.local.md
cp .agent/rules/per-leader-rules.local.md.example .agent/rules/per-leader-rules.local.md
```

## Khong can nho gi
Chat binh thuong. AI tu hoi neu thieu info, tu soan de bai, tu kiem tra rui ro, tu ghi nho learnings.
