---
name: alpha
description: >-
  Skill TỔNG CHỈ HUY dự án TALPHA — tóm tắt toàn hệ thống, trạng thái lộ trình
  P0/P1/P2 + sổ lỗi X, việc còn mở, và điều phối sang 3 skill con (talpha-system,
  lam-section, xu-ly-p1). LUÔN dùng khi user gõ "alpha", "/alpha", mở phiên mới
  hỏi "tình trạng dự án", "đang tới đâu rồi", "làm gì tiếp theo", "tiếp tục công
  việc", "tổng quan hệ thống", hoặc khi chưa rõ việc user giao thuộc skill nào.
  Đây là điểm vào mặc định của mọi phiên làm việc TALPHA.
---

# alpha — Tổng chỉ huy dự án TALPHA

## Hệ thống trong 5 dòng

TALPHA = vận hành + BI cho team bán trang sức/mỹ phẩm qua FB Ads + chat-sale +
COD tại GCC (6 nước) + Taiwan. Dashboard 8 tab (Mac :3000, server 169.58.33.8:3001)
+ ~50 Google Sheets (launchd mỗi giờ) + tồn kho POS live + bot WhatsApp cảnh báo.
Nguồn sự thật: BigQuery `talpha-faos-2026.TALPHA_Dataset`. Repo này = code cho
tất cả; GitHub `syanh12092024-maker/Talpha-New-16-6`, remote tên `talpha-new`.

## Điều phối — việc nào skill nấy

| Việc user giao | Skill | Ghi chú |
|---|---|---|
| Đụng số liệu/dashboard/sheet/bot/kho — BẤT KỲ | `talpha-system` | Đọc TRƯỚC khi sửa dòng code đầu tiên. Rule chỉ số CEO duyệt + bẫy chết người |
| Làm 1 hạng mục có mã (A1…F4) | `lam-section` | Quy trình: git sạch → sửa → verify → 1 commit/section → push → deploy |
| "Số sai/thiếu/nhảy", lỗi mã X, cảnh báo sync-health | `xu-ly-p1` | Chẩn đoán bằng ground truth TRƯỚC, sửa sau. Sổ lỗi X trong references |
| Chưa rõ thuộc loại nào | ở lại `alpha` | Đọc mục Trạng thái dưới đây rồi quyết |

## Kỷ luật bất di bất dịch (tóm từ 3 skill con — chi tiết ở đó)

1. **Ground truth** = Meta API (spend) + POS API (đơn). KHÔNG BAO GIỜ so Sheet↔BQ.
2. **1 section = 1 commit = push ngay**. Commit bằng pathspec `git commit -- <paths>`
   (index dùng chung giữa các phiên song song). CẤM `git reset HEAD~N`.
3. **Deploy**: Mac = `npm run build` + `pm2 restart talpha-dashboard` (KHÔNG tự
   reload); server = `ssh talpha-server 'cd /opt/talpha && bash scripts/deploy_server.sh'`
   (git pull — KHÔNG rsync tay nữa, bẫy đã dính 4 lần). KHÔNG `git clean` trên
   `/opt/talpha` (xoá mất .env.local, key, phiên WhatsApp).
4. **Sync = 2 bản** (repo `sync/` + runtime `~/talpha_reports/runtime/sync/`) cho
   tới khi B1 cutover — sửa sync phải vá CẢ HAI.
5. **BigQuery free tier**: cấm DML/DELETE/DROP; ghi = LOAD JOB; sửa bảng =
   query→destination. Mọi bảng đã chuyển raw/rebuild — KHÔNG quay lại WRITE_TRUNCATE.
6. Cảnh báo kêu nhiều KHÔNG phải lý do nới ngưỡng; số liệu mâu thuẫn với lời giải
   thích → lời giải thích sai.

## Trạng thái lộ trình — chốt 05/08/2026

> Con số trôi theo thời gian. Trước khi báo cáo user, đo lại bằng query trong
> `xu-ly-p1/references/loi-dang-mo.md`, đừng chép nguyên đoạn này.

- **P0 (9 mục): ✅ 9/9** — đóng sổ 03/08.
- **P1 (8 mục): 7/8** — còn B1 (hợp nhất 2 bản sync): cần 7 ngày shadow PASS
  liên tiếp, đồng hồ đếm lại từ **05/08** (2 lần hạ tầng validation hỏng oan —
  xem memory `b1-shadow-validation-broken-clone`, có 3 bước kiểm trước khi tin
  kết quả shadow) → sớm nhất **12/08** cutover.
- **P2 (8 mục): ✅ 8/8** — A5, A6, B5, C2, D3, E2, F3, F4.
- **Sổ lỗi X**: X1 ✅ · X2 ✅ · X6 ✅ · X7 ✅ · X8 ✅ — còn **X3** (giá vốn,
  chờ user + sheet) và **X4** (~14 dòng sku bẩn còn lại, nhỏ).

## Việc đang mở — thứ tự ưu tiên

1. **X3 — giá vốn SKU (chờ 2 thứ từ user)**: (a) user share Google Sheet giá vốn
   (`1MFV6X_Lppace2F7t8PX0MZwt6otWRmV-gbOdZBIC7Ak`) cho service account
   `faos-dashboard@talpha-faos-2026.iam.gserviceaccount.com` quyền Viewer;
   (b) khi đọc được: đối chiếu SKU sheet ↔ `product_catalog`, cập nhật
   `config/talpha_rules.json → products`, BÁO SỐ user duyệt rồi mới deploy view.
   Giá vốn sai = mọi số lãi sai — không tự đoán đơn vị tiền.
2. **B1 cutover (sau khi đủ 7 ngày PASS, sớm nhất 12/08)**: theo
   `docs/proposals/SYNC_CONSOLIDATION_PLAN.md`; sửa cùng đợt: `sync_month.py`
   REPO path cũ + script tay `~/talpha_reports/sync_oman.py` còn gọi chữ ký cũ
   (`last_sync_ts`) sẽ crash nếu chạy.
3. **X4 — dọn nốt sku bẩn** trong `product_catalog` (14 dòng không đúng dạng mã,
   VD `sku='Necklace box'` tách đôi doanh thu SP 008) — sửa ở
   `sync_product_catalog.py`, chạy lại rồi đo lại X3.
4. **fb_campaign_data chưa rà** — có thể cùng họ lỗi WRITE_TRUNCATE (X2) nhưng
   bảng không có cột `date`, cần kiểm cách ghi trước khi kết luận.
5. **F2 phần user**: revoke key Gemini cũ trên aistudio.google.com (đã gỡ khỏi
   2 máy, "Hỏi dashboard" đã tắt theo quyết định user 03/08).

## Bài học đắt giá nhất (đủ ngắn để nhớ, chi tiết trong memory)

- **WRITE_TRUNCATE là họ lỗi ăn dữ liệu số 1**: X1 (đơn 3.960→69.775 sau fix),
  X2 (mất trắng tháng 7 ads), catalog E2 (xoá trắng vì thiếu .env). Khuôn chữa:
  append vào `*_raw` + dựng lại bảng bằng query→destination.
- **`order_id` KHÔNG duy nhất giữa shop** (X8) — POS đánh số riêng từng shop,
  khoá đúng là `(shop_label, id)` / `order_uid`.
- **Autodetect khi APPEND làm lệch schema** (X2) — lấy schema từ chính bảng raw.
- **Hạ tầng validation hỏng thì log vẫn in PASS/FAIL như thường** (B1 ×2 lần) —
  kiểm code clone + bước chạy + cỡ bảng shadow trước khi tin.
- **Đổi chữ ký hàm sync = grep hết nơi gọi** (sync_month, shadow_month, script tay).
- **Luôn nêu mẫu số khi báo tỷ lệ** (`is_confirmed`? khung ngày nào?) — 2 phiên
  từng lệch 20,7% vs 3,4% chỉ vì mẫu số.

## Tài liệu gốc

- Sơ đồ cây + section: artifact "TALPHA — Sơ đồ hệ thống & Lộ trình tối ưu"
  (https://claude.ai/code/artifact/414e34de-d0f5-44df-a2e9-2ef21014343c)
- Rule chỉ số: `docs/TALPHA_METRIC_RULES.md` · Kiến trúc: `docs/ARCHITECTURE_2026.md`
- Danh mục section: `lam-section/references/sections.md` · Sổ lỗi:
  `xu-ly-p1/references/loi-dang-mo.md` · Vận hành: `talpha-system/references/runbook.md`

## Khi đóng xong một việc

Cập nhật: (1) sổ lỗi / sections.md tương ứng, (2) memory (file + MEMORY.md),
(3) mục "Trạng thái" + "Việc đang mở" của CHÍNH SKILL NÀY — alpha là bản đồ,
bản đồ sai còn tệ hơn không có bản đồ.
