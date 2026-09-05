# Master Prompt: Tái cấu trúc Agentic-AI-Levelup vào Stramark_ver2

## NGỮ CẢNH
- **Dự án**: Stramark_ver2 — FAOS v6 (Facebook Ads Optimization System)
- **Phase**: Khởi tạo (scaffold V5.1 trống, chưa có code thực)
- **Stack gốc (repo cũ)**: Python 3.12 + FastAPI + Next.js 15 + BigQuery + FalkorDB
- **Scaffold V5.1 hiện tại**: Node.js/Express skeleton → cần thay đổi sang Python/Next.js
- **Repo nguồn**: `C:\Users\Windows 11 Pro\Global-Stramark (AI)\Agentic-AI-Levelup`
- **Repo đích**: `d:\Stramark_ver2`

## YÊU CẦU CHI TIẾT

### Mục tiêu
Merge toàn bộ code từ `Agentic-AI-Levelup` vào `Stramark_ver2`, tái cấu trúc theo scaffold V5.1 Cognitive Consultant. Loại bỏ nội dung "tự diễn sinh", chuẩn hóa theo Territory Rules + Naming Conventions.

### Sub-tasks

1. **Restructure scaffold V5.1**: Thay `src/` (Node.js) → cấu trúc Python phù hợp FAOS v6
2. **Migrate `faos_brain/`** (AI Core — KHÔNG sửa logic, chỉ move):
   - `analyst.py`, `marketing_director.py`, `runner.py`, `state_machine.py`
   - `config.py`, `llm_client.py`, `webhook_server.py`
   - Sub-dirs: `api/`, `graph/`, `models/`, `prompts/`, `workflows/`
3. **Migrate `dashboard-ui/`** (Next.js 15 frontend — giữ nguyên cấu trúc Next.js)
4. **Migrate `config/`**: YAML configs (naming_registry, thresholds, schedules, projects/)
5. **Migrate `sql/`**: BigQuery DDL (v6/, tables/, _legacy/)
6. **Migrate `scripts/`**: Deploy + ops scripts (6 files)
7. **Migrate `sync/`**: Data sync pipelines
8. **Migrate `tests/`**: 26 test files
9. **Migrate `docs/`**: 12 reference docs
10. **Migrate `api/routers/`** và `app/projects/`**: Per-project code
11. **KHÔNG migrate `_deprecated/`**: Skip legacy archive (15 dirs of old v1-v5 code)
12. **Setup support files**: `.gitignore`, `requirements.txt`, `docker-compose.ai.yml`, `package.json`
13. **Cập nhật memory-bank**: `activeContext.md`, `systemPatterns.md`, `REPO_GRAPH.md`

## MODULES LIÊN QUAN (từ repo cũ)

| Module | Path gốc | Type | Ghi chú |
|--------|----------|------|---------|
| AI Core | `faos_brain/` | Python pkg | 🔴 Forbidden — move only, KHÔNG sửa code |
| Dashboard | `dashboard-ui/` | Next.js app | Giữ nguyên cấu trúc bên trong |
| Config | `config/` | YAML files | 🔴 Forbidden — copy as-is |
| SQL | `sql/` | DDL files | Schema definitions |
| Scripts | `scripts/` | Shell/Python | Deploy & ops |
| Sync | `sync/` | Python | Data pipelines |
| Tests | `tests/` | Python | Test suite |
| Docs | `docs/` | Markdown | Reference docs |
| API Routers | `api/routers/` | Python | FastAPI endpoints |
| App Projects | `app/projects/` | Python | Per-project code |

## RÀNG BUỘC

- **Territory Rules**: Tuân thủ FAOS v6 Development Standards (xem `standards.md`)
- **faos_brain/** là FORBIDDEN — chỉ move, KHÔNG sửa nội dung code
- **config/** là FORBIDDEN — chỉ copy, KHÔNG sửa
- Giữ nguyên `.gitignore` patterns từ repo cũ
- Không cần giữ git history (repo mới)
- `_deprecated/` SKIP hoàn toàn — không mang legacy code sang

## CẤU TRÚC ĐỀ XUẤT (sau restructuring)

```
Stramark_ver2/
├── .agents/                     # ✅ Giữ nguyên scaffold V5.1
├── .context/                    # ✅ Giữ nguyên scaffold V5.1
├── memory-bank/                 # ✅ Cập nhật sau khi migrate
├── docs/                        # 📚 Merge docs từ repo cũ
├── faos_brain/                  # 🧠 AI Core (move as-is)
├── dashboard-ui/                # 🖥️ Frontend (move as-is)
├── config/                      # ⚙️ YAML configs (copy as-is)
├── sql/                         # 📊 BigQuery DDL
├── scripts/                     # 🔧 Deploy & ops
├── sync/                        # 🔄 Data pipelines
├── api/                         # 🌐 FastAPI routers
│   └── routers/
├── app/                         # 📦 Per-project code
│   └── projects/
├── tests/                       # 🧪 Test suite
├── logs/                        # 📝 Runtime logs (gitignored)
├── .gitignore                   # Merged .gitignore
├── requirements.txt             # Python deps
├── package.json                 # Node deps (for dashboard-ui scripts)
├── docker-compose.ai.yml        # FalkorDB + Redis
├── start_dry_run_cycle.sh       # Cron entry point
├── REPO_GRAPH.md                # Cập nhật sau migrate
├── AGENTS.md                    # Giữ nguyên
├── CHANGELOG.md                 # Cập nhật
└── ONBOARDING.md                # Cập nhật
```

## ACCEPTANCE CRITERIA

- [ ] Tất cả code từ `faos_brain/` có mặt trong `Stramark_ver2/faos_brain/` — nội dung giữ nguyên 100%
- [ ] `dashboard-ui/` có mặt đầy đủ — Next.js project chạy được `npm run dev`  
- [ ] `config/` YAML files copy nguyên vẹn
- [ ] `sql/` DDL files copy nguyên vẹn
- [ ] `scripts/` copy nguyên vẹn
- [ ] `sync/`, `api/`, `app/` copy nguyên vẹn
- [ ] `tests/` copy nguyên vẹn — chạy `pytest` không lỗi import
- [ ] `docs/` merge thành công, không conflict với docs V5.1
- [ ] `.gitignore` merge hợp lý (Python + Node.js + V5.1)
- [ ] `requirements.txt` và `docker-compose.ai.yml` có mặt
- [ ] `_deprecated/` KHÔNG xuất hiện trong Stramark_ver2
- [ ] `REPO_GRAPH.md` cập nhật reflect cấu trúc mới
- [ ] `activeContext.md` cập nhật phase mới
- [ ] `systemPatterns.md` cập nhật stack + patterns
- [ ] Node.js scaffold cũ (`src/app.js`, `src/config/`) đã xóa

## VERIFICATION

### Automated
1. Kiểm tra file count: so sánh số file migrate vs repo gốc (trừ `_deprecated/` và `.git/`)
2. `pytest --collect-only` trong `Stramark_ver2` — confirm tests discoverable
3. `cd dashboard-ui && npm install` — confirm frontend deps OK

### Manual (by user)
1. Review cấu trúc folder cuối cùng
2. Confirm `python -m faos_brain.runner --help` chạy được
3. Confirm `cd dashboard-ui && npm run dev` khởi động được
