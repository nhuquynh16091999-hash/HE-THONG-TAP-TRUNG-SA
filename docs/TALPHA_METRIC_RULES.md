# TALPHA — Bản đồ rule chỉ số Ads & Đơn hàng (source of truth)

> Kết quả audit toàn bộ 06/07/2026, cập nhật 03/08/2026 (7 thị trường có Taiwan ·
> 14 TKQC · rule file dùng chung). Đọc file này TRƯỚC khi sửa bất cứ gì liên quan
> báo cáo Sheet / Dashboard / sync. Cập nhật file này khi rule thay đổi.
>
> **Rule máy-đọc-được** nằm ở `config/talpha_rules.json` — file .md này giải thích
> VÌ SAO, file .json là cái code đọc. Sửa rule → sửa .json trước, đừng hard-code lại.

## 1. Kiến trúc dòng dữ liệu

```
Meta API ──(sync mỗi giờ: launchd com.talpha.dailyreport)──► BQ fb_ads_data ──► Sheet (format_all.py)
Pancake POS API ──(cùng chain)─────────────────────────────► BQ sale_order  ──► Sheet
Meta API ──(live)──────────► Dashboard /api/talpha/realtime ──► bot WhatsApp
Pancake POS API ──(live cho hôm nay/hôm qua) + BQ (cũ hơn) ──► Dashboard
```

⚠️ **HAI BẢN CODE SYNC** (landmine lớn nhất):
- Repo: `sync/talpha/talpha_sync.py` + `sync/core/*` — chạy khi gọi TAY từ terminal.
- Runtime: `~/talpha_reports/runtime/sync/talpha/talpha_sync.py` — **bản chạy THẬT dưới launchd**,
  vì launchd không đọc được `~/Desktop` (thiếu Full Disk Access) nên import rơi xuống runtime.
- **Mọi fix sync phải vá CẢ HAI BẢN.** (06/07 đã vá cả hai.)
- Chain: launchd `StartInterval 3600s` (guard 50') → `daily_guarded.sh` → `sync_month.py`
  → `format_all.py`. Hợp nhất 2 bản = mục B1 (đang chạy shadow-sync đối chứng).

### 1.1 Rule dùng chung — 1 file JSON, 3 module (từ 03/08/2026)

`config/talpha_rules.json` (bản copy `dashboard-ui/config/` sinh lúc prebuild) chứa:
marketer + variant tên · 7 thị trường & tỷ giá · alias thị trường · status GTC ·
pattern campaign test · phí ship 3PL · danh sách tên ngoài team.

| Module | Ngôn ngữ | Consumer đã chuyển |
|---|---|---|
| `ops/talpha_reports/talpha_rules.py` | Python | `format_all.py`, `team_report.py` |
| `dashboard-ui/src/lib/talpha/rules.ts` | TS | `realtime/route.ts`, `ads-alerts/route.ts`, `talpha-inventory.ts` |
| `ops/whatsapp-alerts/rules.js` | JS | `daily_report.js` |

Cả 3 cùng expose `attribute_order`/`attributeOrder` (rule CEO 3 bậc), `parse_campaign`,
`build_adid_owner`, `shipping_vnd`. Verify 03/08 trên data thật: **Python ≡ TS ≡ JS,
0 lệch trên cả 3 bậc**.

## 2. Rule từng chỉ số

| Chỉ số | Sheet (format_all.py) | Dashboard (realtime/route.ts) |
|---|---|---|
| **Nguồn spend/msg** | BQ `fb_ads_data` (sync mỗi giờ) | Meta API live |
| **Gán spend→marketer** | `parse_campaign` (module chung): tìm segment thị trường (SAUDI/UAE/TAIWAN…), segment NGAY SAU = tên marketer; bảng variant ở `talpha_rules.json → camp_marketer_tokens` (C.Thuý→ChuThuy, LOC/LỘC/SLỘC→Loc, N.THẾ→The…) | Không gán marketer — nhóm theo TKQC/campaign. Bot + ads-alerts dùng `scanCampaignMarketer` (quét cả tên camp) |
| **Ngày của spend** | Ngày theo **timezone TKQC** (Meta trả sẵn) — múi giờ THẬT của 14 TKQC ở `talpha.yaml → ad_account_timezones` (lấy từ Meta API 03/08, KHÔNG đoán theo tên; 3 account `America/Los_Angeles`) | Cùng |
| **Tin nhắn** | action `onsite_conversion.messaging_conversation_started_7d` | Cùng |
| **Nguồn đơn** | BQ `sale_order` | Hybrid: BQ (≥2 ngày trước) + POS API live (hôm qua/nay) |
| **Gán đơn→marketer** | `attribute_order` (module chung, rule CEO 3 bậc): 1) **TAG marketer trong POS** (`marketer.$.name` → `norm_pos_nv`); 2) không tag/tag ngoài team → **ad_id → chủ campaign**; 3) vẫn không → tab **"(không gán)"** ở file TỔNG THÁNG (duyệt 06/07 — không bỏ đơn lặng lẽ). `shop_label`→thị trường; sản phẩm = tên page tra từ `page_id` | `ad_id` → ad; không khớp thì fallback `marketer+market+page_id` (chỉ khi khoá trỏ đúng 1 campaign); vẫn không → "chưa map" + lý do |
| **Ngày của đơn** | **VN +7** (`Asia/Ho_Chi_Minh`) | Đơn match: ngày theo tz TKQC; đơn chưa match: VN +7 |
| **Doanh số** | `cod ÷ SỐ CHIA CỦA SHOP × tỉ giá cứng theo shop_label` — **7 thị trường**: Saudi(SA) 6850 · UAE(AE) 7010 · Kuwait(KW) 83000 · Oman(OM) 66700 · Qatar(QA) 7050 · Bahrain(BH) 68000 · **Taiwan(TW) 800**. ⚠️ **X13 — số chia KHÔNG phải lúc nào cũng 100**: 6 shop GCC lưu minor units (`cod=9900` ⇒ 99,00 SAR) → ÷100; shop **Đài lưu NGUYÊN TWD** (`cod=950` ⇒ 950 TWD) → ÷1. Nguồn: `talpha_rules.json → markets` (`rate_vnd` + `pos_money_divisor`) | Cùng |
| **DS Giao TC** | `status_category='GIAO_THANH_CONG'` (= status_name delivered/received_money) | Cùng (đã bỏ ước 65% từ 04/07) |
| **14 TKQC** | `runtime/config/ad_accounts.json` (sync) / `ops/talpha_reports/ad_accounts.json` (repo + trang `/admin`) | `config/projects/talpha.yaml` → `ad_account_ids` + `ad_account_names` + `ad_account_timezones` — **phải khớp đủ 14 account**, thiếu 1 chỗ = undercount spend âm thầm |
| **Camp TEST** | Campaign chứa từ `test` (đứng riêng, mọi hoa/thường) = test sản phẩm → **TÁCH khỏi mọi báo cáo doanh số** (spend + đơn qua ad_id/page thuần-test), gom vào file `[Test] Ads - <marketer>` riêng từng người, gộp mọi thị trường, tab theo sản phẩm. ID file: `~/talpha_reports/test_files.json` (SA không tự tạo file được — user tạo + share). **Miễn trừ: thị trường Taiwan** (`test_campaign.exempt_markets`) | Chưa tách (dashboard là ops view, hiện đủ camp) |
| **Phí ship 3PL** | `talpha_rules.json → shipping_fees` theo `shop_label`, TỆ ĐỊA PHƯƠNG: đơn GTC = packing + delivery + COD (pct hoặc flat). iMile (SA/AE/QA/OM) · PostaPlus (KW) · Aramex (BH). **TW chưa chốt 3PL → trả 0, không đoán** | Cùng module (`shippingVnd`) |

## 3. Lệch CỐ HỮU giữa Sheet và Dashboard (không phải bug)

1. **Độ trễ**: Sheet đọc bản sync gần nhất (mỗi giờ); Dashboard live → cùng thời điểm số khác nhau vài %.
2. **Ngày ads ≠ ngày đơn**: spend theo ngày tz TKQC (đặc biệt "Trung Đông múi h Mỹ" =
   giờ Los Angeles, lệch nửa ngày so VN); đơn theo ngày VN. **Từng NGÀY lệch, cả THÁNG khớp.**
   Đừng so daily CPO/ROAS của account múi Mỹ với cảm nhận theo ngày VN.
3. **Gán đơn**: Sheet theo tag POS; Dashboard ưu tiên ad_id. Lệch nhỏ (~4 đơn/500 với marketer
   có tag đầy đủ), lệch to với đơn không tag (xem mục 4).

## 4. Lỗ rule — trạng thái sau quyết định CEO 06/07

Audit 01–06/07 (POS live) phát hiện ~566 đơn không tính cho ai (tag trống 306, Kính 131,
Thạch 77, Tú 50…), trong đó ~338 đơn CÓ ad_id thuộc campaign team.
Ma trận tag↔ad-owner: khi ĐÃ có tag thì tag ≈ chủ ad (gần như không lẫn chéo).

- ✅ **ĐÃ ĐÓNG (CEO duyệt)**: format_all giờ fallback `ad_id → chủ campaign` cho đơn không
  tag/tag ngoài team; phần còn lại vào tab **"(không gán)"** ở file TỔNG THÁNG.
  Verify 06/07: tổng tab marketer + "(không gán)" = 2.120 = 100% đơn POS; fallback cộng
  đúng ma trận audit (Loc +160, The +82, Mai +43, Nhung +26, Chinh +21, ChuThuy +7).
- ⏸️ **CEO chọn BỎ QUA**: spend campaign không parse ra marketer (vd "Kính" ~6.7M/6 ngày)
  tiếp tục nằm ngoài hệ Sheet (Kính không thuộc 8 marketer báo cáo). Nếu sau này cần,
  thêm dòng "Khác" ở file TỔNG.

## 5. Sự cố dữ liệu 06/07 (đã fix — cơ chế chung: "xoá trước, fetch sau, chết giữa chừng")

| Sự cố | Hậu quả | Fix |
|---|---|---|
| Sync ads: Tiểu Alpha 1 timeout 60s + rate limit → 0 rows | Mất 61M spend (Chu Thuý 35M) | Retry+backoff, timeout 90s, account fail → RAISE không ghi (cả 2 bản code) |
| Sync đơn 12:00: SA reset ở page 11 → 100/2210 đơn | sale_order thủng ~900 đơn → Sheet Chu Thuý 489→168 đơn | Retry page ×5, shop fail → RAISE; bỏ DROP-trước trong sync_month.py; ghi WRITE_TRUNCATE atomic |
| Dashboard thiếu 2 TKQC trong yaml | Undercount ~65M | Thêm act_1543721207473858 + act_1380444643991154 |
| Dashboard ước 65% giao | Không khớp DS Giao TC của Sheet | Dùng GTC thật theo status POS |

## 5b. Taiwan — thị trường thứ 7, bẫy còn sót ở nhiều bản code cũ

Taiwan (`shop_label` = **TW**, shop POS `1328343252`, TKQC "Đài 18-05-2026"
`act_1343764530945320`, tz `Asia/Taipei`) được thêm sau 6 thị trường GCC. Bản code
cũ nào thiếu TW sẽ **rơi về tỷ giá mặc định 7010** → doanh thu Taiwan phồng ~9 lần.

- Tỷ giá **TWD→VND = 800** (tạm, chờ CEO xác nhận) — `talpha_rules.json → markets.Taiwan`.
- Đã fix: view BQ (`vw_*`, mục E1) · `team_report.py` (mục E3) · file Sheet Taiwan
  riêng theo `~/talpha_reports/taiwan_files.json` (mục B3).
- Campaign Taiwan **miễn trừ luật tách camp "test"** — tên campaign TW hay chứa "test"
  theo nghĩa khác.
- **TW chưa có bảng phí 3PL** → `shipping_vnd` trả 0 cho TW (cố ý, không đoán số).
- Trước khi tin bất kỳ chỗ nào có bảng tỷ giá: **grep xem có TW/Taiwan chưa**.

## 6. Quy trình chẩn đoán "số sai" (làm theo thứ tự, đừng đoán)

1. **Ground truth**: spend = Meta API (`level=campaign, time_increment=1`); đơn = POS API live.
   **KHÔNG BAO GIỜ** kết luận đúng/sai bằng cách so Sheet với BQ — chúng cùng nguồn, cùng sai.
2. So Meta ↔ `fb_ads_data` theo account: lệch >2% → sync ads hỏng, xem log
   `~/talpha_reports/daily_YYYYMMDD.log` (tìm "Read timed out"/"request limit"/"TRUNCATE").
3. So POS live ↔ `sale_order` theo marketer/ngày: lệch → sync đơn hỏng (tìm "chết ở page").
4. Dấu hiệu kinh điển: **ngày có ĐƠN nhưng 0 SPEND** = sync ads mất account/ngày;
   **đơn tụt đột ngột so với sáng** = sync đơn ghi đè bộ thiếu.
5. Script sẵn có trong repo (`full_audit.py` của phiên 06/07 KHÔNG còn ở repo lẫn runtime — đừng đi tìm):
   - `ops/talpha_reports/compare_shadow.py` — so bản sync cũ ↔ mới theo từng bảng/ngày (mục B1).
   - `ops/talpha_reports/report_health.py` — trạng thái sync gần nhất.
   - Muốn bảng so 4 nguồn như 06/07 thì viết lại theo đúng thứ tự bước 1–4 ở trên.
