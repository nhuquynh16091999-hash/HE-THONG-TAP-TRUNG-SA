# CONTEXT LAYER - Auto-Load khi bat dau session

## === SESSION AUTO-START (V5.1+) ===
Khi bat dau session moi (tin nhan DAU TIEN tu user):
1. Doc memory-bank/activeContext.md → lay Current Focus + Blockers
2. Chay: git log --oneline -3 → so sanh voi Session History
3. Neu DRIFT → auto-fix activeContext.md
4. Tom tat 3 dong cho user: "📋 Context: [focus] | [last commit] | [blocker]"
5. Hoi: "Ban muon lam gi tiep?"
→ KHONG can user go /context-refresh

## Coding (tham chieu, khong copy)
-> Tuan thu `docs/CONVENTIONS.md` (doc khi can, khong load mac dinh)

## Platform (Auto-detect)
AI tu dong nhan dien OS cua user va dieu chinh:
- **Windows**: Dung PowerShell hoac `cmd /c` prefix cho shell commands
- **macOS**: Dung Terminal truc tiep (zsh/bash), `python3` thay vi `python`
- **Path**: Dung separator phu hop OS (`\\` Windows, `/` Mac/Linux)

## Memory Protocol
- **Session start**: Doc activeContext.md + git log -3 (TU DONG, xem SESSION AUTO-START)
- **Binh thuong**: Chi doc activeContext.md (lightweight)
- **REPO_GRAPH.md**: Doc khi can navigate codebase, KHONG doc mac dinh
- **CONTEXT_INDEX.md**: Tra cuu TRUOC khi doc bat ky .context/ file nao
- **Sau khi code xong**: TU DONG cap nhat progress.md + CONTEXT_INDEX.md

## Post-Task Auto-Updates
Sau moi task hoan thanh, TU DONG:
1. Cap nhat progress.md (feature status, commit log)
2. Cap nhat CONTEXT_INDEX.md (neu co context moi)
3. Ghi Proactive Alerts vao activeContext.md (neu phat hien tech debt)
4. Neu conversation > 30 messages → goi y: "Nen compact session"
