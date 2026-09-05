---
description: Debugger Checklist V5.1 - Root Cause Interview (Superpowers Enhanced)
---

## Phase 0: Gatekeeper
User mo ta bug -> Kernel chay Gap Score
Neu mo ta qua mo ho (Gap > 40%) -> HOI:
- Bug xay ra o man hinh/endpoint nao?
- Co error message cu the khong?
- Lan cuoi no hoat dong dung la khi nao?

## Phase 1: Investigate (Superpowers Enhanced)
1. Doc activeContext.md + REPO_GRAPH.md
2. Tra CONTEXT_INDEX.md -> context lien quan
3. **Invoke systematic-debugging skill** (`.agent/skills/systematic-debugging/SKILL.md`)
   - Phase 1: Root Cause Investigation (doc errors, reproduce, check changes, trace data flow)
   - Phase 2: Pattern Analysis (find working examples, compare differences)
   - Phase 3: Hypothesis and Testing (scientific method, 1 variable at a time)
   - KHONG fix truoc khi xong 3 phases tren!
4. FAOS-specific error logs:
   - Backend: `pm2 logs faos-brain` hoac `docker compose logs`
   - Dashboard: Terminal output tu `npm run dev`
   - BigQuery: Check `agent_run_log` table for errors

## Phase 2: Mental Sandbox
5. Trace REPO_GRAPH nguoc tu bug location
6. Tao bang Impact Analysis
7. FAOS-specific traces:
   - LLM chain: `llm_client.py` -> analyst/director -> error handling
   - Data pipeline: BigQuery query -> config.py -> state_machine

## Phase 3: Root Cause Interview
8. Tao max 3 gia thuyet voi confidence level
9. Test gia thuyet confidence cao nhat truoc
10. **Neu 3+ fix fail** -> Question Architecture (systematic-debugging Phase 4.5)
    - STOP va thao luan voi user truoc khi tiep tuc

## Phase 4: Fix + Verify (Superpowers Enhanced)
11. **Invoke test-driven-development skill** (`.agent/skills/test-driven-development/SKILL.md`)
    - Viet failing test reproduce bug TRUOC
    - Watch it fail (RED)
    - Fix bug (GREEN) - minimal change
    - Rui ro cao -> PoC truoc
12. Chay tests verify + kiem tra regression:
    - `python3 -m pytest tests/ -v`
    - Neu dashboard bug: check browser console
13. **Invoke verification-before-completion** (`.agent/skills/verification-before-completion/SKILL.md`)
    - Evidence before claims - khong tuyen bo "da fix" khi chua chay verify

## Phase 5: Document
14. Ghi milestone. Cap nhat progress.md
15. Neu la recurring bug -> ghi vao systemPatterns.md Known Pitfalls

## Superpowers Skills Chain
> **systematic-debugging** (4-phase root cause) → **test-driven-development** (failing test first) → **verification-before-completion** (evidence before claims)
