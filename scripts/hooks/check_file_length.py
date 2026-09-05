#!/usr/bin/env python3
"""
FAOS pre-commit hook: Enforce file length limits.
- Python files: max 300 lines  (faos_brain, sync, api, scripts)
- TypeScript/TSX files: max 500 lines  (dashboard-ui)
"""
import sys
from pathlib import Path

LIMITS = {
    ".py":  300,
    ".ts":  500,
    ".tsx": 500,
}

errors = []

for filepath in sys.argv[1:]:
    path = Path(filepath)
    limit = LIMITS.get(path.suffix)
    if limit is None:
        continue

    try:
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        continue

    if len(lines) > limit:
        errors.append(
            f"  ❌ {filepath}: {len(lines)} dòng (giới hạn {limit})\n"
            f"     → Tách thành file nhỏ hơn theo Extract-Delegate-Reexport pattern"
        )

if errors:
    print("\n🚨 FAOS: File length limit exceeded!\n")
    for e in errors:
        print(e)
    print("\nXem .agent/rules/python-conventions.md hoặc frontend-conventions.md để biết cách tách file.\n")
    sys.exit(1)

sys.exit(0)
