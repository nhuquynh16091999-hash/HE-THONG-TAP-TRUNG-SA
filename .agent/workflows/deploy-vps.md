---
description: How to deploy FAOS v6 to VPS (164.68.101.179)
---

# Deploy FAOS v6 to VPS

// turbo-all

## Prerequisites
- VPS: root@164.68.101.179
- Password: stored in docs/SYNC_RUNBOOK.md credentials section
- sshpass installed locally

## Steps

1. SSH into VPS:
```bash
sshpass -p '<PASSWORD>' ssh -o StrictHostKeyChecking=no root@164.68.101.179
```

2. Rsync code from local to VPS (run from project root):
```bash
sshpass -p '<PASSWORD>' rsync -avz --exclude='.venv' --exclude='node_modules' --exclude='.next' --exclude='__pycache__' --exclude='.git' --exclude='*.pyc' --exclude='.env' \
  faos_brain tests sql scripts docs config sync start_dry_run_cycle.sh deploy.sh requirements.txt setup.py \
  root@164.68.101.179:/opt/faos/
```

3. On VPS — Install Python deps:
```bash
cd /opt/faos && source venv/bin/activate && pip install -r requirements.txt
```

4. On VPS — Ensure __init__.py exists in all packages:
```bash
find /opt/faos/faos_brain -type d -exec sh -c 'touch "$1/__init__.py" 2>/dev/null' _ {} \;
```

5. On VPS — Seed FalkorDB:
```bash
PYTHONPATH=/opt/faos /opt/faos/venv/bin/python3 -c "
from faos_brain.graph.connection import FalkorDBConnection
from faos_brain.graph.schema import create_graph_schema
from faos_brain.graph.loader import load_all_seed_data
conn = FalkorDBConnection(); conn.connect()
create_graph_schema(conn)
load_all_seed_data(conn)
"
```

6. On VPS — Update frontend .env.local:
```bash
# Ensure NEXT_PUBLIC_API_URL=http://164.68.101.179:8000
cat /opt/faos/dashboard-ui/.env.local | grep NEXT_PUBLIC_API_URL
```

7. On VPS — Rebuild frontend (MANDATORY after any .env.local change):
```bash
cd /opt/faos/dashboard-ui && npm run build
```

8. On VPS — Open firewall ports (CRITICAL — DO NOT SKIP):
```bash
sudo ufw allow 8000/tcp
sudo ufw allow 3000/tcp
sudo ufw reload
sudo ufw status
```

9. On VPS — Restart PM2:
```bash
pm2 restart faos-backend faos-frontend
pm2 save
```

10. VERIFY from PUBLIC IP (NEVER use localhost):
```bash
curl -s -o /dev/null -w "Backend: HTTP %{http_code}\n" http://164.68.101.179:8000/health
curl -s -o /dev/null -w "Frontend: HTTP %{http_code}\n" http://164.68.101.179:3000
```

## Troubleshooting

### Backend ModuleNotFoundError: faos_brain
- Ensure `__init__.py` exists: `ls /opt/faos/faos_brain/__init__.py`
- Ensure `scripts/start_backend.sh` has `export PYTHONPATH=/opt/faos`
- Ensure `faos.pth` exists in venv site-packages

### Frontend shows blank data
- `NEXT_PUBLIC_API_URL` must point to VPS public IP, NOT localhost
- Must run `npm run build` AFTER changing `.env.local`
- Check CORS in `faos_brain/api/main.py` allows `*` or VPS IP

### Cannot access from browser
- Check `ufw status` — port must show ALLOW
- Check `iptables -L INPUT -n` for DROP rules
- If cloud provider (AWS/GCP): check Security Group / VPC Firewall
