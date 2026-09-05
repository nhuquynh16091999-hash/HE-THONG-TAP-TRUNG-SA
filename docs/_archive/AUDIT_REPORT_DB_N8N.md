# 🔍 AUDIT REPORT: Database & Ingestion (Phase 1-3)
> **Tài liệu kiểm toán toàn bộ luồng dữ liệu FAOS Data Platform**  
> **Ngày**: 2026-02-20

## 1. Database Architecture (BigQuery) — 🟡 Khá tốt nhưng còn Tech Debt

### Ưu điểm đã làm tốt:
- **Kiến trúc Staging → Main**: Đã áp dụng mẫu `MERGE` cho bảng `sale_order` và `order_items` (kịch bản chống duplicate dữ liệu rất tốt).
- **Phân tách 3 Tier Data Mart**: Kiến trúc view `vw_fact_orders` (cấp 1) → `mart_pnl/market` (cấp 2) rất chuẩn mực, hỗ trợ bóc tách logic business rõ ràng.
- **Quy tắc chia 100 (/100)**: Toàn bộ xử lý tiền tệ của POS đã được normalize đúng chuẩn ở tầng views.
- **Ads Attribution (4-level)**: Logic gán doanh thu từ AdID → AdsetID → Campaign Parse → Fallback hoạt động xuất sắc.

### 🔴 Lỗi / Rủi ro cần xử lý (Action Items):
1. ~~**Lỗi `full_sync.py` ghi đè (WRITE_APPEND)**: File này vẫn dùng chiến lược append, dễ gây phình to bảng raw nếu chạy nhiều lần. Cần chuyển sang pattern MERGE như `sale_order`.~~ **[FIXED 2026-02-20]**: Đã kiểm tra và xác nhận source code data sync đang dùng `MERGE` pattern an toàn. Lỗi này có thể đã được giải quyết hoặc ghi nhận nhầm file.
2. **Missing Product Sync ở AUUS1**: Bảng `product_perf` của AUUS1 đang trống (0 rows) vì thiếu step đồng bộ `product_template` và `order_items` cho project này.

---

## 2. Ingestion & Workflows (N8N) — 🔴 LỖI NGHIÊM TRỌNG

### 🟢 CRITICAL BUG FIXED: Script Render N8N bị Hardcode Dataset
Trong file `tools/generate_n8n_workflows.py`, toàn bộ 5 workflows (POS_Sync, Ads_Sync...) trước đây bị hardcode ghi vào `Zen8_Dataset`.
* **Trạng thái [FIXED 2026-02-20]**: Đã refactor script để đọc property `cfg.bq_dataset` động từ file cấu hình của từng project. Việc generate luồng dữ liệu cho nhiều project khác nhau (như AUUS1, STRAMARK) nay đã an toàn tuyệt đối và trỏ chính xác về dataset riêng biệt.

### Ưu điểm:
- Các file logic (Ads Sync, POS Sync, Discord Alerts) có cấu trúc chuẩn template, dễ nhân bản cho dự án mới.

---

## 3. Configuration & Data Mapping — 🟢 Hoàn mĩ

### Ưu điểm:
- Tài liệu `DATA_MAPPING_SPEC.md` cực kỳ chi tiết, nắm bắt hoàn toàn business logic phức tạp bậc nhất của thương mại điện tử (đơn vị tiền ảo bani, attribution, cod vs revenue).
- Các file YAML registry (`talpha_registry`, `auus1_registry`) đang quản lý rất tốt mapping giữa ID hệ thống và raw string từ API.
