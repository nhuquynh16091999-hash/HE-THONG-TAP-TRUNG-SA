# Danh mục 22 section tối ưu TALPHA — phạm vi · verify · deploy

> Nguồn: audit `docs/proposals/AUDIT_HE_THONG_2026-07-29.md` + artifact
> "TALPHA — Sơ đồ hệ thống & Lộ trình tối ưu". Đường dẫn là điểm neo đã biết
> lúc audit 29/07/2026 — trước khi sửa hãy xác nhận lại vị trí thực tế bằng
> Glob/Grep, nhưng KHÔNG mở rộng phạm vi sang nhánh khác.

## A · Dashboard

### A1 — 6 tab BigQuery (P1)
- **Việc**: bỏ SQL inline, chuyển query sang `vw_orders_std`/`vw_fb_ads_std` (sau khi E1 fix xong); nhãn rõ "DS đặt" vs "DS Giao TC".
- **Phạm vi**: `dashboard-ui/src/components/talpha/tabs/*` (6 tab BQ: CEO, Marketing, P&L, P&L theo SP, Khách hàng, Market Intel).
- **Verify**: mở từng tab, tổng doanh thu GTC khớp rule `SUM(cod)/100 WHERE GIAO_THANH_CONG` — đối chiếu 1 ngày cụ thể bằng query tay lên BQ.
- **Deploy**: `bash ops/deploy/from-mac.sh` chạy TỪ MÁY MAC — đây là cách duy nhất. `npm run build` ở Mac chỉ đổi bản localhost.
- **Phụ thuộc**: E1 xong trước.

### A2 — P&L theo SP + Market Intel (P0 phần CAST · P2 phần order_items)
- **Việc P0**: sửa JOIN `order_items` thiếu CAST trong `product-pnl-tab.tsx` (đối chiếu cách JOIN của market-intel).
- **Phạm vi**: `dashboard-ui/src/components/talpha/tabs/product-pnl-tab.tsx` (+ market-intel tab nếu cần đồng bộ cách JOIN).
- **Verify**: tab trả dữ liệu ≠ rỗng; chạy query JOIN trực tiếp trên BQ xác nhận số dòng > 0.
- **Deploy**: như A1.

### A3 — Ads Command Center (P0 phần ACCOUNT_NAMES · P1 nhãn ROAS · P2 log cap)
- **Việc P0**: ACCOUNT_NAMES 11→14 — tốt nhất đọc tên từ `talpha.yaml`, xoá map hard-code.
- **Phạm vi**: `dashboard-ui/src/app/talpha/ads-command-center/page.tsx`, `dashboard-ui/src/app/api/talpha/realtime/route.ts`, `config/projects/talpha.yaml` (+ bản copy `dashboard-ui/config/projects/talpha.yaml` — sửa thì sửa CẢ HAI).
- **Verify**: tab hiện đủ **14 TKQC có tên** (không còn raw id); tổng spend hôm nay khớp Meta API.
- **Deploy**: như A1.
- **⚠ Tranh chấp**: chung file với E3, D1.

### A4 — TKQC Manager /admin (P0)
- **Việc**: `/api/ad-accounts` trỏ đúng `ops/talpha_reports/ad_accounts.json`.
- **Phạm vi**: `dashboard-ui/src/app/api/ad-accounts/route.ts`.
- **Verify**: mở `/admin` thấy đủ 14 TKQC; POST thử 1 thay đổi không 404 (nhớ revert thay đổi thử).
- **Deploy**: như A1.

### A5 — "Hỏi dashboard" CEO-ask (P2)
- **Việc**: system prompt sinh tự động từ rules file (sau E3); cập nhật docs Gemini.
- **Phạm vi**: `dashboard-ui/src/app/api/talpha/ceo-ask/route.ts`.
- **Verify**: hỏi 3 câu chuẩn (doanh thu GTC hôm qua theo shop; spend theo marketer; top SKU) — SQL sinh ra đúng rule, guardrail SELECT-only còn nguyên.
- **Phụ thuộc**: E3 xong trước.

### A6 — Route & tab legacy (P2)
- **Việc**: chuyển vào `_archive/`: 12 tab cũ `components/tabs/`, `bq-queries.ts`, `bq-schema.ts`, `marketer-map.ts`, war-room / ai-brain routes, `/api/executive-report`.
- **Verify**: `npm run build` sạch; grep không còn import nào trỏ file đã archive.
- **Deploy**: như A1.

## B · Sheets & Sync

### B1 — Hợp nhất 2 bản sync (P1 — việc lớn, nên có nhánh riêng)
- **Việc**: bản repo `sync/talpha/` + `sync/core/` làm chuẩn; port `fb_adset_data` từ bản runtime; biến `~/talpha_reports/runtime/sync/` thành bản deploy từ git (script deploy 1 chiều có checksum).
- **Phạm vi**: `sync/talpha/`, `sync/core/`, runtime `~/talpha_reports/runtime/sync/`, script deploy mới trong `ops/talpha_reports/`.
- **Verify**: shadow-run bản mới với `--dry-run` so sánh row count từng bảng với bản cũ cùng khoảng ngày; launchd chạy 1 chu kỳ thật thành công (xem log `~/talpha_reports/logs/`).
- **Deploy**: **BẮT BUỘC** cập nhật runtime — xong repo mà chưa deploy runtime = chưa xong. Lưu ý memory: `sync_month.py` có REPO path cũ, sửa cùng đợt.
- **⚠ Tranh chấp**: chung file với B2, E3.

### B2 — Script phụ trợ nguy hiểm (P0)
- **Việc**: archive `daily.sh` (bản bq rm — pattern từng gây mất data 06/07) khỏi CẢ repo lẫn runtime; xoá `quick_update.py` (hoặc bổ sung Taiwan RATE=800 nếu user muốn giữ).
- **Phạm vi**: `ops/talpha_reports/daily.sh`, `ops/talpha_reports/quick_update.py`, bản tương ứng trong `~/talpha_reports/`.
- **Verify**: `launchctl list | grep talpha` xác nhận không lịch nào gọi 2 file này; file đã vào `_archive/` hoặc xoá.
- **Deploy**: xoá/di chuyển bản runtime cùng lúc.

### B3 — File mapping vào git (P0)
- **Việc**: copy `test_files.json` + `taiwan_files.json` từ `~/talpha_reports/` vào `ops/talpha_reports/` (git); thêm SAnh vào taiwan; sửa code đọc để runtime vẫn đọc đúng chỗ.
- **Phạm vi**: `ops/talpha_reports/*.json`, `~/talpha_reports/test_files.json`, `~/talpha_reports/taiwan_files.json`.
- **Verify**: chạy format_all 1 lần (hoặc chờ chu kỳ launchd) — file Taiwan của SAnh được tạo/cập nhật.
- **Deploy**: đồng bộ bản runtime.

### B4 — Export worker & lock (P1)
- **Việc**: tách `.lock` riêng cho export_worker khỏi daily_guarded, hoặc lock có timeout + PID check.
- **Phạm vi**: `ops/talpha_reports/export_worker*`, `daily_guarded.sh`, bản runtime tương ứng.
- **Verify**: giả lập worker chết giữa chừng (kill) → chu kỳ sync sau vẫn chạy được, không kẹt 45'.
- **Deploy**: **BẮT BUỘC** runtime + reload launchd.

### B5 — Sync health monitor (P2)
- **Việc**: mỗi lần sync ghi 1 dòng trạng thái (rows/account, ok/fail); bot WA gửi cảnh báo khi fail.
- **Phạm vi**: sync (sau B1 hợp nhất), `ops/whatsapp-alerts/`.
- **Verify**: giả lập 1 account fail → trong 1 chu kỳ, nhóm "BOT AI THÔNG BÁO" nhận tin cảnh báo.
- **Deploy**: `ops/deploy/from-mac.sh`; phần báo cáo Sheets thêm `ops/talpha_reports/deploy_runtime.sh --yes` trên VPS.
- **Phụ thuộc**: B1 xong trước.

## C · Tồn kho

### C1 — POS live + fallback (P1)
- **Việc**: parser Sheet UAE/Saudi đọc theo header thay vì chuỗi literal; UI banner "đang dùng dữ liệu dự phòng ngày X" khi rơi xuống fallback.
- **Phạm vi**: `dashboard-ui/src/app/api/talpha/inventory/route.ts`, `dashboard-ui/src/lib/talpha-inventory.ts`, `talpha-pos-images.ts`, `components/talpha/data/inventory.ts`.
- **Verify**: tab Kho hiện số POS live khớp POS thật 1-2 SKU; ngắt POS (đổi token tạm) → banner fallback hiện.
- **Deploy**: như A1.

### C2 — Scheduler hoá snapshot (P2)
- **Việc**: cron/launchd gọi `sync-inventory` + `snapshot-ads` định kỳ.
- **Phạm vi**: routes `sync-inventory`, `snapshot-ads`, file plist/cron mới trong `ops/`.
- **Verify**: sau 2 chu kỳ, `inventory_snapshot` có thêm 2 dòng mới đúng giờ (query BQ).
- **Deploy**: load plist trên máy chạy (Mac).

## D · Bot WhatsApp

> Mọi section D: code repo `ops/whatsapp-alerts/`, chạy thật tại server
> VPS 139.180.131.21 `/opt/talpha/`, pm2 `talpha-wa-alerts` (ĐANG TẮT). Deploy = from-mac.sh + restart
> theo runbook. **Không test bot trên Mac** — localhost:3001 trên Mac là app
> broadcast khác (404 im lặng).

### D1 — Tin định kỳ + /kho (P1)
- **Việc**: thay logic gán marketer nội bộ bot bằng module attribution chung (sau E3).
- **Phạm vi**: `ops/whatsapp-alerts/` (daily_report.js và các file tin).
- **Verify**: tin báo cáo marketer trong nhóm khớp tên/số với Sheet cùng ngày.
- **Phụ thuộc**: E3 xong trước.

### D2 — Dead code poll() (P0)
- **Việc**: HỎI USER chọn 1 trong 2 trước khi làm: (a) xoá `poll()` + config `pollMinutes/reArmDays` + sửa README; (b) đăng ký lại `setInterval` để tính năng sống thật.
- **Phạm vi**: `ops/whatsapp-alerts/` (file cảnh báo tồn + README).
- **Verify**: (a) grep sạch tham chiếu; (b) hạ ngưỡng tạm 1 SKU → nhận tin cảnh báo rồi trả ngưỡng cũ.

### D3 — Deploy & test bot (P2)
- **Việc**: base URL dashboard vào biến env; deploy bằng git pull thay rsync tay.
- **Phạm vi**: `ops/whatsapp-alerts/` config + script deploy.
- **Verify**: bot restart trên server vẫn gửi tin chu kỳ kế tiếp.

## E · Data layer & rule chung

### E1 — Views chuẩn hoá (P1)
- **Việc**: fix chia cứng `/7010` → tỷ giá theo `shop_label`; thêm Taiwan (800) vào view FX.
- **Phạm vi**: `sql/talpha/views/*.sql`.
- **Verify**: SELECT thử trên view — đơn KW nhân 83000, TW nhân 800; tổng VND 1 ngày khớp tab hiện tại (trong sai số timezone đã biết).
- **Deploy**: chạy `CREATE OR REPLACE VIEW` lên BQ (không đụng bảng — vẫn cấm DELETE/DROP bảng).

### E2 — order_items + COGS (P2 — việc lớn)
- **Việc**: fix sync `order_items` từ POS; sau đó trừ COGS (cost_price 27 SKU trong yaml) ở P&L theo SP.
- **Phạm vi**: sync (sau B1), `product-pnl-tab.tsx`, views liên quan.
- **Verify**: đếm dòng order_items 1 ngày > 0 và khớp số item trên POS 2-3 đơn cụ thể.
- **Phụ thuộc**: B1 xong trước.

### E3 — Rules file + attribution chung (P1 — việc quan trọng nhất, nên có nhánh riêng)
- **Việc**: 1 file rule máy-đọc-được (mở rộng `config/projects/talpha.yaml` hoặc `config/talpha_rules.json`): 7 marketer + mọi variant tên (bẫy Unicode Thuý/Thúy — match bằng "THU"), tỷ giá 7 thị trường CÓ Taiwan, 14 TKQC + timezone từng account, status GTC, shop_label, phí ship, cost_price. Kèm 1 module attribution (Python + TS) theo rule CEO: tag POS → ad_id→chủ camp → "(không gán)". Sau đó thay dần 7 bản mapping cũ.
- **Phạm vi**: `config/`, module mới (`sync/core/` + `dashboard-ui/src/lib/talpha/`), rồi từng consumer: `format_all.py`, `realtime/route.ts`, `ads-alerts/route.ts`, bot `daily_report.js`.
- **Verify**: chạy song song mapping cũ vs mới trên 1 ngày dữ liệu — diff từng đơn/từng camp, chỉ được khác ở các case đã biết là bug cũ.
- **Deploy**: runtime + server bot sau khi thay consumer tương ứng.
- **⚠ Tranh chấp**: chung file với A3, B1, D1 — không chạy song song với các section đó.

## F · Vận hành & bảo mật

### F1 — Log & disk (P0)
- **Việc**: `pm2 install pm2-logrotate` (Mac + server); xoá ~3.3GB log cũ (`talpha-dashboard-error.log` 2.06GB, `talpha-broadcast-error.log` 1.24GB).
- **Verify**: `pm2 conf pm2-logrotate` hiện config; file log cũ đã về 0/xoá.
- **Deploy**: làm trực tiếp cả 2 máy. Lưu ý: xoá log là hành động xoá dữ liệu — xác nhận với user trước khi xoá (log lỗi cũ có thể cần tra).

### F2 — Secrets (P0)
- **Việc**: rotate `GEMINI_API_KEY` (user tự tạo key mới — Claude không tự tạo/nhập key); quy `bigquery_key.json` về 1 vị trí; kiểm tra `.gitignore` phủ đủ.
- **Verify**: key cũ revoke xong CEO-ask vẫn chạy với key mới; `git log --all --  '*bigquery_key.json'` không có key trong lịch sử.
- **⚠**: TUYỆT ĐỐI không commit key/token; không in key ra log.

### F3 — Deploy & pm2 (P0 phần xoá file chết · P2 phần còn lại)
- **XONG 11/09/2026**: còn đúng MỘT file pm2 (`ops/pm2/ecosystem.vps.config.js`), `/opt/talpha` đã là bản git clone, deploy bằng `ops/deploy/from-mac.sh` (máy chủ mượn khoá GitHub của Mac qua `ssh -A`, không cần deploy key riêng).
- **Verify**: `pm2 status` các app vẫn online sau thay đổi.

### F4 — Docs (P2)
- **XONG 11/09/2026**: tài liệu viết lại theo hệ thật (`DASHBOARD_MAP.md` + `docs/TALPHA_METRIC_RULES.md`); 9 tài liệu di sản đã xoá.
- **Verify**: đọc chéo với code thực tế — không còn câu nào mô tả ngược với code đang chạy.
