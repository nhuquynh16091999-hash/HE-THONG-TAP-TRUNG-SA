# 🚀 MASTER PLAN — Chuẩn hóa Dữ liệu & Mở rộng Thị trường

> **Ngày tạo**: 2026-02-23
> **Phạm vi**: Data Standardization → Auto Ads → Hàn/Đài/Nhật → TikTok/Google Ads
> **Mục tiêu**: Tự động hóa 80% vận hành, mở rộng sang 3 thị trường mới, 2 kênh ads mới

---

## 📋 TL;DR — Tổng quan 4 Phase

| Phase | Tên | Timeline | Mục tiêu chính |
|:---:|:---|:---|:---|
| **1** | Chuẩn hóa Dữ liệu | Tuần 1–3 | Unified data model, real-time reporting |
| **2** | Auto Ads Care | Tuần 4–7 | Tự động quản lý FB + TikTok + Google Ads |
| **3** | Mở rộng Hàn/Đài/Nhật | Tuần 8–12 | Onboard 3 thị trường mới (KR/TW/JP) |
| **4** | Kênh bán hàng mới | Tuần 10–14 | TikTok Shop + Google Shopping Ads |

---

## 🏗️ KIẾN TRÚC TỔNG THỂ (Target State)

```
┌─────────────────────────────────────────────────────────────────┐
│                     DATA SOURCES (Ingestion)                     │
├──────────┬──────────┬──────────┬──────────┬──────────────────────┤
│ Poscake  │ Meta Ads │ TikTok   │ Google   │ 3PL APIs            │
│ POS API  │ Graph API│ Ads API  │ Ads API  │ (iMile/Aramex/etc)  │
└────┬─────┴────┬─────┴────┬─────┴────┬─────┴──────────┬──────────┘
     │          │          │          │                │
     ▼          ▼          ▼          ▼                ▼
┌─────────────────────────────────────────────────────────────────┐
│              ORCHESTRATION LAYER (n8n + Python)                   │
│  ┌─────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────────┐ │
│  │POS Sync │  │ Ads Sync │  │ 3PL Sync │  │ Exchange Rate    │ │
│  │(15 min) │  │ (2 hrs)  │  │ (daily)  │  │ Sync (daily)     │ │
│  └─────────┘  └──────────┘  └──────────┘  └──────────────────┘ │
└────────────────────────┬────────────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│              DATA WAREHOUSE (BigQuery)                            │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────────┐ │
│  │ Raw Layer    │  │ Staging      │  │ Mart Layer             │ │
│  │ (per-project)│  │ (dedup/clean)│  │ (perf, P&L, product)   │ │
│  └──────────────┘  └──────────────┘  └────────────────────────┘ │
│  ┌──────────────────────────────────────────────────────────────┐│
│  │ Unified Dims: dim_market, dim_currency, dim_channel,        ││
│  │ dim_platform, dim_product_master                            ││
│  └──────────────────────────────────────────────────────────────┘│
└────────────────────────┬────────────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│              AI AGENTS (Python + Pydantic)                        │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────────────────┐ │
│  │Profit    │ │Ads Auto  │ │Market    │ │Channel             │ │
│  │Guardian  │ │Optimizer │ │Expander  │ │Manager             │ │
│  └──────────┘ └──────────┘ └──────────┘ └────────────────────┘ │
└────────────────────────┬────────────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│              OUTPUT LAYER                                        │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────────────────┐ │
│  │Dashboard │ │Discord   │ │Auto Ads  │ │Reports             │ │
│  │(Next.js) │ │Alerts    │ │Actions   │ │(PDF/Sheet)         │ │
│  └──────────┘ └──────────┘ └──────────┘ └────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

---

## 📑 TÀI LIỆU CHI TIẾT

| # | Tài liệu | File | Nội dung |
|:---:|:---|:---|:---|
| 1 | Phase 1 — Chuẩn hóa Dữ liệu | [PHASE1_DATA_STANDARDIZATION.md](file:///c:/Users/LE%20MO/Desktop/AGENT/docs/PHASE1_DATA_STANDARDIZATION.md) | Unified schema, ETL pipeline, reporting |
| 2 | Phase 2 — Auto Ads Care | [PHASE2_AUTO_ADS_CARE.md](file:///c:/Users/LE%20MO/Desktop/AGENT/docs/PHASE2_AUTO_ADS_CARE.md) | FB + TikTok + Google auto management |
| 3 | Phase 3 — Mở rộng KR/TW/JP | [PHASE3_MARKET_EXPANSION.md](file:///c:/Users/LE%20MO/Desktop/AGENT/docs/PHASE3_MARKET_EXPANSION.md) | Localization, logistics, compliance |
| 4 | Phase 4 — Kênh bán hàng mới | [PHASE4_NEW_CHANNELS.md](file:///c:/Users/LE%20MO/Desktop/AGENT/docs/PHASE4_NEW_CHANNELS.md) | TikTok Shop, Google Shopping |
| 5 | Tech Stack & Tools | [TECH_STACK_SPEC.md](file:///c:/Users/LE%20MO/Desktop/AGENT/docs/TECH_STACK_SPEC.md) | Công nghệ, API, thư viện |

---

## 💰 BUDGET ƯỚC TÍNH

| Hạng mục | Chi phí/tháng | Ghi chú |
|:---|---:|:---|
| BigQuery | $50–200 | Tùy query volume |
| n8n Cloud (hoặc self-host) | $0–50 | Self-host miễn phí |
| TikTok Ads API | Free | Chỉ tốn ads spend |
| Google Ads API | Free | Chỉ tốn ads spend |
| Meta Ads API | Free | Chỉ tốn ads spend |
| Gemini API (AI agents) | $20–50 | 1M tokens/day |
| Vercel (Dashboard) | $0–20 | Free tier đủ |
| **Tổng infra** | **$70–370** | Chưa tính ads spend |
