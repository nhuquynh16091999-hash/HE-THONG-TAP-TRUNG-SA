---
name: xu-ly-p1
description: >-
  Xử lý các LỖI SỐ LIỆU còn tồn của TALPHA (nhóm section X1–X6: Smart Stop cắt cụt
  đơn, fb_ads_data mất tháng cũ, order_items thiếu giá, product_catalog bẩn,
  cogs_vnd chết, sale_order trùng id). Quy trình chẩn đoán-trước-khi-sửa dựa trên
  ground truth Meta API / POS API. LUÔN dùng skill này khi user nói "xử lý P1",
  "làm X1", "sao số sai", "thiếu đơn/thiếu spend", "số nhảy", "báo cáo lệch",
  "COGS sai", "mất dữ liệu tháng trước", hoặc khi một cảnh báo sync-health kêu mà
  chưa rõ đúng/sai. Sửa code trước khi chẩn đoán = rủi ro bịt mất chính cái lỗi
  đang cần bắt (đã xảy ra với B5).
---

# xu-ly-p1 — Xử lý lỗi số liệu tồn đọng

## Skill này khác `lam-section` chỗ nào

`lam-section` dành cho việc **đã biết phải làm gì** (sửa file A, deploy B).
Skill này dành cho việc **chưa biết vì sao số sai** — phần lớn công sức nằm ở chẩn
đoán, và sửa sai chỗ thì tai hại hơn không sửa. Kỷ luật commit/push/deploy vẫn theo
`lam-section` (1 section = 1 commit = push ngay); đừng chép lại, chỉ tuân theo.

## Ba luật cứng — vi phạm là hỏng việc

**1. Ground truth là API gốc, KHÔNG BAO GIỜ so Sheet ↔ BigQuery.**
Hai cái cùng nguồn, cùng sai. Spend đúng = Meta API trực tiếp
(`level=campaign, time_increment=1`). Đơn đúng = POS API live. Sheet và BQ chỉ là
dẫn xuất — chúng khớp nhau không chứng minh được gì.

**2. Cảnh báo kêu nhiều KHÔNG phải lý do nới ngưỡng.**
Ngày 04/08 detector B5 báo 7/15 mục có vấn đề; phiên làm đã kết luận "co ngót tự
nhiên" rồi hạ độ nhạy — tức bịt đúng cái lỗi mà detector sinh ra để bắt. Thực tế là
bug Smart Stop đang ăn mất đơn thật. Muốn nới ngưỡng thì phải chứng minh **từng**
cảnh báo là oan bằng ground truth, không phải bằng suy luận.

**3. Khi số liệu mâu thuẫn với lời giải thích của mình → lời giải thích sai.**
Dấu hiệu lẽ ra thấy ngay hôm đó: số dòng dao động **cả hai chiều**
(3.730 → 5.220 → 3.380). Co ngót tự nhiên chỉ đi xuống một chiều.

## Quy trình 6 bước

### 1. Khoanh lỗi
Lấy mã X từ `references/loi-dang-mo.md`. User mô tả triệu chứng chưa có mã → chẩn
đoán trước (bước 2–3), thấy là lỗi mới thì **thêm mã X mới vào sổ** rồi mới sửa.

### 2. Đo lại triệu chứng bằng số, đừng tin mô tả
Chạy đúng query/lệnh trong mục "Đo lại" của lỗi đó. Số thay đổi theo thời gian —
lỗi có thể đã tự khỏi (do phiên khác sửa) hoặc nặng thêm. **Luôn ghi rõ mẫu số**
khi báo tỷ lệ: `is_confirmed` hay không, khung ngày nào. Hai phiên từng lệch nhau
20,7% vs 3,4% chỉ vì khác mẫu số.

### 3. Đối chiếu ground truth
Meta API cho spend, POS API cho đơn. Lệch >2% mới là lỗi thật; lệch từng ngày do
timezone TKQC là **cố hữu**, cả tháng mới khớp — đừng "sửa" cho khớp từng ngày.

### 4. Tìm nguyên nhân gốc, không chữa triệu chứng
Hỏi đủ 3 câu: dữ liệu sai từ nguồn, hay sai lúc ghi, hay sai lúc đọc? Sửa ở tầng
nào thì các tầng khác hết sai theo? Có bản code thứ hai đang chạy cùng logic không
(runtime `~/talpha_reports/` vs repo `sync/` — xem bẫy #1 của `talpha-system`)?

### 5. Sửa + verify bằng chính phép đo ở bước 2
Trước/sau phải là **cùng một query**. Sửa sync thì phải chờ ít nhất 1 chu kỳ thật
rồi đo lại — compile được không có nghĩa là chạy đúng.

### 6. Ghi lại
Cập nhật `references/loi-dang-mo.md` (đóng lỗi hoặc sửa số đo) và memory. Lỗi đóng
rồi vẫn giữ trong sổ 1 mục ngắn "đã đóng ngày nào, verify bằng gì" — để phiên sau
không đào lại.

## Guard riêng cho nhóm lỗi này

- **BigQuery**: chỉ `SELECT` và `CREATE OR REPLACE VIEW`. Không DELETE/DROP/TRUNCATE
  bảng. Free tier: ghi bảng chỉ bằng LOAD JOB.
- **Sửa sync = sửa cả 2 bản** (repo + runtime) cho tới khi B1 cutover xong, nếu
  không bản đang chạy vẫn giữ nguyên bug.
- **Backfill dữ liệu đã mất** (X2): phải hỏi user trước — kéo lại nhiều tháng từ
  Meta API có thể chạm rate limit và ghi đè bảng đang phục vụ dashboard.
- POS key là `${ENV}` không có sẵn trong shell: đừng gọi POS từ CLI, đi qua
  dashboard route.

## References

`references/loi-dang-mo.md` — sổ lỗi X1–X6: triệu chứng · bằng chứng · nguyên nhân
· cách đo lại · cách verify đã đóng. Đọc đúng mục được giao.
