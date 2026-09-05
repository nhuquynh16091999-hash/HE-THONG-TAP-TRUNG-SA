# 🏗️ DASHBOARD TAB RESTRUCTURE — BRIEFING CHO AGENT TEAM

> **Mục tiêu**: Dashboard hiện có 13 tab → quá nhiều, gây khó navigate. Cần gộp/restructure lại cho gọn.  
> **Yêu cầu CEO**: Gộp các tab trùng nội dung, giữ UX gọn gàng, giữ nguyên Ads Command.  
> **Deadline**: Cần ý kiến đề xuất từ các agents trước khi implement.

---

## 📊 HIỆN TRẠNG: 13 TAB

### Section "DASHBOARD" (9 tab cũ)

| # | Tab ID | Tên | Nội dung chính | Data Source |
|---|--------|-----|----------------|-------------|
| 1 | `overview` | **Tổng quan** | 5 KPI cards (Tổng đơn, Doanh thu, Thành công, ROAS, CPA), Daily Trend chart (orders + revenue), Top Marketer table (5 rows), Revenue Funnel L1→L3→L4 | `mart_performance_master`, `vw_fact_orders`, `fb_ads_data` |
| 2 | `ads-command` | **Ads Command** | ⚡ Full-stack ads management: Meta API sync, account selector, campaign table, spend/impressions/clicks/ROAS tracking, CMO Chat. Hệ thống riêng biệt, kết nối FastAPI backend | FastAPI backend → Meta Ads API |
| 3 | `marketing` | **Marketing** | 5 KPI cards (Spend, Impressions, Clicks, CTR, CPM), Spend vs Revenue chart, Attribution Quality chart, Marketer table (Spend/Revenue/ROAS/CPA/Signal) | `mart_performance_master`, `fb_ads_data`, `vw_fact_orders` |
| 4 | `products` | **Sản phẩm** | Top Products by Revenue (bar chart), Marketer × Product Revenue Matrix (heatmap table) | `mart_product_insights`, `vw_fact_orders`, `fact_order_items_dedup` |
| 5 | `pnl` | **P&L** | 6 KPI cards (Revenue, COGS, Ads, Shipping, FFM, Net Profit), Waterfall chart, Net Profit Trend (area chart), Daily P&L Breakdown table + CSV Export | `vw_fact_orders`, `fact_order_items_dedup`, `vw_fact_ads_performance` |
| 6 | `inventory` | **Tồn kho** | 4 KPI cards (Total SKU, Units Sold, Returned, Return Rate), Product Inventory table + CSV Export | `mart_product_insights` |
| 7 | `customers` | **Khách hàng** | 4 KPI cards (Unique Customers, Total Orders, Avg Orders/Customer, Repeat Rate), Province distribution (pie chart), Top Customers table, New vs Returning (bar chart) | `vw_fact_orders` |
| 8 | `assistant` | **Trợ lý ảo** | Chat interface → RAG Knowledge Base search (quy trình, chính sách, UTM...) | `/api/agent/search` |
| 9 | `ai-cost` | **AI Cost** | Token usage tracking, cost per agent, savings from caching. Daily breakdown. Connects to FastAPI backend | FastAPI `/api/v1/token-usage` |

### Section "CEO INTELLIGENCE" (4 tab mới)

| # | Tab ID | Tên | Nội dung chính | Data Source |
|---|--------|-----|----------------|-------------|
| 10 | `ceo-overview` | **CEO Overview** | 6 KPI cards (Revenue, COGS, Ads, Shipping, Net Profit, Margin%), Monthly P&L trend (ComposedChart), Cost Breakdown table, Top 3 Rankings (Marketer/Product/Market) | `vw_fact_daily_pnl_v2` |
| 11 | `marketer-perf` | **Marketer Perf** | 4 Summary cards, ROAS by Marketer chart, Revenue vs Spend chart, Full P&L table per marketer (Revenue/COGS/Ads/Ship/Net/Margin/Grade), Daily detail expansion | `mart_performance_master` |
| 12 | `product-pnl` | **Product P&L** | 4 KPI cards, Revenue by Product chart, Margin by Product chart, Full Product P&L table (Revenue/COGS/Ads/Ship/Net/Margin/Return Rate/Grade ⭐🟢🟡🔴) | `mart_product_insights` |
| 13 | `market-intel` | **Market Intel** | Market summary cards, Revenue Share by Market (pie), Return Rate by Market (bar), Market × Product Matrix table | `mart_product_insights` |

---

## 🔍 PHÂN TÍCH OVERLAP (TRÙNG LẶP)

### 1. 🟥 **Tổng quan (`overview`) vs CEO Overview (`ceo-overview`)** — TRÙNG NẶNG

| Metric | Tổng quan | CEO Overview |
|--------|-----------|-------------|
| Revenue KPI | ✅ | ✅ |
| Total Orders | ✅ | ❌ |
| ROAS / CPA | ✅ | ❌ |
| COGS / Shipping / Net Profit | ❌ | ✅ (full P&L) |
| Daily Trend chart | ✅ (orders + revenue) | ✅ (monthly P&L) |
| Top Marketer ranking | ✅ (simple 5-row table) | ✅ (top 3 with more detail) |
| Revenue Funnel L1→L4 | ✅ | ❌ |
| Top Product ranking | ❌ | ✅ |
| Top Market ranking | ❌ | ✅ |

**Nhận xét**: CEO Overview là bản nâng cấp mạnh hơn Tổng quan. Nên **gộp**, giữ CEO Overview làm base, thêm Funnel L1→L4 + ROAS/CPA từ old tab.

---

### 2. 🟧 **Marketing (`marketing`) vs Marketer Perf (`marketer-perf`)** — TRÙNG TRUNG BÌNH

| Metric | Marketing | Marketer Perf |
|--------|-----------|---------------|
| Ad Spend KPI | ✅ | ✅ |
| Impressions/Clicks/CTR/CPM | ✅ | ❌ |
| Spend vs Revenue chart | ✅ (daily) | ✅ (by marketer) |
| Attribution Quality chart | ✅ | ❌ |
| Marketer table | ✅ (Spend/Rev/ROAS/CPA/Signal) | ✅ (full P&L: COGS/Ship/Net/Margin/Grade) |
| ROAS by Marketer chart | ❌ | ✅ |
| Daily marketer detail | ❌ | ✅ |

**Nhận xét**: Marketing tập trung ads metrics (impressions, CTR, CPM), Marketer Perf tập trung P&L per marketer. Nên **gộp** thành 1 tab "Marketing & Marketer" với sub-sections.

---

### 3. 🟨 **Sản phẩm (`products`) vs Product P&L (`product-pnl`)** — TRÙNG TRUNG BÌNH

| Metric | Sản phẩm | Product P&L |
|--------|----------|-------------|
| Top Products chart | ✅ (by revenue) | ✅ (by revenue + margin) |
| Product × Marketer matrix | ✅ | ❌ |
| Product P&L table | ❌ | ✅ (full: COGS/Ads/Ship/Net/Margin/Grade) |
| Product Grading | ❌ | ✅ (⭐🟢🟡🔴) |
| Return Rate per product | ❌ | ✅ |

**Nhận xét**: Product P&L đã bao gồm và mở rộng Sản phẩm. Nên **gộp**, lấy Product P&L làm base, thêm Marketer × Product matrix.

---

### 4. 🟩 **P&L (`pnl`) vs CEO Overview (`ceo-overview`)** — TRÙNG NHẸ

| Metric | P&L | CEO Overview |
|--------|-----|-------------|
| Full P&L KPIs | ✅ (6 cards) | ✅ (6 cards) |
| Waterfall chart | ✅ | ❌ |
| Daily P&L table + CSV | ✅ | ❌ (monthly view) |
| Monthly P&L trend | ❌ | ✅ |

**Nhận xét**: P&L tab chi tiết hơn (daily breakdown, CSV export, waterfall). CEO Overview chỉ tóm tắt monthly. **Có thể gộp** P&L vào CEO Overview dưới dạng "Chi tiết P&L" expandable section, hoặc giữ riêng nếu CFO cần deep dive.

---

### 5. 🟦 **Tồn kho (`inventory`) vs Product P&L (`product-pnl`)** — TRÙNG NHẸ

| Metric | Tồn kho | Product P&L |
|--------|---------|-------------|
| Return Rate | ✅ (overall) | ✅ (per product) |
| Units Sold/Returned | ✅ | ✅ |
| Product list table | ✅ (basic) | ✅ (full P&L) |

**Nhận xét**: Tồn kho có thể merge vào Product P&L. Thêm 1 section "Inventory & Returns".

---

### 6. ⬜ **Các tab KHÔNG TRÙNG**

| Tab | Trùng với | Ghi chú |
|-----|----------|---------|
| **Ads Command** | Không trùng | Hệ thống độc lập, Meta API integration. **GIỮI NGUYÊN**. |
| **Khách hàng** | Không trùng | Unique data (province, repeat rate, new vs returning). **GIỮI NGUYÊN** hoặc gộp nhẹ. |
| **Trợ lý ảo** | Không trùng | RAG chatbot. **GIỮI NGUYÊN**. |
| **AI Cost** | Không trùng | Token tracking. **GIỮI NGUYÊN**. |
| **Market Intel** | Không trùng | Market-level analysis. Có thể gộp vào CEO Overview hoặc giữ riêng. |

---

## 💡 GỢI Ý SƠ BỘ (ĐỂ AGENTS THẢO LUẬN)

### Phương án A: Gộp mạnh (13 → 7 tab)

| # | Tab mới | Gộp từ | Nội dung |
|---|---------|--------|----------|
| 1 | **Tổng quan** | overview + ceo-overview + pnl | Full P&L KPIs, Monthly trend, Rankings, Waterfall, Funnel, Daily P&L table |
| 2 | **Ads Command** | ads-command | Giữ nguyên |
| 3 | **Marketing** | marketing + marketer-perf | Ads metrics (spend/CTR/CPM) + Marketer P&L table + ROAS charts |
| 4 | **Sản phẩm** | products + product-pnl + inventory | Product P&L + Grading + Marketer×Product matrix + Inventory returns |
| 5 | **Thị trường** | market-intel + customers | Market Intel + Customer demographics |
| 6 | **Trợ lý ảo** | assistant | Giữ nguyên |
| 7 | **AI Cost** | ai-cost | Giữ nguyên |

### Phương án B: Gộp vừa (13 → 9 tab)

| # | Tab mới | Gộp từ |
|---|---------|--------|
| 1 | **Tổng quan** | overview + ceo-overview |
| 2 | **Ads Command** | giữ nguyên |
| 3 | **Marketing** | marketing + marketer-perf |
| 4 | **Sản phẩm** | products + product-pnl + inventory |
| 5 | **P&L** | pnl (giữ riêng cho CFO deep dive) |
| 6 | **Thị trường** | market-intel |
| 7 | **Khách hàng** | customers |
| 8 | **Trợ lý ảo** | assistant |
| 9 | **AI Cost** | ai-cost |

---

## 🎯 CÂU HỎI & YÊU CẦU CHO CÁC AGENTS

### A. Câu hỏi chiến lược

1. **Phương án A (7 tab) hay B (9 tab)?** Hay đề xuất phương án C riêng?
2. **P&L nên giữ riêng hay gộp vào Tổng quan?** P&L tab có CSV export và daily detail — nên giữ riêng cho CFO?
3. **Market Intel + Khách hàng có nên gộp không?** Market Intel focus thị trường Romania, Khách hàng focus behavior (repeat rate, province). Khác nhau nhưng liên quan.
4. **Tab gộp nên dùng sub-tabs (nội bộ) hay accordion/sections?** Ví dụ: Marketing tab có 2 sub-tab "Ads Metrics" + "Marketer P&L".
5. **Ưu tiên hiển thị mobile?** Sidebar 13 tab khó dùng trên mobile. 7-9 tab khả thi hơn.
6. **Naming convention**: Nên dùng tiếng Việt (Tổng quan, Sản phẩm) hay tiếng Anh (Overview, Products)?

### B. Đề xuất nội dung bổ sung

Mỗi agent hãy đề xuất **metrics/dữ liệu mới** mà tab hiện tại CHƯA CÓ nhưng CẦN CÓ. Ví dụ:

- **Metrics còn thiếu**: Có KPI nào quan trọng cho CEO/CMO/CFO mà dashboard chưa hiển thị? (ví dụ: LTV, CAC, Cohort Retention, Break-even point, Budget utilization rate...)
- **Charts/Visualizations còn thiếu**: Có loại biểu đồ nào sẽ giúp ra quyết định nhanh hơn? (ví dụ: Heatmap theo giờ, Funnel conversion step-by-step, Cohort analysis chart, Geo map...)
- **Alerts/Warnings tự động**: Có nên thêm hệ thống cảnh báo real-time không? (ví dụ: ROAS drop > 20%, Return rate spike, Budget overspend...)
- **So sánh period-over-period**: Hiện tại dashboard chỉ hiện 1 khoảng thời gian. Có cần thêm so sánh tuần này vs tuần trước, tháng này vs tháng trước?
- **Export/Sharing**: Ngoài CSV, có cần thêm PDF report, scheduled email, Slack notification?

### C. Đề xuất cấu trúc chi tiết từng tab (sau khi gộp)

Với mỗi tab đề xuất, agents hãy mô tả **cấu trúc layout cụ thể** theo format sau:

```
📑 TÊN TAB: [Tên tab đề xuất]

🔝 HEADER SECTION:
- KPI Cards: [Liệt kê các KPI card cần hiển thị, thứ tự ưu tiên]
- Filters: [Bộ lọc nào cần có? Date range, Marketer, Product, Market...]

📊 CHARTS SECTION:
- Chart 1: [Loại chart] — [Dữ liệu gì] — [Kích thước: full-width / half-width]
- Chart 2: ...

📋 TABLES SECTION:
- Table 1: [Tên bảng] — [Các cột cần có] — [Sortable? Searchable? Exportable?]
- Table 2: ...

⚡ INTERACTIVE ELEMENTS:
- [Drill-down? Click vào marketer → xem chi tiết?]
- [Sub-tabs nội bộ?]
- [Expand/collapse sections?]

📱 MOBILE PRIORITY:
- [Phần nào ẩn trên mobile? Phần nào collapse?]
```

Ví dụ cho tab "Tổng quan" (gộp từ overview + ceo-overview):

```
📑 TÊN TAB: Tổng quan

🔝 HEADER:
- KPI Cards: Revenue | Net Profit | Margin% | ROAS | CPA | Success Rate
- Filters: Date Range picker

📊 CHARTS:
- Monthly P&L Trend (ComposedChart) — full-width
- Revenue Funnel L1→L3→L4 — half-width  
- Cost Breakdown Waterfall — half-width

📋 TABLES:
- Top 3 Rankings: Marketer | Product | Market — 3-column grid
- Monthly P&L Detail Table — full-width, exportable CSV

⚡ INTERACTIVE:
- Click ranking item → navigate to detail tab
- Toggle monthly/daily view
```

> **LƯU Ý**: Mỗi agent nên đề xuất dựa trên chuyên môn của mình. CMO focus Marketing tab, CFO focus P&L, COO focus Operations, CTO focus technical feasibility.

---

## 📁 FILE REFERENCES

| File | Dòng | Mô tả |
|------|------|-------|
| [dashboard-shell.tsx](file:///c:/Users/LE%20MO/Desktop/AGENT/dashboard-ui/src/components/dashboard-shell.tsx) | 35-50 | TAB_ITEMS array |
| [overview-tab.tsx](file:///c:/Users/LE%20MO/Desktop/AGENT/dashboard-ui/src/components/tabs/overview-tab.tsx) | 1-263 | Tổng quan tab |
| [marketing-tab.tsx](file:///c:/Users/LE%20MO/Desktop/AGENT/dashboard-ui/src/components/tabs/marketing-tab.tsx) | 1-275 | Marketing tab |
| [products-tab.tsx](file:///c:/Users/LE%20MO/Desktop/AGENT/dashboard-ui/src/components/tabs/products-tab.tsx) | 1-191 | Sản phẩm tab |
| [pnl-tab.tsx](file:///c:/Users/LE%20MO/Desktop/AGENT/dashboard-ui/src/components/tabs/pnl-tab.tsx) | 1-341 | P&L tab |
| [inventory-tab.tsx](file:///c:/Users/LE%20MO/Desktop/AGENT/dashboard-ui/src/components/tabs/inventory-tab.tsx) | 1-213 | Tồn kho tab |
| [customer-tab.tsx](file:///c:/Users/LE%20MO/Desktop/AGENT/dashboard-ui/src/components/tabs/customer-tab.tsx) | 1-222 | Khách hàng tab |
| [assistant-tab.tsx](file:///c:/Users/LE%20MO/Desktop/AGENT/dashboard-ui/src/components/tabs/assistant-tab.tsx) | 1-110 | Trợ lý ảo tab |
| [token-cost-tab.tsx](file:///c:/Users/LE%20MO/Desktop/AGENT/dashboard-ui/src/components/tabs/token-cost-tab.tsx) | 1-324 | AI Cost tab |
| [ceo-overview-tab.tsx](file:///c:/Users/LE%20MO/Desktop/AGENT/dashboard-ui/src/components/tabs/ceo-overview-tab.tsx) | 1-597 | CEO Overview tab |
| [marketer-perf-tab.tsx](file:///c:/Users/LE%20MO/Desktop/AGENT/dashboard-ui/src/components/tabs/marketer-perf-tab.tsx) | 1-427 | Marketer Perf tab |
| [product-pnl-tab.tsx](file:///c:/Users/LE%20MO/Desktop/AGENT/dashboard-ui/src/components/tabs/product-pnl-tab.tsx) | 1-417 | Product P&L tab |
| [market-intel-tab.tsx](file:///c:/Users/LE%20MO/Desktop/AGENT/dashboard-ui/src/components/tabs/market-intel-tab.tsx) | 1-426 | Market Intel tab |
