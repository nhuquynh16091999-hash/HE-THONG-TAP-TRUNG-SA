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
COD tại **Đài Loan** (một thị trường, từ 05/09/2026). Dashboard 13 tab trên VPS
`139.180.131.21:3000` + báo cáo Google Sheets (systemd timer mỗi giờ) + tồn kho POS
live + hai màn đối soát tiền. Bot WhatsApp có code nhưng **đang tắt**.
Nguồn sự thật: BigQuery `cty-507710.TALPHA_Dataset`.
GitHub `nhuquynh16091999-hash/HE-THONG-TAP-TRUNG-SA`, remote `origin`.
Bản đồ nghiệp vụ đầy đủ: `DASHBOARD_MAP.md`.

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
3. **Deploy** = `bash ops/deploy/from-mac.sh` **TỪ MÁY MAC**. Máy chủ không có khoá
   GitHub, nó mượn khoá của Mac qua `ssh -A`; `git pull` thẳng trên máy chủ không
   chạy được mà vẫn in `origin/main` cũ nên trông như đã mới nhất. `npm run build`
   ở Mac chỉ đổi bản localhost, KHÔNG phải deploy. KHÔNG `git clean` trên
   `/opt/talpha` (xoá mất .env.local, key, phiên WhatsApp).
4. **Sync chỉ có MỘT bản**: `sync/talpha/talpha_sync.py` (gộp 11/09/2026). Đừng chép
   bản thứ hai sang runtime — trước đây hai bản cùng ghi một bộ bảng mỗi giờ.
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
   `faos-dashboard@cty-507710.iam.gserviceaccount.com` quyền Viewer;
   (b) khi đọc được: đối chiếu SKU sheet ↔ `product_catalog`, cập nhật
   `config/talpha_rules.json → products`, BÁO SỐ user duyệt rồi mới deploy view.
   Giá vốn sai = mọi số lãi sai — không tự đoán đơn vị tiền.
2. ~~**B1 cutover hai engine sync**~~ — **XONG 11/09/2026**. Chỉ còn
   `sync/talpha/talpha_sync.py`; `sync_month.py` nạp nó qua `$TALPHA_REPO` và dừng
   ngay nếu nạp nhầm bản khác.
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
- **Đổi chữ ký hàm sync = grep hết nơi gọi** (`sync_month.py` và mọi script tay).
- **Luôn nêu mẫu số khi báo tỷ lệ** (`is_confirmed`? khung ngày nào?) — 2 phiên
  từng lệch 20,7% vs 3,4% chỉ vì mẫu số.

## Tài liệu gốc

- Sơ đồ cây + section: artifact "TALPHA — Sơ đồ hệ thống & Lộ trình tối ưu"
  (https://claude.ai/code/artifact/414e34de-d0f5-44df-a2e9-2ef21014343c)
- Rule chỉ số: `docs/TALPHA_METRIC_RULES.md` · Bản đồ nghiệp vụ: `DASHBOARD_MAP.md`
- Danh mục section: `lam-section/references/sections.md` · Sổ lỗi:
  `xu-ly-p1/references/loi-dang-mo.md` · Vận hành: `talpha-system/references/runbook.md`

## Khi đóng xong một việc

Cập nhật: (1) sổ lỗi / sections.md tương ứng, (2) memory (file + MEMORY.md),
(3) mục "Trạng thái" + "Việc đang mở" của CHÍNH SKILL NÀY — alpha là bản đồ,
bản đồ sai còn tệ hơn không có bản đồ.
