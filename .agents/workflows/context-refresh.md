---
description: Doc lai context khi bat dau session moi
---
1. Doc memory-bank/activeContext.md
2. Doc .auto-memory/INDEX.md (AI learnings)
3. CHI KHI CAN: Doc them memory-bank files khac (context.md, techContext.md, systemPatterns.md)
4. Kiem tra REPO_GRAPH.md timestamp - neu cu qua 3 ngay -> chay /scan-repo
5. Chay integrity check nhanh: activeContext vs git log -5
6. FAOS-specific checks:
   - `pm2 status` -> backend dang chay chua?
   - `docker compose -f docker-compose.ai.yml ps` -> FalkorDB up?
   - Check .env co du API keys khong
7. Tom tat 3 dong cho user
8. Hoi user muon lam task nao
