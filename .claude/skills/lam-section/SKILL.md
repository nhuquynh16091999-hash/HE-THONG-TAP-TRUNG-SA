---
name: lam-section
description: >-
  Quy trình BẮT BUỘC khi làm 1 hạng mục (section) trong lộ trình tối ưu TALPHA
  (mã A1–F4, giai đoạn P0/P1/P2): khoanh phạm vi → git sạch → pull → sửa →
  verify số thật → ĐÚNG 1 commit theo mã section → push ngay → deploy
  runtime/server nếu cần → báo cáo hash. LUÔN dùng skill này khi user nói
  "làm A4", "sửa hạng mục B2", "fix section E3", "làm P0", "/lam-section ..."
  hay bất kỳ yêu cầu nào tham chiếu mã section trong sơ đồ cây tối ưu TALPHA.
  Không dùng skill này = nguy cơ để file treo, các phiên Claude song song
  dẫm chân nhau, repo↔runtime↔server lệch phiên bản.
---

# lam-section — Quy trình làm 1 hạng mục tối ưu TALPHA

## Vì sao có skill này

Dự án chạy nhiều phiên Claude song song, mỗi phiên một section. Các phiên KHÔNG
thấy nhau — kênh phối hợp duy nhất là git. Đã từng xảy ra: 3 phiên (P0-A3, P0-A4,
P0-B2) xong việc nhưng không commit → 8 file treo trộn lẫn 3 hạng mục, phiên sau
không dám sửa gì. Ngoài ra hệ TALPHA có code chạy NGOÀI repo (runtime
`/root/talpha_reports/` trên VPS `139.180.131.21`) — push xong chưa chắc hệ thống
chạy bản mới; deploy là `bash ops/deploy/from-mac.sh`. Skill này chốt kỷ luật: **1 section = 1 commit = push ngay = deploy nơi đang chạy**.

## Ủy quyền

User gọi skill này (qua `/lam-section <MÃ>` hoặc "làm <MÃ>") = **đã cho phép
commit và push** cho đúng section đó. Không cần hỏi lại trước khi commit/push,
NHƯNG chỉ trong phạm vi file của section — mọi file ngoài phạm vi không được add.

## Quy trình 8 bước — làm đúng thứ tự

### 0. Nhận diện section
- Lấy mã section từ args (VD: `A4`). Không có mã → hỏi user làm section nào rồi dừng chờ.
- Đọc `references/sections.md` mục tương ứng: phạm vi file, cách verify, nơi deploy.
- Section đụng số liệu/dashboard/sheet/bot (hầu hết A, B, D, E) → đọc skill
  `talpha-system` TRƯỚC khi sửa dòng code đầu tiên.

### 1. Kiểm tra working tree
Chạy `git status --short`.
- Có file treo KHÔNG thuộc phạm vi section → **DỪNG**, liệt kê file + đoán chúng
  thuộc section nào, báo user quyết định (commit hộ / stash / bỏ). Không sửa đè.
- File treo thuộc đúng phạm vi (phiên trước làm dở) → báo user rồi tiếp tục trên đó.

### 2. Đồng bộ
`git pull talpha-new main` — lấy commit mới nhất từ các phiên khác trước khi sửa.

### 3. Kiểm tra tranh chấp file
Đối chiếu bảng dưới. Nếu user đang cho phiên khác chạy section cùng hàng → cảnh báo
ngay từ đầu, đề nghị làm tuần tự:

| File bị nhiều section giành | Các section |
|---|---|
| `config/projects/talpha.yaml` (+ bản copy `dashboard-ui/config/`) | A3 · E3 |
| `dashboard-ui/src/app/api/talpha/realtime/route.ts` | A3 · D1 · E3 |
| `format_all.py` (ops + runtime) | B1 · E3 |
| `sync/talpha/` + runtime sync | B1 · B2 · E3 |
| `ops/whatsapp-alerts/` | D1 · D2 · D3 · B5 |

### 4. Sửa code — đúng phạm vi
Chỉ sửa file thuộc section. Phát hiện lỗi ngoài phạm vi → KHÔNG sửa lan, ghi lại
để báo cuối phiên (hoặc spawn task riêng). Guard bất di bất dịch của repo vẫn áp
dụng: không DELETE/DROP/TRUNCATE BigQuery, runner phải `--dry-run` lần đầu,
không commit `.env`/`bigquery_key.json`.

### 5. Verify bằng số thật
Làm theo mục verify của section trong `references/sections.md`. Nguyên tắc chung:
ground truth là Meta API (spend) và POS API (đơn) — KHÔNG so Sheet↔BigQuery với
nhau. Verify fail → sửa tiếp, không commit code chưa chạy được.

### 6. Commit — ĐÚNG 1 commit
- `git add` từng file trong phạm vi. Cấm `git add -A` / `git add .`
- Message: `<type>(talpha): <MÃ> — <mô tả ngắn tiếng Việt>`
  - type: `fix` (sửa lỗi) / `feat` (tính năng) / `chore` (dọn dẹp) / `docs`
  - VD: `fix(talpha): A4 — hồi sinh /api/ad-accounts, trỏ đúng ops/talpha_reports`
  - VD: `chore(talpha): B2 — archive daily.sh nguy hiểm khỏi repo + runtime`
- Làm dở phải nghỉ giữa chừng → vẫn commit 1 commit đánh dấu `WIP(talpha): <MÃ> — ...`
  và push, để phiên sau thấy được.

### 7. Push ngay
`git push talpha-new main`. Bị reject vì phiên khác push trước → `git pull --rebase`
rồi push lại. Không bao giờ force push.

### 8. Deploy nơi đang chạy (nếu section có)
Cột "Deploy" trong `references/sections.md`. Section đụng runtime `/root/talpha_reports/`
hoặc VPS `139.180.131.21` mà chưa chạy `ops/deploy/from-mac.sh` = **CHƯA XONG**,
không được báo done.
Thao tác deploy cụ thể theo `talpha-system` → `references/runbook.md`.

## Báo cáo cuối phiên — theo đúng mẫu

```
✅ <MÃ> — <tên section>
- File đã sửa: <danh sách>
- Verify: <đã kiểm tra gì, kết quả số>
- Commit: <hash ngắn> — <message>  |  Push: ✅/❌
- Deploy: ✅ <nơi nào> / ❌ chưa cần / ⚠️ CẦN NHƯNG CHƯA (lý do)
- Ngoài phạm vi phát hiện: <lỗi gặp nhưng không sửa, thuộc section nào>
```

## References

- `references/sections.md` — danh mục 22 section: phạm vi file · verify · deploy.
  Đọc đúng mục section được giao, không cần đọc hết.
