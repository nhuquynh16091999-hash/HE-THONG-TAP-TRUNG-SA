---
description: Auto-scan codebase va generate REPO_GRAPH.md
---
// turbo-all
1. Scan tat ca source files:
   - `faos_brain/` (Python core)
   - `dashboard-ui/src/` (Next.js frontend)
   - `scripts/` (deployment scripts)
   - `sql/v6/` (active SQL files)
   - `config/` (configuration files)
2. Voi moi file chinh, chay view_file_outline de lay functions/classes
3. Dung grep_search 'import|from' de tim dependency relationships trong faos_brain/
4. Dung grep_search 'import|require' de tim dependency relationships trong dashboard-ui/
5. Tao bang Nodes: moi module 1 row (name, path, type, exports)
6. Tao bang Edges: moi relationship 1 row (from, to, type)
7. Ghi ket qua vao REPO_GRAPH.md (overwrite)
8. Cap nhat timestamp trong REPO_GRAPH.md header
