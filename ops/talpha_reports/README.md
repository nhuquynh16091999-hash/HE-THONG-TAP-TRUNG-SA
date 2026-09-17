# ops/talpha_reports — đường ống báo cáo Google Sheets

Bản version-control của các script chạy ở `/root/talpha_reports/` trên VPS.
**SỬA Ở ĐÂY (repo)** → chạy `./deploy_runtime.sh --yes` để đẩy sang runtime.
KHÔNG sửa tay file trong `/root/talpha_reports/`.

## Vòng chạy (systemd `talpha-report.timer`, mỗi giờ phút :20)

1. `daily_guarded.sh` — dọn lock kẹt (>45'), chặn chạy dày (<50' bỏ qua), gọi 2 bước dưới
2. `sync_month.py` — kéo lại tháng hiện tại từ POS + Meta vào BigQuery.
   **KHÔNG drop bảng**: ghi WRITE_TRUNCATE atomic — fetch hỏng thì bảng cũ còn nguyên.
3. `format_all.py` — đọc `fb_ads_data` + `sale_order`, ghi Google Sheet của từng marketer
4. `report_health.py` + `report_account_health.py` — ghi trạng thái vào BigQuery `sync_health`

**Sync hỏng thì KHÔNG ghi Sheet** (chốt 03/09). Giữ số cũ đúng hơn là ghi đè bằng số
thiếu — xem `docs/TALPHA_METRIC_RULES.md` §5. Chạy tay có chủ đích:
`TALPHA_FORCE_FORMAT=1 ./daily_guarded.sh`.

## Engine sync: MỘT bản, nằm trong repo

`sync_month.py` import `sync/talpha/talpha_sync.py` từ **cây repo**, đường dẫn lấy từ
`$TALPHA_REPO` (systemd đặt `/opt/talpha`). Nạp nhầm bản khác thì script **dừng ngay**
trước khi ghi BigQuery.

Trước 11/09/2026 ở đây có `runtime_sync/` — bản sao engine chép sang runtime. Kết quả:
`talpha-sync.timer` chạy bản repo còn `talpha-report.timer` chạy bản sao, hai bộ code
khác nhau cùng ghi một bộ bảng mỗi giờ, bản nào chạy sau thì đè bản kia. Đã xoá.
**Đừng chép engine đi đâu nữa.**

## Files

| File | Việc |
|---|---|
| `talpha_paths.py` | MỘT chỗ giải đường dẫn (reports · runtime · repo · khoá BigQuery) |
| `daily_guarded.sh` | Vòng chạy mỗi giờ: lock, guard, health |
| `sync_month.py` | Kéo lại tháng hiện tại; cửa sổ theo NGÀY TẠO đơn (`TALPHA_ORDER_WINDOW_DAYS`, mặc định 30) |
| `format_all.py` | Sinh báo cáo Sheets; `parse_camp` map campaign → (thị trường, marketer, sản phẩm) |
| `talpha_rules.py` | Đọc `config/talpha_rules.json` — rule dùng chung phía Python |
| `report_health.py` | Chống sync "chết câm" (từng kẹt số cũ cả tuần 22–29/06) |
| `report_account_health.py` | Health theo TỪNG TKQC/shop — bắt lỗi âm thầm khi một mục rơi khỏi sync mà vòng vẫn rc=0 |
| `check_meta_token.py` | Kiểm token Meta TRƯỚC khi tin vào Sheet. Exit 0 = mọi TKQC đọc được |
| `team_report.py` | Báo cáo ADS gộp TEAM + từng marketer (chạy tay) |
| `new_month_files.py` | Quét thư mục Drive tháng mới → in sẵn `GRAND_KEY` + map từng nước. CHỈ ĐỌC. Người và nước đọc từ `talpha_rules.json` |
| `deploy_runtime.sh` | Deploy MỘT CHIỀU repo → runtime (checksum diff, backup, giữ lock) |
| `snapshot_cron.sh` | Gọi `/api/talpha/sync-inventory` để làm tươi `inventory_snapshot` — dự phòng cho tab Kho. **Chưa hẹn giờ** |
| `catalog_cron.sh` | Đồng bộ danh mục sản phẩm từ POS |
| `<nước>_files.json` — `taiwan_files.json` · `singapore_files.json` · `uae_files.json` | ID file Sheet riêng của từng marketer **theo nước**: `{key marketer: ID}`. Xem mục dưới |
| `ad_accounts.json` · `test_files.json` | Bảng tra, đã version-control |

## File riêng: mỗi marketer × mỗi nước MỘT file

Chốt 16/09/2026. Thư mục Drive tháng có một thư mục con cho mỗi người (ANH, LOC, THAI…);
trong đó mỗi nước người đó chạy là một file: `TAIWAN T9`, `SINGAPORE T9`, `UAE T9`. File nào
cũng chỉ một nước — tab `Tổng` (tiền địa phương + tỷ giá) rồi mỗi sản phẩm một tab. Tổng MỌI
nước của một người nằm ở tab của người đó trong file **TỔNG TEAM THÁNG n**.

(15/09 từng gộp mọi nước vào một file, mỗi nước một tab. Tên file vẫn là "TAIWAN T9" nên
mở thư mục tưởng thiếu Singapore — bỏ ngay hôm sau.)

**Thêm file cho một người chạy nước mới:**

1. **Người** tạo Google Sheet trống trong thư mục của marketer, đặt tên `<NƯỚC> T<tháng>`.
   Service account KHÔNG tự tạo được — quota Drive của nó bằng 0. File tạo trong thư mục
   tự thừa hưởng quyền Editor của service account (thư mục đã share sẵn), không cần share lại.
2. Thêm ID vào `<nước>_files.json` (tên nước = key trong `talpha_rules.json`, viết thường).
   Khoá là **key** marketer (`Loc`), không phải tên hiển thị (`Lộc`).
3. `python3 -m pytest tests/test_talpha_file_theo_nuoc.py` — chặn gõ nhầm key, tên file map
   sai, một ID dùng cho hai báo cáo.
4. Deploy (`deploy_runtime.sh` tự mang mọi `*_files.json` theo).

Có số mà thiếu file thì số **không mất** (vẫn nằm trong TỔNG TEAM); log vòng chạy in
`CANH BAO: … CHUA CO FILE`. File trong map mà đã bị xoá hẳn thì vòng chạy bỏ qua riêng file
đó và in `CANH BAO: … KHONG MO DUOC` — không làm đứng file TỔNG TEAM.

## Nối đơn → campaign theo nguồn đơn · tab CHƯA MAP · tab MAP TAY

Sỹ Anh chốt 17/09/2026: đơn POS → cột **Nguồn đơn** (tên page) → khớp ô tên page trong tên camp
Meta → ra camp → ra sản phẩm, marketer, tiền ads. Luật chi tiết: `docs/TALPHA_METRIC_RULES.md`
(dòng *Nối đơn → campaign*).

File **TỔNG TEAM THÁNG n** có thêm hai tab:

* **CHƯA MAP** — đơn trong tháng không nối được camp nào: ngày, shop, mã đơn, nguồn đơn, marketer
  POS, sale, trạng thái, tiền, đang tính cho ai / sản phẩm nào, camp gợi ý theo quảng cáo, lý do.
  Ghi lại mỗi vòng.
* **MAP TAY** — người điền để gán: `Shop | Mã đơn | Nguồn đơn | Marketer | Sản phẩm | Ghi chú`.
  Có mã đơn → đúng đơn đó (phải ghi Shop); để trống mã đơn → mọi đơn từ page đó. Ô trống = giữ
  máy tự gán. **Job không bao giờ ghi đè tab này** (`write_file(..., giu=...)`), chỉ đọc rồi áp
  ở vòng sau. Dòng lỗi (marketer lạ, thiếu Shop…) hiện ở đầu tab CHƯA MAP.
  Sang tháng mới là file mới — tab MAP TAY bắt đầu trống.

Soát bố cục bằng số thật mà không ghi gì: `TALPHA_FORMAT_DRY=1 python format_all.py` — in từng file, từng tab kèm số đơn.

## ĐÃ XOÁ — không hồi sinh

* **`daily.sh`** — `bq rm` 5 bảng RỒI MỚI sync → fetch chết giữa chừng là mất trắng
  dữ liệu (đã xảy ra 06/07). Pattern drop-trước-sync bị CẤM.
* **`quick_update.py`** — scheduler chết + bảng tỷ giá thiếu Taiwan → chạy tay là số sai.
* **`runtime_sync/`** (11/09/2026) — bản sao engine sync, xem mục trên.
* **Bộ shadow-run** `shadow_month.py` · `shadow_run.sh` · `compare_shadow.py` (11/09/2026)
  — dựng để đối chiếu engine mới với engine cũ trước khi cutover. Cutover xong rồi.
* **5 file launchd `.plist`** (11/09/2026) — hạ tầng đã chuyển sang systemd trên VPS.

## Lưu ý

* `format_all.parse_camp` tìm tên thị trường ở BẤT KỲ vị trí nào rồi lấy marketer ô kế
  tiếp → xử lý được tiền tố lạ (`Tặng/`, `LADI/`). Campaign chuẩn:
  `Thị trường / Marketer / SP / ad_id / ...` — xem `docs/CHUAN_DAT_TEN_CAMPAIGN.md`.
* Marketer chưa map bị loại khỏi báo cáo — đúng ý, không phải lỗi.
* Sheet gom đơn theo VN+7; spend theo timezone từng TKQC → **từng ngày lệch, cả tháng
  khớp**. Không phải bug.
