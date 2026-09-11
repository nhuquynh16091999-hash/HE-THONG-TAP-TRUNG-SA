# TALPHA — Hệ thống tập trung

Dashboard vận hành cho đội Tiểu Alpha: bán trang sức và mỹ phẩm qua Facebook Ads
+ chat-sale + COD tại **thị trường Đài Loan**.

> Dự án độc lập, dựng lại 05/09/2026. Không liên quan tới repo cũ.

Bản đồ nghiệp vụ đầy đủ: **[DASHBOARD_MAP.md](DASHBOARD_MAP.md)**.

---

## Cơ cấu

| Vai trò | Số người | Thấy gì |
|:--|:--|:--|
| Giám đốc | 1 | Toàn bộ số liệu, quản lý người dùng |
| Marketer | 6 | Báo cáo, chi phí quảng cáo của mình |
| Sale | 2 | Đơn hàng, đối soát COD |

Một thị trường: **Đài Loan** (TWD, tỷ giá 800đ, một shop POS, 10 TKQC Meta).

---

## Chạy

```bash
cd dashboard-ui
npm install
cp .env.example .env.local     # rồi điền khoá — xem bảng bên dưới
npm run dev                    # http://localhost:3000
```

Kiểm tra trước khi commit:

```bash
cd dashboard-ui && npm test    # logic đối soát COD, đối soát ads, sổ đơn, vận đơn
python3 -m pytest tests/       # rule nghiệp vụ (tỷ giá, số chia, trạng thái đơn)
```

Deploy lên máy chủ — chạy **từ máy Mac**:

```bash
bash ops/deploy/from-mac.sh
```

### Khoá cần có

| Khoá | Không có thì mất gì |
|:--|:--|
| `GCP_SA_KEY_JSON` (hoặc `bigquery_key.json` ở gốc repo) | 6 tab đọc BigQuery trống |
| `TALPHA_META_ACCESS_TOKEN` | Chi phí quảng cáo, Ads Command Center |
| `TALPHA_POSCAKE_TW_KEY` | Tab Sản phẩm & Kho |
| `GEMINI_API_KEY` | Tính năng "CEO hỏi" (tuỳ chọn) |

---

## Màn hình

| Nhóm | Tab |
|:--|:--|
| 📋 Báo cáo | Tổng quan · P&L · P&L theo sản phẩm |
| 🧾 Đơn hàng & Đối soát | Sổ đơn hàng · **Đối soát COD** · Theo dõi vận đơn |
| 📦 Sản phẩm | Sản phẩm & Kho |
| 👤 Marketer | Marketing & Ads |
| 🎯 Quảng cáo | Chi phí quảng cáo · Ads Command Center · Sức khoẻ quảng cáo |
| 💳 Đối soát chi phí QC | **Đối soát chi phí quảng cáo** |
| 👥 Khách hàng | Khách hàng · Market Intel |

**Đối soát COD** — tải file sao kê của 3PL (CSV/TSV; Excel thì xuất CSV trước), hệ
thống khớp theo mã vận đơn với đơn đã giao và chia làm bốn nhóm: khớp · lệch tiền ·
**chưa về tiền** (tiền còn treo ở 3PL) · thừa ở sao kê. Tên cột của 3PL khai ở
`config/talpha_rules.json → cod_settlement.column_map`.

**Đối soát chi phí quảng cáo** — tải bản kê chi phí TKQC và sao kê thẻ, hệ thống bắt
trừ trùng, phí ẩn, hoá đơn Failed mà thẻ vẫn trừ, và TKQC ngoài danh sách. Không đụng
BigQuery lẫn POS nên chạy được cả khi hai thứ kia chết.

---

## Cấu trúc

```
dashboard-ui/        Next.js 16 + React 19 — toàn bộ giao diện và API
  src/app/api/talpha/  route nghiệp vụ (orders · ad-spend · cod-recon · …)
  src/lib/talpha/      rule gán người, logic đối soát, kho JSON có khoá file
config/              talpha_rules.json — NGUỒN RULE DUY NHẤT
sync/                engine sync POS + Meta → BigQuery (bản duy nhất)
ops/deploy/          script dựng và cập nhật máy chủ
ops/pm2/             ecosystem.vps.config.js — file pm2 duy nhất
ops/talpha_reports/  đường ống báo cáo Google Sheets, chạy theo giờ
ops/whatsapp-alerts/ bot cảnh báo (đang tắt)
sql/talpha/          định nghĩa view BigQuery
docs/                TALPHA_METRIC_RULES.md là source of truth về chỉ số
```

---

## Ba rule dễ tính sai nhất

1. **Doanh thu** = tổng `cod ÷ số chia của shop`, chỉ đơn `GIAO_THANH_CONG` và `cod > 0`.
   Shop Đài lưu **nguyên TWD** nên số chia là **1**, không phải 100. Gõ `/100` là
   tiền tụt đúng 100 lần.
2. **Chi phí quảng cáo đã là VND** — không quy đổi thêm lần nào. Cột ngày là `date`,
   không phải `date_start`.
3. **Chẩn đoán số sai: không bao giờ so Sheet với BigQuery** — cùng nguồn nên cùng
   sai. Đối chiếu thẳng Meta API cho chi phí và POS API cho đơn.

---

## Còn nợ

Xem mục 10 của [DASHBOARD_MAP.md](DASHBOARD_MAP.md), và `config/talpha_rules.json → _todo`.
