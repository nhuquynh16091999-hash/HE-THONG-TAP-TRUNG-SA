#!/usr/bin/env python3
"""Minimal code-only deploy to VPS — does NOT touch .env or credentials.

Strategy:
  1. SSH to VPS
  2. Detect deployment layout (git repo vs plain files)
  3. If git repo:  cd PROJECT && git pull origin main
     Otherwise:    SCP a small allowlist of code files
  4. Restart sync service (if PM2 manages it)
  5. Show last sync log lines for sanity check

Required .env keys:
  VPS_HOST, VPS_USER, VPS_PASS  (or VPS_SSH_KEY)
  VPS_PROJECT_DIR

Usage:
  python scripts/deploy_vps_code.py                  # deploy
  python scripts/deploy_vps_code.py --dry-run        # show what would happen
  python scripts/deploy_vps_code.py --force-scp      # bypass git pull, scp files

Designed to be safe: never overwrites .env on VPS, never restarts unrelated
services, fail-fast on missing credentials.
"""
import argparse
import io
import os
import sys
from pathlib import Path

# UTF-8 stdout for Windows console
if hasattr(sys.stdout, "buffer"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "buffer"):
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

import paramiko
from dotenv import load_dotenv

REPO = Path(__file__).resolve().parent.parent
load_dotenv(REPO / ".env")


def _require(name: str) -> str:
    val = os.environ.get(name, "").strip()
    if not val:
        sys.exit(f"ERROR: missing required env var '{name}' in .env")
    return val


HOST = _require("VPS_HOST")
USER = _require("VPS_USER")
PASS = os.environ.get("VPS_PASS", "").strip()
SSH_KEY = os.environ.get("VPS_SSH_KEY", "").strip()
if not PASS and not SSH_KEY:
    sys.exit("ERROR: provide either VPS_PASS or VPS_SSH_KEY in .env")
PROJECT = _require("VPS_PROJECT_DIR")

# Files to SCP if VPS is not a git repo (the bare minimum for the Pass-2 fix)
SCP_FILES = [
    "sync/stramark/stramark_sync.py",
    "sync/order_sync_utils.py",
]


def run(ssh, cmd, label="", timeout=180, check=True):
    if label:
        print(f"\n>> {label}")
    print(f"$ {cmd}")
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    rc = stdout.channel.recv_exit_status()
    out = stdout.read().decode("utf-8", errors="replace").strip()
    err = stderr.read().decode("utf-8", errors="replace").strip()
    if out:
        print(out[-2000:])
    if err and "warn" not in err.lower():
        print(f"STDERR: {err[-500:]}")
    if check and rc != 0:
        print(f"  ⚠ command exited rc={rc}")
    return rc, out, err


def is_git_repo(ssh, project_dir):
    rc, out, _ = run(ssh, f"test -d {project_dir}/.git && echo YES || echo NO",
                     check=False)
    return out.strip() == "YES"


def get_current_commit(ssh, project_dir):
    rc, out, _ = run(ssh, f"cd {project_dir} && git rev-parse HEAD 2>/dev/null || echo none",
                     check=False)
    return out.strip()[:7]


def get_pm2_processes(ssh):
    """Return list of pm2 process names that look related to faos/stramark."""
    rc, out, _ = run(ssh, "pm2 jlist 2>/dev/null || echo '[]'", check=False)
    try:
        import json
        procs = json.loads(out) if out and out.strip().startswith("[") else []
        names = [p.get("name", "") for p in procs]
        return names
    except Exception:
        return []


def main():
    ap = argparse.ArgumentParser(description="Code-only VPS deploy (no env vars touched)")
    ap.add_argument("--dry-run", action="store_true", help="show plan without changing VPS")
    ap.add_argument("--force-scp", action="store_true",
                    help="skip git pull, always SCP the file allowlist")
    ap.add_argument("--restart", default="auto",
                    help="PM2 process name to restart (default: auto-detect)")
    args = ap.parse_args()

    print(f"Target: {USER}@{HOST}:{PROJECT}")
    print(f"Mode  : {'DRY-RUN' if args.dry_run else 'LIVE'}")
    print(f"Auth  : {'SSH key' if SSH_KEY else 'password'}")
    print()

    # === Connect ===
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        if SSH_KEY:
            ssh.connect(HOST, username=USER, key_filename=SSH_KEY, timeout=30)
        else:
            ssh.connect(HOST, username=USER, password=PASS, timeout=30)
    except Exception as e:
        sys.exit(f"SSH connect failed: {e}")
    print("✓ SSH connected")

    # === Step 1: detect layout ===
    rc, out, _ = run(ssh, f"ls -la {PROJECT}/sync/stramark/stramark_sync.py 2>&1 | head -1",
                     "1. Verify project exists", check=False)
    if "No such file" in out or rc != 0:
        ssh.close()
        sys.exit(f"ERROR: {PROJECT}/sync/stramark/stramark_sync.py not found on VPS")

    is_git = is_git_repo(ssh, PROJECT)
    print(f"\n  VPS layout: {'git repo' if is_git else 'plain files'}")
    if is_git:
        before = get_current_commit(ssh, PROJECT)
        print(f"  current HEAD on VPS: {before}")

    # === Step 2: deploy ===
    if args.dry_run:
        print("\n>> 2. (DRY-RUN) would deploy via " +
              ("git pull" if is_git and not args.force_scp else "SCP allowlist"))
        if not (is_git and not args.force_scp):
            for f in SCP_FILES:
                local = REPO / f
                if local.exists():
                    print(f"     SCP: {f} ({local.stat().st_size:,} bytes)")
                else:
                    print(f"     SKIP (missing locally): {f}")
        ssh.close()
        return

    if is_git and not args.force_scp:
        rc, out, err = run(ssh, f"cd {PROJECT} && git fetch origin main 2>&1 | tail -10",
                           "2a. git fetch", check=False)
        rc, out, err = run(ssh, f"cd {PROJECT} && git status --short 2>&1",
                           "2b. git status (any local changes?)", check=False)
        if out.strip():
            print(f"  ⚠ VPS has uncommitted changes:\n{out}")
            print("  Aborting to avoid overwriting them. Use --force-scp to bypass.")
            ssh.close()
            sys.exit(2)
        rc, out, err = run(ssh, f"cd {PROJECT} && git pull origin main 2>&1 | tail -20",
                           "2c. git pull origin main", check=False)
        if rc != 0:
            print("  ⚠ git pull failed")
            ssh.close()
            sys.exit(3)
        after = get_current_commit(ssh, PROJECT)
        print(f"  HEAD after pull: {after}")
    else:
        print("\n>> 2. SCP file allowlist (no git on VPS)...")
        sftp = ssh.open_sftp()
        for f in SCP_FILES:
            local = REPO / f
            remote = f"{PROJECT}/{f}"
            if not local.exists():
                print(f"  SKIP (missing locally): {f}")
                continue
            # Ensure remote dir exists
            remote_dir = "/".join(remote.split("/")[:-1])
            run(ssh, f"mkdir -p {remote_dir}", check=False)
            print(f"  {f} ({local.stat().st_size:,} bytes) → {remote}")
            sftp.put(str(local), remote)
        sftp.close()

    # === Step 3: detect & restart sync service ===
    pm2_names = get_pm2_processes(ssh)
    print(f"\n>> 3. PM2 processes on VPS: {pm2_names or '(none / pm2 unavailable)'}")
    if args.restart != "auto":
        target = args.restart
    else:
        # Heuristic: any process whose name contains 'sync' or 'stramark'
        target = None
        for n in pm2_names:
            ln = n.lower()
            if "stramark" in ln or "sync" in ln:
                target = n
                break

    if target:
        run(ssh, f"pm2 restart {target} --update-env 2>&1 | tail -10",
            f"3a. Restart {target}", check=False)
    else:
        print("  No matching pm2 process — sync probably runs via cron, no restart needed.")
        # Show cron entry if any so user can confirm
        run(ssh, "crontab -l 2>/dev/null | grep -i 'stramark\\|sync' | head -10",
            "3b. crontab (stramark/sync entries)", check=False)

    # === Step 4: sanity check — show last 5 lines of sync log ===
    rc, out, _ = run(
        ssh,
        f"ls -t {PROJECT}/logs/stramark_sync_*.log 2>/dev/null | head -1",
        "4. Find latest sync log", check=False)
    latest_log = out.strip()
    if latest_log:
        run(ssh, f"tail -10 {latest_log}", f"4a. Last lines of {latest_log}", check=False)

    ssh.close()
    print("\n=== DEPLOY COMPLETE ===")
    print("Next: trigger one sync run with pass-2 to verify the fix is live.")
    print(f"  ssh {USER}@{HOST}")
    print(f"  cd {PROJECT}")
    print("  python sync/stramark/stramark_sync.py --refresh-pending --refresh-days 30")


if __name__ == "__main__":
    main()
