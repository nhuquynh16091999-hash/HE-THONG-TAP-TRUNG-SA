# 📋 FAOS AGENTIC ROADMAP — Chi Tiết Từng Hạng Mục

> **Ngày**: 2026-02-24 | **Baseline**: FAOS v3 (current state)
> **Mục tiêu**: FAOS v4 Agentic — 80% vận hành tự động

---

## 📊 TIẾN ĐỘ TỔNG QUAN

```
Phase A: Foundation (MCP + Agent Upgrade)     ██████░░░░░░░░░░  35%
Phase B: Brain Upgrade (LangGraph v2)         ████░░░░░░░░░░░░  25%
Phase C: Hands (OpenClaw + Auto Ads)          ██░░░░░░░░░░░░░░  10%
Phase D: Autonomous Loop                      ░░░░░░░░░░░░░░░░   0%
────────────────────────────────────────────────────────────────
TỔNG THỂ                                     ███░░░░░░░░░░░░░  18%
```

---

## PHASE A: FOUNDATION — MCP Servers + Agent Upgrade

**Timeline dự kiến**: 4 tuần | **Tiến độ**: 35%

### Đã có (Existing Assets)

| Asset | File | Size | Sẵn sàng wrap MCP? |
|:---|:---|:---:|:---:|
| BigQuery client | `tools/bq_client.py` | 6KB | ✅ Dễ |
| BigQuery credentials | `tools/bq_credentials.py` | 1KB | ✅ |
| Config loader | `tools/config_loader.py` | 9KB | ✅ |
| Discord sender | `tools/discord.py` | 5KB | ✅ |
| CrewAI BQ tools | `agents/crew/tools.py` | 11KB | ✅ Đã là tool functions |
| Meta Ads read | `modules/ads-command-center/backend/router.py` | 11KB | ⚠️ Cần refactor |
| Meta Ads services | `modules/ads-command-center/backend/services/` | 5 files | ⚠️ |
| POS sync | `tools/sync_products.py`, `stramark_order_sync.py` | 16KB | ⚠️ Cần tách API logic |
| 3PL reference | `docs/17_3PL_AUTOMATION_REFERENCE.md` | Docs only | ❌ Chưa có code |

### Công việc chi tiết

---

#### A1. MCP Server: BigQuery 🔴 P0

**Effort**: 3 ngày | **Difficulty**: ⭐⭐ Easy

| # | Task | Chi tiết | Est |
|:---|:---|:---|:---:|
| A1.1 | Setup MCP project | `mcp_servers/bigquery/`, dependencies (`mcp` SDK) | 2h |
| A1.2 | Tool: `query` | Wrap `bq_client.query()` → MCP tool, add project_id param | 4h |
| A1.3 | Tool: `write_rows` | Wrap `bq_client.write()` → MCP tool | 2h |
| A1.4 | Tool: `list_tables` | List tables in dataset | 1h |
| A1.5 | Tool: `get_schema` | Get table columns + types | 1h |
| A1.6 | Tool: `deploy_view` | Wrap `deploy_all_views.py` logic | 3h |
| A1.7 | Resource: schemas | Expose table schemas as MCP resources | 2h |
| A1.8 | Test + docs | Integration test, README | 3h |

**Input**: `tools/bq_client.py` + `agents/crew/tools.py` (đã có query functions)
**Output**: `mcp_servers/bigquery/server.py` chạy standalone

---

#### A2. MCP Server: Meta Ads 🔴 P0

**Effort**: 5 ngày | **Difficulty**: ⭐⭐⭐ Medium

| # | Task | Chi tiết | Est |
|:---|:---|:---|:---:|
| A2.1 | Setup MCP project | `mcp_servers/meta_ads/` | 2h |
| A2.2 | Tool: `get_insights` | Từ `router.py` extract Meta API calls | 6h |
| A2.3 | Tool: `list_campaigns` | List campaigns cho 1 ad account | 3h |
| A2.4 | Tool: `list_adsets` | List adsets | 2h |
| A2.5 | Tool: `list_ads` | List ads | 2h |
| A2.6 | Tool: `pause_ad` | POST status=PAUSED (⚠️ cần safety) | 4h |
| A2.7 | Tool: `scale_budget` | POST daily_budget update (⚠️ safety) | 4h |
| A2.8 | Tool: `create_ad` | Tạo ad mới (future) | 8h |
| A2.9 | Safety layer | Rate limiting, action logging, dry-run mode | 6h |
| A2.10 | Test + docs | Unit tests + README | 4h |

**Input**: `modules/ads-command-center/backend/router.py` + `services/`
**Output**: `mcp_servers/meta_ads/server.py` — read + write Meta Ads

---

#### A3. MCP Server: Poscake POS 🔴 P0

**Effort**: 4 ngày | **Difficulty**: ⭐⭐⭐ Medium

| # | Task | Chi tiết | Est |
|:---|:---|:---|:---:|
| A3.1 | Setup MCP project | `mcp_servers/poscake/` | 2h |
| A3.2 | Tool: `get_orders` | GET /shops/{id}/orders (paginated, date-filtered) | 6h |
| A3.3 | Tool: `get_products` | GET /shops/{id}/products | 3h |
| A3.4 | Tool: `get_stock` | GET /shops/{id}/stock | 3h |
| A3.5 | Tool: `get_order_detail` | GET single order by ID | 2h |
| A3.6 | Tool: `update_order_status` | POST status update (cho 3PL tracking) | 4h |
| A3.7 | Multi-shop support | Loop qua config shops (TALPHA có 6 shops) | 4h |
| A3.8 | Test + docs | | 3h |

**Input**: `tools/stramark_order_sync.py` + `tools/sync_products.py`
**Output**: `mcp_servers/poscake/server.py`

---

#### A4. MCP Server: 3PL (euShipments) 🟡 P1

**Effort**: 5 ngày | **Difficulty**: ⭐⭐⭐⭐ Hard

| # | Task | Chi tiết | Est |
|:---|:---|:---|:---:|
| A4.1 | Tool: `create_order` | POST euShipments create order API | 8h |
| A4.2 | Tool: `get_tracking` | GET shipment tracking info | 4h |
| A4.3 | Tool: `list_shipments` | List all shipments by date | 3h |
| A4.4 | Tool: `get_couriers` | List available couriers | 2h |
| A4.5 | Tool: `reconcile_cod` | COD reconciliation logic | 8h |
| A4.6 | POS→3PL field mapping | Theo doc 17 mapping | 4h |
| A4.7 | Test (dry-run mode) | Test mode in config already exists | 4h |

**Input**: `docs/17_3PL_AUTOMATION_REFERENCE.md` (chi tiết API specs)
**Output**: `mcp_servers/eushipments/server.py`

---

#### A5. MCP Server: Discord 🟡 P1

**Effort**: 1 ngày | **Difficulty**: ⭐ Easy

| # | Task | Chi tiết | Est |
|:---|:---|:---|:---:|
| A5.1 | Tool: `send_message` | Wrap `tools/discord.py` | 2h |
| A5.2 | Tool: `send_embed` | Rich embed messages | 2h |
| A5.3 | Tool: `create_thread` | Thread cho discussions | 2h |
| A5.4 | Multi-webhook | Support per-project webhooks | 1h |

**Input**: `tools/discord.py` (đã hoàn chỉnh)

---

#### A6. Upgrade BaseAgent → MCP-native 🔴 P0

**Effort**: 3 ngày | **Difficulty**: ⭐⭐⭐ Medium

| # | Task | Chi tiết | Est |
|:---|:---|:---|:---:|
| A6.1 | MCP client trong BaseAgent | `self.mcp = MCPClient()` thay vì `import bq_client` | 4h |
| A6.2 | Migrate ProfitGuardian | Đầu tiên migrate 1 agent sang MCP | 6h |
| A6.3 | Migrate OpsWatchdog | | 4h |
| A6.4 | Migrate MarketingAdvisor | | 6h |
| A6.5 | Test compatibility | Đảm bảo output giống hệt pre-MCP | 4h |

---

#### A7. A2A Agent Cards 🟢 P2

**Effort**: 2 ngày | **Difficulty**: ⭐⭐ Easy

| # | Task | Chi tiết | Est |
|:---|:---|:---|:---:|
| A7.1 | Agent Card schema | JSON schema cho FAOS agents | 3h |
| A7.2 | Generate cards | Tạo card cho 12+ agents | 4h |
| A7.3 | Discovery endpoint | HTTP endpoint trả về available agents | 4h |
| A7.4 | A2A message handler | BaseAgent nhận task qua A2A | 6h |

---

### Phase A Summary

| Task | Effort | Priority | Dependencies |
|:---|:---:|:---:|:---|
| A1. MCP BigQuery | 3 ngày | 🔴 P0 | None |
| A2. MCP Meta Ads | 5 ngày | 🔴 P0 | None |
| A3. MCP Poscake | 4 ngày | 🔴 P0 | None |
| A4. MCP 3PL | 5 ngày | 🟡 P1 | Doc #17 |
| A5. MCP Discord | 1 ngày | 🟡 P1 | None |
| A6. BaseAgent upgrade | 3 ngày | 🔴 P0 | A1, A2, A3 |
| A7. A2A Agent Cards | 2 ngày | 🟢 P2 | A6 |
| **Tổng Phase A** | **~23 ngày** | | |

**Có thể song song**: A1 + A2 + A3 cùng lúc → rút còn **~12 ngày** nếu 2 người.

---

## PHASE B: BRAIN UPGRADE — War Room v2

**Timeline dự kiến**: 4 tuần | **Tiến độ**: 25%

### Đã có

| Asset | Chi tiết |
|:---|:---|
| `war_room/orchestrator.py` | LangGraph StateGraph, `build_war_room_graph()`, multi-project |
| `war_room/state.py` | State definition (2KB) |
| `war_room/nodes/` | 7 node implementations |
| `war_room/actions/` | 3 action handlers |
| `agents/llm/llm_provider.py` | Gemini + OpenAI abstraction (16KB) |
| `agents/llm/llm_agent_service.py` | Agent service layer (25KB) |
| `agents/memory/agent_memory.py` | ChromaDB memory (14KB) |
| Dashboard chat | `assistant-tab.tsx` (5KB) |

### Công việc chi tiết

---

#### B1. Planner Node 🔴 P0

**Effort**: 4 ngày | **Difficulty**: ⭐⭐⭐⭐ Hard

| # | Task | Chi tiết | Est |
|:---|:---|:---|:---:|
| B1.1 | Task decomposition | LLM phân rã request → list sub-tasks | 8h |
| B1.2 | Agent matching | Map sub-task → agent dựa trên Agent Cards | 4h |
| B1.3 | Dependency graph | Xác định task nào phải chạy trước | 6h |
| B1.4 | Re-planning | Nếu task fail → re-plan alternative | 6h |
| B1.5 | Test scenarios | 10 test cases (easy → complex) | 4h |

---

#### B2. Human-in-the-Loop Gate 🔴 P0

**Effort**: 3 ngày | **Difficulty**: ⭐⭐⭐ Medium

| # | Task | Chi tiết | Est |
|:---|:---|:---|:---:|
| B2.1 | Approval rules config | YAML: action_type → auto/manual threshold | 4h |
| B2.2 | Discord approval | Bot gửi "Approve?" → CEO react ✅/❌ | 8h |
| B2.3 | Dashboard approval | UI button trong War Room tab | 6h |
| B2.4 | Timeout + escalation | 30 min no response → escalate hoặc skip | 3h |

---

#### B3. Reflector Node 🟡 P1

**Effort**: 2 ngày | **Difficulty**: ⭐⭐⭐ Medium

| # | Task | Chi tiết | Est |
|:---|:---|:---|:---:|
| B3.1 | Result evaluation | LLM đánh giá: task thành công chưa? | 6h |
| B3.2 | Retry logic | Retry failed sub-tasks (max 2 lần) | 4h |
| B3.3 | Learning loop | Log outcome → memory cho lần sau | 4h |

---

#### B4. Natural Language Chat API 🔴 P0

**Effort**: 3 ngày | **Difficulty**: ⭐⭐⭐ Medium

| # | Task | Chi tiết | Est |
|:---|:---|:---|:---:|
| B4.1 | Chat endpoint | POST /api/chat → War Room v2 → stream response | 6h |
| B4.2 | Context injection | Tự inject project context, date, recent alerts | 4h |
| B4.3 | Conversation memory | ChromaDB session memory | 4h |
| B4.4 | Upgrade assistant-tab | Real-time streaming + action status | 8h |

---

#### B5. Unified Agent Runner 🟡 P1

**Effort**: 2 ngày | **Difficulty**: ⭐⭐ Easy

| # | Task | Chi tiết | Est |
|:---|:---|:---|:---:|
| B5.1 | Consolidate servers | Merge FastAPI 8000 + War Room 8001 + ACC 3003 → 1 server | 8h |
| B5.2 | Unified health check | /health → all services status | 3h |
| B5.3 | Docker Compose | Containerize all services | 6h |

---

### Phase B Summary

| Task | Effort | Priority | Dependencies |
|:---|:---:|:---:|:---|
| B1. Planner Node | 4 ngày | 🔴 P0 | A7 (Agent Cards) |
| B2. Human Gate | 3 ngày | 🔴 P0 | None |
| B3. Reflector | 2 ngày | 🟡 P1 | B1 |
| B4. Chat API | 3 ngày | 🔴 P0 | B1 |
| B5. Unified Server | 2 ngày | 🟡 P1 | None |
| **Tổng Phase B** | **~14 ngày** | | |

---

## PHASE C: HANDS — OpenClaw + Auto Ads Care

**Timeline dự kiến**: 4 tuần | **Tiến độ**: 10%

### Đã có

| Asset | Chi tiết |
|:---|:---|
| Ads Command Center UI | 39KB tab, Facebook read implemented |
| Meta API read calls | `router.py` → insights, campaigns, adsets, ads |
| Rules defined | `PHASE2_AUTO_ADS_CARE.md` — 8 FB rules, 4 TikTok, 4 Google |
| Dashboard Ads tab | Interactive UI cho STRAMARK |

---

#### C1. OpenClaw Deployment 🟡 P1

**Effort**: 2 ngày | **Difficulty**: ⭐⭐ Easy

| # | Task | Chi tiết | Est |
|:---|:---|:---|:---:|
| C1.1 | Install OpenClaw | Self-hosted, Docker | 3h |
| C1.2 | MCP wrapper | `mcp_servers/browser/server.py` | 6h |
| C1.3 | Use case: 3PL dashboard | Download COD reports từ euShipments | 4h |
| C1.4 | Use case: competitor | Scrape competitor pricing | 4h |

---

#### C2. Rules Engine 🔴 P0

**Effort**: 5 ngày | **Difficulty**: ⭐⭐⭐⭐ Hard

| # | Task | Chi tiết | Est |
|:---|:---|:---|:---:|
| C2.1 | Rule definition schema | YAML config: condition → action → threshold | 4h |
| C2.2 | Rule evaluator | Python engine evaluate rules vs live data | 8h |
| C2.3 | FB rule implementations | 8 rules từ Phase 2 doc | 8h |
| C2.4 | Action executor | Gọi MCP Meta Ads để thực thi | 6h |
| C2.5 | Action log table | BQ table `ads_action_log` | 3h |
| C2.6 | Rollback mechanism | Undo last action trong 1h | 6h |
| C2.7 | Kill switch | Config flag disable per project/channel | 2h |
| C2.8 | Test dry-run | Run full loop với dry_run=True | 4h |

---

#### C3. 3PL Automation 🔴 P0

**Effort**: 5 ngày | **Difficulty**: ⭐⭐⭐⭐ Hard

| # | Task | Chi tiết | Est |
|:---|:---|:---|:---:|
| C3.1 | Order Automation | POS status=8 → tạo đơn euShipments qua MCP | 8h |
| C3.2 | Tracking Poller | Poll 3PL mỗi 2h → update POS status | 6h |
| C3.3 | N8N workflows | 2 workflows mới (fulfillment_sync, tracking_poll) | 6h |
| C3.4 | BQ tables | `fulfillment_orders`, `fulfillment_tracking` | 4h |
| C3.5 | COD Reconciliation | Match 3PL payments vs orders | 8h |
| C3.6 | Dashboard tab | Fulfillment status tab | 6h |

---

### Phase C Summary

| Task | Effort | Priority | Dependencies |
|:---|:---:|:---:|:---|
| C1. OpenClaw | 2 ngày | 🟡 P1 | None |
| C2. Rules Engine | 5 ngày | 🔴 P0 | A2 (MCP Meta) |
| C3. 3PL Automation | 5 ngày | 🔴 P0 | A3, A4 (MCP POS + 3PL) |
| **Tổng Phase C** | **~12 ngày** | | |

---

## PHASE D: AUTONOMOUS LOOP

**Timeline dự kiến**: Ongoing | **Tiến độ**: 0%

#### D1. Self-Tuning 🟡 P1

| # | Task | Est |
|:---|:---|:---:|
| D1.1 | Threshold auto-adjustment dựa trên 30-day history | 3 ngày |
| D1.2 | A/B test alert thresholds | 2 ngày |

#### D2. Cross-Project Learning 🟢 P2

| # | Task | Est |
|:---|:---|:---:|
| D2.1 | Knowledge transfer: STRAMARK insights → TALPHA | 3 ngày |
| D2.2 | Cross-project anomaly detection | 2 ngày |

#### D3. Predictive Analytics 🟢 P2

| # | Task | Est |
|:---|:---|:---:|
| D3.1 | Stockout prediction (3 ngày trước) | 4 ngày |
| D3.2 | Revenue forecast (7 ngày) | 4 ngày |
| D3.3 | Ads fatigue prediction | 3 ngày |

#### D4. Multi-Channel Ads 🟡 P1

| # | Task | Est |
|:---|:---|:---:|
| D4.1 | MCP Server: TikTok Ads | 5 ngày |
| D4.2 | MCP Server: Google Ads | 5 ngày |
| D4.3 | Unified ads reporting | 3 ngày |
| D4.4 | Cross-channel budget optimizer | 5 ngày |

---

## 📅 TIMELINE TỔNG HỢP

```
     Tháng 1         Tháng 2         Tháng 3         Tháng 4         Tháng 5+
 ─────────────── ─────────────── ─────────────── ─────────────── ───────────
 [A1 MCP BQ    ] 
 [A2 MCP Meta  ][A2             ]
 [A3 MCP POS   ]
                 [A4 MCP 3PL    ]
                 [A5 Discord    ]
                 [A6 BaseAgent  ][A6             ]
                                 [A7 A2A Cards   ]
                                 [B1 Planner     ][B1             ]
                                 [B2 Human Gate  ]
                                                  [B4 Chat API    ]
                                                  [B3 Reflector   ]
                                                  [B5 Unified Srv ]
                                                  [C2 Rules Eng   ][C2             ]
                                                  [C3 3PL Auto    ][C3             ]
                                                                   [C1 OpenClaw    ]
                                                                   [D1-D4 Ongoing  ]
```

---

## 🎯 QUICK WINS — Làm Ngay Được

Những việc có thể bắt đầu **ngay bây giờ** mà không cần setup mới:

| # | Task | Effort | Impact |
|:---|:---|:---:|:---:|
| 1 | **3PL Order Automation** (C3.1) — Doc #17 đã rất chi tiết | 1 ngày | 🔴 Cao |
| 2 | **MCP BigQuery** (A1) — Wrap `bq_client.py` | 3 ngày | 🔴 Cao |
| 3 | **Rules Engine config** (C2.1) — Chỉ viết YAML | 0.5 ngày | 🟡 |
| 4 | **Consolidate servers** (B5.1) — 3 servers → 1 | 1 ngày | 🟡 |
| 5 | **Agent Cards** (A7.1-A7.2) — Viết JSON cho 12 agents | 0.5 ngày | 🟢 |

---

## 💰 RESOURCE ESTIMATE

| Phase | Effort (1 dev) | Effort (2 devs) | Effort (AI-assisted*) |
|:---|:---:|:---:|:---:|
| Phase A | 23 ngày | 12 ngày | 8 ngày |
| Phase B | 14 ngày | 8 ngày | 5 ngày |
| Phase C | 12 ngày | 7 ngày | 5 ngày |
| Phase D | 30+ ngày | 18 ngày | 12 ngày |
| **Tổng** | **~79 ngày** | **~45 ngày** | **~30 ngày** |

*\*AI-assisted = dùng AI coding assistant (như hiện tại) để tăng tốc development.*

---

*Created: 2026-02-24 | Sẽ cập nhật khi hoàn thành từng milestone*
