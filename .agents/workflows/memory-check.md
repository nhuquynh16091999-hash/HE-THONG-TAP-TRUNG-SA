---
description: Kiem tra tinh toan ven cua Memory Bank
---
// turbo-all
1. Doc progress.md - lay list features 'da hoan thanh'
2. Voi moi feature: verify file/code ton tai
   - FAOS-specific: verify `faos_brain/` modules match progress
3. Doc activeContext.md - check 'Dang lam' co match reality
4. So sanh REPO_GRAPH.md vs thuc te
5. Kiem tra memory-bank files (5 files: context.md, techContext.md, systemPatterns.md, activeContext.md, progress.md)
6. Kiem tra .auto-memory/INDEX.md ton tai va < 50 dong
7. Kiem tra cac FAOS-specific items:
   - `config/projects/` co match voi .env PROJECT configs
   - `sql/v6/` tables match docs/SCHEMA_FROZEN.md
   - `tests/` coverage vs modules trong faos_brain/
8. Tao bao cao: [OK] / [DRIFT] / [STALE]
9. Auto-fix cac DRIFT items don gian
