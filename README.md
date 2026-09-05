# TALPHA — Hệ thống tập trung

Dashboard vận hành cho đội Tiểu Alpha: bán trang sức và mỹ phẩm qua Facebook Ads
+ chat-sale + COD tại **thị trường Đài Loan**.

> Dự án độc lập, dựng lại 05/09/2026. Không liên quan tới repo cũ.

---

## Cơ cấu

| Vai trò | Số người | Thấy gì |
|:--|:--|:--|
| Giám đốc | 1 | Toàn bộ số liệu, quản lý người dùng |
| Marketer | 5 | Báo cáo, chi phí quảng cáo của mình |
| Sale | 2 | Đơn hàng, đối soát COD |

Một thị trường: **Đài Loan** (TWD, tỷ giá 800đ, một shop POS).

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
cd dashboard-ui && npm test    # logic đối soát COD
python3 -m pytest tests/       # rule nghiệp vụ (tỷ giá, số chia, trạng thái đơn)
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
| 🧾 Đơn hàng | Danh sách đơn · **Đối soát COD** |
| 📦 Sản phẩm | Sản phẩm & Kho |
| 👤 Marketer | Marketing & Ads |
| 🎯 Quảng cáo | **Chi phí quảng cáo** · Ads Command Center · Sức khoẻ quảng cáo |
| 👥 Khách hàng | Khách hàng · Market Intel |

**Đối soát COD** — tải file sao kê của đơn vị vận chuyển (CSV/TSV; Excel thì xuất
CSV trước), hệ thống khớp theo mã vận đơn với đơn đã giao và chia làm bốn nhóm:
khớp · lệch tiền · **chưa về tiền** (tiền còn treo ở 3PL) · thừa ở sao kê.
Tên cột của 3PL khai ở `config/talpha_rules.json → cod_settlement.column_map`.

---

## Cấu trúc

```
dashboard-ui/        Next.js 16 + React 19 — toàn bộ giao diện và API
  src/app/api/talpha/  route nghiệp vụ (orders · ad-spend · cod-recon · …)
  src/lib/talpha/      rule gán người, logic đối soát, kho JSON có khoá file
config/              talpha_rules.json — NGUỒN RULE DUY NHẤT
sync/                sync POS + Meta → BigQuery
ops/talpha_reports/  báo cáo Google Sheets chạy theo giờ
ops/whatsapp-alerts/ bot cảnh báo
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

Bản đồ hệ thống đầy đủ: [DASHBOARD_MAP.md](DASHBOARD_MAP.md).

---

## Còn nợ

- **Phí 3PL Đài Loan chưa khai** (`config/talpha_rules.json → shipping_fees.TW`).
  Đài từng là thị trường test nên chưa ai chốt phí. Giờ là thị trường duy nhất —
  chưa khai thì mọi con số lãi/lỗ đang thiếu phí vận chuyển, và dashboard hiện
  chi phí vận chuyển bằng 0 (thiếu, chứ không phải không mất phí).
- **Danh sách 5 marketer và 2 sale đang là tạm** — xem `_todo` trong rules file.
