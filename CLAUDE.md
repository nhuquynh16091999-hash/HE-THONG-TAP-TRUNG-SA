# TALPHA — hướng dẫn cho Claude Code

Dashboard vận hành cho đội Tiểu Alpha: bán trang sức và mỹ phẩm qua Facebook Ads +
chat-sale + COD tại **Đài Loan**. Một thị trường, một shop POS, 10 tài khoản quảng cáo.

**Đọc `DASHBOARD_MAP.md` trước khi sửa bất cứ thứ gì.** Nó là bản đồ nghiệp vụ: tiền
đi đường nào, số trên màn hình đến từ đâu, cái gì chạy ở đâu.

## Chạy

```bash
cd dashboard-ui && npm run dev          # http://localhost:3000
cd dashboard-ui && npm test             # 27 phép thử logic đối soát
python3 -m pytest tests/                # rule nghiệp vụ (tỷ giá, số chia, trạng thái đơn)
```

Deploy lên máy chủ — chạy **từ máy Mac**, không phải trên máy chủ:

```bash
bash ops/deploy/from-mac.sh
```

## Kiến trúc

* **Giao diện + API**: Next.js 16 App Router + React 19 + TailwindCSS, tất cả trong
  `dashboard-ui/`. Không có backend riêng.
* **Kho số**: BigQuery `cty-507710.TALPHA_Dataset`, đọc qua `/api/query`.
* **Nguồn thô**: Meta Marketing API và POS Poscake — vừa đồng bộ theo giờ vào BigQuery,
  vừa gọi thẳng cho các màn hình cần số tức thời.
* **Sync**: `sync/talpha/talpha_sync.py` + `sync/core/`, chạy bằng systemd trên VPS.
* **Đăng nhập**: NextAuth v5 (`lib/auth.ts`); danh sách người dùng qua `lib/users.ts`.

## Nguyên tắc cứng — vi phạm là số sai hoặc mất dữ liệu

* **Rule nghiệp vụ khai ở `config/talpha_rules.json`, KHÔNG gõ vào code.** Tỷ giá, số
  chia tiền POS, tên marketer, phí 3PL, ngưỡng ROAS đều ở đó. Phía TypeScript đọc qua
  `lib/talpha/rules.ts`; phía Python qua `ops/talpha_reports/talpha_rules.py`.
* **Đường dẫn cấu hình hỏi `lib/talpha/config-path.ts`**, đừng tự ghép `process.cwd()`.
* **Số chia tiền POS không phải lúc nào cũng 100.** Shop Đài lưu nguyên TWD nên chia 1.
  Dùng `posMoneyDivisor()`, đừng gõ `/100`.
* **Chi phí quảng cáo đã là VND.** Không quy đổi thêm lần nào.
* **BigQuery: không tự chạy DELETE / DROP / TRUNCATE.** Sync ghi WRITE_TRUNCATE atomic —
  fetch hỏng thì bảng cũ còn nguyên. Pattern drop-trước-khi-fetch bị CẤM (đã mất trắng
  dữ liệu ngày 06/07 vì nó).
* **Chỉ có MỘT engine sync**: `sync/talpha/talpha_sync.py`. Đừng chép bản thứ hai sang
  runtime — trước đây có hai bản cùng ghi một bộ bảng mỗi giờ và đè lẫn nhau.
* **Chỉ có MỘT file pm2**: `ops/pm2/ecosystem.vps.config.js`.
* **Không commit** `.env`, `bigquery_key.json`, `data/`, `config/manual_data/`.

## Chẩn đoán số sai

Không bao giờ so Google Sheet với BigQuery — cùng nguồn nên cùng sai. Đối chiếu thẳng:

```bash
# Token Meta còn sống không, TKQC nào đọc được
python3 ops/talpha_reports/check_meta_token.py

# Sync lần gần nhất
ssh root@139.180.131.21 'journalctl -u talpha-sync -n 40 --no-pager'

# Vòng ghi Sheet lần gần nhất
ssh root@139.180.131.21 'tail -40 /root/talpha_reports/daily_$(date +%Y%m%d).log'
```

Sheet lệch dashboard **là cố hữu**: sync theo giờ vs gọi live, gom đơn theo giờ VN vs
timezone từng TKQC. Đừng "fix cho khớp" từng ngày.

## Tài liệu

| File | Nội dung |
|:--|:--|
| `DASHBOARD_MAP.md` | Bản đồ nghiệp vụ — đọc trước tiên |
| `docs/TALPHA_METRIC_RULES.md` | Source of truth về công thức chỉ số |
| `docs/DEPLOY_VPS.md` | Dựng và cập nhật máy chủ |
| `docs/DOI_SOAT_COD.md` | Nghiệp vụ đối soát COD |
| `docs/CHUAN_DAT_TEN_CAMPAIGN.md` | Quy ước đặt tên campaign (quyết định gán marketer) |
| `ops/pm2/README.md` | pm2 và systemd timer |
| `ops/talpha_reports/README.md` | Đường ống báo cáo Google Sheets |
