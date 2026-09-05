---
description: Bắt đầu session database — đọc state, check health, cập nhật khi xong
---
## Quy trình bắt buộc cho mọi session liên quan Database/Data Mart

### Bước 1: Đọc PROJECT_STATE.md
// turbo
Đọc file `PROJECT_STATE.md` ở root dự án TRƯỚC KHI LÀM BẤT CỨ GÌ.
Nắm rõ: cái gì đang chạy đúng (KHÔNG SỬA), cái gì đang lỗi, quyết định đã confirm.

### Bước 2: Chạy Health Check
// turbo
```bash
python tools/check_pipeline_health.py
```
Kiểm tra: data freshness, API token, view row counts, sanity metrics.

### Bước 3: Fix issues trước
Nếu health check báo lỗi → fix lỗi đó TRƯỚC, KHÔNG build feature mới.
Đặc biệt:
- Token expired → báo user refresh token
- Data stale → chạy sync
- View missing → chạy deploy: `python sql/deploy_stramark.py`

### Bước 4: Làm task
Bây giờ mới bắt đầu task chính.
- Mọi thay đổi SQL → sửa file trong `sql/stramark/*.sql`
- Deploy: `python sql/deploy_stramark.py`
- KHÔNG tạo view bằng Python script rải rác

### Bước 5: Cập nhật PROJECT_STATE.md
Khi kết thúc session:
1. Cập nhật section 🟢 nếu có view mới hoạt động
2. Cập nhật section 🔴 nếu có issue mới phát hiện
3. Cập nhật section 📋 nếu có quyết định mới với user
4. Cập nhật ngày `Last updated`
