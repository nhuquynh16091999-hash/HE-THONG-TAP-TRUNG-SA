#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
# FAOS v6 — DRY_RUN Cycle (5-Day Production Trial)
# ═══════════════════════════════════════════════════════════════════
#
# This script runs the full FAOS daily cycle in DRY_RUN mode:
#   08:00 → Full Analyst + Director workflow
#   18:00 → T+1 Reflection (accuracy check)
#   21:00 → CAPI Push (POS → Meta)
#
# Usage:
#   chmod +x start_dry_run_cycle.sh
#
#   # Interactive: run all 3 phases manually (good for first day)
#   ./start_dry_run_cycle.sh run
#
#   # Install cron jobs for automated 5-day trial
#   ./start_dry_run_cycle.sh install-cron
#
#   # Remove cron jobs after trial
#   ./start_dry_run_cycle.sh uninstall-cron
#
#   # Check status of last runs
#   ./start_dry_run_cycle.sh status
#
# Requirements:
#   - Python virtualenv at .venv/
#   - GOOGLE_APPLICATION_CREDENTIALS set
#   - FalkorDB running (docker compose up -d falkordb)
#
# Ref: docs/04_WBS_and_Roadmap.md §4.2 (DRY_RUN Production Trial)
# ═══════════════════════════════════════════════════════════════════

set -euo pipefail

# ─── Config ───
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PYTHONPATH="${PROJECT_DIR}/Agentic-AI-Levelup"
export GOOGLE_APPLICATION_CREDENTIALS="${PROJECT_DIR}/bigquery_key.json"
VENV="${PROJECT_DIR}/.venv/bin/activate"
LOG_DIR="${PROJECT_DIR}/logs/dry_run"
PROJECT_ID="${1:-stramark}"  # Default project

# Ensure log dir
mkdir -p "${LOG_DIR}"

# ─── Colors ───
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

info()  { echo -e "${BLUE}[INFO]${NC}  $1"; }
ok()    { echo -e "${GREEN}[ OK ]${NC}  $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $1"; }
fail()  { echo -e "${RED}[FAIL]${NC}  $1"; }

# ─── Timestamp ───
NOW=$(date "+%Y-%m-%d %H:%M:%S")
TODAY=$(date "+%Y-%m-%d")

# ═══════════════════════════════════════════
# Phase 1: Full Daily Run (08:00)
# ═══════════════════════════════════════════
run_daily() {
    local log_file="${LOG_DIR}/${TODAY}_daily.log"
    info "═══ PHASE 1: FULL DAILY RUN (Analyst + Director) ═══"
    info "Project: ${PROJECT_ID} | DRY_RUN=True | Log: ${log_file}"

    source "${VENV}"
    cd "${PROJECT_DIR}/Agentic-AI-Levelup"
    python -m faos_brain.runner \
        --project "${PROJECT_ID}" \
        --dry-run \
        --verbose \
        2>&1 | tee "${log_file}"

    local exit_code=${PIPESTATUS[0]}
    if [ ${exit_code} -eq 0 ]; then
        ok "Daily run completed successfully"
    elif [ ${exit_code} -eq 2 ]; then
        fail "EMERGENCY HALT — data gates failed"
    else
        fail "Daily run failed (exit code: ${exit_code})"
    fi
    return ${exit_code}
}

# ═══════════════════════════════════════════
# Phase 2: Reflection (18:00)
# ═══════════════════════════════════════════
run_reflection() {
    local log_file="${LOG_DIR}/${TODAY}_reflection.log"
    info "═══ PHASE 2: DAILY REFLECTION (T+1 Accuracy) ═══"
    info "Project: ${PROJECT_ID} | Log: ${log_file}"

    source "${VENV}"
    python -m faos_brain.runner \
        --project "${PROJECT_ID}" \
        --reflection-only \
        --verbose \
        2>&1 | tee "${log_file}"

    local exit_code=${PIPESTATUS[0]}
    if [ ${exit_code} -eq 0 ]; then
        ok "Reflection completed successfully"
    else
        fail "Reflection failed (exit code: ${exit_code})"
    fi
    return ${exit_code}
}

# ═══════════════════════════════════════════
# Phase 3: CAPI Push (21:00)
# ═══════════════════════════════════════════
run_capi() {
    local log_file="${LOG_DIR}/${TODAY}_capi.log"
    info "═══ PHASE 3: CAPI PUSH (POS → Meta) ═══"
    info "Project: ${PROJECT_ID} | DRY_RUN=True | Log: ${log_file}"

    source "${VENV}"
    python -c "
import asyncio
from faos_brain.workflows.capi_push import CAPIPushWorkflow

async def main():
    wf = CAPIPushWorkflow(project_id='${PROJECT_ID}')
    result = await wf.run(dry_run=True)
    print(f'CAPI Push result: {result}')

asyncio.run(main())
    " 2>&1 | tee "${log_file}"

    local exit_code=${PIPESTATUS[0]}
    if [ ${exit_code} -eq 0 ]; then
        ok "CAPI push completed successfully"
    else
        fail "CAPI push failed (exit code: ${exit_code})"
    fi
    return ${exit_code}
}

# ═══════════════════════════════════════════
# Run All Phases (Interactive)
# ═══════════════════════════════════════════
run_all() {
    echo ""
    echo "═══════════════════════════════════════════════"
    echo " FAOS v6 DRY_RUN CYCLE — ${TODAY}"
    echo " Project: ${PROJECT_ID}"
    echo "═══════════════════════════════════════════════"
    echo ""

    local errors=0

    run_daily   || ((errors++))
    echo ""
    run_reflection || ((errors++))
    echo ""
    run_capi    || ((errors++))

    echo ""
    echo "═══════════════════════════════════════════════"
    if [ ${errors} -eq 0 ]; then
        ok "All 3 phases completed successfully ✅"
    else
        fail "${errors}/3 phases had errors ❌"
    fi
    echo "Logs saved to: ${LOG_DIR}/"
    echo "═══════════════════════════════════════════════"
}

# ═══════════════════════════════════════════
# Cron Management
# ═══════════════════════════════════════════
install_cron() {
    info "Installing cron jobs for FAOS DRY_RUN cycle..."

    local SCRIPT_PATH="${PROJECT_DIR}/start_dry_run_cycle.sh"

    # Create cron entries
    local CRON_DAILY="0 8 * * * cd ${PROJECT_DIR} && ${SCRIPT_PATH} daily >> ${LOG_DIR}/cron.log 2>&1"
    local CRON_REFLECT="0 18 * * * cd ${PROJECT_DIR} && ${SCRIPT_PATH} reflection >> ${LOG_DIR}/cron.log 2>&1"
    local CRON_CAPI="0 21 * * * cd ${PROJECT_DIR} && ${SCRIPT_PATH} capi >> ${LOG_DIR}/cron.log 2>&1"

    # Remove existing FAOS cron entries, then add new ones
    (crontab -l 2>/dev/null | grep -v "faos_brain" | grep -v "start_dry_run_cycle") | crontab -
    (crontab -l 2>/dev/null; echo "${CRON_DAILY}"; echo "${CRON_REFLECT}"; echo "${CRON_CAPI}") | crontab -

    ok "Cron jobs installed:"
    echo "   08:00 → Full daily (Analyst + Director)"
    echo "   18:00 → Reflection (T+1 accuracy)"
    echo "   21:00 → CAPI Push (POS → Meta)"
    echo ""
    info "Verify with: crontab -l"
}

uninstall_cron() {
    info "Removing FAOS cron jobs..."
    (crontab -l 2>/dev/null | grep -v "faos_brain" | grep -v "start_dry_run_cycle") | crontab -
    ok "Cron jobs removed"
}

show_status() {
    echo ""
    echo "═══ FAOS DRY_RUN Status ═══"
    echo ""

    for phase in daily reflection capi; do
        local log="${LOG_DIR}/${TODAY}_${phase}.log"
        if [ -f "${log}" ]; then
            local size=$(wc -l < "${log}" | tr -d ' ')
            local last=$(tail -1 "${log}")
            ok "${phase}: ${size} lines — last: ${last}"
        else
            warn "${phase}: No log for today"
        fi
    done

    echo ""
    info "Log directory: ${LOG_DIR}/"
    ls -la "${LOG_DIR}/"*.log 2>/dev/null || warn "No logs found"
}

# ═══════════════════════════════════════════
# CLI Router
# ═══════════════════════════════════════════
case "${1:-run}" in
    run|all)
        shift 2>/dev/null || true
        PROJECT_ID="${1:-stramark}"
        run_all
        ;;
    daily)
        shift 2>/dev/null || true
        PROJECT_ID="${1:-stramark}"
        run_daily
        ;;
    reflection)
        shift 2>/dev/null || true
        PROJECT_ID="${1:-stramark}"
        run_reflection
        ;;
    capi)
        shift 2>/dev/null || true
        PROJECT_ID="${1:-stramark}"
        run_capi
        ;;
    install-cron)
        install_cron
        ;;
    uninstall-cron)
        uninstall_cron
        ;;
    status)
        show_status
        ;;
    *)
        echo "Usage: $0 {run|daily|reflection|capi|install-cron|uninstall-cron|status} [project_id]"
        echo ""
        echo "Commands:"
        echo "  run              Run all 3 phases interactively"
        echo "  daily            Run 08:00 phase (Analyst + Director)"
        echo "  reflection       Run 18:00 phase (T+1 accuracy)"
        echo "  capi             Run 21:00 phase (CAPI Push)"
        echo "  install-cron     Install automated cron schedule"
        echo "  uninstall-cron   Remove cron jobs"
        echo "  status           Show today's run status"
        exit 1
        ;;
esac
