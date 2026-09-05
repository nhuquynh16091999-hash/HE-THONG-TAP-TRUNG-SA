# TALPHA — Checklist Roadmap A→F

> Nguồn theo dõi tiến độ chính thức. Kiến trúc tổng: `ARCHITECTURE_2026.md`. Reference kỹ thuật: `TALPHA_DETAIL.md`.
> Cập nhật: 2026-06-19.

**Tiến độ: 23/25 bước (92%)**

| GĐ | Tên | Tiến độ |
|:--|:--|:--|
| A | Nền móng & Dọn dẹp | ✅ 4/4 |
| B | Chuẩn hóa Data Pipeline | ✅ 4/4 |
| C | Dashboard Core hoàn thiện | ✅ 4/4 |
| D | AI Features — CEO Overview | ✅ 5/5 |
| E | Automation & Ops Tools | 🔄 3/4 |
| F | Agent Revival — Thế hệ 1 | 🔄 3/4 |

---

## GĐ A — Nền móng & Dọn dẹp ✅ 4/4

- [x] **A1** — Gỡ 6 dự án cũ (auus1, hnle, stramark, t1, trendify, zen8) khỏi dashboard/sync/SQL → single-project TALPHA
- [x] **A2** — `docs/ARCHITECTURE_2026.md` (kiến trúc tổng) + `TALPHA_DETAIL.md` (reference chi tiết + sơ đồ liên kết DB)
- [x] **A3** — Single-project hoá: middleware/page/login default `talpha`, `users.json` TALPHA-only
- [x] **A4** — Commit + push migration lên remote `talpha-new`

## GĐ B — Chuẩn hóa Data Pipeline ✅ 4/4

- [x] **B1** — `sync/core/` backbone: `pos_client`, `meta_client`, `bq_writer`, `business_rules`
- [x] **B2** — Refactor `talpha_sync.py` dùng `sync/core/` (612 → 404 dòng)
- [x] **B3** — `business_rules` 8 quy tắc nghiệp vụ + 68 unit tests pass (`tests/test_talpha_business_rules.py`)
- [x] **B4** — Config template `_template.yaml` chuẩn TALPHA pattern (GCC, shop_label, FX rates)

## GĐ C — Dashboard Core hoàn thiện 🔄 3/4

- [x] **C1** — Sản phẩm & Kho: inventory live BQ snapshot (payload object 7-key) + đồng bộ 3-chiều Sheet↔BQ↔web
- [x] **C2** — Realtime POS: gom ngày theo timezone từng TKQC Meta (fix string-slice bug)
- [x] **C3** — Auth TALPHA-only: chặn account ngoài TALPHA ở `validate/route.ts`, default mode `talpha`
- [x] **C4** — Product P&L: `product_catalog` (334 SKU từ POS) + view `vw_product_pnl` (JOIN 99.9%) + tab "P&L theo SP". `order_items` đã có 27.333 rows; tên/giá lấy từ catalog (order endpoint chỉ trả UUID + qty)

## GĐ D — AI Features (CEO Overview) 🔄 1/5

- [x] **D1** — CEO AI Ask: executive summary + text-to-SQL (Claude) — cần `ANTHROPIC_API_KEY`
- [x] **D2** — Smart alerts: cảnh báo SKU cần nhập gấp / tồn âm / ROAS dưới mục tiêu / margin âm (panel CeoSmartInsights)
- [x] **D3** — Decision Support: hành động ưu tiên theo độ khẩn (nhập hàng, cắt campaign ROAS thấp, scale)
- [x] **D4** — Ops Checklist: 4 mục kiểm tra trong ngày (tồn kho, tồn âm, ROAS, POS Saudi)
- [x] **D5** — Timeline: độ mới dữ liệu (snapshot tồn kho, BQ snapshot time, nguồn từng market)

## GĐ E — Automation & Ops Tools 🔄 3/4

- [x] **E1** — ETL scheduler PM2 (`ecosystem.sync.config.js`, cron mỗi 6h) + Discord alert đỏ-khi-lỗi (chi tiết lỗi). *Kích hoạt: set `DISCORD_WEBHOOK_ETL` + `pm2 start sync/talpha/ecosystem.sync.config.js`*
- [x] **E2** — Saudi POS 500: retry 3 lần backoff (`pos_client._fetch_page_with_retry`, đã test mock 500→retry→hồi phục)
- [x] **E3** — QA + BH: đã có key & hoạt động (catalog sync kéo QA 22 + BH 8 SP); cả 6 shop trong `POS_SHOPS`
- [ ] **E4** — ⏳ *Chờ giá trị thật*: return fee OM + BH (số tiền); Pixel ID Meta — không bịa được

## GĐ F — Agent Revival — Thế hệ 1 🔄 3/4

> Hồi sinh trên nền **Claude** (stack thật; doc cũ ghi Gemini→GPT đã bỏ). Agent đọc BigQuery chuẩn hoá, KHÔNG tạo nguồn dữ liệu mới. Chạy live cần `ANTHROPIC_API_KEY` (như D1).

- [x] **F1** — Analyst agent (`faos_brain/agents/analyst.py`): đọc vw_fact_daily_pnl/marketer/product + momentum → Claude phân tích. Verified đọc data thật (8.816 đơn), degrade khi thiếu ads.
- [x] **F2** — Marketing Director (`marketing_director.py`): hiệu quả ads theo marketer + xu hướng → Claude đề xuất scale/cut/ngân sách.
- [x] **F3** — LLM client (`llm_client.py`): Claude + model fallback (opus→haiku) + retry backoff. 4 unit test pass (`tests/test_agents.py`).
- [ ] **F4** — FalkorDB graph layer ⏳ *Hoãn*: cần Docker instance + use case rõ; agent đọc BQ trực tiếp đã đủ cho thế hệ 1.

---

*Quy ước: ✅ xong · 🔄 đang làm · ⏳ chưa bắt đầu · 🧊 frozen. Cập nhật ô tiến độ ở bảng đầu file mỗi khi tick một mục.*
