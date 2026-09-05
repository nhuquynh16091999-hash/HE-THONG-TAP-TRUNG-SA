---
description: Reviewer Checklist V5.1 (Superpowers Enhanced)
---

## Pre-Review
1. Doc docs/CONVENTIONS.md
2. **Invoke requesting-code-review skill** (`.agent/skills/requesting-code-review/SKILL.md`)
   - Get git SHAs (BASE_SHA, HEAD_SHA)
   - Prepare review context: what was implemented, plan/requirements

## Review Scope
3. Xac dinh scope: git diff hoac files user chi dinh

## Code Quality Checklist
4. Review checklist:
   - Naming conventions (camelCase functions, PascalCase classes, kebab-case files)
   - File <= 300 dong, Function <= 30 dong
   - Error handling dung pattern (try/except voi specific exceptions)
   - Khong hardcoded values (dung config.py hoac .env)
   - Co test coverage (kiem tra tests/ folder)
   - FAOS-specific:
     - LLM calls phai co fallback chain
     - BigQuery queries phai parameterized (khong string concat)
     - State machine transitions phai hop le
     - Config tat ca qua `faos_brain/config.py`

## Architecture Review
5. Doc REPO_GRAPH.md -> check circular dependencies
6. Categorize issues: **Critical** (must fix), **Important** (should fix), **Suggestions** (nice to have)

## Review Reception
7. **Invoke receiving-code-review skill** (`.agent/skills/receiving-code-review/SKILL.md`)
   - Khi nhan feedback: Verify truoc khi implement
   - KHONG performative agreement ("You're absolutely right!")
   - Push back voi technical reasoning neu feedback sai
   - YAGNI check: neu feature khong duoc dung -> remove

## Report
8. Tao report: Passed / Warnings / Violations
   - Critical issues -> block merge
   - Important issues -> fix before proceeding
   - Suggestions -> note for later

## Superpowers Skills Chain
> **requesting-code-review** (dispatch + context) → Review → **receiving-code-review** (verify → implement)
