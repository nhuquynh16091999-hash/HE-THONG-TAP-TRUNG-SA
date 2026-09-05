# Master Prompt: Refactor 6 Oversized Files
<!-- Created: 2026-03-06T15:36 -->
<!-- Status: PENDING USER REVIEW -->

## NGỮ CẢNH
- **Dự án**: FAOS v6 — AI-powered Fashion Ad Ops
- **Phase**: V5.1 vừa tích hợp xong, sẵn sàng clean up tech debt
- **Stack**: Python 3.12 (FastAPI), Next.js 15, BigQuery, FalkorDB
- **Trạng thái Git**: `main` branch, synced tại `69f564d`
- **Prerequisites**: Git pull + merge trước khi refactor

## YÊU CẦU CHI TIẾT

### Mục tiêu
Tách 6 files quá lớn thành modules nhỏ hơn (<= 300 dòng), giữ nguyên API public, không breaking changes.

### 6 Files cần refactor (theo thứ tự ưu tiên)

| # | File | Lines | Funcs | Strategy | Priority |
|---|------|-------|-------|----------|----------|
| 1 | `marketing_director.py` | 1265 | 27 | Tách thành 4 files | 🔴 Critical |
| 2 | `analyst.py` | 1054 | 24 | Tách thành 4 files | 🔴 Critical |
| 3 | `daily_analysis.py` | 651 | 11 | Tách thành 2-3 files | 🟡 High |
| 4 | `capi_push.py` | 506 | 11 | Tách thành 2 files | 🟡 High |
| 5 | `webhook_server.py` | 399 | 11 | Tách thành 2 files | 🟢 Medium |
| 6 | `runner.py` | 391 | 7 | Tách thành 2 files | 🟢 Medium |

### Chi tiết Refactor Plan

#### File 1: `marketing_director.py` (1265→4 files)
```
marketing_director.py      → MarketingDirector class (init, run_daily_strategy) ~200 lines
director_approval.py  [NEW] → route_decision(), validate_transition(), DailyAutoTracker ~200 lines
director_execution.py [NEW] → execute_decision(), _call_meta_api(), _init_meta_api() ~200 lines
director_comms.py     [NEW] → send_approval_request(), _log_to_bq(), _save_decision_to_graph() ~200 lines
```

#### File 2: `analyst.py` (1054→4 files)
```
analyst.py                  → ExecutiveAnalyst class (init, run_daily_analysis) ~200 lines
analyst_parser.py     [NEW] → _parse_llm_output(), _extract_predictions(), _extract_lessons() ~200 lines
analyst_persistence.py [NEW] → save_predictions(), save_lessons(), save_run_log(), send_report() ~200 lines
analyst_reflection.py [NEW] → run_reflection(), _update_predictions_with_actuals() ~200 lines
```

#### File 3: `daily_analysis.py` (651→2 files)
```
daily_analysis.py           → ForcedWorkflow class (init, run, _transition) ~300 lines
data_gates.py         [NEW] → validate_data_gates(), DataGateResult, EmergencyHaltError ~200 lines
workflow_logging.py   [NEW] → log_run_start(), log_run_end(), emit_sse() ~150 lines
```

#### File 4: `capi_push.py` (506→2 files)
```
capi_push.py                → CAPIPushWorkflow (init, run, fetch, log) ~250 lines
capi_transform.py     [NEW] → hash_field(), normalize_phone(), hash_user_data(), build_event() ~200 lines
```

#### File 5: `webhook_server.py` (399→2 files)
```
webhook_server.py           → FastAPI app, routes, health ~200 lines
webhook_handlers.py   [NEW] → _handle_approve(), _handle_reject(), _handle_rollback(), helpers ~200 lines
```

#### File 6: `runner.py` (391→2 files)
```
runner.py                   → FAOSRunner class (init, run_* methods) ~250 lines
runner_cli.py         [NEW] → build_parser(), main() CLI entrypoint ~150 lines
```

## MODULES LIÊN QUAN (từ REPO_GRAPH)
- `config.py` — hub node, 11 modules depend → KHÔNG đụng
- `state_machine.py` — imported by director + workflow → KHÔNG đụng
- `models/` — Pydantic types → KHÔNG đụng
- `graph/` — FalkorDB layer → KHÔNG đụng
- `api/` — imports from graph, config → May cần update nếu import paths thay đổi

## RÀNG BUỘC
1. **Zero breaking changes** — Public API (class names, function signatures) giữ nguyên
2. **Re-export pattern** — File gốc vẫn re-export tất cả symbols cho backward compat
3. **Production safety** — Test kỹ từng file trước khi chuyển sang file tiếp theo
4. **Git hygiene** — Commit mỗi file refactor thành 1 commit riêng
5. **Import path compat** — `from faos_brain.analyst import ExecutiveAnalyst` vẫn hoạt động

## WORKFLOW TUẦN TỰ (6 sprints)

```
For each of 6 files:
  1. Git pull + merge (chỉ lần đầu)
  2. Chạy existing tests → ghi baseline
  3. Tạo file mới, move logic
  4. Update imports trong file gốc (re-export)
  5. Chạy lại tests → must PASS 100%
  6. Commit: "[FAOS] refactor: split {file} into modules"
  7. → Chuyển sang file tiếp theo
```

## ACCEPTANCE CRITERIA
- [ ] Tất cả 6 files chính <= 300 dòng
- [ ] Tổng 12 files mới tạo đúng structure
- [ ] `from faos_brain.analyst import ExecutiveAnalyst` vẫn hoạt động
- [ ] `from faos_brain.marketing_director import MarketingDirector` vẫn hoạt động
- [ ] Tất cả existing tests PASS (zero regression)
- [ ] Mỗi refactor là 1 Git commit riêng
- [ ] REPO_GRAPH.md được cập nhật sau khi xong

## VERIFICATION
1. **Test suite**: Chạy `python -m pytest tests/` trước và sau mỗi refactor
2. **Import check**: Verify tất cả `from faos_brain.*` imports vẫn resolve
3. **Grep check**: `grep -r "from faos_brain" --include="*.py"` → no broken imports
4. **Final scan**: Re-run `/scan-repo` sau khi xong tất cả → cập nhật REPO_GRAPH.md
