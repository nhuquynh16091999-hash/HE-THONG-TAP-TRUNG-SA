# Huong dan - 3 phut setup

## Buoc 1: Mo du an trong Antigravity IDE, set lam Active Workspace

## Buoc 2: Chat bat ky yeu cau nao
AI se TU DONG:
- Doc context du an (memory-bank/)
- Danh gia Context Gap (thieu bao nhieu thong tin)
- Hoi lai neu chua du thong tin
- Soan Master Prompt de xac nhan
- Kiem tra rui ro truoc khi code

## Buoc 3: Dung workflow commands
- `/context-refresh` — Load lai context dau session
- `/new-feature` — Bat dau code feature moi (co Mental Sandbox)
- `/debug` — Fix bug voi Root Cause Interview
- `/scan-repo` — Cap nhat REPO_GRAPH.md
- `/deploy-vps` — Deploy len production VPS

## Buoc 4: Khong can nho gi
- AI tu hoi khi thieu info
- AI tu soan de bai roi hoi ban confirm
- AI tu kiem tra rui ro
- Sau 30 tin nhan -> AI tu nhac compact session

## FAOS-Specific Notes
- Luon chay runner voi `--dry-run` truoc khi production
- Check `pm2 status` de xem backend status
- Dashboard: `cd dashboard-ui && npm run dev`
- FalkorDB: `docker compose -f docker-compose.ai.yml up -d`
