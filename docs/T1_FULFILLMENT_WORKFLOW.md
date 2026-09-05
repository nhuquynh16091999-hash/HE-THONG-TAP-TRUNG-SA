# T1 Fulfillment Automation — Quy trình tự động

## So sánh: Thủ công vs Tự động

### ❌ Quy trình THỦ CÔNG (trước đây)
```
Bạn vào POS Cake
   ↓ chọn đơn → chuyển "Đang đóng hàng"
   ↓ Export file Excel từ POS
   ↓ Mở Excel, chỉnh sửa theo form euShipments:
   │   - Thêm postcode (phải tra thủ công)
   │   - Chuẩn hóa SĐT (+421...)
   │   - Map SKU sang mã 3PL
   │   - Thêm COD, trọng lượng...
   ↓ Login euShipments → Upload file Excel
   ↓ Chờ euShipments xử lý
   ↓ Quay lại POS → cập nhật status "Đã gửi"
   
   ⏱ ~15-30 phút cho mỗi batch đơn
```

### ✅ Quy trình TỰ ĐỘNG (hiện tại)
```
Bạn vào POS Cake
   ↓ chọn đơn → chuyển "Đang đóng hàng" (status 8)
   ↓ XONG! Không cần làm gì thêm.
   
   (Script tự động chạy mỗi 5 phút)
   ↓ Tự đọc POS → lọc đơn status 8
   ↓ Tự validate SĐT + Địa chỉ Slovakia
   ↓ Tự fill postcode từ database 130+ thành phố
   ↓ Tự check tồn kho (euShipments API)
   ↓ Tự tạo đơn trên euShipments (API)
   ↓ Tự log vào BigQuery
   ↓ Nếu lỗi → tự alert Discord
   
   ⏱ ~5 giây cho mỗi đơn
```

---

## Script chạy tự động như thế nào?

### Có 2 cách chạy:

#### Cách 1: Watcher (Khuyên dùng) — Chạy liên tục
```powershell
# Mở terminal, chạy lệnh này → để nó chạy nền:
python sync\t1\fulfillment_watcher.py

# Mặc định check mỗi 5 phút. Đổi interval:
python sync\t1\fulfillment_watcher.py --interval 10   # mỗi 10 phút
python sync\t1\fulfillment_watcher.py --once           # chạy 1 lần rồi dừng
```

Watcher sẽ:
1. Gọi POS Cake API → lấy đơn status 8
2. So sánh với BigQuery → lọc đơn mới chưa xử lý
3. Validate + auto-fix địa chỉ
4. Check tồn kho 3PL
5. Tạo đơn euShipments
6. Lặp lại sau N phút

#### Cách 2: Windows Task Scheduler — Lên lịch cố định
```
1. Mở "Task Scheduler" (Win + R → taskschd.msc)
2. Create Basic Task → "T1 Fulfillment Sync"
3. Trigger: Daily → Repeat every 5 minutes
4. Action: Start Program → sync\t1\run_fulfillment.bat
```

---

## Luồng xử lý chi tiết mỗi đơn

```
┌─────────────────────────────────┐
│  POS Cake: Đơn status = 8      │
│  "Đang đóng hàng"              │
└──────────┬──────────────────────┘
           ↓
┌──────────▼──────────────────────┐
│  Step 1: Đã xử lý chưa?       │
│  Check BigQuery fulfillment_    │
│  orders table                   │
│  → Đã có? SKIP                 │
│  → Chưa có? Tiếp tục ↓        │
└──────────┬──────────────────────┘
           ↓
┌──────────▼──────────────────────┐
│  Step 2: VALIDATE              │
│  ✓ SĐT → +421xxxxxxxxx        │
│  ✓ Tên người nhận (≥3 ký tự)  │
│  ✓ Địa chỉ (≥5 ký tự)        │
│  ✓ Thành phố → fuzzy match     │
│  ✓ Postcode → auto-fill từ DB  │
│                                 │
│  🔧 AI Auto-Fix:               │
│  - "kosice" → "Košice"          │
│  - Thiếu ZIP → fill "040 01"   │
│  - "067 12" → "066 01" (sai)   │
│                                 │ 
│  ❌ Lỗi? → Discord alert       │
│            → Dừng → Sửa thủ công│
└──────────┬──────────────────────┘
           ↓
┌──────────▼──────────────────────┐
│  Step 3: CHECK TỒN KHO        │
│  API: get-prod-avails           │
│  ✓ Có hàng? → Tiếp tục        │
│  ❌ Hết hàng? → Discord alert   │
│                → DỪNG           │
└──────────┬──────────────────────┘
           ↓
┌──────────▼──────────────────────┐
│  Step 4: TẠO ĐƠN euShipments  │
│  API: create-order              │
│  - Sender: 3284 (Oddie House)  │
│  - Courier: GLS Slovakia (741) │
│  - COD: EUR                     │
│  - Tên, SĐT, địa chỉ (đã fix)│
│  - SKU + số lượng              │
│                                 │
│  ✅ Thành công → Log BigQuery   │
│  ❌ Lỗi → Discord alert        │
└──────────┬──────────────────────┘
           ↓
┌──────────▼──────────────────────┐
│  Step 5: KẾT QUẢ              │
│  📊 Summary → log              │
│  📱 Discord alert nếu có lỗi   │
│  📈 BigQuery → Dashboard       │
└─────────────────────────────────┘
```

---

## Postcode tự động

Khi POS không có postcode (ZIP), hệ thống tự điền:

| Thành phố khách nhập | → Postcode AI fill |
|---|---|
| Bratislava | → 811 01 |
| Košice | → 040 01 |
| Martin | → 036 01 |
| Prešov | → 080 01 |
| Žilina | → 010 01 |
| Nitra | → 949 01 |
| Poprad | → 058 01 |
| ...(130+ thành phố) | → auto-fill |

Nếu thành phố viết sai chính tả:
- `kosice` → `Košice` (040 01) ✅
- `presov` → `Prešov` (080 01) ✅  
- `bratislawa` → `Bratislava` (811 01) ✅
- `zilina` → `Žilina` (010 01) ✅

---

## Chạy thử nghiệm (test)

```powershell
# Dry-run: chỉ validate, KHÔNG tạo đơn thật
python sync\t1\fulfillment_automation.py --dry-run

# Test mode: tạo đơn test trên euShipments
python sync\t1\fulfillment_automation.py --test

# Production: tạo đơn thật
# ⚠️ Trước khi chạy: đổi test_mode: false trong t1.yaml
python sync\t1\fulfillment_automation.py
```

## Lệnh bật automation chạy nền

```powershell
# Terminal 1: Bật watcher chạy nền
python sync\t1\fulfillment_watcher.py --interval 5
```
