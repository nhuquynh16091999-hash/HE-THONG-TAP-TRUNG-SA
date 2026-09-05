#!/usr/bin/env python3
"""
FAOS pre-commit hook: Enforce architecture boundaries.

Rules:
- sync/<store>/*.py      → KHÔNG được import từ faos_brain/
- api/routers/<store>/   → KHÔNG được import từ api/routers/<other_store>/
- sync/<store>/          → KHÔNG được import từ sync/<other_store>/

Rationale: Mỗi store là một module độc lập. Shared logic phải đi qua
           shared/ hoặc faos_brain/api/ (không phải faos_brain internals).
"""
import re
import sys
from pathlib import Path

VIOLATIONS = []

# Pattern: import faos_brain.xxx hoặc from faos_brain.xxx import yyy
FAOS_BRAIN_IMPORT = re.compile(
    r"^\s*(import|from)\s+faos_brain[.\s]"
)

# Pattern: from api.routers.STORE_X import ... (trong file của STORE_Y)
API_CROSS_IMPORT = re.compile(
    r"^\s*from\s+api\.routers\.(\w+)\s"
)

# Pattern: from sync.STORE_X import ... (trong file của STORE_Y)
SYNC_CROSS_IMPORT = re.compile(
    r"^\s*from\s+sync\.(\w+)\s"
)

KNOWN_STORES = {
    "stramark", "auus1", "talpha", "t1", "hnle",
    "trendify", "zen8", "auus1",
}


def get_store_from_path(filepath: str) -> str | None:
    parts = Path(filepath).parts
    # sync/stramark/... → "stramark"
    # api/routers/stramark/... → "stramark"
    for i, part in enumerate(parts):
        if part in ("sync", "routers") and i + 1 < len(parts):
            return parts[i + 1]
    return None


for filepath in sys.argv[1:]:
    path   = Path(filepath)
    store  = get_store_from_path(filepath)
    prefix = str(path.parts[0]) if path.parts else ""

    try:
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        continue

    for lineno, line in enumerate(lines, 1):
        # sync/ không được import faos_brain internals
        if prefix == "sync" and FAOS_BRAIN_IMPORT.match(line):
            # Cho phép import faos_brain.api (public gateway)
            if "faos_brain.api" not in line:
                VIOLATIONS.append(
                    f"  ❌ {filepath}:{lineno}: sync/ không được import faos_brain internals\n"
                    f"     {line.strip()}\n"
                    f"     → Dùng shared/ hoặc faos_brain.api thay thế"
                )

        # sync/<store_A>/ không được import sync/<store_B>/
        if prefix == "sync" and store:
            m = SYNC_CROSS_IMPORT.match(line)
            if m and m.group(1) != store and m.group(1) in KNOWN_STORES:
                VIOLATIONS.append(
                    f"  ❌ {filepath}:{lineno}: sync/{store}/ không được import sync/{m.group(1)}/\n"
                    f"     {line.strip()}\n"
                    f"     → Tách logic chung ra shared/"
                )

        # api/routers/<store_A>/ không được import api/routers/<store_B>/
        if "routers" in str(path) and store:
            m = API_CROSS_IMPORT.match(line)
            if m and m.group(1) != store and m.group(1) in KNOWN_STORES:
                VIOLATIONS.append(
                    f"  ❌ {filepath}:{lineno}: api/routers/{store}/ không được import api/routers/{m.group(1)}/\n"
                    f"     {line.strip()}\n"
                    f"     → Dùng shared/ hoặc faos_brain.api"
                )

if VIOLATIONS:
    print("\n🚨 FAOS: Architecture boundary violations!\n")
    for v in VIOLATIONS:
        print(v)
    print("\nXem AGENTS.md hoặc docs/SYSTEM_ARCHITECTURE.md để hiểu zone rules.\n")
    sys.exit(1)

sys.exit(0)
