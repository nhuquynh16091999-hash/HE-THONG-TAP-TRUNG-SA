# TALPHA — Hệ thống vận hành ANTALO

Dashboard cho đội ANTALO: bán hàng qua Facebook Ads → chat-sale → thu COD ở **5 nước**
(Đài Loan, Singapore, UAE, Nhật Bản, Việt Nam). File này là **sơ đồ luồng một trang**
(soát lại theo đúng code và máy chủ đang chạy, 12/11/2026). Chi tiết từng màn hình, từng
con số: **[DASHBOARD_MAP.md](DASHBOARD_MAP.md)**. Luật cho người sửa code: `CLAUDE.md`.

---

## 1. Năm thị trường

| Nước | Tiền (tỷ giá) | Shop POS | Giao hàng | Người cầm | Team |
|:--|:--|:--|:--|:--|:--|
| Đài Loan | TWD (800đ) | Đài | NAZA供应链 + 17TRACK | Sỹ Anh | Đông Á |
| Nhật Bản | JPY (160đ) | Nhật | NAZA + Japan Post (17TRACK) | Sỹ Anh | Đông Á |
| Singapore | SGD (20.000đ) | Singapore | 3PL Sing (bảng đối tác) | Thái | Đông Nam Á |
| UAE | AED (7.000đ) | UAE | D&T Fulfillment / WeShip | Lộc | Trung Đông |
| Việt Nam | VND | "VIỆT NAM" (hạt giống) | J&T, đọc thẳng từ đơn POS | — | Việt Nam |

Mọi con số này khai ở `config/talpha_rules.json` (`markets`, `access.teams`, `shipping_fees`).

---

## 2. Luồng của một đơn hàng

```
Facebook Ads ─► khách nhắn tin (Pancake / Botcake) ─► sale chốt đơn trên POS Poscake
                                                            │
                          ┌─────────────────────────────────┼──────────────────────────┐
                          ▼                                 ▼                          ▼
                 3PL nhận và giao hàng              theo dõi hành trình          POS đổi trạng thái
              (NAZA · 3PL Sing · D&T · J&T)      (17TRACK · WeShip · POS J&T)     đã giao / hoàn
                          │                                 │                          │
                          ▼                                 ▼                          ▼
               khách trả tiền cho shipper          tab Theo dõi vận đơn        sync mỗi giờ → BigQuery
                          │                        + tin Zalo vận đơn                  │
                          ▼                                                            ▼
               3PL chuyển tiền theo kỳ ─► tab Tiền COD về ◄── khớp mã vận đơn ──► Sổ đơn hàng
```

---

## 3. Ba đường số chảy vào dashboard

| Đường | Từ đâu → tới đâu | Dùng cho |
|:--|:--|:--|
| **Chốt số** (mỗi giờ) | Meta API + POS + bảng đơn đối tác → BigQuery → Google Sheet "TỔNG TEAM" | Tổng quan, P&L, Marketer, Lãi lỗ, tin Zalo |
| **Tức thời** | Meta API + POS gọi thẳng | Ads Command Center, Sản phẩm & Kho |
| **File tải lên** | Sao kê 3PL, sao kê thẻ, chi phí vận hành nhập tay → `data/*.json` | Tiền COD về, Thanh toán quảng cáo, Lãi lỗ |

Sheet "TỔNG TEAM" là **một nguồn chung** cho dashboard, file Sheet và bot Zalo, nên ba nơi
luôn cùng số.

---

## 4. Việc nền trên máy chủ (`139.180.131.21`, thư mục `/opt/talpha`)

| Khi nào | Việc | Chạy bằng |
|:--|:--|:--|
| Mỗi giờ, phút :00 | Kéo Meta + POS + bảng đối tác vào BigQuery | `talpha-sync.timer` → `sync/talpha/talpha_sync.py` |
| Mỗi giờ, phút :20 | Ghi Google Sheet + soát TKQC/shop mất số (không ghi nếu sync hỏng) | `talpha-report.timer` → `daily_guarded.sh` → `sync_month.py`, `format_all.py`, `report_account_health.py` |
| Mỗi giờ, phút :40 | Chụp tồn kho dự phòng | `talpha-snapshot.timer` → `snapshot_cron.sh` |
| Mỗi ngày 05:10 (giờ VN) | Danh mục sản phẩm POS → BigQuery | `talpha-catalog.timer` → `sync_product_catalog.py` |
| Mỗi ngày 06:00 và 21:30 (giờ VN) | Nạp bảng đơn đối tác vào sổ vận đơn | `talpha-tracking.timer` → `ops/deploy/tracking-import.sh` |
| Luôn chạy | Dashboard (Next.js, cổng 3000, HTTPS qua nginx) | pm2 `talpha-dashboard` |
| Luôn chạy | Bot Zalo: tin ads 08:30 · 13 · 18 · 22h, tin vận đơn 08:30 · 22h (giờ VN), mỗi nước một nhóm | pm2 `talpha-zalo-alerts` |

Máy Mac chỉ là máy dev, không chạy việc nền nào.

---

## 5. Màn hình

| Nhóm | Tab | Trả lời câu hỏi |
|:--|:--|:--|
| 📋 Báo cáo | Tổng quan · P&L · P&L theo SP | Bán được bao nhiêu, lãi gộp tạm tính |
| 🧾 Đơn hàng | Sổ đơn hàng · Theo dõi vận đơn | Đơn nào đang ở đâu, kiện nào kẹt |
| 💼 Kế toán | Lãi lỗ · Tiền COD về · Thanh toán quảng cáo | Lãi thật sau mọi khoản, tiền về đủ chưa |
| 📦 Sản phẩm | Sản phẩm & Kho | Còn hàng gì |
| 👤 Marketer | Marketing & Ads | Từng người chạy ra sao |
| 🎯 Quảng cáo | Chi phí QC · Ads Command Center · Sức khoẻ QC | Đang tiêu bao nhiêu, camp nào cần tắt |
| 👥 Khách hàng | Khách hàng · Market Intel | Khách mua lại, thị trường |

Phân quyền theo team: mỗi người chỉ thấy nước của team mình; giám đốc thấy hết
(`talpha_rules.json → access`, tài khoản ở `config/users.json` trên máy chủ).

---

## 6. Cấu trúc thư mục

```
config/talpha_rules.json   NGUỒN LUẬT DUY NHẤT: tỷ giá, phí 3PL, giá vốn, marketer, phân quyền
config/projects/           tài khoản quảng cáo Meta + shop POS
dashboard-ui/              Next.js 16 + React 19: toàn bộ giao diện và API
  src/app/api/talpha/        25 nhóm route nghiệp vụ
  src/lib/talpha/            logic thuần (đối soát, vận đơn, lãi lỗ, phân quyền), có test
  src/components/talpha/     các tab
sync/                      engine kéo số vào BigQuery (bản duy nhất)
ops/talpha_reports/        đường ống ghi Google Sheet + soát sức khoẻ dữ liệu
ops/zalo-alerts/           bot Zalo
ops/deploy/                script dựng và cập nhật máy chủ
ops/pm2/                   file pm2 duy nhất
sql/talpha/views/          định nghĩa view BigQuery
doi-soat-chi-phi-qc/       bản dòng lệnh của tab Thanh toán quảng cáo (dùng chung logic)
tests/                     phép thử luật nghiệp vụ Python
docs/                      công thức chỉ số, deploy, đối soát COD, quy ước tên camp
data/                      số thật (sao kê, sổ vận đơn), NGOÀI git, chép lên máy chủ khi deploy
```

---

## 7. Chạy, kiểm tra, deploy

```bash
cd dashboard-ui && npm run dev          # http://localhost:3000
cd dashboard-ui && npm test             # logic đối soát, vận đơn, sổ đơn, lãi lỗ, phân quyền
TALPHA_RULES="$PWD/config/talpha_rules.json" python3 -m pytest tests/
cd ops/zalo-alerts && npm test          # bot Zalo
```

Deploy từ máy Mac (máy chủ không tự `git pull` được):

```bash
git push origin main
KEY=~/.ssh/id_ed25519 GH_KEY=~/.ssh/id_ed25519 bash ops/deploy/from-mac.sh
ssh root@139.180.131.21 'bash /opt/talpha/ops/talpha_reports/deploy_runtime.sh --yes'   # khi sửa ops/talpha_reports hoặc luật
```

---

## 8. Ba luật dễ tính sai nhất

1. **Số chia tiền POS khác nhau theo shop**: Đài lưu nguyên TWD (chia 1), Singapore và UAE
   chia 100. Luôn dùng `posMoneyDivisor()`.
2. **Chi phí quảng cáo đã là VND**, không quy đổi thêm lần nào.
3. **Chẩn đoán số sai: không so Sheet với BigQuery** (cùng nguồn nên cùng sai). Đối chiếu
   thẳng Meta API cho chi phí và POS cho đơn.

Việc còn nợ: mục 10 của [DASHBOARD_MAP.md](DASHBOARD_MAP.md) và `talpha_rules.json → _todo`.
