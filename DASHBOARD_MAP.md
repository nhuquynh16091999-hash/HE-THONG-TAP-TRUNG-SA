# TALPHA Dashboard — Bản đồ hệ thống

> Bản hệ thống hoá phần **dashboard** (`dashboard-ui/`) và mọi thứ nuôi số cho nó.
> Nguồn: đọc trực tiếp code tại commit `edb2b16` (branch `main`).
> Rule chỉ số & bẫy vận hành: `.claude/skills/talpha-system/SKILL.md` (source of truth).

---

## 1. Dashboard là cái gì

Next.js 16 (App Router) + React 19 + TailwindCSS, chạy **1 dự án duy nhất: TALPHA**
(bán trang sức/mỹ phẩm qua Facebook Ads + chat-sale + COD ở GCC + Taiwan).

- Vào `/` → middleware check login → redirect `/talpha`
- `/talpha` render **1 shell duy nhất**: `components/talpha/dashboard-shell.tsx`
- Auth: NextAuth v5 (`lib/auth.ts`), user lưu ở `config/users.json` (bcrypt)
- Data: BigQuery `cty-507710.TALPHA_Dataset` + gọi live Meta API / Poscake POS

---

## 2. Cấu trúc điều hướng (5 nhóm / 9 tab)

| Nhóm sidebar | Tab con | Component | Nguồn số |
|---|---|---|---|
| 📋 Báo cáo | Tổng quan | `tabs/ceo-overview-tab.tsx` | `/api/query` (BQ) + `/api/talpha/targets` |
| | P&L | `tabs/pnl-tab.tsx` | `/api/query` |
| | P&L theo SP | `tabs/product-pnl-tab.tsx` | `/api/query` + `/api/talpha/product-costs` |
| 📦 Sản phẩm | Sản phẩm & Kho | `tabs/products-tab.tsx` | `/api/talpha/inventory` (POS live, fallback BQ snapshot) |
| 👤 Marketer | Marketing & Ads | `tabs/marketing-tab.tsx` | `/api/query` + `/api/talpha/marketer-perf` + `targets` |
| 🎯 Quảng cáo | Ads Command Center | `app/talpha/ads-command-center/page.tsx` (618 dòng) | `/api/talpha/realtime` (Meta + POS **live**) |
| | Sức khoẻ quảng cáo | `tabs/ad-health-tab.tsx` | `/api/query` |
| 👥 Khách hàng | Khách hàng | `tabs/customer-tab.tsx` | `/api/query` |
| | Market Intel | `tabs/market-intel-tab.tsx` | `/api/query` |

Ghi chú:
- `tabs/ads-command-tab.tsx` chỉ là **wrapper 10 dòng** bọc lại page `/talpha/ads-command-center`
  → cùng một màn hình tồn tại ở 2 URL.
- 2 tab `ads-command` + `ad-health` **bỏ qua bộ chọn ngày** (`IGNORES_DATE_RANGE`) vì
  view của chúng có cửa sổ thời gian cố định.
- Ngoài shell còn có `/admin` (quản lý user + TKQC) và `/login`.

---

## 3. Tầng API (Next.js route handlers)

### Cổng SQL chung
`POST /api/query` — gateway BigQuery của **6/9 tab**.
- Chỉ cho `SELECT` / `WITH`, chặn `;` và toàn bộ DDL/DML bằng whitelist keyword
- Auth bằng `DASHBOARD_API_KEY` (nếu không set env → mở, chế độ dev)
- Dataset lấy từ cookie `activeDataset` (shell set = `TALPHA_Dataset`)

### Route nghiệp vụ TALPHA (`/api/talpha/*`)

| Route | Việc |
|---|---|
| `realtime` (625 dòng) | Gọi thẳng Meta API + POS, dựng số cho Ads Command Center & bot WA |
| `inventory` | Tồn kho POS live; POS chết → rơi về bảng BQ `inventory_snapshot` |
| `sync-inventory` / `snapshot-ads` | Endpoint cho launchd gọi định kỳ để 2 bảng snapshot không chết đứng |
| `marketer-perf` | Hiệu suất từng marketer |
| `product-costs` | Giá vốn theo SP (đọc `config/talpha_rules.json`) |
| `targets` | Chỉ tiêu (KPI) |
| `ads-alerts` | Cảnh báo spend cho bot WhatsApp |
| `billing` | Hạn mức / thanh toán TKQC |
| `sheet-report` | Đọc báo cáo Google Sheets |
| `export-report` | Nút "Xuất Sheet" → đẩy job vào BQ `export_jobs`, `export_worker.py` xử lý |
| `sync-health` | Bot WA đọc để biết sync còn sống hay đã "chết câm" |
| `ceo-ask` (211 dòng) | Hỏi đáp CEO bằng LLM → sinh SQL (`lib/talpha/ceo-ask-prompt.ts`, `ceo-ask-sql.ts`) |

### Hạ tầng
`auth/[...nextauth]`, `auth/register`, `auth/validate`, `users`, `ad-accounts`.

---

## 4. View BigQuery mà dashboard đụng tới

Đếm theo số lần tham chiếu trong `dashboard-ui/src`:

```
vw_orders_std           29×   ← xương sống đơn hàng
vw_fb_ads_std           16×   ← xương sống spend
vw_ad_windows            4×
vw_attribution_quality   2×
vw_product_pnl · vw_product_catalog_std · vw_marketer_momentum
vw_fact_daily_pnl · vw_fact_daily_marketer · vw_daily_momentum
vw_creative_fatigue · vw_campaign_lifecycle
```

Đổi `vw_orders_std` hoặc `vw_fb_ads_std` = ảnh hưởng gần như cả dashboard.

---

## 5. Số từ đâu chảy vào

```
Meta API (15 TKQC) ─┐
                    ├─ launchd MỖI GIỜ ─► sync_month.py ─► BigQuery ─► format_all.py ─► ~56 Google Sheets
Poscake POS (7 shop)┘                          │
                                               └──► /api/query ──► 6 tab BQ
Meta API + POS ──── LIVE ────────────────► /api/talpha/realtime ──► Ads Command Center + bot WA
POS ─────────────── LIVE ────────────────► /api/talpha/inventory ─► tab Kho + digest tồn kho
BQ fb_ads_data ──────────────────────────► /api/talpha/ads-alerts ► bot WA cảnh báo spend
```

**Hệ quả cần nhớ:** tab BQ và Ads Command Center **khác bản chất** — tab BQ dùng doanh thu
GIAO THÀNH CÔNG, Ads Command dùng doanh thu ĐẶT. ROAS 2 nơi không so trực tiếp được.

---

## 6. Cái gì chạy ở đâu

| Thành phần | Nơi chạy | Ghi chú |
|---|---|---|
| Dashboard (Mac) | pm2 `talpha-dashboard`, port **3000** | `dashboard-ui/ecosystem.config.js` |
| Dashboard (server) | `169.58.33.8`, port **3001**, `/opt/talpha/` | deploy `scripts/deploy_server.sh` |
| Sync + Sheets | launchd `com.talpha.dailyreport`, 3600s | chạy bản **runtime** `~/talpha_reports/`, **không phải repo** |
| Export worker | launchd `com.talpha.export-worker` | poll BQ `export_jobs` mỗi 20s |
| Snapshot jobs | launchd `com.talpha.snapshot-inventory` (15') / `-ads` (30') | gọi API dashboard |
| Bot WhatsApp | server, pm2 `talpha-wa-alerts` | code `ops/whatsapp-alerts/` |
| pm2 config | `ops/pm2/ecosystem.mac.config.js` / `.server.config.js` | namespace `talpha` |

---

## 7. Repo có gì ngoài dashboard

| Thư mục | Nội dung | Trạng thái |
|---|---|---|
| `dashboard-ui/` | Next.js dashboard | **Đang chạy** |
| `ops/talpha_reports/` | Sync tháng, format ~56 Sheets, health check, export worker | **Đang chạy** (bản runtime) |
| `ops/whatsapp-alerts/` | Bot WA (Node) | **Đang chạy** |
| `sync/` | Bản modular của engine sync (`sync/talpha/` + `sync/core/`) | Chưa cutover — shadow run |
| `config/` | `projects/talpha.yaml` (15 TKQC + tz), `talpha_rules.json`, bảng giá vốn CSV | Config sống |
| `sql/` | `talpha/`, `v6/`, `tables/`, `fixes/` — phần lớn nằm `_legacy/` | Hỗn hợp |
| `faos_brain/` | Agent AI (analyst, marketing_director, autoscale, ads_spy, FastAPI) | Di sản FAOS v6, dashboard **không gọi** |
| `docs/` | 30+ file; quan trọng: `TALPHA_METRIC_RULES.md`, `ARCHITECTURE_2026.md`, `RUNBOOK_V6.md` | Hỗn hợp v5/v6 |
| `.claude/skills/talpha-system/` | Bản đồ + rule + landmines + runbook | **Đọc trước khi sửa số** |
| `tests/` | 33 file test, hầu hết cho `faos_brain` | Lệch trọng tâm |

---

## 8. Điểm cần dọn (đã kiểm chứng trong code)

1. **README.md lỗi thời** — mô tả cây thư mục `faos_brain/analyst.py`, `faos_brain/runner.py`,
   `_deprecated/`: **không file nào tồn tại**. Thực tế agent nằm ở `faos_brain/agents/`.
2. **Thư mục `Agentic-AI-Levelup/` rỗng** — tàn dư tên repo cũ.
3. **`.env.example` gốc vẫn mặc định STRAMARK** (`BQ_DATASET=STRAMARK_Dataset`,
   `PROJECT_ID=auus1`) trong khi repo đã single-project TALPHA. `dashboard-ui/.env.example`
   cũng còn STRAMARK. Người mới copy nguyên là trỏ sai dataset.
4. **Danh sách TKQC nằm ~6 nơi** (`config/projects/talpha.yaml`, `ops/.../ad_accounts.json`,
   runtime config, `sync/core/meta_client.py`, realtime route, ads-command page).
   Thêm TKQC thiếu 1 chỗ = undercount spend âm thầm.
5. **Logic gán marketer nhân bản ~7 chỗ**, regex khác nhau (`Loc` vs `Lộc`).
6. **Hai bản engine sync lệch kiến trúc** — repo `sync/talpha/` (modular) vs runtime
   (monolith 656 dòng). Launchd chạy bản runtime.
7. **Ads Command Center trùng 2 đường vào** (page + tab wrapper).
8. `package.json` gốc chỉ có `pm2` + `puppeteer` — không phản ánh project thật.

---

## 9. Chạy dashboard trên máy này

Máy `/Users/macbook` là máy sạch (chưa có `~/talpha_reports/`, chưa có launchd job nào).
Node 24.14 · npm 11.9 · pm2 6.0 có sẵn.

**Đã làm rồi:**
- `npm install` trong `dashboard-ui/` — 639 gói
- Tạo `dashboard-ui/.env.local` (`AUTH_SECRET` sinh ngẫu nhiên, `chmod 600`, đã gitignore)
- Chạy thử: server ready 1,7s · `/` → `/login` · `/talpha` chặn đúng khi chưa đăng nhập

**Còn thiếu — phải Sỹ Anh đưa, điền vào chỗ `<<< CẦN ĐIỀN >>>` trong `.env.local`:**

| Khoá | Dùng cho |
|---|---|
| `GCP_SA_KEY_JSON` (hoặc file `bigquery_key.json` ở gốc repo) | 6 tab đọc BigQuery |
| `TALPHA_META_ACCESS_TOKEN` · `TALPHA_META_APP_SECRET` | Ads Command Center |
| `TALPHA_POSCAKE_{SA,AE,KW,OM,QA,BH,TW}_KEY` · `TALPHA_PANCAKE_API_TOKEN` | Tab Sản phẩm & Kho |
| `GEMINI_API_KEY` (tuỳ chọn) | Tính năng "CEO hỏi" |

Chưa có khoá thì `/api/query` trả `Could not load the default credentials` và mọi tab số đều trống.

```bash
cd "/Users/macbook/Desktop/Dashboard Sỹ Anh/Talpha-New-16-6/dashboard-ui" && npm run dev
```

**Phần Python (sync + Sheets) cố tình CHƯA cài.** Máy này có Python 3.9.6, repo cần 3.12.
Quan trọng hơn: nhánh `ops/talpha_reports/` **GHI** vào đúng BigQuery và Google Sheets mà hệ
thống cũ đang chạy thật. Repo đã tách nhưng **dữ liệu vẫn chung** — chạy sync từ máy này là
đụng vào số liệu production. Cần quyết có tách luôn dataset/Sheets hay không rồi mới cài.

## 10. Ba rule dễ hiểu nhầm nhất

1. **Doanh thu** = `SUM(cod ÷ số chia của shop)` khi `status_category='GIAO_THANH_CONG' AND cod>0`.
   Số chia **không phải lúc nào cũng 100**: 6 shop GCC ÷100, shop Đài Loan ÷1.
   Tra ở `config/talpha_rules.json → markets.*.pos_money_divisor`.
2. **Ads spend đã là VND** — không quy đổi, không ÷100. Cột `date`, không phải `date_start`.
3. **Sheet lệch Dashboard là cố hữu** (sync theo giờ vs live; tag POS vs `ad_id`; timezone
   từng TKQC vs ngày VN). Đừng "fix" cho khớp từng ngày — chẩn đoán số sai phải đối chiếu
   Meta API và POS API trực tiếp, **không bao giờ** so Sheet ↔ BigQuery.
