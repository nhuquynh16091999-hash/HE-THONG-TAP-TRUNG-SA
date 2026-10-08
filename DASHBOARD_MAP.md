# TALPHA — Bản đồ nghiệp vụ

Một tài liệu, đọc từ trên xuống là hiểu tiền đi đường nào và số hiện trên màn hình
đến từ đâu. Viết lại 11/09/2026 theo đúng code đang chạy.

Rule chỉ số (công thức doanh thu, tỷ giá, số chia): `docs/TALPHA_METRIC_RULES.md`.
Cách vận hành máy chủ: `docs/DEPLOY_VPS.md`.

---

## 1. Việc kinh doanh

Bán trang sức và mỹ phẩm qua Facebook Ads → chat-sale Messenger → **thu tiền COD**.
**Cả ba nước đang bán — Đài Loan, Singapore, UAE**. UAE giao qua D&T Fulfillment (bảng giá `shipping_fees.AE`, 25/09/2026), chưa chạy quảng cáo — đơn tới 25/09 là đơn tự nhiên. Sỹ Anh xác nhận lại 07/10/2026: UAE
VẪN chưa chạy ads (58 đơn 01–07/10, nhập tay trên POS, tag "Tô Lâm" → Lộc, không page/quảng cáo)
— nên tiền ads UAE = 0 là ĐÚNG, không phải thiếu TKQC. Khi UAE bắt đầu chạy: camp đặt `AE/…` và
TKQC chạy nó phải nằm trong `/me/adaccounts` của token, nếu không là ghi thiếu âm thầm.
Hàng Đài đi từ kho Trung Quốc qua 3PL **NAZA供应链**; khách trả tiền cho shipper; NAZA gom
rồi chuyển về theo kỳ. Singapore: bảng giá 3PL khai ở `shipping_fees.SG` (25/09/2026, chưa ghi tên đối tác), chờ sao kê mẫu.

**Mỗi thị trường = một team riêng, không liên quan nhau** (Sỹ Anh chốt 05/10/2026; Nhật thêm 08/10/2026):

| Team | Nước | Leader |
|:--|:--|:--|
| Trung Đông | UAE | Lộc |
| Đông Nam Á | Singapore | Thái |
| Đông Á | Đài Loan | Sỹ Anh (tạm thời) |
| Nhật Bản | Nhật Bản | Sỹ Anh (tạm thời) |

**Nhật Bản (mở 08/10/2026)** — camp đặt `JP/…` (Thắng, Thương chạy từ 08/10). CHƯA CÓ SHOP POS nên
`status: "sap_chay"`: chỉ có tiền ads + tin nhắn, chưa có đơn/doanh số/vận đơn. Tỷ giá 1 JPY = 160đ
(Sỹ Anh chốt). Có shop thì làm theo `markets.Japan._status_note` trong `talpha_rules.json`.

| Vai (`role`) | Người | Thấy gì |
|:--|:--|:--|
| Giám đốc (`director`) | Sỹ Anh | Cả ba team, mọi tab, Quản trị (người dùng, TKQC) |
| Leader (`leader`) | Lộc · Thái | Mọi tab của team mình (báo cáo, P&L, đơn, vận đơn, Kế toán → Tiền COD về, quảng cáo, kho, khách) — chỉ nước của team |
| Sale · vận đơn (`sale`) | Thương (cả ba team) | Sổ đơn (kể cả đòi NAZA tiền đơn quá hạn), Theo dõi vận đơn, Kho, Khách hàng — **không** vào Kế toán |
| Marketer (`marketer`) | — (khai khi cần) | Marketing, quảng cáo, kho của team |

**Phân quyền chặn ở máy chủ, không chỉ ẩn nút.** Luật ở `talpha_rules.json → access` (team →
nước, vai → tab); mỗi tài khoản trong `config/users.json` mang `role` + `teams` (sửa ở `/admin` →
Quản lý User; đăng nhập bằng **tên đăng nhập + mật khẩu**, mỗi người một tài khoản). Cửa vào là
`dashboard-ui/src/proxy.ts`: chưa đăng nhập thì không trang nào, API nào mở; route một nước (sổ
đơn, đối soát, vận đơn) bị từ chối nếu nước không thuộc team, và tab mở thẳng ở nước đầu tiên
của team; route gộp nhiều nước (sheet-report, pnl-costs, product-pnl, inventory, marketer-perf,
ad-spend, realtime, `/api/query`) tự cắt theo team — chi tiêu Meta theo nước ở tên campaign, đơn
theo shop; `/api/query` thay mỗi bảng trong câu SQL bằng câu con đã lọc nước
(`lib/talpha/access-rules.ts → scopeQuery`). Bot Zalo và việc nền gọi API bằng **chìa nội bộ**
`data/.internal_token` (dashboard tự sinh lúc khởi động; `ops/zalo-alerts/config.js` tự gắn vào
mọi lượt gọi). Phân quyền chỉ có tác dụng khi `DASHBOARD_PUBLIC` tắt (tắt từ 05/10/2026).

Mỗi nước một shop POS Poscake — Đài "TAIWAN SỸ ANH" 1022091930 · Singapore 715135541 ·
UAE 101090498 (đổi 25/09/2026) · 8 tài khoản quảng cáo Meta đọc được, chạy chung cho mọi nước. Tỷ giá:
**800đ/TWD**, **20.000đ/SGD**, **7.000đ/AED**.

**Singapore chỉ tính đơn tạo từ 14/09/2026** (`markets.Singapore.orders_from`): lúc nối,
shop có 54 đơn là bản sao đơn Đài (cùng SĐT, cùng phút tạo). Số chia tiền Singapore và
UAE đặt 100 nhưng **chưa đo** trên đơn SGD/AED thật — có đơn đầu tiên thì soát lại (log
sync cảnh báo "số chia CHƯA ĐO" ngay khi shop có đơn ghi SGD/AED có tiền).

**Nước nằm ở `config/talpha_rules.json → markets`**, mỗi nước một khối có `status`:
`dang_ban` (đã nối shop, có tỷ giá và số chia — số tiền được tính) hoặc `sap_chay` (máy
đã nhận ra trong tên campaign nên chi tiêu tách đúng nước, nhưng chưa kéo đơn, chưa
tính tiền). Chi tiêu quảng cáo gán về nước bằng **ô đầu tên campaign** (`TW` · `SG` ·
`AE`); tên cũ không ghi nước tính về Đài. Đơn gom ngày theo **giờ Việt Nam** cho cả ba
nước. Kế hoạch mở rộng: trang "TALPHA ba thị trường".

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
            tab Tiền COD về   ◄──── khớp mã vận đơn ────►  6 tab đọc BigQuery
```

Ba câu hỏi tiền, ba màn hình khác nhau — **đừng trộn**:

| Câu hỏi | Màn hình | Nguồn |
|:--|:--|:--|
| Bán được bao nhiêu? | Tổng quan | File Sheet **TỔNG TEAM** — doanh số đơn đã chốt + DS giao TC |
| Lãi gộp tạm tính? | P&L | Sheet TỔNG TEAM + giá vốn (mã SP trên đơn POS × bảng Giá tới Taiwan) + phí ship ước tính (trung bình sao kê NAZA) |
| Đang tiêu bao nhiêu, ngay lúc này? | Ads Command Center | Meta + POS **gọi thẳng**, đơn **ĐÃ ĐẶT** |
| Tiền có về đủ không? | Kế toán: Tiền COD về · Thanh toán quảng cáo | File sao kê người dùng tải lên |

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
| Tiền COD về | Sao kê NAZA (xlsx) + Google Sheet tiền hàng (chỉ đọc) | `data/cod_statements.json` |
| Thanh toán quảng cáo | Chi phí TKQC + sao kê thẻ | `data/ads_recon.json`, `data/ads_recon_kho.json` |
| Theo dõi vận đơn · Sổ đơn hàng | Bảng đơn của đối tác (Google Sheet) — **tự nạp 6h sáng**, hoặc bấm “Đọc bảng đối tác” | `data/tracking.json` |

`data/` nằm **ngoài git** (có số tiền thật). `ops/deploy/from-mac.sh` chép nó lên
máy chủ, và **dừng lại báo lỗi** nếu chép trượt.

---

## 4. Màn hình — 7 nhóm, 13 tab

Vào `/` → `proxy.ts` kiểm đăng nhập → `/talpha` → `components/talpha/dashboard-shell.tsx` (menu
chỉ hiện tab tài khoản được xem — `/api/talpha/me`).

| Nhóm | Tab | Component | Số từ đâu |
|:--|:--|:--|:--|
| 📋 Báo cáo | Tổng quan | `tabs/ceo-overview-tab.tsx` | `/api/talpha/sheet-report?from&to` (đọc thẳng file TỔNG TEAM) + `targets` |
| | P&L | `tabs/pnl-tab.tsx` | `sheet-report?from&to` + `pnl-costs` |
| | P&L theo SP | `tabs/product-pnl-tab.tsx` | `/api/talpha/product-pnl` (đơn đã chốt × giá vốn × ads theo mã SP trong tên camp) |
| 🧾 Đơn hàng | Sổ đơn hàng (+ khung Đòi tiền NAZA) | `tabs/order-ledger-tab.tsx` · `tabs/order-ledger-market.tsx` | `/api/talpha/order-ledger` + `cod-actions` (Đài) · `order-ledger/market` (Singapore, UAE) |
| | Theo dõi vận đơn | `tabs/tracking-tab.tsx` | `/api/talpha/tracking` |
| 💼 Kế toán | Tiền COD về | `tabs/cod-recon-tab.tsx` | `/api/talpha/order-ledger` + `cod-recon` + `cod-actions` (Đài) · `cod-recon/market` (Singapore, UAE) |
| | Thanh toán quảng cáo (chỉ giám đốc) | `tabs/ads-recon-tab.tsx` | `/api/talpha/ads-recon` |
| 📦 Sản phẩm | Sản phẩm & Kho | `tabs/products-tab.tsx` | `/api/talpha/inventory` |
| 👤 Marketer | Marketing & Ads | `tabs/marketing-tab.tsx` | `/api/query` (số Meta) + `sheet-report?from&to` (từng người, KPI) |
| 🎯 Quảng cáo | Chi phí quảng cáo | `tabs/ad-spend-tab.tsx` | `/api/talpha/ad-spend` |
| | Ads Command Center | `app/talpha/ads-command-center/page.tsx` | `/api/talpha/realtime` |
| | Sức khoẻ quảng cáo | `tabs/ad-health-tab.tsx` | `/api/query` |
| 👥 Khách hàng | Khách hàng · Market Intel | `tabs/customer-tab.tsx` · `market-intel-tab.tsx` | `/api/query` |

Ngoài shell còn `/login` và `/admin` (người dùng + TKQC).

**Mốc gốc 15/09/2026** (`talpha_rules.json → report_start_date`, Sỹ Anh chốt 25/09/2026):
tab Tổng quan · P&L · P&L theo SP · Marketing · Chi phí quảng cáo không tính ngày trước mốc
(`FLOOR_TABS` trong shell) — bộ chọn ngày mặc định từ mốc, chọn sớm hơn thì tự kéo về. Tab
vận hành (Sổ đơn, Tiền COD về, Vận đơn, Kho, Khách hàng) không chặn: đơn cũ còn chờ thu tiền.

**Tổng quan đọc thẳng Sheet, không tự tính.** Trước 25/09/2026 tab tính lại từ BigQuery theo
luật riêng (doanh thu chỉ đơn đã giao, tên marketer là tên tài khoản POS, không mốc ngày) nên
lệch Sheet cả trăm triệu. Muốn đổi cách tính thì sửa `format_all.py` — Sheet, bot Zalo và
tab đổi theo cùng lúc.

Ba tab **bỏ qua bộ chọn ngày** (`IGNORES_DATE_RANGE`): Ads Command Center và Sức khoẻ
quảng cáo có cửa sổ thời gian cố định trong view; Thanh toán quảng cáo lấy kỳ từ chính
file sao kê.

**Mục Kế toán (Sỹ Anh chốt 07/10/2026)** = Tiền COD về (tên cũ "Đối soát COD") + Thanh toán
quảng cáo (tên cũ "Đối soát chi phí QC"). Hai màn cùng trả lời *tiền thật có khớp không*, cùng
cách làm (tải sao kê → máy soát → gõ số ngân hàng), cùng tính theo kỳ.

* Tiền COD về: leader nước đó + giám đốc kiểm soát chung — leader xem, tải sao kê NAZA, nhập
  tiền về. Không có vai trò kế toán riêng. Sale không vào; ghi tiền về / hỏi / bỏ qua khoản
  lệch bị chặn ở `cod-actions` (`ghiCodDuoc` trong `access-rules.ts`).
* Đòi NAZA tiền đơn quá hạn **ở lại Sổ đơn hàng** (khung "Đòi tiền NAZA"): việc theo từng đơn,
  cần tên khách + số điện thoại ngay cạnh, và sale cũng phải làm được. Lần đầu tách Đơn hàng /
  Đối soát đã phải gộp lại vì người dùng nhảy qua nhảy lại giữa hai màn cho cùng một đơn.
* Thanh toán quảng cáo vẫn chỉ giám đốc: thẻ và TKQC chạy chung cả công ty, không chia theo team.
  Không đặt tên "Chi phí quảng cáo" — trùng tab trong mục Quảng cáo (*tiêu bao nhiêu, ROAS*),
  trùng tên là sớm muộn có người đem số đối soát đi tính ROAS.

---

## 5. Tầng API

### `/api/query` — cổng SQL dùng chung của 6 tab BigQuery

Chỉ nhận `SELECT` / `WITH`; chặn `;` và toàn bộ DDL/DML bằng danh sách từ khoá cấm.
Phải đăng nhập (proxy.ts). Người chỉ xem một phần nước: mỗi bảng trong câu bị thay bằng câu con
đã lọc nước (`vw_orders_std.market`, `sale_order.shop_label`, `order_items` theo shop, chi tiêu
Meta theo nước ở tên campaign); bảng gộp mọi nước (`vw_attribution_quality`) và mọi đường vòng
(dataset khác, `INFORMATION_SCHEMA`, chú thích `#`, ký tự thoát) bị từ chối.

### `/api/talpha/*`

| Route | Việc | Ai gọi |
|:--|:--|:--|
| `realtime` | Meta + POS live, dựng số Ads Command Center | Giao diện, bot WA |
| `inventory` | Tồn kho POS live; POS chết → snapshot BQ | Giao diện, bot WA |
| `order-ledger` | Sổ đơn Đài: mỗi đơn một dòng, khách + tiền + vòng đời (bảng NAZA + sao kê) | Giao diện |
| `order-ledger/market?market=SG\|AE` | Sổ đơn Singapore, UAE (29/09/2026): đơn + khách + hàng + trạng thái giao + đèn việc phải làm; cùng nguồn `loadMarketShipments` với Theo dõi vận đơn và Tiền COD về. Hàng: Sing ở cột SKU bảng đối tác, UAE ở `order_items`. Chưa có sao kê nên chưa có cột tiền về | Giao diện (nút Đài Loan / Singapore / UAE) |
| `cod-recon` | Khớp sao kê 3PL với đơn đã giao | Giao diện |
| `cod-recon/market?market=SG\|AE` | Tiền COD về nước ngoài Đài, bước 1 (26/09/2026): tiền còn ở đâu — đã giao / chưa giao / hoàn-huỷ. SG đọc bảng đối tác + 17TRACK, UAE (từ 28/09/2026) đọc đơn POS + trạng thái tra ở WeShip — cả hai chung `lib/talpha/tracking-market.ts` với Theo dõi vận đơn. Bước 2 (08/10/2026): POST tải sao kê / DELETE xoá kỳ, kho riêng `data/cod_statements_<sg|ae>.json`, nhận file NAZA hoặc bảng .xlsx/.csv có mã vận đơn + tiền COD, khớp từng đơn (`lib/talpha/cod-statement-market.ts`); sổ cùng bố cục Đài — việc hôm nay, ngân hàng, luồng tiền, máy soát, tỷ giá (`lib/talpha/cod-so-nuoc.ts`, ghi việc qua `cod-recon/market/actions`) — xem `docs/DOI_SOAT_COD.md` | Giao diện (nút Đài Loan / Singapore / UAE, nút “Tải sao kê …”) |
| `tracking` · `tracking/import` | 17TRACK + nạp bảng đơn đối tác. `?market=SG`: Singapore sổ riêng (`data/tracking_sg.json`), đơn đọc từ BigQuery `partner_orders`. `?market=AE` (28/09/2026): UAE không có bảng đối tác, 17TRACK không có hãng — đơn đọc từ POS (mã AWB ở `sale_order.partner → extend_code`), POST tra thẳng trang WeShip `portal.weshipme.com/tracking` (`lib/talpha/weship.ts`, miễn phí, không quota), sổ `data/tracking_ae.json` | Giao diện (nút Đài Loan / Singapore / UAE, nút “Tra WeShip”) · `talpha-tracking.timer` 6h + 21:30 (nạp bảng Đài + đồng bộ từng nước) · bot Zalo 08:30 + 22:00 (mỗi nước một tin, vào nhóm "ADS + VẬN ĐƠN" của nước đó) |
| `ads-recon` | Đối soát chi phí TKQC với sao kê thẻ | Giao diện |
| `cod-actions` | Đánh dấu đã đòi / đã nhận tiền | Giao diện |
| `ad-spend` · `marketer-perf` · `product-costs` · `targets` | Số phụ trợ cho tab | Giao diện |
| `ceo-ask` | Hỏi đáp bằng LLM → sinh SQL | Giao diện |
| `export-report` | Nút "Xuất Sheet" → chạy thẳng `format_all.py` (**đang hỏng**, xem mục 7) | Giao diện |
| `sync-inventory` | Ghi snapshot tồn kho làm dự phòng cho tab Kho | `snapshot_cron.sh` (chưa hẹn giờ) |
| `ads-alerts` · `sync-health` | Cảnh báo spend, sức khoẻ sync | Bot Zalo · bot WA (đang tắt) |
| `sheet-report` | Số từ file TỔNG TEAM — `?date=` một ngày, `?from&to=` cộng cả khoảng | Bot Zalo · tab Tổng quan |
| `report-config` | Mốc gốc báo cáo cho bộ chọn ngày | Giao diện |
| `pnl-costs` | Giá vốn + phí ship ước tính của đơn đã chốt, theo ngày và nước; liệt kê mã chưa có giá | Tab P&L · Tổng quan |
| `product-pnl` | P&L từng sản phẩm: doanh số chia theo số lượng, ads theo mã SP trong tên campaign | Tab P&L theo SP |
| `billing` | Hạn mức, số dư TKQC | Bot WA (đang tắt) |

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

`partner_orders` — bảng đơn của đối tác 3PL (Google Sheet) chép vào BigQuery mỗi vòng
talpha-sync: mã vận đơn, ngày xuất kho, trạng thái giao, COD đối tác thu (đơn vị gốc, cột
`currency`). Khai bảng ở `talpha_rules.json → partner_orders.sheets`; hiện có Singapore
("BS UP DATA SGP", 25/09/2026). Bảng phải chia sẻ quyền Người xem cho tài khoản dịch vụ.

---

## 7. Cái gì chạy ở đâu

| Thành phần | Nơi chạy | Khởi động bằng |
|:--|:--|:--|
| Dashboard | VPS `139.180.131.21:3000`, `/opt/talpha` | pm2 `talpha-dashboard` — `ops/pm2/ecosystem.vps.config.js` |
| HTTPS + app cài được (PWA) | `https://139.180.131.21` (06/10/2026) — nginx 443 → `127.0.0.1:3000` | `ops/deploy/nginx-talpha-https.conf`, `vps-setup.sh` tự chép mỗi lần deploy. Dùng chung chứng chỉ Let's Encrypt **cho IP** (hạn 6 ngày, `certbot-renew.timer` của AI Sale gia hạn). App: `src/app/manifest.ts`, `public/sw.js` (KHÔNG lưu số liệu — chỉ trang mất mạng), nút "Cài app" `components/talpha/cai-app.tsx`. Điện thoại chỉ cài được qua HTTPS |
| Kéo số vào BigQuery | VPS, mỗi giờ phút :00 | systemd `talpha-sync.timer` → `sync/talpha/talpha_sync.py` |
| Ghi Google Sheets | VPS, mỗi giờ phút :20 | systemd `talpha-report.timer` → `/root/talpha_reports/daily_guarded.sh` |
| Nạp bảng đơn đối tác | VPS, 6h sáng mỗi ngày | systemd `talpha-tracking.timer` → `ops/deploy/tracking-import.sh` (gọi route `tracking/import`) |
| Bot Zalo ads + vận đơn | VPS — MỖI NƯỚC MỘT NHÓM "ADS + VẬN ĐƠN TAIWAN · SGP · UAE · JAPAN" (08/10/2026; bỏ nhóm BÁO CÁO ADS gộp + 3 nhóm VẬN ĐƠN cũ): ads 08:30 · 13:00 · 18:00 · 22:00, vận đơn 08:30 · 22:00, lệnh `/baocao` `/canhbao` `/vandon` trả số đúng nước của nhóm. Số theo nước × người đọc `data/bao_cao_nuoc/<tháng>.json` do `format_all.py` ghi cùng lúc file TỔNG TEAM | pm2 `talpha-zalo-alerts` — nick Zalo phụ ghép 15/09/2026; bot tự nhận nhóm theo tên; ghép lại, đổi nhóm: `ops/zalo-alerts/README.md` |
| Bot cảnh báo WhatsApp | — | **Tắt**. Code ở `ops/whatsapp-alerts/`, cách bật trong `ops/pm2/README.md` |
| Máy Mac | Máy dev | `cd dashboard-ui && npm run dev`. Không job nền nào. |

**Việc nền đang hỏng hoặc chưa có lịch chạy** — soát 13/09/2026, để lại xử lý sau.
Chúng chưa từng chạy lần nào trong dự án mới:

| Thứ | Tình trạng thật |
|:--|:--|
| `ops/talpha_reports/snapshot_cron.sh` | `inventory_snapshot` không được làm tươi — đó là đường dự phòng của tab Kho khi POS chết |
| `ops/talpha_reports/catalog_cron.sh` | `product_catalog` **0 dòng từ ngày dựng dự án** → giá vốn trong `vw_orders_std` luôn 0 (tab P&L và P&L theo SP không còn dựa vào nó từ 25–28/09/2026 — giá vốn tính ở `lib/talpha/order-costs.ts`). Script ghi cứng Python ở `runtime/.venv`, trên VPS là `/opt/talpha/.venv` nên chết ngay |
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
ops/zalo-alerts/         bot báo cáo ads vào nhóm Zalo
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

**Nút WhatsApp — chỉ UAE** (Sỹ Anh chốt 29/09/2026): Sổ đơn UAE có cột ghim “Xác nhận khách”,
Theo dõi vận đơn UAE có nút to dưới mỗi khách. Bấm là mở `wa.me/<số quốc tế>` kèm tin xác nhận
đơn soạn sẵn tiếng Anh (hàng, tiền COD, địa chỉ POS, hỏi giờ giao — `tinXacNhan`). Bật/tắt từng
nước ở `talpha_rules.json → markets.*.phone.whatsapp` (Đài, Singapore: false). Số chuẩn hoá ở
`lib/talpha/whatsapp.ts` (mã nước, độ dài số trong nước, số 0 đầu); số không khớp luật thì
không có nút, để khỏi nhắn nhầm người.

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
