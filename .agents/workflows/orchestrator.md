---
description: Workflow dieu phoi chinh - quyet dinh dung role nao cho task
---

## Step 1: Classify Task
- Feature moi / code moi -> BUILDER checklist (/new-feature)
- Bug fix / loi -> DEBUGGER checklist (/debug)
- Review / kiem tra -> REVIEWER checklist (/code-review)
- Memory/scaffold maintenance -> MAINTAINER
- Khong ro -> HOI USER

## Step 2: Load Context
1. Doc activeContext.md (luon luon)
2. Neu task lien quan module cu the:
   a. Tra CONTEXT_INDEX.md -> tim relevant context
   b. Doc REPO_GRAPH.md -> xac dinh affected modules
3. Neu session moi: chay Self-Healing trigger

## FAOS-Specific Routing
- Task lien quan BigQuery -> doc `docs/SCHEMA_FROZEN.md` truoc
- Task lien quan AI agent -> doc `docs/AGENT_WORKFLOWS.md`
- Task lien quan dashboard -> doc `dashboard-ui/` structure
- Task lien quan config -> doc `config/projects/` va `config/thresholds.yaml`

## Step 3: Execute voi Role Checklist
Load checklist tuong ung. Sau moi milestone -> ghi vao activeContext.

## Step 4: Wrap Up
- Cap nhat CONTEXT_INDEX.md neu co context file moi
- Bao Proactive Alerts neu co
- Neu > 30 messages -> suggest session compact
