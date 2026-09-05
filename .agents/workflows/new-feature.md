---
description: Builder Checklist V5.1 - voi Mental Sandbox va PoC Protocol
---

## Phase 0: Gatekeeper (tu dong)
- Kiem tra Fast-Track: fix typo / <=1 file <=10 dong -> code ngay
- Kernel chay Context Gap Score
- Neu Gap > 20% -> redirect sang /refine-intent truoc

## Phase 0b: Doc lai Master Prompt (neu co)
- Kiem tra .context/current/{task-name}.md co ton tai khong
- Neu co -> doc lai de dam bao khong troi context

## Phase 1: Context Loading
1. Doc activeContext.md
2. Tra CONTEXT_INDEX.md -> load relevant contexts
3. Doc REPO_GRAPH.md -> modules lien quan

## Phase 2: Mental Sandbox (BAT BUOC)
// turbo-all
4. Liet ke tat ca files se bi thay doi
5. Trace trong REPO_GRAPH bang TOOL THUC TE (grep_search, view_file_outline):
   - File nao IMPORT file nay? Co bi break khong?
   - Shared utilities nao bi anh huong?
   - FAOS-specific: Check `faos_brain/config.py` import chain
6. Tao bang Side-Effect Analysis (PHAI co cot Verified By):
   | File thay doi | Files bi anh huong | Rui ro | Muc do | Verified By |
   Verified By = ten tool da dung (grep_search, view_file_outline, etc.)
   Neu Verified By trong -> side-effect la GIA DINH, KHONG duoc danh gia High.
7. DANH GIA RUI RO:
   - Neu co >= 1 muc High (DA VERIFIED) -> DE XUAT tao PoC.md truoc
   - Neu tat ca Low/Med -> tiep Phase 3

## Phase 2b: PoC Protocol (khi rui ro cao)
8. Tao file docs/poc/{feature-name}-poc.md
9. Gui PoC cho user review -> approve -> tiep Phase 3

## Phase 3: Implementation Plan (Superpowers Enhanced)
10. **Invoke writing-plans skill** (`.agent/skills/writing-plans/SKILL.md`)
    - Tao bite-sized tasks (2-5 phut moi task)
    - Moi task co: exact file paths, complete code, verification steps
    - Enforce TDD: moi task bat dau bang failing test
    - Save plan to `docs/plans/YYYY-MM-DD-<feature-name>.md`
11. Gui plan artifact -> cho user approve

## Phase 4: Execution (Superpowers Enhanced)
12. **Invoke executing-plans skill** (`.agent/skills/executing-plans/SKILL.md`)
    - Execute theo plan bite-sized steps
    - Follow **test-driven-development** skill (`.agent/skills/test-driven-development/SKILL.md`):
      RED -> GREEN -> REFACTOR cycle cho moi step
    - Sentinel checks song song
13. Sau moi milestone -> ghi vao activeContext
14. **Invoke verification-before-completion** (`.agent/skills/verification-before-completion/SKILL.md`):
    - Evidence before claims - chay command verify truoc khi tuyen bo xong

## Phase 5: Post-flight (Superpowers Enhanced)
15. **Invoke finishing-a-development-branch** (`.agent/skills/finishing-a-development-branch/SKILL.md`):
    - Verify tests -> Present 4 options (merge/PR/keep/discard) -> Execute choice
16. Cap nhat progress.md, REPO_GRAPH.md, CONTEXT_INDEX.md
17. FAOS-specific: Chay `python3 -m pytest tests/ --co -q` de verify test collection

## Superpowers Skills Chain
> refine-intent → **brainstorming** → **writing-plans** → **executing-plans** + **TDD** → **verification-before-completion** → **finishing-a-development-branch**
