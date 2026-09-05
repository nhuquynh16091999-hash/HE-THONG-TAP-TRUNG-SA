# Architecture Decisions: AUUS (FAOS v6)

## ADR Log
| # | Decision | Context | Status | Date |
|---|----------|---------|--------|------|
| 1 | V5.1 Cognitive Consultant scaffold | Chong context gap cho AI assistant | Adopted | 2026-03-04 |
| 2 | Gemini primary + GPT-4o fallback | Gemini re hon (~10x), GPT lam safety net | Adopted | 2026-03 |
| 3 | FalkorDB cho knowledge graph | Redis protocol, temporal graph, open-source | Adopted | 2026-03 |
| 4 | BigQuery cho analytics | Du an da dung, scale tot, cheap storage | Adopted | 2026-03 |
| 5 | Pydantic BaseSettings | Type-safe config, .env auto-load | Adopted | 2026-03 |
| 6 | 3-level State Machine | DAILY > CAMPAIGN > AD_SET — granular control | Adopted | 2026-03 |
| 7 | SSE cho Live Feed | Real-time streaming, simple, no WebSocket overhead | Adopted | 2026-03 |
| 8 | Telegram approval | Mobile-friendly, inline keyboards, instant | Adopted | 2026-03 |
| 9 | Multi-project config | config/projects/*.yaml — support stramark, auus1, zen8 | Adopted | 2026-03 |
| 10 | Docker cho infra only | FalkorDB + Graphiti + SimpleMem in Docker, app runs native | Adopted | 2026-03 |
