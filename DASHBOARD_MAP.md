# TALPHA — Bản đồ nghiệp vụ

Một tài liệu, đọc từ trên xuống là hiểu tiền đi đường nào và số hiện trên màn hình
đến từ đâu. Viết lại 11/09/2026 theo đúng code đang chạy.

Rule chỉ số (công thức doanh thu, tỷ giá, số chia): `docs/TALPHA_METRIC_RULES.md`.
Cách vận hành máy chủ: `docs/DEPLOY_VPS.md`.

---

## 1. Việc kinh doanh

Bán trang sức và mỹ phẩm ở **Đài Loan**, qua Facebook Ads → chat-sale Messenger →
**thu tiền COD**. Hàng đi từ kho Trung Quốc qua 3PL **NAZA供应链**; khách trả tiền
cho shipper; NAZA gom rồi chuyển về theo kỳ.

| Vai | Người | Thấy gì |
|:--|:--|:--|
| Giám đốc | 1 | Toàn bộ số liệu, quản lý người dùng |
| Marketer | 6 (Lộc · Sỹ Anh · Thái · Thương · Quỳnh · Thắng) | Báo cáo, chi phí quảng cáo |
| Sale | 2 (một ghế còn trống) | Đơn hàng, đối soát COD |

Một thị trường · một shop POS Poscake · 10 tài khoản quảng cáo Meta (4 đang chạy).
Tiền: TWD, tỷ giá cố định **800đ/TWD**.

---

## 2. Một đơn hàng đi qua những đâu

```
  Facebook Ads ──► khách nhắn tin ──► sale chốt trên POS Poscake
                                            │
                                            ▼
                                     đơn có mã vận đơn
                                            │
                     ┌──────────────────────┼──────────────────────┐
                     ▼                      ▼                      ▼
              NAZA nhận hàng          17TRACK theo dõi        POS đổi trạng thái
                     │                hành trình kiện          GIAO_THANH_CONG
                     ▼                      │                      │
            khách trả tiền mặt              │                      │
                     │                      │                      │
                     ▼                      ▼                      ▼
            sao kê NAZA theo kỳ      tab Theo dõi vận đơn    sync giờ → BigQuery
                     │                                             │
                     ▼                                             ▼
            tab Đối soát COD  ◄──── khớp mã vận đơn ────►  6 tab đọc BigQuery
```

Ba câu hỏi tiền, ba màn hình khác nhau — **đừng trộn**:

| Câu hỏi | Màn hình | Nguồn |
|:--|:--|:--|
| Bán được bao nhiêu? | Tổng quan · P&L | BigQuery, đơn **GIAO THÀNH CÔNG** |
| Đang tiêu bao nhiêu, ngay lúc này? | Ads Command Center | Meta + POS **gọi thẳng**, đơn **ĐÃ ĐẶT** |
| Tiền có về đủ không? | Đối soát COD · Đối soát chi phí QC | File sao kê người dùng tải lên |

> **Hai định nghĩa doanh thu.** Tab BigQuery đếm đơn đã giao xong; Ads Command Center
> đếm đơn vừa đặt. ROAS hai nơi **không so trực tiếp được**. Đây là thiết kế, không
> phải lỗi cần "fix cho khớp".

---

## 3. Số chảy vào bằng hai đường

### Đường chốt số — theo giờ, qua BigQuery

```
Meta API (10 TKQC) ─┐
                    ├─► talpha-sync.timer (:00 mỗi giờ) ─► BigQuery cty-507710.TALPHA_Dataset
POS Poscake (1 shop)┘         sync/talpha/talpha_sync.py
                                                              │
                              talpha-report.timer (:20) ──────┤
                              daily_guarded.sh                │
                                ├─ sync_month.py  (kéo lại tháng hiện tại)
                                └─ format_all.py  (ghi Google Sheets của từng marketer)
                                                              │
                                            /api/query ◄──────┘──► 6 tab báo cáo
```

`talpha-report` **không ghi Sheet khi sync hỏng**. Chốt 03/09: một Sheet cũ toàn
phần đọc được, còn Sheet nửa mới nửa thiếu thì không. Lý do có chốt này: token Meta
chết 02/09, spend về 0, mà spend nằm ở mẫu số nên Sheet sai theo hướng **đẹp giả**
(CPO 103.735đ khi thật ~165.000đ) — 46 tiếng không ai nghi.

### Đường phản ứng — gọi thẳng, không qua BigQuery

```
Meta API + POS ──live──► /api/talpha/realtime   ──► Ads Command Center
POS            ──live──► /api/talpha/inventory  ──► tab Sản phẩm & Kho
                            (POS chết → rơi về bảng inventory_snapshot trong BQ)
```

### Đường thứ ba — file người dùng tải lên

Ba màn hình **không đụng BigQuery lẫn POS**, chạy được cả khi hai thứ kia chết:

| Màn hình | File đầu vào | Kho lưu |
|:--|:--|:--|
| Đối soát COD | Sao kê NAZA (xlsx) + Google Sheet tiền hàng (chỉ đọc) | `data/cod_statements.json` |
| Đối soát chi phí QC | Chi phí TKQC + sao kê thẻ | `data/ads_recon.json`, `data/ads_recon_kho.json` |
| Theo dõi vận đơn | Bảng đơn của đối tác (Google Sheet) | `data/tracking.json` |

`data/` nằm **ngoài git** (có số tiền thật). `ops/deploy/from-mac.sh` chép nó lên
máy chủ, và **dừng lại báo lỗi** nếu chép trượt.

---

## 4. Màn hình — 7 nhóm, 13 tab

Vào `/` → middleware kiểm đăng nhập → `/talpha` → `components/talpha/dashboard-shell.tsx`.

| Nhóm | Tab | Component | Số từ đâu |
|:--|:--|:--|:--|
| 📋 Báo cáo | Tổng quan | `tabs/ceo-overview-tab.tsx` | `/api/query` + `targets` |
| | P&L | `tabs/pnl-tab.tsx` | `/api/query` |
| | P&L theo SP | `tabs/product-pnl-tab.tsx` | `/api/query` + `product-costs` |
| 🧾 Đơn hàng & Đối soát | Sổ đơn hàng | `tabs/order-ledger-tab.tsx` | `/api/talpha/order-ledger` |
| | Đối soát COD | `tabs/cod-recon-tab.tsx` | `/api/talpha/order-ledger` + `cod-recon` |
| | Theo dõi vận đơn | `tabs/tracking-tab.tsx` | `/api/talpha/tracking` |
| 📦 Sản phẩm | Sản phẩm & Kho | `tabs/products-tab.tsx` | `/api/talpha/inventory` |
| 👤 Marketer | Marketing & Ads | `tabs/marketing-tab.tsx` | `/api/query` + `marketer-perf` |
| 🎯 Quảng cáo | Chi phí quảng cáo | `tabs/ad-spend-tab.tsx` | `/api/talpha/ad-spend` |
| | Ads Command Center | `app/talpha/ads-command-center/page.tsx` | `/api/talpha/realtime` |
| | Sức khoẻ quảng cáo | `tabs/ad-health-tab.tsx` | `/api/query` |
| 💳 Đối soát chi phí QC | Đối soát chi phí QC | `tabs/ads-recon-tab.tsx` | `/api/talpha/ads-recon` |
| 👥 Khách hàng | Khách hàng · Market Intel | `tabs/customer-tab.tsx` · `market-intel-tab.tsx` | `/api/query` |

Ngoài shell còn `/login` và `/admin` (người dùng + TKQC).

Ba tab **bỏ qua bộ chọn ngày** (`IGNORES_DATE_RANGE`): Ads Command Center và Sức khoẻ
quảng cáo có cửa sổ thời gian cố định trong view; Đối soát chi phí QC lấy kỳ từ chính
file sao kê.

**Đối soát chi phí QC đứng riêng một nhóm, không nhét vào "Quảng cáo"** — tab "Chi phí
quảng cáo" trả lời *tiêu bao nhiêu và hiệu quả ra sao*; mục này trả lời *tiền có ra
đúng số không*. Gộp chung là sớm muộn có người đem số đối soát đi tính ROAS.

---

## 5. Tầng API

### `/api/query` — cổng SQL dùng chung của 6 tab BigQuery

Chỉ nhận `SELECT` / `WITH`; chặn `;` và toàn bộ DDL/DML bằng danh sách từ khoá cấm.
Xác thực bằng `DASHBOARD_API_KEY` (không đặt env → mở, chế độ dev). Dataset lấy từ
cookie `activeDataset` (shell đặt `TALPHA_Dataset`).

### `/api/talpha/*`

| Route | Việc | Ai gọi |
|:--|:--|:--|
| `realtime` | Meta + POS live, dựng số Ads Command Center | Giao diện, bot WA |
| `inventory` | Tồn kho POS live; POS chết → snapshot BQ | Giao diện, bot WA |
| `order-ledger` | Sổ đơn: mỗi đơn một dòng, khách + tiền + vòng đời | Giao diện |
| `cod-recon` | Khớp sao kê 3PL với đơn đã giao | Giao diện |
| `tracking` · `tracking/import` | 17TRACK + nạp bảng đơn đối tác | Giao diện |
| `ads-recon` | Đối soát chi phí TKQC với sao kê thẻ | Giao diện |
| `cod-actions` | Đánh dấu đã đòi / đã nhận tiền | Giao diện |
| `ad-spend` · `marketer-perf` · `product-costs` · `targets` | Số phụ trợ cho tab | Giao diện |
| `ceo-ask` | Hỏi đáp bằng LLM → sinh SQL | Giao diện |
| `export-report` | Nút "Xuất Sheet" → chạy thẳng `format_all.py` (**đang hỏng**, xem mục 7) | Giao diện |
| `sync-inventory` | Ghi snapshot tồn kho làm dự phòng cho tab Kho | `snapshot_cron.sh` (chưa hẹn giờ) |
| `ads-alerts` · `billing` · `sheet-report` · `sync-health` | Cảnh báo spend, hạn mức TKQC, số từ Sheet, sức khoẻ sync | Bot WA (đang tắt) |

Hạ tầng: `auth/[...nextauth]`, `auth/validate`, `users`, `ad-accounts`.

---

## 6. BigQuery — `cty-507710.TALPHA_Dataset`

View mà dashboard đụng tới, đếm theo số lần tham chiếu trong `dashboard-ui/src`:

```
vw_orders_std           31×   ← xương sống đơn hàng
vw_fb_ads_std           16×   ← xương sống chi tiêu
vw_ad_windows            4×
vw_attribution_quality   2×
vw_product_pnl · vw_product_catalog_std · vw_marketer_momentum
vw_fact_daily_pnl · vw_fact_daily_marketer · vw_daily_momentum
vw_creative_fatigue · vw_campaign_lifecycle
```

Sửa `vw_orders_std` hoặc `vw_fb_ads_std` là đụng gần như cả dashboard.
Định nghĩa view: `sql/talpha/views/`, deploy bằng `sql/talpha/deploy_talpha_analytics.py`.

Bảng thô dashboard đọc thẳng: `sale_order`, `order_items`, `fb_ads_data`,
`fb_adset_data`, `inventory_snapshot`, `sync_health`.

---

## 7. Cái gì chạy ở đâu

| Thành phần | Nơi chạy | Khởi động bằng |
|:--|:--|:--|
| Dashboard | VPS `139.180.131.21:3000`, `/opt/talpha` | pm2 `talpha-dashboard` — `ops/pm2/ecosystem.vps.config.js` |
| Kéo số vào BigQuery | VPS, mỗi giờ phút :00 | systemd `talpha-sync.timer` → `sync/talpha/talpha_sync.py` |
| Ghi Google Sheets | VPS, mỗi giờ phút :20 | systemd `talpha-report.timer` → `/root/talpha_reports/daily_guarded.sh` |
| Bot cảnh báo WhatsApp | — | **Tắt**. Code ở `ops/whatsapp-alerts/`, cách bật trong `ops/pm2/README.md` |
| Máy Mac | Máy dev | `cd dashboard-ui && npm run dev`. Không job nền nào. |

**Việc nền đang hỏng hoặc chưa có lịch chạy** — soát 13/09/2026, để lại xử lý sau.
Chúng chưa từng chạy lần nào trong dự án mới:

| Thứ | Tình trạng thật |
|:--|:--|
| `ops/talpha_reports/snapshot_cron.sh` | `inventory_snapshot` không được làm tươi — đó là đường dự phòng của tab Kho khi POS chết |
| `ops/talpha_reports/catalog_cron.sh` | `product_catalog` **0 dòng từ ngày dựng dự án** → tab P&L theo SP và giá vốn trong `vw_orders_std` trống. Script ghi cứng Python ở `runtime/.venv`, trên VPS là `/opt/talpha/.venv` nên chết ngay |
| Nút "Xuất Sheet" (`api/talpha/export-report`) | Đường dẫn script ghi cứng `/Users/syanh/talpha_reports/format_all.py` — máy Mac của chủ cũ, bấm trên máy chủ là báo "Không thấy script". Và format_all.py không tự giữ khoá |

Dựng timer theo mẫu `ops/deploy/vps-sync-setup.sh`.

Deploy: **`bash ops/deploy/from-mac.sh`** từ máy Mac. Máy chủ không có khoá GitHub —
nó mượn khoá của máy Mac qua `ssh -A` trong lúc chạy script. `git pull` thẳng trên
máy chủ **không** chạy được, và tệ hơn là nó vẫn in ra `origin/main` cũ nên trông như
đã mới nhất.

`npm run build` ở máy Mac **không phải deploy** — nó chỉ đổi bản chạy ở localhost.

---

## 8. Cấu trúc repo

```
dashboard-ui/            Next.js 16 + React 19 — toàn bộ giao diện và API
  src/app/api/talpha/      route nghiệp vụ
  src/lib/talpha/          rule gán người, logic đối soát, kho JSON có khoá file
  src/lib/talpha/config-path.ts   MỘT chỗ biết cấu hình nằm ở đâu
config/                  talpha_rules.json — NGUỒN RULE DUY NHẤT
  projects/talpha.yaml     TKQC Meta + shop POS
sync/                    engine sync POS + Meta → BigQuery (bản DUY NHẤT)
  core/                    pos_client · meta_client · bq_writer · business_rules
ops/deploy/              5 script dựng và cập nhật máy chủ
ops/pm2/                 ecosystem.vps.config.js — file pm2 DUY NHẤT
ops/talpha_reports/      đường ống báo cáo Google Sheets
ops/whatsapp-alerts/     bot cảnh báo (đang tắt)
sql/talpha/views/        12 định nghĩa view BigQuery
docs/                    TALPHA_METRIC_RULES.md là source of truth về chỉ số
```

---

## 9. Ba rule dễ tính sai nhất

1. **Doanh thu** = `SUM(cod ÷ số chia của shop)`, chỉ đơn `GIAO_THANH_CONG` và `cod > 0`.
   Shop Đài lưu **nguyên TWD** nên số chia là **1**, không phải 100. Gõ `/100` là tiền
   tụt đúng 100 lần (AOV ra 8.987đ/đơn). Tra ở `talpha_rules.json → markets.*.pos_money_divisor`,
   đọc qua `posMoneyDivisor()`.
2. **Chi phí quảng cáo đã là VND** — không quy đổi lần nào nữa. Cột ngày là `date`,
   không phải `date_start`.
3. **Chẩn đoán số sai: không bao giờ so Sheet với BigQuery** — cùng nguồn nên cùng sai.
   Đối chiếu thẳng Meta API cho chi phí và POS API cho đơn.

---

## 10. Còn nợ

* **Phí thao tác NAZA 3 RMB/đơn** — bảng giá ghi miễn phí, thực tế thu đều trên 463 đơn
  (1.389 RMB qua 7 kỳ). Chưa hỏi được NAZA khoản này là gì.
* **Quy tắc gán sale chưa khai** (`sale_assignment`) → mọi đơn rơi vào "(chưa gán sale)".
* **Tên đầy đủ của giám đốc và bạn sale thứ hai** chưa có.
* **KPI tháng đang là số của đội cũ** (`targets`).
* **6 mã vận đơn bị gán cho hai đơn khác nhau** và **39 dòng trống mã vận đơn** trong
  file đơn tổng — tab Đối soát đang cảnh báo.
* Giá vốn 3 mã nhiều biến thể (004, 012, 017) đang lấy giá cao nhất; 12 sản phẩm trong
  bảng mua hàng chưa có mã SKU.

Danh sách đầy đủ: `config/talpha_rules.json → _todo`.
