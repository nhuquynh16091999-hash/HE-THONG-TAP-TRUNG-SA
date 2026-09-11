---
name: talpha-system
description: Bản đồ hệ thống + rule chỉ số + bẫy vận hành của TALPHA (dashboard ads Đài Loan, báo cáo Google Sheets, tồn kho, đối soát COD và chi phí quảng cáo, BigQuery cty-507710.TALPHA_Dataset). LUÔN dùng skill này TRƯỚC KHI làm bất cứ việc gì đụng tới số liệu, dashboard, sheet báo cáo, sync, tồn kho, hay chẩn đoán "số sai/thiếu/lệch" trong dự án TALPHA — kể cả khi user chỉ hỏi "sao spend hôm nay thiếu", "đơn của X đâu", "thêm TKQC mới", "sửa báo cáo". Không đọc skill này trước khi sửa code liên quan số liệu = rủi ro phá rule đã được CEO duyệt.
---

# TALPHA System — bản đồ hệ thống & rule chỉ số

Bán trang sức/mỹ phẩm qua Facebook Ads + chat-sale + COD tại **Đài Loan** (một thị
trường duy nhất từ 05/09/2026). Hệ thống = dashboard + báo cáo Google Sheets + tồn kho
+ hai màn đối soát tiền, xoay quanh BigQuery **`cty-507710.TALPHA_Dataset`**.

Bản đồ nghiệp vụ đầy đủ trong repo: **`DASHBOARD_MAP.md`** — đọc nó trước.

## 1. Cái gì chạy ở đâu

```
Meta API (10 TKQC) ─┐
                    ├─ talpha-sync.timer  :00 ─► BigQuery ─┬─ /api/query ─► 6 tab báo cáo
POS Poscake (1 shop)┘                                      │
                      talpha-report.timer :20 ─────────────┴─ format_all.py ─► Google Sheets

Meta API + POS ──live──► /api/talpha/realtime   ─► Ads Command Center
POS            ──live──► /api/talpha/inventory  ─► tab Sản phẩm & Kho
File tải lên   ────────► /api/talpha/{cod-recon, ads-recon, tracking} ─► 3 màn đối soát
```

| Thành phần | Chạy ở đâu |
|---|---|
| Dashboard | VPS `139.180.131.21:3000`, `/opt/talpha`, pm2 `talpha-dashboard` |
| Sync vào BigQuery | VPS, systemd `talpha-sync.timer` → `/opt/talpha/sync/talpha/talpha_sync.py` |
| Ghi Google Sheets | VPS, systemd `talpha-report.timer` → `/root/talpha_reports/daily_guarded.sh` |
| Bot WhatsApp | **Tắt** — code ở `ops/whatsapp-alerts/`, cách bật ở `ops/pm2/README.md` |
| Máy Mac | Chỉ là máy dev. Không pm2, không launchd, không cron. |

**Deploy = `bash ops/deploy/from-mac.sh` TỪ MÁY MAC.** `git pull` trên VPS không chạy
được (không có khoá GitHub) và vẫn in `origin/main` cũ nên trông như đã mới nhất.
`npm run build` ở Mac chỉ đổi bản localhost, không phải deploy.

## 2. Rule chỉ số BẮT BUỘC (CEO đã duyệt — sai = số bậy)

1. **Doanh thu** = `SUM(cod ÷ SỐ CHIA CỦA SHOP)` WHERE `status_category='GIAO_THANH_CONG'
   AND cod>0`. KHÔNG dùng `total_price`. "GTC hôm nay ≈ 0" là ĐÚNG (COD trễ), không phải bug.
   ⚠️ **Số chia KHÔNG phải lúc nào cũng 100**: shop Đài lưu **NGUYÊN TWD** (cod=950 ⇒
   950 TWD) → ÷1. Gõ `/100` cứng = tiền tụt đúng 100 lần (đã dính 20/08, AOV ra 8.987đ).
   Bảng số chia: `config/talpha_rules.json → markets.*.pos_money_divisor`, đọc qua
   `posMoneyDivisor()`. Thêm shop mới: lấy đơn thật từ POS API so với giá bán thật rồi mới khai.
2. **Tỷ giá → VND**: TW **800**. Khai ở `talpha_rules.json → markets.Taiwan.rate_vnd`.
3. **Chi phí quảng cáo ĐÃ là VND** (không ÷100, không quy đổi). Cột `date`, không phải `date_start`.
4. **Marketer của đơn** — rule 3 bậc: (a) tag POS `JSON_EXTRACT_SCALAR(marketer,'$.name')`;
   (b) không tag/ngoài team → `ad_id` → chủ campaign; (c) vẫn không → "(không gán)".
   KHÔNG bỏ đơn lặng lẽ.
5. **Join ads↔đơn**: `CAST(fb_ads_data.ad_id AS STRING) = sale_order.ad_id`.
6. **Timezone**: `inserted_at` là UTC. Sheet gom đơn theo VN+7; spend theo tz từng TKQC
   → **từng ngày lệch, cả tháng khớp**. Không phải bug.
7. **Campaign chứa từ "test"** (đứng riêng) → tách khỏi mọi báo cáo doanh số.
8. Một TKQC chứa campaign của NHIỀU marketer và ngược lại — đừng coi tổng account =
   spend một người.

Văn bản đầy đủ: `docs/TALPHA_METRIC_RULES.md`.

## 3. Bẫy — đọc trước khi sửa code

1. **Chẩn đoán "số sai": KHÔNG BAO GIỜ so Sheet ↔ BigQuery** — cùng nguồn, cùng sai.
   Ground truth: spend = Meta API trực tiếp (`ops/talpha_reports/check_meta_token.py`);
   đơn = POS API live.
2. **Sheet lệch dashboard là CỐ HỮU** — sync theo giờ vs gọi live; tag POS vs `ad_id`;
   timezone từng TKQC vs ngày VN. Đừng "fix cho khớp" từng ngày.
3. **Ads Command Center dùng doanh thu ĐẶT, tab BigQuery dùng GIAO THÀNH CÔNG** →
   ROAS hai nơi khác bản chất, không so trực tiếp.
4. **BigQuery gói miễn phí: KHÔNG streaming, KHÔNG DML** — chỉ LOAD JOB
   (`WRITE_TRUNCATE` atomic). Pattern `bq rm` trước khi sync bị CẤM: fetch chết giữa
   chừng là mất trắng dữ liệu (đã xảy ra 06/07).
5. **`talpha-report` không ghi Sheet khi sync hỏng** (chốt 03/09). Giữ số cũ đúng hơn
   là ghi đè bằng số thiếu — spend nằm ở mẫu số nên Sheet sai theo hướng **đẹp giả**.
6. **Danh sách TKQC vẫn nằm ở nhiều nơi**: `config/projects/talpha.yaml` (dashboard đọc),
   `ops/talpha_reports/ad_accounts.json` (sync đọc), `sync/core/meta_client.py`.
   Thêm TKQC mà thiếu một chỗ = undercount spend âm thầm.
7. **Logic gán marketer vẫn bị nhân bản** (`format_all.py`, realtime route, bot WA,
   `talpha-inventory.ts`) — regex khác nhau, output khác nhau (`Loc` vs `Lộc`).
   Sửa mapping một chỗ KHÔNG lan sang chỗ khác.
8. **Bẫy Unicode tên**: POS lưu "Chu Thuý" (sắc trên Y) ≠ "Thúy" — match bằng `"THU"`.
9. Chi tiết đầy đủ: `references/landmines.md`.

## 4. Thao tác vận hành

Thêm TKQC, chữa số thiếu, re-sync tay, xử lý lock kẹt, vị trí log — `references/runbook.md`.

## 5. Tài liệu gốc trong repo

- `DASHBOARD_MAP.md` — bản đồ nghiệp vụ, đọc trước tiên
- `docs/TALPHA_METRIC_RULES.md` — rule chỉ số + quy trình chẩn đoán (source of truth)
- `docs/DEPLOY_VPS.md` — dựng và cập nhật máy chủ
- `docs/DOI_SOAT_COD.md` — nghiệp vụ đối soát COD
- `docs/CHUAN_DAT_TEN_CAMPAIGN.md` — quy ước tên campaign (quyết định gán marketer)
