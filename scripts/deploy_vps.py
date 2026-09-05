#!/usr/bin/env python3
"""Deploy ALL Stramark changes to VPS via SCP (direct file copy).

Secrets are loaded from .env at project root. Required keys:
  - VPS_HOST, VPS_USER, VPS_PASS  (or VPS_SSH_KEY for key-based auth)
  - VPS_PROJECT_DIR               (e.g. /opt/faos)
  - POSCAKE_API_KEY, POSCAKE_SHOP_ID
  - STRAMARK_FFM_API_TOKEN, STRAMARK_FFM_API_TOKEN_2
  - T1_FFM_API_TOKEN, T1_PANCAKE_API_TOKEN, T1_PANCAKE_SHOP_ID
  - OPENAI_API_KEY
"""
import sys, io, os, time
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

import paramiko
from pathlib import Path
from dotenv import load_dotenv

# Load .env from project root (parent of scripts/)
LOCAL_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(LOCAL_ROOT / ".env")

def _require(name: str) -> str:
    val = os.environ.get(name, "").strip()
    if not val:
        sys.exit(f"ERROR: missing required env var '{name}' in .env")
    return val

HOST    = _require("VPS_HOST")
USER    = _require("VPS_USER")
PASS    = os.environ.get("VPS_PASS", "").strip()
SSH_KEY = os.environ.get("VPS_SSH_KEY", "").strip()
if not PASS and not SSH_KEY:
    sys.exit("ERROR: provide either VPS_PASS or VPS_SSH_KEY in .env")
PROJECT = _require("VPS_PROJECT_DIR")

def run(ssh, cmd, label="", timeout=180):
    if label: print(f"\n>> {label}")
    print(f"$ {cmd}")
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    stdout.channel.recv_exit_status()
    out = stdout.read().decode("utf-8", errors="replace").strip()
    err = stderr.read().decode("utf-8", errors="replace").strip()
    if out: print(out[-2000:])
    if err and "warn" not in err.lower() and "notice" not in err.lower():
        print(f"STDERR: {err[-500:]}")
    return out

# Files to deploy (local_relative_path → remote_path)
# Full list: all files changed between origin/main and master
FILES = [
    # ── Python sync scripts ──
    ("sync/stramark/__init__.py", f"{PROJECT}/sync/stramark/__init__.py"),
    ("sync/stramark/fulfillment_automation.py", f"{PROJECT}/sync/stramark/fulfillment_automation.py"),
    ("sync/stramark/fulfillment_validators.py", f"{PROJECT}/sync/stramark/fulfillment_validators.py"),
    ("sync/stramark/fulfillment_status_sync.py", f"{PROJECT}/sync/stramark/fulfillment_status_sync.py"),
    ("sync/stramark/status_audit.py", f"{PROJECT}/sync/stramark/status_audit.py"),
    ("sync/stramark/fulfillment_watcher.py", f"{PROJECT}/sync/stramark/fulfillment_watcher.py"),
    ("sync/stramark/address_db.py", f"{PROJECT}/sync/stramark/address_db.py"),
    ("sync/stramark/bq_operations.py", f"{PROJECT}/sync/stramark/bq_operations.py"),
    ("sync/stramark/eu_shipment_client.py", f"{PROJECT}/sync/stramark/eu_shipment_client.py"),
    ("sync/stramark/eu_shipment_parser.py", f"{PROJECT}/sync/stramark/eu_shipment_parser.py"),
    ("sync/stramark/eu_shipment_sync.py", f"{PROJECT}/sync/stramark/eu_shipment_sync.py"),
    ("sync/stramark/stramark_sync.py", f"{PROJECT}/sync/stramark/stramark_sync.py"),
    ("sync/stramark/tce_pdf_parser.py", f"{PROJECT}/sync/stramark/tce_pdf_parser.py"),
    ("sync/stramark/tce_sync.py", f"{PROJECT}/sync/stramark/tce_sync.py"),

    # ── API routes (Stramark-specific) ──
    ("dashboard-ui/src/app/api/stramark/eushipments/push-orders/route.ts", f"{PROJECT}/dashboard-ui/src/app/api/stramark/eushipments/push-orders/route.ts"),
    ("dashboard-ui/src/app/api/stramark/eushipments/status-sync/route.ts", f"{PROJECT}/dashboard-ui/src/app/api/stramark/eushipments/status-sync/route.ts"),
    ("dashboard-ui/src/app/api/stramark/eushipments/status-audit/route.ts", f"{PROJECT}/dashboard-ui/src/app/api/stramark/eushipments/status-audit/route.ts"),
    ("dashboard-ui/src/app/api/stramark/eushipments/force-repush/route.ts", f"{PROJECT}/dashboard-ui/src/app/api/stramark/eushipments/force-repush/route.ts"),
    ("dashboard-ui/src/app/api/stramark/eushipments/ghost-orders/route.ts", f"{PROJECT}/dashboard-ui/src/app/api/stramark/eushipments/ghost-orders/route.ts"),
    ("dashboard-ui/src/app/api/stramark/realtime/route.ts", f"{PROJECT}/dashboard-ui/src/app/api/stramark/realtime/route.ts"),

    # ── API routes (shared) ──
    ("dashboard-ui/src/app/api/eushipments/push-orders/route.ts", f"{PROJECT}/dashboard-ui/src/app/api/eushipments/push-orders/route.ts"),
    ("dashboard-ui/src/app/api/eushipments/route.ts", f"{PROJECT}/dashboard-ui/src/app/api/eushipments/route.ts"),
    ("dashboard-ui/src/app/api/eushipments/sync/route.ts", f"{PROJECT}/dashboard-ui/src/app/api/eushipments/sync/route.ts"),
    ("dashboard-ui/src/app/api/ai-brain/chat/route.ts", f"{PROJECT}/dashboard-ui/src/app/api/ai-brain/chat/route.ts"),

    # ── Dashboard components (Stramark tabs) ──
    ("dashboard-ui/src/components/stramark/constants.ts", f"{PROJECT}/dashboard-ui/src/components/stramark/constants.ts"),
    ("dashboard-ui/src/components/stramark/dashboard-shell.tsx", f"{PROJECT}/dashboard-ui/src/components/stramark/dashboard-shell.tsx"),
    ("dashboard-ui/src/components/stramark/tabs/fulfillment-tab.tsx", f"{PROJECT}/dashboard-ui/src/components/stramark/tabs/fulfillment-tab.tsx"),
    ("dashboard-ui/src/components/stramark/tabs/ads-command-tab.tsx", f"{PROJECT}/dashboard-ui/src/components/stramark/tabs/ads-command-tab.tsx"),
    ("dashboard-ui/src/components/stramark/tabs/ceo-overview-tab.tsx", f"{PROJECT}/dashboard-ui/src/components/stramark/tabs/ceo-overview-tab.tsx"),
    ("dashboard-ui/src/components/stramark/tabs/marketer-perf-tab.tsx", f"{PROJECT}/dashboard-ui/src/components/stramark/tabs/marketer-perf-tab.tsx"),
    ("dashboard-ui/src/components/stramark/tabs/marketing-tab.tsx", f"{PROJECT}/dashboard-ui/src/components/stramark/tabs/marketing-tab.tsx"),
    ("dashboard-ui/src/components/stramark/tabs/pnl-tab.tsx", f"{PROJECT}/dashboard-ui/src/components/stramark/tabs/pnl-tab.tsx"),

    # ── Shared components ──
    ("dashboard-ui/src/components/admin-home.tsx", f"{PROJECT}/dashboard-ui/src/components/admin-home.tsx"),
    ("dashboard-ui/src/components/ai-brain/PersonalitySettings.tsx", f"{PROJECT}/dashboard-ui/src/components/ai-brain/PersonalitySettings.tsx"),
    ("dashboard-ui/src/components/ai-brain/ai-brain-dashboard.tsx", f"{PROJECT}/dashboard-ui/src/components/ai-brain/ai-brain-dashboard.tsx"),

    # ── UI components ──
    ("dashboard-ui/src/components/ui/kpi-card.tsx", f"{PROJECT}/dashboard-ui/src/components/ui/kpi-card.tsx"),
    ("dashboard-ui/src/components/ui/tab-skeleton.tsx", f"{PROJECT}/dashboard-ui/src/components/ui/tab-skeleton.tsx"),

    # ── Lib / utilities ──
    ("dashboard-ui/src/lib/bq-queries.ts", f"{PROJECT}/dashboard-ui/src/lib/bq-queries.ts"),
    ("dashboard-ui/src/lib/constants.ts", f"{PROJECT}/dashboard-ui/src/lib/constants.ts"),
    ("dashboard-ui/src/lib/marketer-map.ts", f"{PROJECT}/dashboard-ui/src/lib/marketer-map.ts"),
    ("dashboard-ui/src/lib/utils.ts", f"{PROJECT}/dashboard-ui/src/lib/utils.ts"),

    # ── Package.json (dependencies may have changed) ──
    ("dashboard-ui/package.json", f"{PROJECT}/dashboard-ui/package.json"),

    # ── Config & SQL ──
    ("config/projects/stramark.yaml", f"{PROJECT}/config/projects/stramark.yaml"),
    ("sql/stramark/create_fulfillment_tables.sql", f"{PROJECT}/sql/stramark/create_fulfillment_tables.sql"),
    ("sql/stramark/create_ffm_shipments.sql", f"{PROJECT}/sql/stramark/create_ffm_shipments.sql"),
    ("sql/stramark/vw_ffm_cost_actual.sql", f"{PROJECT}/sql/stramark/vw_ffm_cost_actual.sql"),
    ("sql/stramark/03_mart_performance_master_v5_actual_ffm.sql", f"{PROJECT}/sql/stramark/03_mart_performance_master_v5_actual_ffm.sql"),
]

# Connect
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
if SSH_KEY:
    ssh.connect(HOST, username=USER, key_filename=SSH_KEY)
else:
    ssh.connect(HOST, username=USER, password=PASS)
sftp = ssh.open_sftp()

# === STEP 1: Create directories ===
print(">> 1. Creating directories...")
dirs = set()
for _, remote in FILES:
    dirs.add(os.path.dirname(remote))
for d in sorted(dirs):
    run(ssh, f"mkdir -p {d}")
print(f"   Created {len(dirs)} directories")

# === STEP 2: Upload files ===
print("\n>> 2. Uploading files...")
uploaded = 0
for local_rel, remote in FILES:
    local_path = str(LOCAL_ROOT / local_rel)
    if not os.path.exists(local_path):
        print(f"   SKIP (not found): {local_rel}")
        continue
    size = os.path.getsize(local_path)
    print(f"   {local_rel} ({size:,} bytes) → {remote}")
    sftp.put(local_path, remote)
    uploaded += 1

print(f"\n   Uploaded {uploaded}/{len(FILES)} files")

# === STEP 3: Build env vars block from local .env (no hardcoded secrets) ===
_env_lines = [
    "",
    "# ── Stramark Fulfillment (euShipments) ──",
    f"POSCAKE_API_URL={os.environ.get('POSCAKE_API_URL', 'https://pos.pages.fm/api/v1')}",
    f"POSCAKE_API_KEY={_require('POSCAKE_API_KEY')}",
    f"POSCAKE_SHOP_ID={_require('POSCAKE_SHOP_ID')}",
    f"STRAMARK_FFM_API_TOKEN={_require('STRAMARK_FFM_API_TOKEN')}",
    f"STRAMARK_FFM_API_TOKEN_2={_require('STRAMARK_FFM_API_TOKEN_2')}",
    f"EU_SHIPMENT_CLIENT_ID_NEW={os.environ.get('EU_SHIPMENT_CLIENT_ID_NEW', '3282')}",
    "# ── T1 Fulfillment ──",
    f"T1_FFM_API_TOKEN={os.environ.get('T1_FFM_API_TOKEN', '')}",
    f"T1_PANCAKE_API_TOKEN={os.environ.get('T1_PANCAKE_API_TOKEN', '')}",
    f"T1_PANCAKE_SHOP_ID={os.environ.get('T1_PANCAKE_SHOP_ID', '')}",
    "# ── OpenAI ──",
    f"OPENAI_API_KEY={_require('OPENAI_API_KEY')}",
    "",
]
env_vars = "\n".join(_env_lines)

out = run(ssh, f"grep -c 'POSCAKE_API_KEY' {PROJECT}/dashboard-ui/.env.local 2>/dev/null || echo 0", "3. Check env vars")
if out.strip() == "0":
    # Write via heredoc
    run(ssh, f"cat >> {PROJECT}/dashboard-ui/.env.local << 'ENVEOF'{env_vars}ENVEOF", "3a. Add env vars")
    run(ssh, f"grep -c 'POSCAKE\\|STRAMARK_FFM\\|T1_FFM\\|OPENAI' {PROJECT}/dashboard-ui/.env.local", "3b. Verify")
else:
    print("   Env vars already present")

# === STEP 4: Install deps + Rebuild Next.js ===
print("\n>> 4a. Installing npm dependencies (package.json changed)...")
run(ssh, f"cd {PROJECT}/dashboard-ui && npm install --legacy-peer-deps 2>&1 | tail -10", timeout=180)

print("\n>> 4b. Rebuilding Next.js... (1-2 min)")
out = run(ssh, f"cd {PROJECT}/dashboard-ui && npm run build 2>&1 | tail -30", timeout=300)

# Check if build succeeded
if "prerendered" in out or "server-rendered" in out or "Static" in out:
    print("\n   BUILD SUCCESS")
else:
    print("\n   BUILD MAY HAVE ISSUES - check output above")

# === STEP 5: Restart PM2 ===
run(ssh, f"pm2 restart faos-frontend --update-env", "5. Restart PM2")
time.sleep(5)
run(ssh, "pm2 list", "6. PM2 status")

# === STEP 6: Test API ===
time.sleep(5)
out = run(ssh,
    f'curl -s -m 10 http://localhost:3000/api/stramark/eushipments/push-orders '
    f'-X POST -H "Content-Type: application/json" -d \'{{"dryRun": true}}\'',
    "7. Test push-orders API (dry run)")

if '"success"' in out:
    print("\n   API WORKING!")
else:
    print("\n   API may need more time to start, retrying in 10s...")
    time.sleep(10)
    out = run(ssh,
        f'curl -s -m 10 http://localhost:3000/api/stramark/eushipments/push-orders '
        f'-X POST -H "Content-Type: application/json" -d \'{{"dryRun": true}}\'',
        "7b. Retry test")

sftp.close()
ssh.close()
print("\n\n=== DEPLOY COMPLETE ===")
print(f"Dashboard: http://164.68.101.179:3000/stramark")
