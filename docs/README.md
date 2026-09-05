# 📚 FAOS Documentation — Index

> **Last Updated**: 2026-02-24
> **Structure**: 17 numbered docs + extras + archive

---

## Dev Reading Order (Cho project mới)

> [!IMPORTANT]
> **Chỉ cần đọc 3 file để bắt đầu:**
> 1. `06_PROJECT_CLONE_GUIDE.md` — **Làm gì, theo thứ tự nào** (DDL, N8N, validation)
> 2. `02_DATABASE_MASTER_SPEC.md` — **Database hoạt động thế nào** (schema, status, currency)
> 3. `10_BUG_POSTMORTEM.md` — **Tránh bẫy gì** (8 bugs đã gặp + phòng ngừa)

---

## 📖 Document Map

### Core (phải đọc)

| # | File | Nội dung | Audience |
|---|------|----------|----------|
| 00 | [SYSTEM_OVERVIEW](00_SYSTEM_OVERVIEW.md) | Kiến trúc FAOS, tech stack, data flow, projects | Tất cả |
| 02 | [DATABASE_MASTER_SPEC](02_DATABASE_MASTER_SPEC.md) | **Source of truth** — Schema, status mapping, currency, attribution | Dev, DBA |
| 03 | [DATA_DICTIONARY](03_DATA_DICTIONARY.md) | Zen8_Dataset tables + columns + sample queries | Dev, Analyst |
| 04 | [NAMING_CONVENTION](04_NAMING_CONVENTION.md) | Campaign naming rules cho FB Ads | Marketer, Dev |
| 05 | [N8N_WORKFLOWS](05_N8N_WORKFLOWS.md) | N8N workflow specs, credentials, schedules | DevOps, Dev |
| 06 | [PROJECT_CLONE_GUIDE](06_PROJECT_CLONE_GUIDE.md) | **Step-by-step**: clone DB, N8N, dashboard, validation | Dev |
| 07 | [OPERATIONS_RUNBOOK](07_OPERATIONS_RUNBOOK.md) | Daily/weekly/monthly operational procedures | Ops, Manager |
| 08 | [AGENT_SPECS](08_AGENT_SPECS.md) | 12+ AI Agent specs (C-Suite, Specialist, CrewAI) | Dev |
| 09 | [UTM_TRACKING_GUIDE](09_UTM_TRACKING_GUIDE.md) | UTM setup cho Facebook Ads (Stramark-specific) | Marketer |
| 10 | [BUG_POSTMORTEM](10_BUG_POSTMORTEM.md) | 8 bugs từ restructuring + root cause + prevention rules | Tất cả |

### Extended

| # | File | Nội dung | Audience |
|---|------|----------|----------|
| 11 | [REVENUE_DEFINITIONS](11_REVENUE_DEFINITIONS.md) | Định nghĩa doanh thu, dashboard tab mapping, status→revenue | Dev, Analyst |
| 12 | [NEW_PROJECT_SETUP_FORM](12_NEW_PROJECT_SETUP_FORM.md) | Form nhập thông tin cho dự án mới | PM, Dev |
| 13 | [SYSTEM_AUDIT](13_SYSTEM_AUDIT.md) | **Full-stack audit** — BQ, N8N, agents, dashboard, tools (v2.0) | Tất cả |
| 14 | [PROJECT_KICKOFF_VERIFICATION](14_PROJECT_KICKOFF_VERIFICATION.md) | Checklist kiểm tra khi bắt đầu project | Dev, PM |
| 15a | [TALPHA_PRE_GOLIVE_GUIDE](15_TALPHA_PRE_GOLIVE_GUIDE.md) | TALPHA go-live guide | Dev |
| 15b | [AUUS1_PRE_GOLIVE_GUIDE](15_AUUS1_PRE_GOLIVE_GUIDE.md) | AUUS1 go-live guide | Dev |
| 16 | [CLONE_GOLIVE_GUIDE](16_CLONE_GOLIVE_GUIDE.md) | Clone + go-live combo guide | Dev |
| 17 | [3PL_AUTOMATION_REFERENCE](17_3PL_AUTOMATION_REFERENCE.md) | 3PL automation: Meta→POS→euShipments (STRAMARK) | Dev |

### Operational Guides

| File | Nội dung | Audience |
|------|----------|----------|
| [MARKETER_SOP_STRAMARK](MARKETER_SOP_STRAMARK.md) | SOP cho marketer STRAMARK | Marketer |
| [STRAMARK_FULFILLMENT_ANALYSIS](STRAMARK_FULFILLMENT_ANALYSIS.md) | Phân tích chi phí fulfillment STRAMARK | Finance, PM |
| [TALPHA_SETUP_CHECKLIST](TALPHA_SETUP_CHECKLIST.md) | Checklist setup TALPHA | Dev |
| [etl_best_practices](etl_best_practices.md) | ETL guidelines + patterns | Dev |

### Project Expansion

| File | Nội dung | Audience |
|------|----------|----------|
| [PROJECT_EXPANSION_MASTER_PLAN](PROJECT_EXPANSION_MASTER_PLAN.md) | Master plan mở rộng hệ thống | PM, CEO |
| [PHASE1_DATA_STANDARDIZATION](PHASE1_DATA_STANDARDIZATION.md) | Phase 1: Chuẩn hóa dữ liệu | Dev |
| [PHASE2_AUTO_ADS_CARE](PHASE2_AUTO_ADS_CARE.md) | Phase 2: Tự động quản lý ads | Dev |
| [PHASE3_MARKET_EXPANSION](PHASE3_MARKET_EXPANSION.md) | Phase 3: Mở rộng thị trường (KR, TW, JP) | PM |
| [PHASE4_NEW_CHANNELS](PHASE4_NEW_CHANNELS.md) | Phase 4: Kênh mới (TikTok, Google Shopping) | PM |
| [TECH_STACK_SPEC](TECH_STACK_SPEC.md) | Đặc tả technology stack | Dev, CTO |

---

## 📁 Assets (không phải docs)

| File | Loại | Mô tả |
|------|------|-------|
| `DASHBOARD_MOCKUP.md` | Design | Mockup design cho Operation Center |
| `dashboard_mockup.html` | HTML | Interactive mockup |
| `api-1.yaml` | OpenAPI | API specification |
| `lv.drawio` | Diagram | Entity Relationship Diagram |
| `tl.docx` | Reference | Tài liệu dev gốc (Zen8 system) |
| `AUDIT_REPORT_APP.md` | Report | App audit report |
| `AUDIT_REPORT_DB_N8N.md` | Report | DB + N8N audit report |
| `AUUS1_FULL_AUDIT.md` | Report | AUUS1 full audit |

## 🗄️ Archive (`_archive/`)

7 files đã superseded — giữ lại để tham khảo lịch sử:

| File | Thay thế bởi |
|------|-------------|
| `07_DATABASE_SPEC.md` | `02_DATABASE_MASTER_SPEC.md` |
| `PROJECT_DATABASE_STANDARD.md` | `02_DATABASE_MASTER_SPEC.md` + `06_PROJECT_CLONE_GUIDE.md` |
| `DASHBOARD_ARCHITECTURE_BLUEPRINT.md` | `02_DATABASE_MASTER_SPEC.md` |
| `DASHBOARD_RESTRUCTURE_BRIEFING.md` | One-time briefing, completed |
| `DASHBOARD_V2_EXECUTIVE_REPORT.md` | Report template, superseded by dashboard |
| `N8N_WORKFLOW_OPTIMIZATION.md` | Merged into `05_N8N_WORKFLOWS.md` |
| `05_PROJECT_ONBOARDING.md` | Replaced by `06_PROJECT_CLONE_GUIDE.md` |
