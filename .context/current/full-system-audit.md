# Master Prompt: Full System Audit — Stramark_ver2

## NGỮ CẢNH
- **Dự án**: Stramark_ver2 (FAOS v6) — Marketing Analytics Dashboard
- **Phase**: Development, ~40% progress
- **Stack**: Python 3.12 + FastAPI (backend), Next.js 15 + React 19 (frontend), BigQuery (data), FalkorDB (graph)
- **VPS**: Contabo 164.68.101.179 (Ubuntu 22.04), PM2 managed
- **Local**: Windows, IP 192.168.1.2
- **Repo**: github.com/nhatngo-coder/Agentic-AI-Levelup (branch master)

## YÊU CẦU CHI TIẾT
Audit toàn bộ hệ thống, tìm bugs/issues, fix được gì fix luôn, cập nhật memory bank.

### Checklist Audit
1. **Project Structure** — file/folder organization, naming conventions
2. **Dashboard-UI** — components, imports, dead code, rendering issues
3. **Backend (faos_brain)** — API routes, agent logic, error handling
4. **SQL/BigQuery** — views consistency, data accuracy, missing columns
5. **Sync Scripts** — EU Shipment sync, scheduler, error handling
6. **Config & Environment** — .env files, secrets exposure, missing configs
7. **Deployment** — PM2 config, deploy.sh, VPS readiness
8. **Security** — credentials in code, API keys, auth
9. **Memory Bank** — update techContext.md, systemPatterns.md, REPO_GRAPH.md

## MODULES LIÊN QUAN
Toàn bộ: dashboard-ui/, faos_brain/, sql/, sync/, scripts/, config/, api/, app/, tests/, docs/

## RÀNG BUỘC
- Territory Rules: faos_brain/, config/, tests/ = read-only audit (không sửa logic)
- Fix những gì an toàn: labels, imports, dead code, memory bank files
- Flag issues cần human review

## ACCEPTANCE CRITERIA
- [ ] Mỗi module được audit với verdict: OK / WARN / CRITICAL
- [ ] Issues list với severity + recommendation
- [ ] Auto-fix simple issues
- [ ] Memory bank files cập nhật đầy đủ
- [ ] Audit report artifact tạo xong

## VERIFICATION
- Memory bank files phản ánh đúng thực tế
- Không còn STALE/DRIFT items trong memory check
