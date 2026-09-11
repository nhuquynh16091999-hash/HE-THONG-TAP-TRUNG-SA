# Sổ lỗi số liệu đang mở — nhóm section X

> Đo lần cuối 04/08/2026. Mỗi lần chạm vào lỗi nào, cập nhật lại số đo + trạng thái.
> Mức: 🔴 đang mất/sai dữ liệu thật · 🟡 sai số hiển thị · ⚪ nợ kỹ thuật.

| Mã | Lỗi | Mức | Trạng thái |
|---|---|---|---|
| X1 | Smart Stop cắt cụt `sale_order` mỗi vòng sync | 🔴 | **ĐÓNG 04/08** (3 chu kỳ verify) |
| X2 | `fb_ads_data` xoá sạch tháng cũ khi sang tháng mới | 🔴 | **ĐÓNG 05/08** (T5-T7 khớp Meta 0,00%) |
| X3 | `order_items` thiếu giá + phủ 61% → COGS chỉ 20,7% | 🟡 | ĐANG MỞ |
| X4 | `product_catalog` bẩn — tên SP lọt vào cột `sku` | 🟡 | ĐANG MỞ |
| X5 | `vw_orders_std.cogs_vnd` luôn = 0 (2 đường COGS) | ⚪ | ĐANG MỞ |
| X6 | `sale_order` trùng id | ⚪ | ĐÓNG THEO X1 (rebuild dedupe theo id) |
| X7 | Tab Marketing & Ads liệt kê sai danh sách team | 🟡 | ĐÃ ĐÓNG 04/08 |
| X8 | `order_id` không duy nhất — POS đánh số riêng từng shop | 🔴 | ĐÃ ĐÓNG 05/08 |
| X9 | POS ghi ADSET id vào ô `ad_id` — 999 đơn không nối được campaign | 🟡 | ĐÃ SỬA 06/08 |
| X13 | Shop Đài lưu NGUYÊN TWD nhưng view chia 100 như GCC — tiền TW tụt 100 lần | 🔴 | **ĐÃ SỬA 20/08** (view + Sheet + realtime) |

---

## X1 — Smart Stop cắt cụt `sale_order` 🔴

**Triệu chứng**: số đơn mỗi vòng sync nhảy cả hai chiều, vòng ngắn ghi đè
(WRITE_TRUNCATE) làm mất bộ đầy đủ. Log 04/08: 3.730 → 3.840 → **5.220** → 5.160 →
3.770 → **3.380** → 3.470 → 4.440.

**Nguyên nhân gốc** — cùng một logic ở CẢ HAI bản:
`sync/order_sync_utils.py::should_stop_fetching` (runtime, đang chạy) và
`sync/core/pos_client.py::_should_stop` (repo, bản B1):

```python
return all(o.get("updated_at","") <= last_sync_ts for o in orders)   # per_page = 10
```

Giả định "POS trả orders newest-first theo `updated_at`" là **SAI** — feed POS sắp
theo `inserted_at` (ngày TẠO) desc. Docstring runtime vẫn ghi "Orders are sorted
newest-first by POS API" → sai từ tài liệu.

**Hệ quả**: đơn COD tạo lâu ngày mới giao xong (`updated_at` mới, `inserted_at` cũ)
nằm sâu ở trang sau → gặp 1 trang toàn đơn cũ là dừng sớm, mất hẳn. SA nặng nhất:
`Smart Stop tại page` nhảy 384 → 245 → 206, page × 10 khớp đúng số dòng SA trong BQ
(3.840 / 2.450 / 2.060). Các shop khác ổn định (AE 83 · KW 20 · OM 3 · QA 9 · BH 8 · TW 16).

**Đo lại**:
```bash
grep -oE "orders [0-9]+" ~/talpha_reports/daily_$(date +%Y%m%d).log | tail -8
```
```sql
SELECT shop_label, COUNT(*) n, MIN(SUBSTR(inserted_at,1,10)) don_cu_nhat
FROM `cty-507710.TALPHA_Dataset.sale_order` GROUP BY 1 ORDER BY 1
```
`don_cu_nhat` lùi theo số page (SA 24/07, AE 29/07…) thay vì đứng ở mốc đầu tháng
= đang bị cắt.

**Ground truth POS API (probe 04/08, `GET /shops/{id}/orders`)** — đo chứ không đoán:

| Câu hỏi | Kết quả |
|---|---|
| Feed sắp theo gì? | `inserted_at` DESC = **True**, `updated_at` DESC = **False** |
| Tham số phân trang | **`page_size`** (tối đa 100). `per_page` bị **BỎ QUA** → code cũ luôn nhận 10 đơn/request |
| Filter theo updated_at | Không có (`startDateTime`/`updated_at_from` đều không ăn) |
| Quy mô | SA 59.009 · AE 36.392 · KW 11.769 · QA 5.785 · OM 1.695 · BH 854 · TW 286 = **115.790 đơn** |

**Ground truth BigQuery (probe 04/08)**: DML `DELETE`/`MERGE` → **403 billing not enabled**;
nhưng **query-with-destination WRITE_TRUNCATE chạy được** → đủ để dựng lại bảng từ raw.

**ĐÃ SỬA 04/08** — 3 thay đổi, áp cho CẢ repo lẫn runtime:
1. `page_size=100` thay `per_page=10` → ít hơn 10 lần số request, đủ nhanh để bỏ Smart Stop.
2. Bỏ Smart Stop, thay bằng `trim_page_to_window()` / `_trim_to_window()` — cắt theo
   `inserted_at < window_start`, đúng chiều sắp xếp thật. Cửa sổ mặc định **60 ngày**
   (`TALPHA_ORDER_WINDOW_DAYS`).
3. Bỏ WRITE_TRUNCATE cho bảng đơn, thay bằng `append_and_rebuild_orders()`:
   `sale_order_raw` / `order_items_raw` **APPEND-only** (không bao giờ ghi đè) →
   dựng lại bảng sạch mỗi vòng bằng query-with-destination. Chỉ append đơn mới/đổi
   `updated_at` nên raw không phình. **Cửa sổ nay chỉ quyết định "đơn nào được làm
   mới", KHÔNG còn quyết định "đơn nào bị xoá".**

Hệ quả kèm theo: shop lỗi không còn phải huỷ cả vòng ghi (đơn shop đó giữ bản cũ);
X6 trùng id tự hết vì rebuild dedupe theo id.

**Test cơ chế (bảng `*_x1test`, 04/08)**: seed 94 đơn cũ ngoài cửa sổ + kéo 17 đơn
trong cửa sổ → bảng ra **111 đơn, mất 0 đơn** (WRITE_TRUNCATE sẽ chỉ còn 17); chạy
vòng 2 số không tụt; 0 trùng id.

**Kết quả thật 04/08** — quy mô lỗi lớn hơn nhiều so với ước lượng ban đầu:

| Vòng | Code | Cửa sổ | `sale_order` |
|---|---|---|---|
| 13:05 | cũ | Smart Stop | 3.960 |
| 14:29 | cũ | Smart Stop | 4.040 |
| 15:29 | **mới** | 60 ngày | **18.404** |
| 15:55 | backfill | từ 01/06 | 19.838 |
| 16:20 | **mới** | 30 ngày | **19.845** ✅ không tụt |
| 16:51 | **mới** (launchd) | 30 ngày | **19.860** ✅ không tụt |

Vòng 16:20 là bằng chứng quyết định: chỉ kéo về 10.168 đơn (cửa sổ 30 ngày) nhưng bảng
vẫn 19.845 vì dựng lại từ raw — WRITE_TRUNCATE cũ sẽ tụt về đúng 10.168. Trong 10.168
đơn kéo về chỉ **785 đơn** thực sự mới/đổi trạng thái được append. Bước đơn mất **3'12"**.

Bảng marketer 06/06–04/08 trước/sau (cùng mẫu số = tổng mọi dòng kể cả "không gán"):
**1.399 → 8.006 đơn** — dashboard trước đó chỉ hiển thị **17,5%** số đơn thật.
Riêng 7 người trong team: 1.231 → 7.209 đơn. Mọi shop `cu_nhat` = 2026-06-01, trùng id = 0.

Đối chiếu ground truth: số đơn từng shop trong bảng **khớp đúng** số POS API trả cho
cùng cửa sổ (SA 9.932/9.932, AE 6.481/6.481…) — lệch 0%.

**✅ ĐÃ ĐÓNG 04/08**: 3 chu kỳ liên tiếp số đơn không giảm (18.404 → 19.845 → 19.860),
`don_cu_nhat` mỗi shop đứng yên, trùng id = 0, khớp POS API 0% lệch.

**Việc kéo theo — đã làm hết 04/08**:
- ✅ **Van chống dội bot B5** (`accountAlertMinHours`, `accountClearPolls`) đã gỡ
  (commit 772ff6b). Detector giờ soi 15 mục, 0 mục sót — chính X1 là thủ phạm cũ.
- ✅ **Bảng nháp** `_x1_probe` + `sale_order_x1test`/`order_items_x1test` (+`_raw`) đã xoá.
- ✅ **Backfill lịch sử** xong 05/08: `sale_order` **94.566 đơn**, liền mạch theo tháng,
  SA từ 2024-09 · AE từ 2024-08 · KW từ 2024-12 · OM 2025-03 · QA 2025-06 · BH/TW 2026.
  (POS báo `total_entries` cao hơn — SA 59.160 vs 50.898 kéo được — phần chênh là đơn
  POS đếm nhưng phân trang không trả, không phải lỗ hổng dữ liệu: các tháng đều liền.)
  Backfill này làm lộ lỗi **X8** — xem mục riêng bên dưới.

---

## X2 — `fb_ads_data` xoá sạch tháng cũ 🔴

**Triệu chứng** (phát hiện 04/08, chưa có memory nào ghi): bảng chỉ còn tháng hiện
tại + đúng 1 ngày biên.

```
thang    dong   tu           den          spend_tr
2026-07   434   2026-07-31   2026-07-31      53.3
2026-08  1474   2026-08-01   2026-08-04     141.7
```

Toàn bộ 01–30/07 **đã mất**. Ghi chú cũ trong [[e1-views-vnd-done]] "spend 29–30/07
= 0, nghi window sync" thực ra là biểu hiện sớm của lỗi này.

**Nguyên nhân gốc (xác nhận 05/08, đọc code chứ không đoán)**: `sync_month.py` gọi
`sync_fb_ads(days_back=(today-first).days+1)` = month-to-date, rồi `load_truncate`
**WRITE_TRUNCATE cả bảng** bằng đúng cửa sổ đó. Ngày 1 hàng tháng `days_back=1` →
bảng chỉ còn 1-2 ngày. 31/07 sống sót vì là ngày biên (`since` = today−1 = 31/07 khi
chạy 01/08). `fb_adset_data` dính y hệt.

**Đo lại**:
```sql
SELECT FORMAT_DATE('%Y-%m', date) thang, COUNT(*) dong,
       MIN(CAST(date AS STRING)) tu, MAX(CAST(date AS STRING)) den
FROM `cty-507710.TALPHA_Dataset.fb_ads_data` GROUP BY 1 ORDER BY 1
```

**ĐÃ SỬA 05/08 — commit `eca62b2`**, áp cho CẢ repo lẫn runtime. Cùng khuôn X1:
`append_and_rebuild_ads()` — append vào `fb_ads_data_raw`/`fb_adset_data_raw` rồi
dựng lại bảng, dedupe `(account_id, ad_id|adset_id, date)` giữ `sync_time` mới nhất
(Meta chốt sổ muộn vẫn cập nhật được). Cửa sổ nay chỉ quyết định **ngày nào được làm
mới**, không còn quyết định ngày nào bị xoá. Account fetch lỗi cũng không phải huỷ
cả vòng ghi nữa.

**Hai bẫy gặp khi làm — đừng lặp lại:**
1. `autodetect=True` khi APPEND suy `sync_time` thành TIMESTAMP trong khi bảng raw
   là STRING → BQ trả 400 `Field sync_time has changed type`. WRITE_TRUNCATE cũ
   không lộ vì nó tạo lại bảng mỗi lần. **Luôn lấy schema từ chính bảng raw.**
2. Bảng THẬT (do engine runtime tạo bằng autodetect) có `sync_time` TIMESTAMP,
   `account_id`/`ad_id` INTEGER — khác hẳn `ADS_SCHEMA` của repo khai STRING cả ba.
   Bản repo sẽ vỡ vòng đầu khi B1 cutover nếu dùng schema khai sẵn.

**Verify đã đóng (05/08)**: chạy `sync_fb_ads(days_back=1)` — mô phỏng đúng ngày 1
tháng mới — chỉ kéo về **815 dòng** nhưng bảng vẫn **2.461 dòng**; bản cũ sẽ tụt về
đúng 815. Test cơ chế trên bảng nháp `fb_ads_x2test`: seed 3 ngày lịch sử + kéo 1
ngày → 4 dòng (không mất), kéo lại cùng ngày → vẫn 4 dòng (không nhân bản), spend
cập nhật theo bản mới.

**Backfill 05/08 (user duyệt cả 3 tháng)**: T5+T6 gộp từ bảng backup
`fb_ads_data_bak0629` vào raw (+10.243 dòng, phải CAST vì backup để STRING còn raw
là TIMESTAMP/INTEGER; backup thiếu cột `project_id` → CAST NULL). T7 kéo lại từ Meta
API bằng `days_back` tính tới 01/07.

### Kiểm lại bằng GROUND TRUTH — Meta API (05/08 chiều)

Bản backup không đủ: T5 chỉ có 25→31/05, T6 thiếu **217,3tr (−19%)**. Lệch tập trung
ở 6 TKQC, nhìn khoảng ngày là ra ngay — "Trang sức 15/6" · "Trung Đông múi h Mỹ" ·
"Đài 18-05" chỉ có **đúng 1 ngày 30/06**; "Mỹ phẩm 3" mất 01–14/06.

Đã xác định KHÔNG phải lỗi cơ chế: `fb_ads_data_raw` và bảng sạch cho T6 **giống hệt
nhau** (8.809 dòng / 917,0tr) → rebuild không làm rơi dòng nào, phần thiếu chưa bao
giờ được kéo về. Đã kéo lại T5 + T6 thẳng từ Meta API.

| Tháng | Meta API | BigQuery | Lệch |
|---|---|---|---|
| T5 | 1.147,5tr | 1.147,5tr | **0,00%** ✅ |
| T6 | 1.134,3tr | 1.134,3tr | **0,00%** ✅ |
| T7 | 1.472,7tr | 1.472,7tr | **0,00%** ✅ |

Tháng 8 kiểm theo TỪNG NGÀY: 01–03/08 lệch 0,0% · 04/08 −1,0% (Meta chốt sổ muộn) ·
05/08 −21% **là độ trễ sync bình thường**, không phải lỗi — spend vẫn chạy tiếp sau
lần sync gần nhất. Đừng "sửa" cho khớp ngày đang chạy.

### Hai thứ sửa thêm khi kiểm (05/08)

1. **`sync_fb_ads` nhận thêm `since`/`until`** (cả 2 bản) — trước chỉ có `days_back`
   tính lùi từ hôm nay, không backfill được tháng cũ theo từng tháng.
2. **Bản runtime HUỶ cả lượt sync ads khi 1 TKQC lỗi** trong khi bản repo ghi phần lấy
   được rồi mới raise — hai bản lệch nhau, mô tả X2 ở trên viết theo bản repo. Huỷ cả
   lượt là đúng thời WRITE_TRUNCATE (ghi bộ thiếu = xoá mất ngày cũ) nhưng nay ghi
   append thì bộ thiếu KHÔNG xoá được gì. Backfill T5 hỏng 2 lượt (~14 phút) chỉ vì 1
   account lỗi tạm thời. Đã sửa runtime cho khớp repo: bỏ qua account lỗi, ghi tiếp,
   raise ở cuối để `report_health` vẫn kêu.

---

## X3 — `order_items` thiếu giá, phủ 61% 🟡

**Số đo 04/08** (mẫu số = `is_confirmed`, đây là chỗ 2 phiên từng lệch nhau):

| Khung | Tổng DT | DT cấp SP | Có giá vốn | % cấp SP | % tổng |
|---|---|---|---|---|---|
| Từ 04/07 | 716,4tr | 436,8tr | 90,6tr | **20,7%** | 12,6% |
| 7 ngày | 435,0tr | 269,7tr | 64,4tr | 23,9% | 14,8% |

Ba lớp thiếu chồng nhau:
1. `avg_imported_price` = 0 ở **toàn bộ** 2.993 dòng; `retail_price` = 0 ở
   5.283/5.285 dòng; `shop_name` rỗng toàn bộ → POS không trả giá.
2. Chỉ 61% doanh thu confirmed có dòng `order_items` khớp `product_catalog`.
3. Chỉ **4/45** SKU bán ra 7 ngày có giá vốn khai trong `talpha_rules.json`
   (file có 27 SKU nhưng phần lớn không phải hàng đang bán).

**SKU bán chạy chưa khai giá vốn** (7 ngày): 153 Essential Oil Perfume 48,3tr ·
008 Necklace box 39,2tr · 162 Kreain Soothing 22,6tr · 133 Feng Shui 22,3tr ·
125 Fitgum 10,2tr.

**Hướng sửa**: phần (3) là **nhập liệu** — user khai giá vốn, khai ~10 SKU đầu là
phủ được đa số. Phần (1)(2) thuộc sync/POS, kiểm xem POS có trả field giá ở endpoint
khác không.

**Verify**: chạy lại query phủ ở trên, `% cấp SP` tăng; nêu rõ mẫu số khi báo.

---

## X4 — `product_catalog` bẩn 🟡

**Triệu chứng**: cột `sku` có dòng chứa TÊN sản phẩm thay vì mã. Cùng một SP bị tách
hai dòng doanh thu và tra giá vốn trượt:
- 008 Necklace box: `sku='008'` 39,2tr **+** `sku='Necklace box'` 8,8tr
- 162 Kreain: `sku='162'` 22,6tr **+** `sku='Kreain Soothing Massage Gel'` 18,5tr

**Đo lại**:
```sql
SELECT sku, COUNT(*) n FROM `cty-507710.TALPHA_Dataset.product_catalog`
WHERE NOT REGEXP_CONTAINS(sku, r'^[0-9A-Za-z\-_.]{1,12}$') GROUP BY 1 ORDER BY 2 DESC
```

**Hướng sửa**: chuẩn hoá lúc sync catalog (sku rỗng/không đúng dạng → lấy mã từ
`product_name` prefix "153 - ..." nếu có, còn không thì để NULL + đếm riêng, đừng
lấy tên làm sku). Sửa xong phải chạy lại X3 vì phủ sẽ đổi.

---

## X5 — `vw_orders_std.cogs_vnd` luôn = 0 ⚪

View tính COGS từ `SUM(avg_imported_price × quantity)` trên `order_items` — cột này
= 0 toàn bộ (xem X3) → cột `cogs_vnd` luôn 0 trong khi tab P&L theo SP lại tính COGS
riêng từ `talpha_rules.json`. **Hai định nghĩa COGS song song, một cái đã chết.**

Nguy hiểm ở chỗ: ai query thẳng view sẽ tưởng lãi = doanh thu (COGS 0).

**Hướng sửa** — chọn 1: (a) bỏ cột khỏi view cho khỏi đánh lừa; (b) cho view đọc giá
vốn từ rules file như tab, để mọi consumer dùng chung một định nghĩa.

**Đo lại**: `SELECT COUNTIF(cogs_vnd>0), COUNT(*) FROM vw_orders_std WHERE order_date >= …`

---

## X6 — `sale_order` trùng id ⚪ (gần đóng)

Ngày 03/08 có **10 dòng trùng** (5 đơn × 2, giống hệt từng cột, ở SA + AE) →
`vw_orders_std` bê nguyên, mọi SUM nhân đôi 5 đơn đó. Đo lại 04/08: còn **1 dòng**
(4.440 dòng / 4.439 id).

**ĐÓNG 04/08 theo X1**: bảng `sale_order` nay được **dựng lại** từ `sale_order_raw`
bằng `ROW_NUMBER() OVER (PARTITION BY id ORDER BY updated_at DESC, sync_time DESC) = 1`
→ không thể còn 2 dòng cùng id. Verify bằng query "Đo lại" dưới đây: `trung = 0`.
Các tab đang `GROUP BY id` trước khi JOIN thì cứ để nguyên, không hại gì.

(Lịch sử: 03/08 có 10 dòng trùng, 04/08 còn 1 — số ngẫu nhiên theo vòng sync.)

**Hướng sửa**: dedupe trong `vw_orders_std` (`GROUP BY id` + `ANY_VALUE`) để mọi
consumer an toàn, hoặc chặn ghi trùng ở sync (thuộc B1). Tab nào JOIN `sale_order`
lấy phone/tên PHẢI gom `GROUP BY id` trước khi JOIN — customer-tab và market-intel
Q0 đã làm.

**Đo lại**:
```sql
SELECT COUNT(*) n_rows, COUNT(DISTINCT id) n_ids, COUNT(*)-COUNT(DISTINCT id) trung
FROM `cty-507710.TALPHA_Dataset.sale_order`
```

---

## X7 — Tab Marketing & Ads liệt kê sai danh sách team 🟡 (ĐÃ ĐÓNG 04/08)

**Triệu chứng user báo**: "số lượng nhân viên team đang bị sai", nghi do dùng chung TKQC
với team khác. Bảng "Hiệu suất Marketer" hiện **10 dòng** cho team **7 người**.

**Nguyên nhân**: `marketing-tab.tsx` GROUP BY thẳng `vw_orders_std.marketer_name` — cột
này là **tag POS thô**, view không chuẩn hoá. Không liên quan gì tới dùng chung TKQC.
Bốn lỗi chồng nhau:

1. **1 người ra nhiều dòng** (tag POS gõ tay, mỗi lần một kiểu):
   Thế = `Trần Thế` 155 + `N. Thế` 91 + `Thế` 3 → **249 đơn bị xé làm 3**;
   Mai = `Thục Mai` 97 + `Mai Mai` 41; Lộc còn biến thể `Sỹ  Lộc` (2 dấu cách).
2. **Người ngoài team hiện như nhân sự team**: `Bùi Nguyên  Kính` (138 đơn — chú ý
   **2 dấu cách** trong tag POS), `Võ Ánh Ngọc Tú`.
3. **Người trong team biến mất**: Chính (`CHÍNH 1`, 55 đơn nhưng 0 GTC) và S.Anh
   (không có tag nào) không có dòng nào → tưởng đã nghỉ.
4. **Bỏ đơn lặng lẽ** — client filter `name === "unknown"` → **38 đơn / 34,9tr** biến
   mất khỏi báo cáo, vi phạm rule CEO bậc 3 "không bỏ đơn lặng lẽ".

**Cách sửa**: bảng marketer chuyển sang route server `/api/talpha/marketer-perf`, gán đơn
bằng `attributeOrder` của module chung `lib/talpha/rules.ts` (rule 3 bậc: tag POS →
ad_id → `(không gán)`). Bảng render đúng roster trong `config/talpha_rules.json` kể cả
người 0 đơn; thêm dòng `(không gán)` và dòng chú thích tag ngoài team. Dedupe `order_id`
trước khi SUM (lỗi X6).

**Đo lại** (đây là phép đo dùng cho cả trước/sau):
```bash
curl -s "http://localhost:3000/api/talpha/marketer-perf?from=2026-06-06&to=2026-08-04"
```
```sql
-- tag POS thô: dùng để phát hiện biến thể tên mới
SELECT marketer_name, COUNTIF(is_confirmed) gtc, COUNT(*) tat_ca
FROM `cty-507710.TALPHA_Dataset.vw_orders_std`
WHERE order_date BETWEEN '2026-06-06' AND '2026-08-04' GROUP BY 1 ORDER BY 2 DESC
```

**Verify đã đóng (04/08)**: 10 dòng → **7 dòng đúng roster** + `(không gán)`.
Thế gộp 249 đơn/194,5tr · Mai 140 · Lộc 318 · Nhung 75 · Chu Thuý 448 · Chính 0 · S.Anh 0.
Tổng đơn hiển thị 1.361 → **1.399** (chênh đúng 38 đơn `unknown` trước đây bị bỏ);
doanh thu 1.048,4tr → 1.083,4tr (chênh đúng 34,9tr).

**Roster — CEO chốt 04/08/2026**: bản đúng là `config/talpha_rules.json` (7 người: Lộc ·
Chu Thuý · Nhung · Thế · Mai · **Chính** · S.Anh). Repo trước đó có **3 roster lệch nhau**;
đã đồng bộ 2 bản còn lại và ghi rõ chúng chỉ là tham khảo:
`config/projects/talpha.yaml` §9 (không code nào đọc khối `marketers:`) và
`config/naming/talpha_registry.yaml` (file đã chết, chỉ docs/_archive nhắc tới).
`Lê Thục Bình` không còn trong roster → chuyển sang `marketer_ignored`.

**Còn mở sau X7** (chưa sửa, không chặn):
- Tag POS ngoài team `Nguyễn Hữu Thắng` (76 đơn), `Trần Đại Việt` (37), `Quân Hoàng` (1)
  — chung shop POS, 0 đơn GTC nên chưa lên bảng. Việc loại họ khỏi bảng do
  `normPosMarketer` (khớp `contains`) lo, KHÔNG phụ thuộc `external_team` — khoá đó chỉ
  là danh sách mô tả cho prompt CEO-ask, không có code nào khớp tên bằng nó. Muốn CEO-ask
  hiểu đúng thì bổ sung 2 tên đầu vào `external_team`.
- Đơn của họ **không join được** `fb_ads_data` (ad_id không có trong 14 TKQC) — nhưng
  đang lẫn với hệ quả X2 (bảng mất tháng cũ), chưa kết luận được là ads ngoài hệ thống.

---

## X8 — `order_id` KHÔNG duy nhất 🔴 (ĐÃ ĐÓNG 05/08)

**POS đánh số đơn RIÊNG cho từng shop.** `id=18` tồn tại ở cả 7 shop; tổng **20.257 id
bị nhiều shop dùng chung**. Khoá duy nhất phải là **(shop, id)**.

Lỗi này ẩn suốt vì bảng chỉ chứa đơn gần đây (id lớn, hiếm đụng nhau). Backfill toàn bộ
lịch sử của X1 kéo tới các đơn id nhỏ là lộ ngay. **"10 dòng trùng id" của X6 chính là
biểu hiện sớm của chuyện này**, không phải sync ghi trùng.

**Thiệt hại thật (05/08)**: bước dựng lại của X1 gom `PARTITION BY id` → nhập các đơn
khác nhau của 7 shop làm một, bảng còn **69.775 thay vì 94.566** đơn. Không mất dữ liệu
— `sale_order_raw` giữ đủ, dựng lại bằng khoá đúng là về ngay 94.566. Đây đúng là tính
chất mà tầng raw sinh ra để bảo vệ.

**Đã sửa** (commit 6867422) — khoá (shop, id) ở MỌI nơi:
- sync repo + runtime: rebuild `PARTITION BY shop_label, id`; item theo
  `(shop_id, order_id, item_id)`; `get_existing_versions` khoá `"shop|id"`.
- `vw_orders_std`: thêm cột **`order_uid` = `CONCAT(shop_label,'-',id)`**;
  `items_cogs` GROUP BY `(shop_id, order_id)` và JOIN theo cả hai — trước đó **cộng giá
  vốn của những đơn khác nhau vào nhau**.
- ceo-overview-tab · pnl-tab · marketer-perf · prompt CEO-ask: đếm/dedupe theo `order_uid`.

**Đo lại**:
```sql
SELECT COUNT(*) n, COUNT(DISTINCT order_uid) uid, COUNT(DISTINCT order_id) oid
FROM `cty-507710.TALPHA_Dataset.vw_orders_std`
```
`uid` phải = `n`. Nếu `oid < uid` thì đó là số đơn sẽ bị đếm thiếu nếu ai đó dùng nhầm cột.

**Verify đã đóng 05/08**: 94.566 dòng · `order_uid` duy nhất 94.566 · `order_id` duy nhất
69.775 (chênh 24.791 = mức đếm thiếu nếu dùng sai cột). 9 view deploy + verify OK.

**LUẬT CHO PHIÊN SAU**: viết query trên `vw_orders_std` thì **đếm và dedupe bằng
`order_uid`**, không bao giờ bằng `order_id`. JOIN sang `order_items` phải ghép cả
`shop_id`.

---

## X9 — POS ghi ADSET id vào ô `ad_id` 🟡 (ĐÃ SỬA 06/08)

**Triệu chứng**: 25,8% đơn không nối được về campaign → ROAS theo từng marketer hụt.

**Bóc tách T7+T8 (10.634 đơn hợp lệ)** — đây mới là cách đọc đúng con số 25,8%:

| Nhóm | Đơn | % | Xử lý |
|---|---|---|---|
| Khớp thẳng `ad_id` | 7.885 | 74,1% | — |
| **`ad_id` thực ra là ADSET id** | **999** | **9,4%** | ✅ sửa 06/08 |
| Không có `ad_id` lẫn `adset_id` | 767 | 7,2% | đơn inbox/tự nhiên — đúng là không gán được |
| Id thuộc **TKQC ngoài danh sách 14** | 983 | 9,2% | ⏳ chờ CEO quyết |

**Chẩn đoán đầu tiên SAI — bài học**: tôi kết luận "ad bị thiếu khỏi `fb_ads_data`" và
suýt đi thêm TKQC. Số liệu tự mâu thuẫn đã cứu: đối chiếu ad-level cả TKQC với Meta ra
**0 ad thiếu**, trong khi 3 ad cụ thể lại không có dòng nào trong bảng. Hỏi lại Meta thì
các id đó khớp `fb_adset_data.adset_id`. Khi số liệu mâu thuẫn với lời giải thích của
mình thì **lời giải thích sai** — đừng sửa theo chẩn đoán đầu tiên.

**Đã sửa**: nạp CẢ `fb_adset_data` (adset_id → campaign) vào chung bảng tra bậc 2,
`ad_id` nạp SAU để đè nếu trùng (bản ad chính xác hơn). Áp cho `marketer-perf` route và
`format_all.py` (cả 2 bản). Id nào cũng trỏ về campaign của chính nó nên **không có
chuyện gán nhầm người**; trượt cả hai mới vào "(không gán)".

**Verify**: nối được 7.885 → **8.884**/10.634 đơn (74,1% → **83,5%**), +999 đơn. Commit f25acb6.

**Còn mở — cần CEO quyết**: 983 đơn đến từ **3 TKQC không có trong danh sách 14**:
`act_2165175834409287` · `act_2082756529005182` · `act_4715497232015849`. Token của ta
ĐỌC ĐƯỢC chúng (cùng Business Manager) nhưng campaign đặt tên `Kính/…`, `Thắng …` —
tức **ads của team khác** chạy vào chung shop POS. Thêm vào danh sách sync thì đơn gán
được, nhưng spend của team khác cũng vào dashboard TALPHA. Đây là quyết định kinh doanh,
không phải kỹ thuật.

---

## X13 — Shop Đài lưu NGUYÊN TWD, view chia 100 như GCC 🔴 (ĐÃ SỬA 20/08)

**Triệu chứng** (tab Báo cáo → Tổng quan, khoảng 22/06–20/08/2026):
Taiwan 154 đơn · DS Giao TC **1.384.048 VND** · ads 46.747.621 VND · biên **−3277,6%**
⇒ **8.987 VND/đơn**, trong khi 6 market kia 802k–1,05tr/đơn.

**Đo lại** (cùng query của tab):
```sql
SELECT market, COUNT(DISTINCT order_uid) orders, ROUND(SUM(revenue_vnd),0) revenue_vnd,
       ROUND(SUM(revenue_vnd)/COUNT(DISTINCT order_uid),0) aov_vnd
FROM `cty-507710.TALPHA_Dataset.vw_orders_std`
WHERE order_date BETWEEN '2026-06-22' AND '2026-08-20'
  AND is_confirmed AND marketer_group != 'external'
GROUP BY 1 ORDER BY revenue_vnd DESC
```

**KHÔNG phải tỷ giá.** `markets.Taiwan.rate_vnd = 800` mang ghi chú "tạm 800, xác nhận
khi thêm shop POS Đài" nên rất dễ nghi oan nó. Tỷ giá TWD→VND thật là 780–800 ⇒ sai số
vài %, không thể tạo ra độ lệch 100 lần. Hạ tỷ giá để "chữa" là đi sai hẳn đường.

**Nguyên nhân gốc — đơn vị tiền của shop, không phải tỷ giá.**
`vw_orders_std` giả định "Poscake lưu MINOR UNITS" cho MỌI shop nên chia 100 cứng.
Ground truth POS API (20/08, `GET /shops/{id}/orders`):

| Shop | Đơn | cod thô | Hàng trong đơn | Đọc đúng |
|---|---|---|---|---|
| TW | 336 | **950** | 1 Birthstone Set + 1 BOX | **950 TWD** (~760k VND) |
| TW | 332 | **1390** | 2 Birthstone Set | 1.390 TWD |
| SA | 68974 | 10900 | 2 Pink Bloom Wash | 109,00 SAR |
| SA | 68972 | 22900 | 1 Diamond Set + 1 box | 229,00 SAR |

Bằng chứng thứ hai, trên toàn bảng: `cod` chia hết cho 100 hay không —

| shop | cod ⋮100 | cod KHÔNG ⋮100 |
|---|---|---|
| SA | 50.545 | 61 |
| AE | 25.981 | 35 |
| TW | **3** | **298** |

Giá Đài là các mốc 950 · 1.390 · 999 · 1.499 · 6.999 — giá NT$ thật, không phải minor
units. TWD trên thực tế không có đơn vị phụ, nên shop Đài nhập giá nguyên.

**Đã sửa (lớp 0 + gom về rules file)**: thêm `markets.*.pos_money_divisor` vào
`config/talpha_rules.json` (GCC 100, TW 1); `vw_orders_std` sinh CASE số chia y như cách
sinh CASE tỷ giá (`money_divisor_sql()` trong `deploy_talpha_analytics.py`), cột
`pos_money_divisor` trả ra view để tầng trên đối chiếu được. Vá luôn các đường KHÁC cũng
gõ `/100` cứng: `format_all.py` (Sheet — file TAIWAN cũng đang tụt 100 lần),
`team_report.py`, `report_account_health.py`, `business_rules.py`, `realtime/route.ts`,
`constants.ts`, `bq_context.py`.

**Verify** (cùng query ở trên, sau khi deploy view):

| market | trước | sau | AOV sau |
|---|---|---|---|
| TW | 1.384.048 | **138.404.800** | 898.732 |
| SA/AE/KW/QA/BH/OM | — | **không đổi 1 đồng** | 802k–1,05tr |

Biên TW: −3277,6% → **+66,2%** (rev 138,4tr − ads 46,7tr − ship 0).

**CÒN MỞ — phí ship TW = 0.** `shipping_fees` chưa có khoá `TW` nên `shippingVND()` trả 0
⇒ biên TW đang **cao hơn thực tế**. Đối tác 3PL đọc được từ POS: **BÌNH AN EXP** (212 đơn)
· **NAZA** (64 đơn); `partner.total_fee` POS trả 0 nên KHÔNG suy ra được biểu phí — phải
hỏi CEO (packing · delivery · cod_pct/cod_flat, tệ TWD) rồi khai vào `shipping_fees.TW`
của rules file **và** `SHIPPING_FEES` trong `dashboard-ui/src/components/talpha/utils.ts`.

---

## Đang chờ — KHÔNG phải lỗi, đừng đụng vào

- **B1 cutover sync**: cần 7 ngày shadow PASS liên tiếp, đếm từ 03/08 (03 ✅, 04 ✅
  → sớm nhất 10/08). Kèm `sync_month.py` còn REPO path cũ, sửa cùng đợt cutover.
  ⚠️ X1 nằm trong phạm vi sync — sửa X1 phải đồng bộ với kế hoạch B1, đừng để bản
  repo và runtime lệch thêm.
- **F3 deploy key**: chờ user dán vào GitHub thì `/opt/talpha` mới thành git repo.
  Tới lúc đó deploy vẫn phải `rsync -az --delete` (chạy `--dry-run --itemize-changes`
  trước) — bẫy "rsync không xoá file đã bỏ" đã dính 3 lần: daily.sh, ecosystem, A6.
- **Van chống dội 6h của bot B5**: đang bịt bớt cảnh báo — phải gỡ ngay sau khi X1
  đóng, nếu không detector lại thành trang trí.
