# RUNBOOK_V6.md — FAOS v6 Operations Manual

> **Cẩm nang vận hành cho Boss / Dev / SRE**
>
> Hướng dẫn setup, vận hành hàng ngày, và xử lý sự cố cho hệ thống FAOS v6.

---

## Table of Contents

1. [Environment Setup](#1-environment-setup)
2. [Daily Operations](#2-daily-operations)
3. [Troubleshooting Guide](#3-troubleshooting-guide)
4. [Adding a New Project](#4-adding-a-new-project)
5. [Emergency Procedures](#5-emergency-procedures)
6. [Monitoring & Alerts](#6-monitoring--alerts)

---

## 1. Environment Setup

### 1.1 Prerequisites

| Tool | Version | Purpose |
|:--|:--|:--|
| Python | 3.9+ | Backend runtime |
| Node.js | 18+ | Dashboard frontend |
| Docker | 24+ | FalkorDB container |
| Google Cloud SDK | Latest | BigQuery + Auth |

### 1.2 Clone & Install

```bash
# Clone repository
git clone https://github.com/nhatngo-coder/Agentic-AI-Levelup.git
cd Agentic-AI-Levelup

# Python backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Frontend dashboard
cd dashboard-ui
npm install
cd ..
```

### 1.3 Environment Variables

Create `.env` in project root:

```bash
# ═══ REQUIRED ═══

# Google Cloud
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account-key.json
GCP_PROJECT_ID=levelup-465304

# BigQuery Dataset (per project)
BQ_DATASET=STRAMARK_Dataset          # or AUUS1_Dataset

# Meta Marketing API
META_ACCESS_TOKEN=EAAxxxxxxxxxxxxxxx  # Long-lived token (60 days)
META_PIXEL_ID=123456789012345
META_APP_SECRET=xxxxxxxxxxxxxxxx

# FalkorDB
FALKORDB_HOST=localhost
FALKORDB_PORT=6379
FALKORDB_GRAPH_NAME=faos_v6

# LLM Provider
GEMINI_API_KEY=AIzaSyxxxxxxxxxxxxxxxxx
OPENAI_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxx

# ═══ OPTIONAL ═══

# Notification channels
TELEGRAM_BOT_TOKEN=1234567890:AAHxxxxxxxxxxxxxxxxx
TELEGRAM_CHAT_ID=-1001234567890
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...

# Dashboard
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_APP_NAME=STRAMARK

# Project defaults
DEFAULT_PROJECT_ID=stramark
```

### 1.4 Start Services

```bash
# 1. Start FalkorDB
docker compose up -d falkordb

# 2. Verify FalkorDB is running
docker exec -it faos-falkordb redis-cli PING
# Expected: PONG

# 3. Initialize graph schema
python -c "
from faos_brain.graph.connection import FalkorDBConnection
from faos_brain.graph.schema import create_graph_schema
conn = FalkorDBConnection()
conn.connect()
result = create_graph_schema(conn)
print(f'Schema: {result}')
"

# 4. Start backend API
uvicorn faos_brain.api.main:app --host 0.0.0.0 --port 8000 --reload

# 5. Start frontend dashboard (separate terminal)
cd dashboard-ui && npm run dev
```

---

## 2. Daily Operations

### 2.1 Automatic Schedule (Cron)

```
08:00  →  Analyst + Director workflow (DRY_RUN)
18:00  →  T+1 Reflection (accuracy evaluation)
21:00  →  CAPI Push (POS orders → Meta)
```

Install cron:
```bash
chmod +x start_dry_run_cycle.sh
./start_dry_run_cycle.sh install-cron
```

### 2.2 Manual Commands

```bash
# Full daily run (dry run — no Meta API changes)
python -m faos_brain.runner --project stramark --dry-run

# Full daily run (LIVE — executes real Meta API)
python -m faos_brain.runner --project stramark --live

# Analyst only
python -m faos_brain.runner --project stramark --analyst-only --dry-run

# Director only
python -m faos_brain.runner --project stramark --director-only --dry-run

# Reflection only (18:00)
python -m faos_brain.runner --project stramark --reflection-only

# Check today's logs
./start_dry_run_cycle.sh status
```

### 2.3 Dashboard URLs

| URL | Page |
|:--|:--|
| `http://localhost:3000` | Main Dashboard |
| `http://localhost:3000/agent-control` | AI Agent Control Center |
| `http://localhost:3000/agent-control/live-feed` | Real-time SSE Feed |
| `http://localhost:3000/agent-control/audit` | AI Accuracy + Decision Audit |
| `http://localhost:3000/agent-control/memory` | AI Memory Manager |

---

## 3. Troubleshooting Guide

### 3.1 `EmergencyHaltError` — Data Gates Failed

**Symptom:** Runner exits with code 2, log shows `🚨 EMERGENCY HALT`

**Possible causes & fixes:**

| Gate | Error | Fix |
|:--|:--|:--|
| `ORDERS_DATA` | "0 rows with orders" | Check if POS → BQ sync ran. Run: `bq query "SELECT MAX(report_date) FROM STRAMARK_Dataset.daily_performance"` |
| `ADS_DATA` | "0 rows with ads" | Check Meta Marketing API sync. Verify `META_ACCESS_TOKEN` in `.env` |
| `ATTRIBUTION` | "Attribution < 85%" | POS orders not matching ads campaigns. Check product_code mapping. |
| `META_TOKEN` | "Token too short" | Token expired. See §3.2 below. |

### 3.2 Meta Access Token Expired

> Meta long-lived tokens expire after **60 days**.

**Fix:**
```bash
# 1. Go to Meta Business Suite → Settings → Advanced
# 2. Generate new System User Token with ads_management, ads_read permissions
# 3. Exchange for long-lived token:
curl -X GET "https://graph.facebook.com/v19.0/oauth/access_token?\
grant_type=fb_exchange_token&\
client_id={APP_ID}&\
client_secret={APP_SECRET}&\
fb_exchange_token={SHORT_LIVED_TOKEN}"

# 4. Update .env
META_ACCESS_TOKEN=EAAnew_token_here

# 5. Restart backend
kill $(lsof -ti :8000) && uvicorn faos_brain.api.main:app --port 8000 &

# 6. Verify
python -c "
from faos_brain.config import settings
print(f'Token length: {len(settings.meta_access_token)}')
print('OK' if len(settings.meta_access_token) > 50 else 'TOO SHORT')
"
```

### 3.3 FalkorDB Down

**Symptom:** `ConnectionError: Cannot connect to FalkorDB`

**Fix:**
```bash
# Check container status
docker ps -a | grep falkordb

# If stopped, restart
docker compose restart falkordb

# If container missing, recreate
docker compose up -d falkordb

# Verify connection
docker exec -it faos-falkordb redis-cli PING

# Re-initialize schema (idempotent, safe to re-run)
python -c "
from faos_brain.graph.connection import FalkorDBConnection
from faos_brain.graph.schema import create_graph_schema
conn = FalkorDBConnection()
conn.connect()
create_graph_schema(conn)
print('Schema OK')
"
```

### 3.4 BigQuery Permission Denied

**Symptom:** `google.api_core.exceptions.Forbidden: 403`

**Fix:**
```bash
# Check current credentials
gcloud auth list
gcloud config get-value project

# Re-authenticate
gcloud auth application-default login

# Or set service account key directly
export GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json

# Verify BQ access
bq ls levelup-465304:STRAMARK_Dataset
```

### 3.5 LLM API Errors

**Symptom:** `LLMClientError: Gemini/OpenAI returned error`

| Error | Fix |
|:--|:--|
| `429 Rate Limit` | Wait 60s, will auto-retry. Reduce concurrent runs. |
| `401 Invalid Key` | Check `GEMINI_API_KEY` or `OPENAI_API_KEY` in `.env` |
| `500 Server Error` | Temporary. System auto-falls back to rules-based mode. |
| `Context too long` | Data snapshot too large. Check report_date range filter. |

### 3.6 Frontend Build Failures

```bash
cd dashboard-ui

# Clear build cache
rm -rf .next node_modules/.cache

# Reinstall dependencies
rm -rf node_modules
npm install

# Rebuild
npm run build

# If TypeScript errors, check versions
npx next --version
npx tsc --version
### 3.7 ⚠️ VPS Deployment Gotchas (CRITICAL — DO NOT SKIP)

> **Bài học xương máu từ deploy ngày 2026-03-02:**
> App chạy OK bên trong VPS nhưng KHÔNG thể truy cập từ bên ngoài.

#### Lỗi 1: Tường lửa (Firewall) chặn port

**Triệu chứng:** `curl localhost:8000` trả về HTTP 200 trên VPS, nhưng trình duyệt bên ngoài không vào được.

**Nguyên nhân:** UFW trên Ubuntu có `policy DROP` — mọi port không được phép đều bị chặn.

**Fix bắt buộc khi deploy VPS:**
```bash
sudo ufw allow 8000/tcp    # Backend API
sudo ufw allow 3000/tcp    # Frontend Dashboard
sudo ufw allow 6379/tcp    # FalkorDB (chỉ mở nếu cần truy cập từ xa)
sudo ufw reload
sudo ufw status            # Xác nhận ALLOW
```

**Nếu dùng Cloud Provider (AWS/GCP):** Phải thêm Inbound Rule trong Security Group / VPC Firewall cho port 8000 và 3000 (Source: `0.0.0.0/0`).

#### Lỗi 2: Next.js `NEXT_PUBLIC_*` cần rebuild

**Triệu chứng:** Frontend load được giao diện (vỏ) nhưng không có dữ liệu (trắng bóc).

**Nguyên nhân:** Biến `NEXT_PUBLIC_*` được **bake vào lúc build** (compile-time). Sửa `.env.local` mà không rebuild = frontend vẫn gọi `localhost:8000`.

**Fix:**
```bash
cd /opt/faos/dashboard-ui
# Sửa .env.local → NEXT_PUBLIC_API_URL=http://<VPS_IP>:8000
npm run build   # BẮT BUỘC sau khi đổi NEXT_PUBLIC_*
pm2 restart faos-frontend
```

#### Lỗi 3: Test bằng `localhost` trên VPS = Sai

**Quy tắc TUYỆT ĐỐI:** Luôn test từ public IP, KHÔNG DÙNG localhost.

```bash
# ❌ SAI — test nội bộ, luôn thành công, che giấu lỗi firewall
curl http://localhost:8000/health

# ✅ ĐÚNG — test qua public IP, phản ánh trải nghiệm thực tế của user
curl http://164.68.101.179:8000/health
curl http://164.68.101.179:3000
```

#### Lỗi 4: `crypto.randomUUID()` crash trên HTTP (không phải HTTPS)

**Triệu chứng:** Trang LiveFeed trắng hoàn toàn. Console báo `TypeError: crypto.randomUUID is not a function`.

**Nguyên nhân:** `crypto.randomUUID()` là Web API **chỉ hoạt động trên Secure Context (HTTPS)**. VPS dùng HTTP → function = `undefined` → crash toàn bộ React component.

**Fix:** Thay `crypto.randomUUID()` bằng fallback function:
```typescript
const genId = (): string =>
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
```

**Rule:** Không bao giờ dùng `crypto.randomUUID()` trực tiếp trong client-side code trên HTTP. Luôn wrap bằng fallback.

#### Lỗi 5: Backend trả 500 vì thiếu `GOOGLE_APPLICATION_CREDENTIALS`

**Triệu chứng:** Frontend load được nhưng data trống. Backend log: `google.auth.exceptions.DefaultCredentialsError`.

**Nguyên nhân:** PM2 khởi chạy backend qua script, nhưng biến `GOOGLE_APPLICATION_CREDENTIALS` không được export trong script đó.

**Fix:** Thêm vào `start_backend.sh`:
```bash
export GOOGLE_APPLICATION_CREDENTIALS="/opt/faos/.keys/service-account.json"
```

**Rule:** Mọi biến environment cần thiết phải được khai báo trong startup script mà PM2 sử dụng, **KHÔNG** chỉ trong `.bashrc` (PM2 không source `.bashrc`).

#### VPS Deploy Checklist (dùng cho MỌI lần deploy)

- [ ] Code synced (rsync/git pull)
- [ ] Python deps installed (pip install -r requirements.txt)
- [ ] FalkorDB running (docker exec falkordb redis-cli PING)
- [ ] Graph schema + seed data loaded
- [ ] `.env` đầy đủ (BQ key, Meta token, LLM keys)
- [ ] `GOOGLE_APPLICATION_CREDENTIALS` dùng đường dẫn tuyệt đối
- [ ] Frontend `.env.local` → `NEXT_PUBLIC_API_URL=http://<VPS_IP>:8000`
- [ ] Frontend đã rebuild (`npm run build`)
- [ ] PM2 start backend + frontend
- [ ] **UFW allow 8000/tcp + 3000/tcp** ← KHÔNG ĐƯỢC QUÊN
- [ ] Test từ **public IP** (không dùng localhost)
- [ ] Crontab installed (daily/reflection/capi)

---

## 4. Adding a New Project

> Example: Adding project `zen8` to the system.

### Step 1: BigQuery Dataset

```sql
-- Create dataset in BigQuery Console
CREATE SCHEMA IF NOT EXISTS `levelup-465304.ZEN8_Dataset`
OPTIONS (location = 'US');

-- Copy table schemas from STRAMARK
-- Run each DDL in sql/v6/tables/ with {DATASET} = ZEN8_Dataset
-- Run each view in sql/v6/views/ with {DATASET} = ZEN8_Dataset
```

### Step 2: Config

```bash
# Add to .env
BQ_DATASET_ZEN8=ZEN8_Dataset

# Or update faos_brain/config.py to support multi-dataset
```

### Step 3: FalkorDB Graph Data

```python
# Seed initial data
from faos_brain.graph.connection import FalkorDBConnection

conn = FalkorDBConnection()
conn.connect()

# Create PersonalityConfig node
conn.graph.query("""
    CREATE (:PersonalityConfig {
        id: 'personality_zen8',
        agent: 'director',
        project_id: 'zen8',
        risk_level: 0.5,
        auto_budget_limit: 3000,
        daily_auto_ceiling: 15000
    })
""")
print("PersonalityConfig created for zen8")
```

### Step 4: Delegation Matrix

```python
# Add ad accounts via API
import httpx

accounts = [
    {"account_id": "act_zen8_001", "account_name": "ZEN8 Main", "managed_by": "AI"},
    {"account_id": "act_zen8_002", "account_name": "ZEN8 Test", "managed_by": "HUMAN"},
]

resp = httpx.post(
    "http://localhost:8000/api/personality/zen8/accounts",
    json=accounts
)
print(f"Delegation matrix: {resp.json()}")
```

### Step 5: Dashboard Config

```bash
# Add project to frontend dropdown
# Edit: dashboard-ui/src/app/agent-control/layout.tsx

# Add to PROJECTS array:
{ id: "zen8", label: "ZEN8", color: "#10b981" },
```

### Step 6: Cron Setup

```bash
# Add zen8 to cron schedule
# Edit start_dry_run_cycle.sh or add parallel cron entries:
#   0 8 * * * ./start_dry_run_cycle.sh daily zen8
#   0 18 * * * ./start_dry_run_cycle.sh reflection zen8
#   0 21 * * * ./start_dry_run_cycle.sh capi zen8
```

### Step 7: Verify

```bash
# Test run
python -m faos_brain.runner --project zen8 --dry-run --analyst-only -v

# Check dashboard
open http://localhost:3000/agent-control
# Select "ZEN8" from project dropdown
```

---

## 5. Emergency Procedures

### 5.1 Stop All AI Operations

```bash
# Kill all running FAOS processes
pkill -f "faos_brain.runner"

# Remove cron jobs
./start_dry_run_cycle.sh uninstall-cron

# Verify nothing is running
ps aux | grep faos
```

### 5.2 Rollback a Decision

```sql
-- 1. Find the decision in approval_logs
SELECT decision_id, action_type, campaign_id, rollback_snapshot
FROM `levelup-465304.STRAMARK_Dataset.approval_logs`
WHERE decision_id = 'dec_2026-03-02_001'
  AND project_id = 'stramark';

-- 2. Use rollback_snapshot to restore Meta API state manually
-- 3. Mark as rolled back
UPDATE `levelup-465304.STRAMARK_Dataset.approval_logs`
SET status = 'ROLLED_BACK', decided_by = 'human:admin'
WHERE decision_id = 'dec_2026-03-02_001';
```

### 5.3 Force Data Resync

```bash
# Trigger ETL backfill for specific date range
python -c "
from faos_brain.data_sync import backfill_date_range
backfill_date_range('stramark', '2026-02-25', '2026-03-01')
"

# Verify data exists
bq query --nouse_legacy_sql \
  "SELECT report_date, COUNT(*) FROM STRAMARK_Dataset.daily_performance
   WHERE report_date >= '2026-02-25' GROUP BY 1 ORDER BY 1"
```

---

## 6. Monitoring & Alerts

### 6.1 Health Check Endpoints

| Endpoint | Expected |
|:--|:--|
| `GET /api/health` | `{"status": "ok"}` |
| `GET /api/memory/graph-stats` | Node counts per label |
| `GET /api/ai-intelligence/accuracy?project_id=stramark&days=7` | Recent accuracy data |

### 6.2 Key Metrics to Monitor

| Metric | Warning Level | Critical Level |
|:--|:--|:--|
| Prediction accuracy (MA7) | < 70% | < 50% |
| Decision win rate | < 60% | < 40% |
| Data gate pass rate | < 95% | < 80% |
| CAPI push success rate | < 95% | < 90% |
| LLM cost per run | > $0.50 | > $2.00 |

### 6.3 Log Files

```
logs/
└── dry_run/
    ├── 2026-03-02_daily.log        # 08:00 run
    ├── 2026-03-02_reflection.log   # 18:00 run
    ├── 2026-03-02_capi.log         # 21:00 run
    └── cron.log                    # Aggregated cron output
```

---

*Last updated: 2026-03-02 | FAOS v6 — Phase 1 Complete*
