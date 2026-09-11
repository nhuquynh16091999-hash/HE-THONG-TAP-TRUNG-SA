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
| `export_worker.py` | Poll BigQuery `export_jobs` — nút "Xuất Sheet" trên web đẩy job vào |
| `team_report.py` | Báo cáo ADS gộp TEAM + từng marketer (chạy tay) |
| `new_month_files.py` | Quét thư mục Drive tháng mới → sinh sẵn map cho `format_all.py`. CHỈ ĐỌC |
| `deploy_runtime.sh` | Deploy MỘT CHIỀU repo → runtime (checksum diff, backup, giữ lock) |
| `snapshot_cron.sh` | Gọi `/api/talpha/sync-inventory` và `/api/talpha/snapshot-ads` để hai bảng snapshot không chết đứng |
| `catalog_cron.sh` | Đồng bộ danh mục sản phẩm từ POS |
| `ad_accounts.json` · `taiwan_files.json` · `test_files.json` | Bảng tra, đã version-control |

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
