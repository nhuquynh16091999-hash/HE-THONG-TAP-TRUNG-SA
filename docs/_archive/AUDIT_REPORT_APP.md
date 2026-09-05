# 🔍 AUDIT REPORT: App Layer (Backend, Frontend, Agents)
> **Tài liệu kiểm toán tầng ứng dụng FAOS Data Platform**  
> **Ngày**: 2026-02-20

## 1. Application Backend (`dashboard-ui/api/`) — 🟡 Cần tinh chỉnh

### Tình trạng thiết kế Backend:
- **Tốt**: Các Route query trực tiếp vào file View (`mart_*`) của BigQuery, tối ưu tốc độ đọc cực tốt thay vì tự JOIN bằng Javascript.
- **Rủi ro Single-Tenant**: Backend chỉ đọc `DATASET` từ biến môi trường `process.env.DATASET || "STRAMARK_Dataset"`. Nghĩa là 1 server Node.js đang chỉ phục vụ duy nhất 1 dự án. Nếu muốn xem dashboard của AUUS1, user sẽ phải đổi `.env` và restart server.
  * **Giải pháp**: Nhận tham số `?project=AUUS1` từ query URL, sau đó Map sang Dataset tương ứng ở file `constants.ts`.

---

## 2. Dashboard Frontend (`dashboard-ui/`) — 🔴 HARDCODE TIỀN TỆ

### Lỗi hiển thị cứng (Hardcoded Values):
Sau khi quét toàn bộ mã nguồn Frontend, phát hiện hệ thống đang bị "trói chặt" vào dự án STRAMARK:
1. **Lỗi tỷ giá cứng**: 
   - Trong `utils.ts`: `export const RON_TO_VND = 6200;`
   - Trong `types.ts`: `RON_TO_VND: 5500` (Thậm chí code đang xài 2 tỷ giá khác nhau ở 2 file!)
2. **Lỗi text cứng (RON)**: Các table header, biểu đồ, metrics (ví dụ ở `pnl-tab.tsx`, `marketing-tab.tsx`) đang gõ sẵn chữ `"Revenue (RON)"`, `"Spend (RON)"`, ước tính phí `14 RON`.
   - Nếu chuyển qua dự án AUUS1 (USD/AUD), giao diện vẫn sẽ hiện chữ "RON" và covert sai ra tiền Việt.

* **Giải pháp**: Xóa bỏ các hằng số này; Backend API bắt buộc phải trả về tỷ giá (từ bảng `cost_exchange_rates` của BQ), và text ký hiệu tiền tệ phải được lấy động hoặc đọc từ config.

---

## 3. Core Agents & War Room — 🟡 Cần Parameterize (Tham số hóa)

### Tình trạng Agent (trong `agents/crew/`):
Mô hình "War Room" với các đặc vụ ảo khá ấn tượng (COO, CFO, CMO). Tuy nhiên:
- **Hardcode Dataset**: 90% các công cụ (Tools) bị set mặc định truy vấn `STRAMARK_Dataset`. VD ở `tools.py`: `os.getenv("BQ_DATASET", "STRAMARK_Dataset")`.
- **Rủi ro chéo dữ liệu**: Khi War Room phân tích cho giám đốc của phòng ban dự án AUUS1, các Agent sẽ vẫn chui vào lấy số liệu của phòng STRAMARK để trả lời (do code bị hardcode mặc định trả về STRAMARK).

### Ưu điểm AI:
- File script `war_room_server.py` đã bỏ `pydantic v2` và chạy Standalone FastAPI, giải quyết được rất nhiều xung đột thư viện ở quá khứ. Tracking Token khá ổn.

---

## 🎯 TỔNG KẾT ACTION ITEMS ƯU TIÊN (Dành cho Dev):
1. **[N8N]**: Sửa `tools/generate_n8n_workflows.py` để N8N bắn order/ads đúng dataset dự án thay vì `Zen8_Dataset`.
2. **[UI]**: Loại bỏ hardcode 'RON' và tỷ giá tĩnh tại frontend; thay bằng Object `currency_symbol` truyền từ API hoặc App Context.
3. **[Agents]**: Tham số hóa các tool AI để Agent biết mình đang ngồi họp ở dự án nào (nhận `dataset_name` từ prompt context).
