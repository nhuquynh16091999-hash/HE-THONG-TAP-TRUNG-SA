# Product Requirements: AUUS (FAOS v6)

## 1. Tong quan
AI-powered Facebook Ads Optimization System cho e-commerce COD cross-border.
2 AI Agents tu dong phan tich va quan ly chien dich quang cao.

## 2. User Stories
| ID | Role | Action | Benefit |
|----|------|--------|---------|
| US-01 | Ad Manager | Xem AI phan tich ads real-time | Khong can manual review |
| US-02 | Ad Manager | AI tu dong dieu chinh budget | Khong mat co hoi / waste budget |
| US-03 | Team Lead | Xem audit trail moi quyet dinh | Giam sat va trace AI decisions |
| US-04 | Ad Manager | Approve/reject qua Telegram | Quyet dinh nhanh, moi luc moi noi |
| US-05 | Ad Manager | Xem knowledge graph | Hieu AI "nho" gi ve campaigns |

## 3. Functional Requirements
### 3.1 AI Agent Cycle
- Daily analysis tu BigQuery data
- Campaign-level va AdSet-level decisions
- LLM-powered reasoning (Gemini + GPT fallback)

### 3.2 Dashboard
- Live Feed (SSE streaming)
- Audit History
- Memory Viewer (FalkorDB)
- Settings page

### 3.3 Approval Flow
- Telegram inline keyboard cho high-risk decisions
- Auto-execute cho low-risk decisions

## 4. Non-Functional Requirements
- Performance: API response < 500ms, SSE latency < 2s
- Security: API keys secured, .env not committed
- Availability: Cron-based (khong can 24/7 uptime)
