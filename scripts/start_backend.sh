#!/usr/bin/env bash
# PM2 wrapper for FAOS Backend API
# Cross-platform: Mac (local dev), Ubuntu (VPS), Windows (Git Bash/WSL)

# Auto-detect project root (where this script lives → parent dir)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$PROJECT_ROOT" || { echo "ERROR: Cannot cd to $PROJECT_ROOT"; exit 1; }

# Auto-detect virtualenv: .venv (Mac/Windows) or venv (VPS/Ubuntu)
if [ -f ".venv/bin/activate" ]; then
  source .venv/bin/activate
elif [ -f "venv/bin/activate" ]; then
  source venv/bin/activate
elif [ -f ".venv/Scripts/activate" ]; then
  # Windows Git Bash
  source .venv/Scripts/activate
elif [ -f "venv/Scripts/activate" ]; then
  # Windows Git Bash (venv)
  source venv/Scripts/activate
else
  echo "ERROR: No virtualenv found in $PROJECT_ROOT"
  echo "Looked for: .venv/bin/activate, venv/bin/activate, .venv/Scripts/activate, venv/Scripts/activate"
  exit 1
fi

export PYTHONPATH="$PROJECT_ROOT"

echo "=== FAOS Backend Starting ==="
echo "  Project: $PROJECT_ROOT"
echo "  Python:  $(which python)"
echo "  Venv:    $VIRTUAL_ENV"
echo "=============================="

exec uvicorn faos_brain.api.main:app --host 0.0.0.0 --port 8000
