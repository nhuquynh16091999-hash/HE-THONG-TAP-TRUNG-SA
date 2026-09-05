# Allowed Commands - Safe Auto-Run List (V5.1)

Cac lenh sau duoc phep chay voi SafeToAutoRun: true.
Moi lenh KHONG co trong list -> PHAI hoi user truoc.

## 1. He thong va Dieu huong
ls, pwd, cat, tree, echo, find, which, head, tail, wc

## 2. Git (Chi DOC)
git status, git diff, git log, git branch, git show

## 3. Python (FAOS-specific)
pip install, pip list, python3 --version, python3 -m venv
pytest, pytest --co, python3 -m pytest
python3 -m faos_brain.runner --dry-run
pip freeze

## 4. Node.js / Package Manager (Dashboard)
npm install, npm i, npm ci, npm list
npm run dev, npm run build, npm run lint, npm test
cd dashboard-ui && npm install
cd dashboard-ui && npm run build

## 5. Docker va Infra (Chi DOC)
docker ps, docker logs, docker-compose ps
docker compose -f docker-compose.ai.yml ps
docker compose -f docker-compose.ai.yml logs
pm2 status, pm2 logs

## 6. Network va API Test
curl, ping

## 7. BigQuery (Chi DOC)
bq ls, bq show, bq head, bq query --dry_run

## 8. File Operations (Chi DOC)
cat, less, head, tail, wc -l, diff, md5sum

## BLACKLIST - KHONG BAO GIO auto-run
- rm -rf, sudo rm
- docker rm, docker stop, docker-compose down
- git push, git merge, git rebase, git reset --hard
- DROP, TRUNCATE, DELETE FROM (SQL)
- bq rm, bq update (destructive BigQuery ops)
- shutdown, reboot
- python3 -m faos_brain.runner (KHONG co --dry-run)
- pm2 delete, pm2 stop
- Any command with sudo
