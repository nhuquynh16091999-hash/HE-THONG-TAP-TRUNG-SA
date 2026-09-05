# 01 — Đặc Tả Sản Phẩm & Giao Diện (PRD & UI Specs)

> **Project**: FAOS v6 — Agentic Workflow & Human-in-the-Loop  
> **Version**: 1.0 | **Date**: 2026-03-01  
> **Author**: System Architect  
> **Status**: Draft — Pending Review

---

## Mục Lục

1. [Tổng Quan Sản Phẩm](#1-tổng-quan-sản-phẩm)
2. [Interactive Approval System](#2-interactive-approval-system-discordtelegram)
3. [Agent Control Center UI](#3-agent-control-center-ui-nextjs)
4. [AI Intelligence Dashboard Tab](#4-ai-intelligence-dashboard-tab)

---

## 1. Tổng Quan Sản Phẩm

### 1.1 Mục Tiêu

Xây dựng hệ thống AI Agent vận hành e-commerce cross-border với 2 đặc tính cốt lõi:

- **Agentic Workflow**: AI tự phân tích, ra quyết định, và tự học mỗi ngày
- **Human-in-the-Loop**: Các quyết định quan trọng PHẢI qua duyệt con người trước khi thực thi

### 1.2 User Personas

| Persona | Mô tả | Cách tương tác |
|:--|:--|:--|
| **Owner / CEO** | Ra quyết định cuối cùng, duyệt lệnh AI | Telegram/Discord buttons, Dashboard |
| **Marketing Lead** | Giám sát chiến dịch, điều team MKT | Dashboard Marketer Leaderboard |
| **Developer / Admin** | Quản trị AI, sửa SOPs, debug | Agent Control Center |

### 1.3 Modules

| Module | Mô tả | Kênh |
|:--|:--|:--|
| Interactive Approval | Duyệt/Từ chối/Rollback lệnh AI | Telegram + Discord |
| Agent Control Center | Quản trị Agent (Live Feed, Memory, Audit, Personality) | Dashboard Next.js |
| AI Intelligence | Biểu đồ accuracy, win-rate | Dashboard Next.js |

---

## 2. Interactive Approval System (Discord/Telegram)

### 2.1 Tổng Quan Luồng

```
AI Director phân tích data
       │
       ├── Lệnh nhỏ (< auto_budget_limit) ──→ TỰ THỰC THI ──→ Log "AUTO_APPROVED"
       │
       └── Lệnh lớn / nguy hiểm ──→ GỬI APPROVAL REQUEST
                                           │
                                    ┌──────┴──────┐
                                    │  Discord /   │
                                    │  Telegram    │
                                    │  Message     │
                                    │ ┌──────────┐ │
                                    │ │ ✅ Duyệt  │ │
                                    │ │ ❌ Bỏ qua │ │
                                    │ │ ↩️ Rollback│ │
                                    │ └──────────┘ │
                                    └──────┬──────┘
                                           │
                              ┌────────────┼────────────┐
                              │            │            │
                         ✅ Duyệt    ❌ Bỏ qua   ↩️ Rollback
                              │            │            │
                     Thực thi Meta API  Log REJECTED  Khôi phục
                     Log APPROVED       Không làm gì  trạng thái cũ
                     Gửi confirm msg                  Log ROLLED_BACK
```

### 2.2 Điều Kiện Kích Hoạt Approval

| Hành động | Điều kiện | Approval Required? |
|:--|:--|:--|
| Tăng budget ≤ `auto_budget_limit` | VD: tăng $30, limit = $50 | ❌ Auto-execute |
| Tăng budget > `auto_budget_limit` | VD: tăng $80, limit = $50 | ✅ Cần duyệt |
| Tăng budget > 30% | Bất kể số tiền | ✅ Cần duyệt |
| Giảm budget bất kỳ | — | ❌ Auto-execute |
| Pause AdSet | AdSet phụ | ❌ Auto-execute |
| Kill Campaign (tắt hẳn) | Campaign chủ lực | ✅ Cần duyệt |
| Create new campaign | — | ✅ Cần duyệt |
| Thay đổi Automated Rules | — | ✅ Cần duyệt |

- `auto_budget_limit` được cấu hình từ Personality Settings (mặc định: $50/ngày/campaign = 5000 cents)
- `risk_level` (0.0→1.0) ảnh hưởng: risk cao → auto_limit cao hơn, ít phải duyệt hơn

### 2.3 Message Format — Discord

```
┌─────────────────────────────────────────────────────────┐
│ 🤖 AI Marketing Director — Yêu Cầu Duyệt Lệnh         │
│─────────────────────────────────────────────────────────│
│                                                         │
│ 🎯 Hành động:    SCALE BUDGET (+25%)                    │
│ 📊 Chiến dịch:   04.02-D04-Romania-CĐ-AureliaWear-LC  │
│ 💰 Thay đổi:     $80/ngày → $100/ngày (+$20)           │
│                                                         │
│ 📝 Lý do (AI):                                          │
│ ROAS 3.5 (MA7=3.2, UPTREND). Campaign stable 5 ngày.   │
│ Theo SOP: ROAS > 3.0 + stable ≥ 3d → eligible scale.   │
│ FalkorDB history: Scale 20% cùng camp tuần trước →      │
│ ROAS tăng 3.0→3.5. Confident scale thêm 25%.           │
│                                                         │
│ 📈 Data Evidence:                                       │
│ Revenue MA3: $450 ↑ | MA7: $380                         │
│ CPM: $12.5 (stable) | CPA: $8.2 (↓ from $9.1)         │
│                                                         │
│ ⚠️ Risk Level: 🔴🔴⚪⚪⚪ (2/5 — Low-Medium)             │
│                                                         │
│ ┌────────────┐ ┌────────────┐ ┌──────────────┐         │
│ │ ✅ Duyệt   │ │ ❌ Bỏ Qua  │ │ ↩️ Rollback  │         │
│ └────────────┘ └────────────┘ └──────────────┘         │
│                                                         │
│ Decision ID: dec_20260301_001 │ ⏰ Hết hạn sau 4 giờ    │
└─────────────────────────────────────────────────────────┘
```

### 2.4 Message Format — Telegram

Telegram dùng **Inline Keyboard Buttons** (native trong Bot API):

```
🤖 *AI Marketing Director — Yêu Cầu Duyệt*

🎯 *Hành động:* SCALE BUDGET (+25%)
📊 *Chiến dịch:* 04.02-D04-Romania-CĐ-LC
💰 *Thay đổi:* $80→$100/ngày (+$20)

📝 *Lý do:* ROAS 3.5 (MA7=3.2, ↑). Stable 5d. SOP: scale eligible.
📈 *Evidence:* Revenue MA3 $450↑, CPA $8.2↓

⚠️ Risk: 2/5

[✅ Duyệt Lệnh] [❌ Bỏ Qua] [↩️ Rollback]

⏰ Hết hạn: 12:00 PM
```

Telegram API call:

```python
# Telegram Inline Keyboard
reply_markup = {
    "inline_keyboard": [[
        {"text": "✅ Duyệt Lệnh", "callback_data": f"approve_{decision_id}"},
        {"text": "❌ Bỏ Qua",     "callback_data": f"reject_{decision_id}"},
        {"text": "↩️ Rollback",   "callback_data": f"rollback_{decision_id}"},
    ]]
}
```

### 2.5 Hành Vi Khi Bấm Nút

#### ✅ Duyệt Lệnh

| Bước | Hành vi |
|:--|:--|
| 1 | Bot nhận callback `approve_{decision_id}` |
| 2 | Load decision từ pending queue (SimpleMem) |
| 3 | Gọi Meta Marketing API thực thi (VD: update budget) |
| 4 | Ghi log vào BQ `approval_logs` (status=`APPROVED`, approved_by={username}) |
| 5 | Ghi decision vào FalkorDB graph: `Decision` node + `DECIDED_ON` edge |
| 6 | Gửi confirm message: "✅ Lệnh đã được {user} duyệt. Budget updated $80→$100." |
| 7 | Schedule auto-review sau 24h: SimpleMem save `review_at` |
| 8 | Sau 24h: Agent tự check kết quả, so sánh ROAS trước/sau → ghi Lesson |

#### ❌ Bỏ Qua

| Bước | Hành vi |
|:--|:--|
| 1 | Bot nhận callback `reject_{decision_id}` |
| 2 | Ghi log vào BQ `approval_logs` (status=`REJECTED`, approved_by={username}) |
| 3 | Ghi vào FalkorDB: `Decision` node (status=REJECTED) |
| 4 | Gửi confirm: "❌ Lệnh đã bị {user} từ chối." |
| 5 | Agent LƯU LẠI việc bị reject + reason → SimpleMem |
| 6 | Sau 24h: Agent vẫn tự check kết quả. Nếu reject đúng → ghi lesson "User rejected, outcome proved right". Nếu reject sai → ghi lesson "User rejected but AI was correct" |

#### ↩️ Rollback

| Bước | Hành vi |
|:--|:--|
| 1 | Bot nhận callback `rollback_{decision_id}` |
| 2 | Load `rollback_state` từ SimpleMem (snapshot trước khi thay đổi) |
| 3 | Gọi Meta API khôi phục: VD budget $100 → rollback $80 |
| 4 | Ghi log BQ `approval_logs` (status=`ROLLED_BACK`) |
| 5 | Ghi FalkorDB: `ROLLED_BACK` edge giữa Decision mới và cũ |
| 6 | Gửi confirm: "↩️ Đã rollback về trạng thái cũ bởi {user}." |

> **Lưu ý**: Rollback chỉ available cho lệnh đã được Duyệt trước đó. Nếu chưa duyệt thì nút Rollback sẽ reply "Không có gì để rollback."

### 2.6 Timeout & Expiration

| Cấu hình | Giá trị | Mô tả |
|:--|:--|:--|
| **Default timeout** | 4 giờ | Sau 4h không ai bấm → status = `EXPIRED` |
| **Extended timeout** | 12 giờ | Cho lệnh Kill campaign (quan trọng hơn) |
| **Rollback window** | 24 giờ | Sau khi Duyệt, nút Rollback active trong 24h |
| **Auto-review** | 24 giờ | Agent tự check kết quả sau 24h |

Khi hết hạn:
- Bot edit message gốc → thêm "⏰ EXPIRED — Không ai phản hồi trong 4h"
- Log vào BQ: status = `EXPIRED`
- Agent ghi nhận timeout vào SimpleMem

### 2.7 Dual-Channel Strategy

| Kênh | Ưu tiên | Use case |
|:--|:--|:--|
| **Telegram** | PRIMARY | Owner check nhanh trên điện thoại, duyệt mọi lúc mọi nơi |
| **Discord** | SECONDARY | Dev team theo dõi chi tiết, debug, xem log |

- Mỗi approval request gửi **CẢ HAI** kênh đồng thời
- Ai bấm trước thì thắng (first-come-first-served)
- Sau khi 1 kênh xử lý → kênh còn lại update message "Đã được xử lý bởi {user} trên {channel}"

### 2.8 Rollback State Snapshot

Trước khi thực thi bất kỳ lệnh nào, Director snapshot trạng thái hiện tại:

```json
{
  "decision_id": "dec_20260301_001",
  "entity_type": "adset",
  "entity_id": "act_817501334775697_adset_12345",
  "snapshot": {
    "status": "ACTIVE",
    "daily_budget": 8000,
    "bid_strategy": "LOWEST_COST_WITHOUT_CAP"
  },
  "snapshot_at": "2026-03-01T08:15:00Z",
  "expires_at": "2026-03-02T08:15:00Z"
}
```

Lưu vào SimpleMem với key `rollback:{decision_id}`. TTL = 24 giờ.

---

## 3. Agent Control Center UI (Next.js)

### 3.1 Tổng Quan Layout

```
Dashboard (:3000)
├── / (existing tabs: CEO, Ads, P&L, etc.)
├── /agent-control                    ← NEW: Landing page
│   ├── /agent-control/analyst        ← Analyst agent management
│   │   ├── Tab: Live Feed
│   │   ├── Tab: Memory Manager
│   │   ├── Tab: Audit Log
│   │   └── Tab: Personality
│   └── /agent-control/director       ← Director agent management
│       ├── Tab: Live Feed
│       ├── Tab: Memory Manager
│       ├── Tab: Audit Log
│       └── Tab: Personality
└── /ai-intelligence                  ← NEW: AI accuracy charts
```

### 3.2 Landing Page (`/agent-control`)

```
┌──────────────────────────────────────────────────────────────────┐
│  🤖 FAOS Agent Control Center                                    │
│──────────────────────────────────────────────────────────────────│
│                                                                  │
│  ┌─────────────────────────┐  ┌─────────────────────────┐       │
│  │  📊 Executive Analyst    │  │  📣 Marketing Director   │       │
│  │                         │  │                         │       │
│  │  Status: 🟢 Running     │  │  Status: 🟢 Running     │       │
│  │  Last run: 08:00 today  │  │  Last run: 08:15 today  │       │
│  │  Accuracy: 78%          │  │  Win-rate: 72%          │       │
│  │  Decisions: 3 today     │  │  Pending: 1 approval    │       │
│  │                         │  │                         │       │
│  │  [🔍 Open Control Panel]│  │  [🔍 Open Control Panel]│       │
│  └─────────────────────────┘  └─────────────────────────┘       │
│                                                                  │
│  📋 Recent Activity                                              │
│  [08:15] Director: ✅ Scale Camp_D04 +20% (auto-approved)        │
│  [08:05] Analyst:  📊 Daily analysis complete (3 projects)       │
│  [08:00] System:   🟢 FalkorDB healthy, 247 nodes               │
└──────────────────────────────────────────────────────────────────┘
```

### 3.3 Tab 1: 📡 Live Feed

**Mục đích**: Hiển thị realtime quá trình suy nghĩ và thực thi của AI agent.

#### Wireframe

```
┌──────────────────────────────────────────────────────────────────┐
│  📡 Live Feed — Executive Analyst                    [▶ Running] │
│──────────────────────────────────────────────────────────────────│
│                                                                  │
│  ┌─ Filter: [All Steps ▾] [Today ▾] ──── [🔄 Auto-scroll: ON] ─┐│
│  │                                                               ││
│  │ [08:00:01] 🟢 ── STEP 1: Fetching SOPs from FalkorDB...      ││
│  │ [08:00:03] 🟢 ── ✅ 12 SOPs loaded (ROAS_v2, Budget_v1...)   ││
│  │ [08:00:03] 🟢 ── STEP 2: Recalling yesterday from SimpleMem  ││
│  │ [08:00:05] 🟢 ── ✅ 5 decisions, 8 predictions recalled       ││
│  │ [08:00:05] 🟡 ── STEP 3: Querying BigQuery (3 projects)...   ││
│  │ [08:00:12] 🟢 ── ✅ STRAMARK: 45 orders, ROAS 2.8             ││
│  │ [08:00:13] 🟢 ── ✅ AUUS1: 120 orders, ROAS 3.1               ││
│  │ [08:00:14] 🟡 ── STEP 4: LLM Analysis (GPT-4o)...            ││
│  │ [08:00:22] 🟢 ── ✅ Analysis complete. 3 actions proposed.     ││
│  │ [08:00:22] 🟢 ── STEP 5: Reflecting on yesterday...          ││
│  │ [08:00:25] 🟢 ── ✅ Accuracy: 6/8 (75%). 2 lessons learned.   ││
│  │ [08:00:25] 🟡 ── STEP 6: Saving to FalkorDB + SimpleMem...   ││
│  │ [08:00:27] 🟢 ── ✅ 2 Lesson nodes created, 3 edges added.    ││
│  │ [08:00:27] 🟢 ── STEP 7: Sending report to Discord...        ││
│  │ [08:00:28] 🟢 ── ✅ COMPLETE. Total time: 27s.                 ││
│  │                                                               ││
│  └───────────────────────────────────────────────────────────────┘│
│                                                                  │
│  📊 Run Summary: 7 steps | 27s | 0 errors | Accuracy: 75%       │
└──────────────────────────────────────────────────────────────────┘
```

#### Kỹ Thuật

| Thành phần | Chi tiết |
|:--|:--|
| **Protocol** | Server-Sent Events (SSE) |
| **Backend endpoint** | `GET /api/agent/{agent_name}/feed` |
| **Event format** | `data: {"step": "STEP_1", "status": "in_progress", "message": "Fetching SOPs...", "timestamp": "08:00:01"}` |
| **Frontend** | `EventSource` API, auto-scroll, color-coded by status |
| **Buffer** | Keep last 200 events in memory, paginate older from BQ |
| **Reconnect** | Auto-reconnect on disconnect (SSE native) |

#### SSE Event Schema

```typescript
interface AgentEvent {
  agent: 'analyst' | 'director';
  step: string;        // 'STEP_1_FETCH_SOP', 'STEP_4_LLM_ANALYZE', etc.
  status: 'start' | 'success' | 'error' | 'warning';
  message: string;     // Human-readable description
  data?: object;       // Optional structured data (metrics, counts)
  timestamp: string;   // ISO 8601
  run_id: string;      // Groups events from same run
}
```

### 3.4 Tab 2: 🧠 Memory Manager (Quản Lý Não)

**Mục đích**: Cho phép con người đọc, sửa, xóa SOPs và bài học trong FalkorDB. Can thiệp xóa kinh nghiệm sai lệch.

#### Wireframe

```
┌──────────────────────────────────────────────────────────────────┐
│  🧠 Memory Manager — Executive Analyst                          │
│──────────────────────────────────────────────────────────────────│
│                                                                  │
│  🔍 Search: [______________________________] [🔎]               │
│  Filter: [All Types ▾] [Last 30 days ▾]                         │
│                                                 [+ Add New SOP]  │
│  ┌──────────────────────────────────────────────────────────────┐│
│  │ 📋 SOPs (12 items)                                    [▾]    ││
│  │  ┌────────────────────────────────────────────────────────┐  ││
│  │  │ 📌 ROAS Thresholds v2              Updated: 2026-03-01│  ││
│  │  │   Danger < 1.3 | Warning < 2.0 | Excellent ≥ 3.0     │  ││
│  │  │   Applies to: All markets                              │  ││
│  │  │                          [✏️ Edit] [🗑️ Delete]         │  ││
│  │  └────────────────────────────────────────────────────────┘  ││
│  │  ┌────────────────────────────────────────────────────────┐  ││
│  │  │ 📌 Budget Safety Rules v1          Updated: 2026-02-28│  ││
│  │  │   Max change: 50%/day | Scale req: 3d stable           │  ││
│  │  │   Applies to: STRAMARK, AUUS1                          │  ││
│  │  │                          [✏️ Edit] [🗑️ Delete]         │  ││
│  │  └────────────────────────────────────────────────────────┘  ││
│  │                                                              ││
│  │ 📝 Lessons Learned (47 items)                         [▾]    ││
│  │  ┌────────────────────────────────────────────────────────┐  ││
│  │  │ 💡 "Scale >20% → CPM tăng ~40%"    Learned: 2026-02-25│  ││
│  │  │   Evidence: Camp_D04 scaled 25% on Feb 24,             │  ││
│  │  │   CPM went from $11→$15.4 within 24h.                 │  ││
│  │  │   Confidence: HIGH (validated 3x)                      │  ││
│  │  │                          [✏️ Edit] [🗑️ Delete]         │  ││
│  │  └────────────────────────────────────────────────────────┘  ││
│  │  ┌────────────────────────────────────────────────────────┐  ││
│  │  │ ⚠️ "Romania CPM thấp nhất vào sáng" Learned: 2026-02-20│ ││
│  │  │   Evidence: Chưa validate. Chỉ dựa trên 2 ngày data.  │  ││
│  │  │   Confidence: LOW (unvalidated)                        │  ││
│  │  │                          [✏️ Edit] [🗑️ Delete]         │  ││
│  │  └────────────────────────────────────────────────────────┘  ││
│  │                                                              ││
│  │ 🎯 Recent Decisions (124 items)                       [▾]    ││
│  │  (Read-only — decisions cannot be edited, only viewed)       ││
│  └──────────────────────────────────────────────────────────────┘│
│                                                                  │
│  📊 Stats: 12 SOPs | 47 Lessons | 124 Decisions | 89 Predictions│
└──────────────────────────────────────────────────────────────────┘
```

#### CRUD Operations

| Action | UI Trigger | Behavior |
|:--|:--|:--|
| **View** | Click card | Expand full details + related graph edges |
| **Add SOP** | [+ Add New SOP] button | Modal form: name, rules, applies_to, version |
| **Edit** | [✏️ Edit] button | Inline edit mode, save/cancel |
| **Delete** | [🗑️ Delete] button | Confirm dialog: "Xóa lesson này sẽ ảnh hưởng đến quyết định AI. Bạn chắc chắn?" |
| **Search** | Search bar | Full-text search across all node types |

#### Delete Confirmation Dialog

```
┌─────────────────────────────────────────────┐
│  ⚠️ Xác Nhận Xóa Bài Học                    │
│─────────────────────────────────────────────│
│                                             │
│  Bạn sắp xóa:                              │
│  "Romania CPM thấp nhất vào sáng"           │
│                                             │
│  ⚠️ WARNING: AI sẽ không còn nhớ insight    │
│  này khi ra quyết định. Nếu insight đúng,   │
│  AI có thể mắc lại lỗi cũ.                 │
│                                             │
│  📝 Lý do xóa (bắt buộc):                  │
│  [Data chỉ 2 ngày, chưa đủ validate____]   │
│                                             │
│     [❌ Hủy]        [🗑️ Xác Nhận Xóa]      │
└─────────────────────────────────────────────┘
```

- Xóa = **soft delete** (đánh flag `deleted_at`, `deleted_by`, `delete_reason`)
- Giữ audit trail — xóa không mất hoàn toàn, có thể restore

### 3.5 Tab 3: 📊 Audit Log (Win-Rate)

**Mục đích**: So sánh hiệu quả thực tế giữa đề xuất AI vs quyết định User vs kết quả 24h sau.

#### Wireframe

```
┌──────────────────────────────────────────────────────────────────┐
│  📊 Audit Log — AI vs Human Performance        Win-Rate: 72%    │
│──────────────────────────────────────────────────────────────────│
│                                                                  │
│  Filter: [Last 30 days ▾] [All Agents ▾] [All Actions ▾]       │
│                                                                  │
│  ┌── Win-Rate Over Time ──────────────────────────────────────┐ │
│  │  80%┤                    ╱╲                                │ │
│  │  70%┤      ╱╲     ╱╲   ╱  ╲  ╱╲                          │ │
│  │  60%┤╲  ╱╲╱  ╲  ╱  ╲╱    ╲╱  ╲                           │ │
│  │  50%┤ ╲╱                                                   │ │
│  │     └──────────────────────────────────────────────────────│ │
│  │       Feb 01    Feb 08    Feb 15    Feb 22    Mar 01       │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌── Comparison Table ────────────────────────────────────────┐ │
│  │ Date  │ AI Proposed         │ User     │ Outcome 24h │ Win?│ │
│  │───────┼─────────────────────┼──────────┼─────────────┼─────│ │
│  │ 03-01 │ Scale D04 +20%     │ ✅ Duyệt │ ROAS 3.2→3.5│ ✅  │ │
│  │ 02-28 │ Kill L20 camp      │ ❌ Reject │ ROAS 0.8→0.5│ ✅* │ │
│  │ 02-27 │ Scale NA4 +30%     │ ✅ Duyệt │ ROAS 2.8→1.9│ ❌  │ │
│  │ 02-26 │ Pause AdSet_RO_M   │ ✅ Duyệt │ Saved $45   │ ✅  │ │
│  │ 02-25 │ Scale D04 +15%     │ ✅ Auto  │ ROAS 3.0→3.2│ ✅  │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  * = AI was right but user rejected (missed opportunity)         │
│                                                                  │
│  📊 Summary:                                                     │
│  Approved: 45 | Rejected: 12 | Rolled Back: 3 | Expired: 5     │
│  AI Win (when approved): 33/45 = 73%                            │
│  AI Correct (when rejected): 8/12 = 67% (user should listen!)  │
└──────────────────────────────────────────────────────────────────┘
```

#### Win-Rate Calculation

```
AI Win-Rate = (Approved & Successful + Rejected & AI was right) / Total Decisions × 100

Where:
- "Successful" = actual outcome improved or maintained after 24h
- "AI was right" = rejected but actual worsened (AI's recommendation would have helped)
```

#### Data Source

- `approval_logs` table — decisions + approval status
- `ai_prediction_log` table — predictions vs actuals
- Join on `decision_id` + 24h window comparison

### 3.6 Tab 4: ⚙️ Personality Settings

**Mục đích**: Cho Owner điều chỉnh hành vi AI mà không cần sửa code.

#### Wireframe

```
┌──────────────────────────────────────────────────────────────────┐
│  ⚙️ Personality Settings — AI Marketing Director                 │
│──────────────────────────────────────────────────────────────────│
│                                                                  │
│  🎚️ Risk Tolerance                                               │
│  Ultra-Safe ├───────────●───────────┤ Aggressive                │
│  0.0              0.6 (current)              1.0                │
│  ℹ️ Higher = AI tự quyết nhiều hơn, ít hỏi hơn                  │
│                                                                  │
│  ──────────────────────────────────────────────────────          │
│                                                                  │
│  💰 Auto Budget Limit                                            │
│  Dưới ngưỡng này → AI tự thực thi, không cần hỏi                │
│  [$ 50_________] /ngày per campaign                              │
│  ℹ️ VD: AI tăng budget $30 → auto. Tăng $80 → hỏi approval.    │
│                                                                  │
│  ──────────────────────────────────────────────────────          │
│                                                                  │
│  🎯 Target KPIs                                                  │
│  ┌─────────────────┬──────────────────────────────┐             │
│  │ ROAS Target      │ [2.5_____]                   │             │
│  │ Max CPA           │ [$ 15____]                   │             │
│  │ Min Orders/day    │ [10______]                   │             │
│  │ Max Return Rate   │ [25 %____]                   │             │
│  │ ROAS Kill (danger)│ [1.3_____]                   │             │
│  └─────────────────┴──────────────────────────────┘             │
│                                                                  │
│  ──────────────────────────────────────────────────────          │
│                                                                  │
│  ⏰ Schedule                                                     │
│  ┌─────────────────┬──────────────────────────────┐             │
│  │ Analyst Run      │ [08:00] [Asia/Ho_Chi_Minh ▾] │             │
│  │ Director Run     │ [08:15] [Asia/Ho_Chi_Minh ▾] │             │
│  │ Daily Reflection │ [18:00] [Asia/Ho_Chi_Minh ▾] │             │
│  └─────────────────┴──────────────────────────────┘             │
│                                                                  │
│  Agent Status:                                                   │
│  [✅] Executive Analyst enabled                                  │
│  [✅] Marketing Director enabled                                 │
│  [ ] Auto Ad Setup (Phase 2 — coming soon)                      │
│                                                                  │
│           [💾 Save Settings]    [↩️ Reset to Defaults]           │
│                                                                  │
│  ℹ️ Settings saved to FalkorDB PersonalityConfig node.           │
│  Changes take effect on next agent run.                          │
└──────────────────────────────────────────────────────────────────┘
```

#### Personality Fields → FalkorDB Mapping

| UI Field | FalkorDB Property | Type | Default |
|:--|:--|:--|:--|
| Risk Tolerance | `PersonalityConfig.risk_level` | FLOAT 0.0-1.0 | 0.5 |
| Auto Budget Limit | `PersonalityConfig.auto_budget_limit` | INT (cents) | 5000 |
| ROAS Target | `PersonalityConfig.target_roas` | FLOAT | 2.5 |
| Max CPA | `PersonalityConfig.max_cpa` | FLOAT | 15.0 |
| Min Orders/day | `PersonalityConfig.min_daily_orders` | INT | 10 |
| Max Return Rate | `PersonalityConfig.max_return_rate` | FLOAT (%) | 25.0 |
| ROAS Kill | `PersonalityConfig.roas_danger` | FLOAT | 1.3 |
| Analyst Schedule | `PersonalityConfig.analyst_cron` | STRING | `0 8 * * *` |
| Director Schedule | `PersonalityConfig.director_cron` | STRING | `15 8 * * *` |

---

## 4. AI Intelligence Dashboard Tab

### 4.1 Route: `/ai-intelligence`

Tab riêng trong main dashboard (bên cạnh CEO, Ads, P&L...).

#### Wireframe

```
┌──────────────────────────────────────────────────────────────────┐
│  🧠 AI Intelligence                                              │
│──────────────────────────────────────────────────────────────────│
│                                                                  │
│  ┌── Prediction Accuracy (30 days) ───────────────────────────┐ │
│  │  90%┤                                                      │ │
│  │  80%┤              ╱╲     ╱╲ ╱╲                            │ │
│  │  70%┤    ╱╲  ╱╲  ╱  ╲   ╱  ╲╱  ╲╱╲                       │ │
│  │  60%┤╲╱╱  ╲╱  ╲╱    ╲╱╱        ╲                          │ │
│  │  50%┤                                                      │ │
│  │     └──────────────────────────────────────────────────────│ │
│  │       Feb 01    Feb 08    Feb 15    Feb 22    Mar 01       │ │
│  │       ── Analyst    ── Director                            │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌── Accuracy by Metric ──────┐  ┌── Decision Outcomes ────────┐│
│  │ ROAS:    ██████████ 82%    │  │  ✅ Approved    45 (69%)    ││
│  │ Orders:  ████████░░ 71%    │  │  ❌ Rejected    12 (18%)    ││
│  │ Revenue: █████████░ 76%    │  │  ↩️ Rolled Back  3  (5%)    ││
│  │ CPA:     ██████░░░░ 65%    │  │  ⏰ Expired      5  (8%)    ││
│  │ CPM:     █████░░░░░ 58%    │  │  ⚡ Auto-Exec   20          ││
│  └────────────────────────────┘  └─────────────────────────────┘│
│                                                                  │
│  📈 Trend: Accuracy improving +3.2%/week (last 4 weeks)         │
└──────────────────────────────────────────────────────────────────┘
```

#### Data Source

- `ai_prediction_log` — accuracy per metric per date
- `approval_logs` — decision outcome counts
- Query: `SELECT prediction_date, metric, AVG(accuracy_pct) ... GROUP BY 1, 2`

---

## Appendix: Technical Notes

### A. Discord Bot vs Webhook

| | Webhook | Bot |
|:--|:--|:--|
| Gửi message | ✅ | ✅ |
| Interactive Buttons | ❌ | ✅ |
| Receive callbacks | ❌ | ✅ |

→ FAOS v6 cần **Discord Bot Application** (không chỉ webhook).  
Setup: Discord Developer Portal → New Application → Bot → Invite → Interactions Endpoint URL = `https://{server}/discord/interactions`

### B. Telegram Bot Setup

| Step | Action |
|:--|:--|
| 1 | @BotFather → `/newbot` → get Bot Token |
| 2 | Set webhook: `POST https://api.telegram.org/bot{token}/setWebhook?url=https://{server}/telegram/callback` |
| 3 | Inline Keyboard buttons natively supported |
| 4 | Callback queries arrive at webhook URL |

### C. SSE vs WebSocket

| | SSE | WebSocket |
|:--|:--|:--|
| Direction | Server → Client only | Bi-directional |
| Reconnect | Auto (native) | Manual |
| Complexity | Low | Higher |
| Use case | Live Feed (read-only) | Chat, interactive |

→ SSE đủ cho Live Feed (server push log → client display). Không cần WebSocket.
