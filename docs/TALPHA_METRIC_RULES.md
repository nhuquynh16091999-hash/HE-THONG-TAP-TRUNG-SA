# TALPHA — Rule chỉ số Ads & Đơn hàng (source of truth)

> Viết lại 11/09/2026 cho hệ **một thị trường Đài Loan**. Đọc file này TRƯỚC khi sửa
> bất cứ gì liên quan báo cáo Sheet / dashboard / sync. Rule đổi thì cập nhật file này.
>
> **Rule máy-đọc-được** nằm ở `config/talpha_rules.json` — file .md này giải thích
> VÌ SAO, file .json là cái code đọc. Sửa rule → sửa .json trước, đừng gõ lại vào code.
>
> Bản đồ hệ thống (cái gì chạy ở đâu): `DASHBOARD_MAP.md`.

## 1. Dòng dữ liệu

```
Meta API ──┐
           ├─ talpha-sync.timer :00 ─► BigQuery ─┬─ /api/query ────► 6 tab báo cáo
POS Poscake┘                                     │
             talpha-report.timer :20 ────────────┴─ format_all.py ─► Google Sheets

Meta API + POS ──live──► /api/talpha/realtime  ─► Ads Command Center
POS            ──live──► /api/talpha/inventory ─► tab Sản phẩm & Kho
```

**Engine sync chỉ có MỘT bản**: `sync/talpha/talpha_sync.py` + `sync/core/*`.
Trước 11/09/2026 có bản thứ hai dưới `~/talpha_reports/runtime/sync/`, và hai timer
nạp hai bản khác nhau vào cùng một bộ bảng BigQuery mỗi giờ — bản nào chạy sau thì đè
bản kia. `sync_month.py` nay dừng lại nếu nạp nhầm bản. **Đừng chép engine đi đâu nữa.**

### 1.1 Rule dùng chung — một file JSON, ba module

`config/talpha_rules.json` chứa: marketer + biến thể tên · thị trường & tỷ giá · alias ·
status GTC · pattern campaign test · phí 3PL · giá vốn SKU · ngưỡng ROAS · luật đối soát.

| Module | Ngôn ngữ | Ai dùng |
|---|---|---|
| `dashboard-ui/src/lib/talpha/rules.ts` | TS | route dashboard, `talpha-inventory.ts`, prompt CEO-ask |
| `ops/talpha_reports/talpha_rules.py` | Python | `format_all.py`, `team_report.py` |
| `ops/whatsapp-alerts/rules.js` | JS | `daily_report.js` (bot đang tắt) |

Cả ba cùng expose `attribute_order`/`attributeOrder` (rule CEO ba bậc), `parse_campaign`,
`build_adid_owner`, `shipping_vnd`. Đối chứng 03/08 trên data thật: Python ≡ TS ≡ JS.

Đường dẫn tới file cấu hình: phía TS hỏi `lib/talpha/config-path.ts`, đừng tự ghép
`process.cwd()`. Bản sao `dashboard-ui/config/` đã xoá 11/09 — nó từng lệch thật
(giữ shop_id Đài cũ `1328343252` trong khi bản chuẩn là `408074608`).

## 2. Rule từng chỉ số

| Chỉ số | Sheet (`format_all.py`) | Dashboard (`realtime/route.ts`) |
|---|---|---|
| **Nguồn spend / tin nhắn** | BigQuery `fb_ads_data` (sync mỗi giờ) | Meta API live |
| **Gán spend → marketer** | `parse_campaign`: tìm segment thị trường, segment NGAY SAU là tên marketer; bảng biến thể ở `talpha_rules.json → camp_marketer_tokens` | Nhóm theo TKQC/campaign; bot dùng `scanCampaignMarketer` quét cả tên camp |
| **Ngày của spend** | Ngày theo **timezone TKQC** (Meta trả sẵn) — múi giờ thật của từng TKQC ở `talpha.yaml → ad_account_timezones`, lấy từ Meta API, KHÔNG đoán theo tên | Cùng |
| **Tin nhắn** | action `onsite_conversion.messaging_conversation_started_7d` | Cùng |
| **Nguồn đơn** | BigQuery `sale_order` | Hybrid: BigQuery (≥2 ngày trước) + POS API live (hôm qua/nay) |
| **Gán đơn → marketer** | `attribute_order`, rule CEO ba bậc: 1) TAG trong POS (`marketer.$.name`); 2) không tag/ngoài team → `ad_id` → chủ campaign; 3) vẫn không → tab **"(không gán)"**. KHÔNG bỏ đơn lặng lẽ | `ad_id` → ad; không khớp thì fallback `marketer+market+page_id` (chỉ khi khoá trỏ đúng một campaign); vẫn không → "chưa map" kèm lý do |
| **Ngày của đơn** | **VN +7** (`Asia/Ho_Chi_Minh`) | Đơn đã match: theo tz TKQC; chưa match: VN +7 |
| **Doanh số** | `cod ÷ số chia của shop × tỷ giá`. Đài Loan: **số chia 1**, tỷ giá **800đ/TWD**. Nguồn: `talpha_rules.json → markets` (`pos_money_divisor` + `rate_vnd`) | Cùng |
| **DS Giao TC** | `status_category = 'GIAO_THANH_CONG'` | Cùng |
| **Danh sách TKQC** | `ops/talpha_reports/ad_accounts.json` | `config/projects/talpha.yaml` → `ad_account_ids` + `ad_account_names` + `ad_account_timezones` |
| **Campaign TEST** | Campaign chứa từ `test` đứng riêng → tách khỏi báo cáo doanh số, gom vào file `[Test] Ads - <tên>`. **Đài Loan được miễn trừ** (`test_campaign.exempt_markets`) — tên campaign TW hay chứa "test" theo nghĩa khác | Chưa tách (dashboard là màn vận hành, hiện đủ camp) |
| **Phí 3PL** | `talpha_rules.json → shipping_fees.TW` — NAZA供应链, tính bằng RMB theo kênh giao (7-Eleven/FamilyMart 27 · HCT 32 · Yamato 38 RMB cho kg đầu; sau đó 15 RMB/kg dưới 3kg, 19 RMB/kg trên 3kg) + 3 RMB/đơn phí thao tác | Cùng module (`shippingVnd`) |

### ⚠️ Số chia tiền POS — bẫy đắt nhất

`cod` trong POS **không phải lúc nào cũng là minor units**. Shop Đài lưu **nguyên TWD**
(`cod=950` ⇒ 950 TWD, đã verify bằng POS API 20/08) nên số chia là **1**. Gõ `/100` cứng
là doanh thu tụt đúng 100 lần — AOV ra 8.987đ/đơn, đủ vô lý để thấy ngay, nhưng lúc đó
số đã lên Sheet rồi.

Dùng `posMoneyDivisor()` (TS) hoặc bảng `markets.*.pos_money_divisor` (Python). Thêm
shop mới: lấy một đơn thật từ POS API, so với giá bán thật, rồi mới khai.

> Ghi chú lịch sử: sáu shop GCC cũ (SA/AE/KW/OM/QA/BH) lưu minor units nên số chia là
> 100. Chúng đã ngừng bán từ 05/09/2026 và không còn trong config. Mặc định của
> `posMoneyDivisor()` vẫn là 100 cho shop_label lạ — cố ý giữ, nhưng nghĩa là gõ sai
> tên shop sẽ chia nhầm 100. Khai đúng tên, đừng dựa vào mặc định.

## 3. Lệch CỐ HỮU giữa Sheet và dashboard (không phải bug)

1. **Độ trễ**: Sheet đọc bản sync gần nhất (mỗi giờ); Ads Command Center gọi live →
   cùng thời điểm số khác nhau vài phần trăm.
2. **Ngày ads ≠ ngày đơn**: spend theo ngày timezone TKQC, đơn theo ngày VN.
   **Từng NGÀY lệch, cả THÁNG khớp.** Đừng so CPO/ROAS theo ngày của TKQC lệch múi giờ
   với cảm nhận theo ngày VN.
3. **Gán đơn**: Sheet theo tag POS; dashboard ưu tiên `ad_id`. Lệch nhỏ với marketer có
   tag đầy đủ, lệch to với đơn không tag.
4. **Hai định nghĩa doanh thu**: tab BigQuery đếm đơn GIAO THÀNH CÔNG; Ads Command
   Center đếm đơn ĐÃ ĐẶT. ROAS hai nơi không so trực tiếp được.

## 4. Vì sao sync ghi WRITE_TRUNCATE atomic

Ngày 06/07/2026 ba sự cố cùng một cơ chế: **xoá trước, fetch sau, chết giữa chừng**.

| Sự cố | Hậu quả | Đã sửa thế nào |
|---|---|---|
| Sync ads timeout 60s + dính rate limit → 0 dòng | Mất 61 triệu spend | Retry + backoff, timeout 90s, account lỗi thì RAISE chứ không ghi |
| Sync đơn reset ở trang 11 → 100/2.210 đơn | `sale_order` thủng ~900 đơn, Sheet tụt 489→168 đơn | Retry trang ×5, shop lỗi thì RAISE; bỏ DROP-trước trong `sync_month.py`; ghi WRITE_TRUNCATE atomic |
| Thiếu 2 TKQC trong yaml | Undercount ~65 triệu | Thêm vào danh sách |

**Pattern `bq rm` trước khi sync bị CẤM.** Fetch hỏng thì bảng cũ còn nguyên — số cũ
nhưng đúng, exit code khác 0 để soi log.

## 5. Vì sao sync hỏng thì KHÔNG ghi Sheet

Chốt 03/09/2026. Token Meta chết lúc 11:50, `fb_ads_data` đứng từ 10:36. Vòng chạy vẫn
trả rc=1 và vẫn in "ADS FAIL", nhưng `format_all.py` chạy vô điều kiện ngay sau đó nên
mỗi giờ lại ghi spend THIẾU xuống Sheet dưới dạng số 0 — không phân biệt được với
"không tiêu đồng nào".

Spend nằm ở **mẫu số**, nên Sheet sai theo hướng **đẹp giả**: CPO 103.735đ khi thật
~165.000đ, %Ads/DT 11,98% khi thật ~19%. Bảng ĐỨNG chứ không MẤT dòng nên
`report_account_health` vẫn báo "ok". **46 tiếng không ai nghi**, tới lúc CEO nhìn Sheet
thấy số đẹp bất thường mới lộ.

Nay `daily_guarded.sh` bỏ qua bước ghi Sheet khi sync rc≠0. Một Sheet cũ toàn phần đọc
được, còn Sheet nửa mới nửa thiếu thì không. Chạy tay có chủ đích:
`TALPHA_FORCE_FORMAT=1 ./daily_guarded.sh`.

## 6. Quy trình chẩn đoán "số sai" (làm theo thứ tự, đừng đoán)

1. **Ground truth**: spend = Meta API (`level=campaign, time_increment=1`); đơn = POS API
   live. **KHÔNG BAO GIỜ** kết luận đúng/sai bằng cách so Sheet với BigQuery — chúng cùng
   nguồn nên cùng sai.
2. Token Meta còn sống không: `python3 ops/talpha_reports/check_meta_token.py`
   (exit 0 = mọi TKQC đọc được).
3. So Meta ↔ `fb_ads_data` theo account: lệch >2% → sync ads hỏng.
   `journalctl -u talpha-sync -n 60 --no-pager` — tìm "Read timed out" / "request limit".
4. So POS live ↔ `sale_order` theo marketer/ngày: lệch → sync đơn hỏng (tìm "chết ở page").
5. Dấu hiệu kinh điển:
   * ngày có ĐƠN nhưng 0 SPEND → sync ads mất account hoặc mất ngày;
   * đơn tụt đột ngột so với sáng → sync đơn ghi đè bằng bộ thiếu;
   * mọi chỉ số đẹp lên bất thường → kiểm mẫu số trước, thường là spend thiếu.
6. Trạng thái vòng chạy gần nhất:
   `tail -40 /root/talpha_reports/daily_$(date +%Y%m%d).log` trên VPS, hoặc
   `ops/talpha_reports/report_health.py`.
