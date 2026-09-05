# Context: FAOS v6 — Agentic AI System

## Project Brief

### Muc tieu du an
AI-powered Facebook Ads Optimization System (FAOS) — Two autonomous agents analyzing and managing cross-border e-commerce ad campaigns (COD model).

### Pham vi (Scope)
- Core features:
  - Executive Analyst (Pillar 2): Phan tich du lieu quang cao, phat hien bat thuong, bao cao hang ngay
  - Marketing Director (Pillar 3): Tu van chien luoc marketing, dieu chinh ngan sach, toi uu ROAS
  - Dashboard real-time (Next.js 15): Live Feed, Audit Trail, Memory Graph, Settings
  - BigQuery data pipeline: Sync Meta Ads → BigQuery → AI Analysis
  - FalkorDB knowledge graph: Luu tru va truy van memory cua AI agents
  - Telegram/Discord alerting: Thong bao real-time cho team leaders
  - State Machine 3-level: Campaign/AdSet/Ad level analysis
  - CAPI (Conversions API) push: Gui du lieu chuyen doi ve Meta

- Nice to have:
  - Multi-project management (Stramark, T1, AUUS1, TAlpha)
  - Automated budget reallocation
  - Trend prediction module

### Doi tuong su dung
- **Project Leaders**: Quan ly quang cao e-commerce xuyen bien gioi (RO, BG, HU markets)
- **CEO/Management**: Dashboard tong quan performance
- **AI System**: 2 autonomous agents tu phan tich va de xuat

### Tieu chi thanh cong
- AI agents chay tu dong daily heartbeat khong can human intervention
- ROAS cai thien >= 15% sau 30 ngay su dung
- Giam thoi gian manual analysis tu 2h/ngay xuong < 15 phut
- Zero data loss trong BigQuery pipeline

### Rang buoc
- Tech stack: Python 3.9.6, FastAPI, Next.js 15, BigQuery, FalkorDB
- Hosting: Contabo VPS (Ubuntu 22.04 - IP: 164.68.101.179)
- API limits: Meta Marketing API rate limits
- Budget: COD e-commerce margins (thap, can toi uu)

---

## Product Context

### Tai sao du an nay ton tai?
Cross-border COD e-commerce (Romania, Bulgaria, Hungary) can phan tich quang cao Facebook lien tuc, nhung team leaders khong du thoi gian manually review hang tram campaigns moi ngay. FAOS v6 tu dong hoa phan tich bang AI agents, giam thoi gian tu 2h xuong 15 phut.

### Van de giai quyet
1. **Information Overload**: Hang tram campaigns chay dong thoi, khong the manual review het
2. **Reaction Time**: Phat hien bat thuong (CPA spike, ROAS drop) qua muon, mat tien
3. **Data Silos**: Du lieu nam rai rac giua Meta Ads Manager, Google Sheets, BigQuery
4. **Inconsistent Analysis**: Moi leader phan tich theo cach rieng, thieu chuan hoa
5. **Knowledge Loss**: Khi leader nghi viec, mat toan bo insights va know-how

### User Experience Goals
- **Zero-setup daily briefing**: AI tu dong gui bao cao moi sang qua Telegram
- **Real-time alerts**: Phat hien bat thuong va canh bao trong 5 phut
- **One-click deep dive**: Tu dashboard co the drill down den ad-level analysis
- **Memory persistence**: AI nho tat ca quyet dinh va context tu truoc
- **Multi-project view**: Xem performance across all projects tren 1 dashboard

### Doi thu / San pham tuong tu
- **Revealbot**: Manh automation, yeu AI insights, dat tien
- **Madgicx**: Tot cho optimization, khong ho tro COD-specific metrics
- **Custom Sheets**: Mien phi nhung manual, khong scalable
- **FAOS v5 (predecessor)**: Lacked graph memory, no state machines, single agent only

---
(Note: File nay it thay doi. Cap nhat khi thay doi scope lon hoac pivot product direction.)
