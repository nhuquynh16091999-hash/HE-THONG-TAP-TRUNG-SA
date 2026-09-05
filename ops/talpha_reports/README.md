# ops/talpha_reports — Báo cáo ads daily (Google Sheets)

Bản version-control của các script chạy ở `~/talpha_reports/` (launchd **mỗi giờ**).
Quy trình từ 29/07/2026: **SỬA Ở ĐÂY (repo)** → chạy `./deploy_runtime.sh --yes` để đẩy
sang runtime. KHÔNG sửa tay file trong `~/talpha_reports/` nữa.

## Luồng chính (launchd `com.talpha.dailyreport`, StartInterval 3600s)

1. `daily_guarded.sh` — dọn lock kẹt (>45'), guard chống chạy dày (<50' bỏ qua)
2. `sync_month.py` — sync tháng hiện tại từ POS + Meta vào BigQuery.
   **KHÔNG drop bảng**: ghi WRITE_TRUNCATE atomic — fetch fail thì bảng cũ còn nguyên
   (số cũ nhưng đúng), exit code ≠ 0 để soi log.
3. `format_all.py` — đọc fb_ads_data + sale_order, ghi ~56 Google Sheet (8 marketer × market)
4. `report_health.py` — ghi 1 dòng vào BQ `sync_health` (bot WA đọc qua `/api/talpha/sync-health`)

## Files

- `daily_guarded.sh` — orchestrator mỗi giờ (lock + guard + health)
- `sync_month.py` — resync full tháng; dưới launchd import engine RUNTIME qua `PYTHONPATH`
  (lưu ý: biến `REPO` bên trong còn trỏ path repo cũ `Agentic-AI-Levelup` — chạy tay phải
  set `PYTHONPATH=~/talpha_reports/runtime`; sẽ dọn khi cutover engine, xem bên dưới)
- `format_all.py` — sinh ~56 báo cáo Sheets; `parse_camp` map campaign → (market, marketer, product)
- `report_health.py` — chống sync "chết câm" (từng kẹt số cũ cả tuần 22–29/6)
- `export_worker.py` — launchd `com.talpha.export-worker`: poll BQ `export_jobs` 20s (nút "Xuất Sheet" trên web)
- `talpha_rules.py` + `config/talpha_rules.json` — rules chung (marketer, tỷ giá CÓ Taiwan 800, TKQC)
- `test_files.json` / `taiwan_files.json` / `ad_accounts.json` — mapping, đã version-control từ 29/07
- `runtime_sync/` — bản runtime của `talpha_sync.py` + `config_loader` + `order_sync_utils`
  (deploy sang `~/talpha_reports/runtime/sync/`)
- `deploy_runtime.sh` — deploy MỘT CHIỀU repo → runtime (checksum diff, backup, giữ lock)
- `shadow_run.sh` / `shadow_month.py` / `compare_shadow.py` — launchd `com.talpha.shadowsync` 21:30:
  chạy engine sync của repo ghi bảng `*_shadow`, so khớp với bảng thật; khớp 7 ngày liên tục
  → cutover theo `docs/proposals/SYNC_CONSOLIDATION_PLAN.md`
- `team_report.py` — báo cáo ADS gộp TEAM + từng marketer (file "Tháng 6 AI")
- `snapshot_cron.sh` + `com.talpha.snapshot-inventory.plist` (15') / `com.talpha.snapshot-ads.plist` (30'):
  gọi `/api/talpha/sync-inventory` và `/api/talpha/snapshot-ads` của dashboard Mac để 2 bảng
  snapshot BQ không chết đứng (C2 — trước đó `inventory_snapshot` dừng 10/07, `ads_command_snapshot`
  dừng 18/06). `inventory_snapshot` LÀ nguồn dự phòng của tab Kho khi POS chết → cũ = tab Kho hiện số cũ

## Cài 2 job snapshot (C2) — làm 1 lần trên máy chạy dashboard

```bash
./deploy_runtime.sh --yes                       # đẩy snapshot_cron.sh sang runtime
cp ops/talpha_reports/com.talpha.snapshot-*.plist ~/Library/LaunchAgents/
launchctl unload ~/Library/LaunchAgents/com.talpha.snapshot-inventory.plist 2>/dev/null
launchctl load   ~/Library/LaunchAgents/com.talpha.snapshot-inventory.plist
launchctl unload ~/Library/LaunchAgents/com.talpha.snapshot-ads.plist 2>/dev/null
launchctl load   ~/Library/LaunchAgents/com.talpha.snapshot-ads.plist
tail -f ~/talpha_reports/snapshot_$(date +%Y%m%d).log
```

Dashboard bật `TALPHA_SYNC_TOKEN` → tạo `~/talpha_reports/snapshot_cron.env` (KHÔNG vào git)
với `TALPHA_SYNC_TOKEN=...` khớp `.env.local`; đổi cổng thì thêm `TALPHA_DASH_URL=...`.

## ĐÃ XOÁ — không hồi sinh (P0-B2, audit 29/07)

- **`daily.sh`** — bq rm 5 bảng RỒI MỚI sync → fetch chết giữa chừng là mất trắng data
  (đã xảy ra 06/07). Xoá khỏi repo (commit `cfcb499`), runtime archive tại
  `~/talpha_reports/_archive/daily.sh.DANGEROUS-bq-rm`. Pattern drop-trước-sync bị CẤM —
  sync hiện tại WRITE_TRUNCATE atomic, không cần drop.
- **`quick_update.py`** — scheduler chết + bảng tỷ giá RATE thiếu Taiwan → chạy tay là số sai.
  Archive tại `~/talpha_reports/_archive/quick_update.py.dead-no-scheduler`.
  Cần re-sync tay: dùng `sync_month.py` theo `.claude/skills/talpha-system/references/runbook.md`.

## Lưu ý quan trọng

- `format_all.parse_camp`: tìm tên thị trường ở BẤT KỲ vị trí nào rồi lấy marketer ô kế tiếp
  → xử lý được tiền tố lạ (`Tặng/`, `LADI/`). Campaign chuẩn: `Thị trường / Marketer / SP / ad_id / ...`
- Marketer chưa map (Thắng, Kính = team khác) bị loại khỏi báo cáo — đúng ý.
- Sheet gom đơn theo VN+7; spend theo timezone từng TKQC → từng ngày lệch, cả tháng khớp
  (KHÔNG phải bug — xem `docs/TALPHA_METRIC_RULES.md`).
