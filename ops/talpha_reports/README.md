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
| `report_files.py` | **Bộ file của TỪNG THÁNG** (01/10/2026): khai tay `report_files/YYYY-MM.json`, không có thì quét thư mục "Tháng N" trên Drive. Tháng tính theo giờ VN |
| `new_month_files.py` | Soát bộ file một tháng trên Drive (`python3 new_month_files.py 2026-10`) — đủ file chưa, file nào sai tên/.xlsx. CHỈ ĐỌC |
| `tao_thang_moi.gs` | Apps Script chạy bằng tài khoản chủ thư mục: share thư mục gốc cho service account, chép khuôn tháng trước sang "Tháng N", tự chạy ngày 25 |
| `deploy_runtime.sh` | Deploy MỘT CHIỀU repo → runtime (checksum diff, backup, giữ lock) |
| `snapshot_cron.sh` | Gọi `/api/talpha/sync-inventory` để làm tươi `inventory_snapshot` — dự phòng cho tab Kho. **Chưa hẹn giờ** |
| `catalog_cron.sh` | Đồng bộ danh mục sản phẩm từ POS |
| `report_files/YYYY-MM.json` | Bộ file KHAI TAY của một tháng (hiện chỉ tháng 9/2026): `{grand, files: {nước: {key marketer: ID}}, test}` |
| `ad_accounts.json` | Bảng tra, đã version-control |

## Mỗi tháng MỘT thư mục (01/10/2026)

Thư mục gốc **CÔNG TY ANTALO / BÁO CÁO ADS ANTALO** (`talpha_rules.json → report_drive`) chứa
`Tháng 9`, `Tháng 10`… Vòng chạy tự tìm bộ file của **tháng đang chạy theo giờ VN** trong
thư mục đó (`report_files.py`) — không còn ID cố định trong code hay `<nước>_files.json`.
Không thấy bộ file của tháng → **không ghi gì** (rc 3, log `CHUA CO BO FILE THANG`), không bao
giờ ghi sang file tháng khác.

Vì sao: 01/10/2026 bộ ID cố định vẫn trỏ file tháng 9, máy chủ (giờ UTC) lật tháng lúc 07:00
sáng → từ 07:22 cả 16 file "Tháng 9" bị xoá sạch tab, ghi số tháng 10, file tổng đổi tên
"TỔNG TEAM THÁNG 10"; tin Zalo 08:30 không gửi được. Dựng lại tháng cũ:
`TALPHA_REPORT_MONTH=2026-09 python format_all.py` (giữ `.lock` như vòng chạy).

**Tháng mới:** service account không tạo được file (quota Drive = 0), nên file do người tạo —
chạy Apps Script `tao_thang_moi.gs` (chép khuôn tháng trước, tự chạy ngày 25), hoặc tạo tay
theo mẫu dưới. Thư mục gốc phải share **Editor** cho
`talpha-dashboard@cty-507710.iam.gserviceaccount.com`. Soát: `python3 new_month_files.py 2026-10`.

## File riêng: mỗi marketer × mỗi nước MỘT file

Chốt 16/09/2026. Thư mục Drive tháng có một thư mục con cho mỗi người (ANH, LOC, THAI…);
trong đó mỗi nước người đó chạy là một file: `TAIWAN T9`, `SINGAPORE T9`, `UAE T9`. File nào
cũng chỉ một nước — tab `Tổng` (tiền địa phương + tỷ giá) rồi **mỗi page một tab, đặt theo tên
page** (17/09/2026, trước đó theo mã sản phẩm — `042` và `042 - BLACK` thành hai tab). Tổng MỌI
nước của một người nằm ở tab của người đó trong file **TỔNG TEAM THÁNG n**.

(15/09 từng gộp mọi nước vào một file, mỗi nước một tab. Tên file vẫn là "TAIWAN T9" nên
mở thư mục tưởng thiếu Singapore — bỏ ngay hôm sau.)

**Thêm file cho một người chạy nước mới:**

1. **Người** tạo Google Sheet trống trong thư mục của marketer **ở thư mục tháng đó**, đặt tên
   `<NƯỚC> T<tháng>`. Service account KHÔNG tự tạo được — quota Drive của nó bằng 0. File tạo
   trong thư mục tự thừa hưởng quyền Editor của service account, không cần share lại.
2. Hết. Vòng :20 kế tiếp tự thấy file (bản nhớ ở `runtime/report_files_cache/YYYY-MM.json`).

Có số mà thiếu file thì số **không mất** (vẫn nằm trong TỔNG TEAM); log vòng chạy in
`CANH BAO: … CHUA CO FILE`. File đã bị xoá hẳn thì vòng chạy bỏ qua riêng file
đó và in `CANH BAO: … KHONG MO DUOC` — không làm đứng file TỔNG TEAM.

## Nối đơn → campaign theo nguồn đơn

Sỹ Anh chốt 17/09/2026: đơn POS → cột **Nguồn đơn** (tên page) → khớp ô tên page trong tên camp
Meta → ra camp → ra sản phẩm, marketer, tiền ads. Luật chi tiết: `docs/TALPHA_METRIC_RULES.md`
(dòng *Nối đơn → campaign*). Đơn không ra được marketer nằm ở tab **"(không gán)"** của file
TỔNG TEAM. (17/09 từng thêm tab CHƯA MAP + MAP TAY — gỡ ngay hôm đó vì trùng việc với tab
"(không gán)".)

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
