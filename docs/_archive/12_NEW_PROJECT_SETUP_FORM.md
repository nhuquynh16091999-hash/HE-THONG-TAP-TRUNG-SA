# 🚀 SETUP FORM — Dự Án Mới trên FAOS Platform

> **Mục đích**: Người setup điền form này TRƯỚC khi bắt đầu clone. Thiếu bất kỳ field REQUIRED nào → hệ thống sẽ KHÔNG hoạt động.
>
> **Cách dùng**: Copy file này thành `PROJECT_SETUP_{TEN_DU_AN}.md`, điền đầy đủ, gửi lại cho team tech.

---

## 📋 PHẦN A — THÔNG TIN DỰ ÁN (Bắt buộc)

| # | Field | Giá trị | Ghi chú |
|---|-------|---------|---------|
| 1 | **Tên dự án** | `_______________` | Tên thương hiệu |
| 2 | **Mã dự án** (project_id) | `_______________` | Viết thường, không dấu (vd: `zen8`, `pialpha`) |
| 3 | **Loại tiền chính** | `_______________` | VND / USD / RON / AED / SAR |
| 4 | **Múi giờ** | `_______________` | Mặc định: `Asia/Ho_Chi_Minh` |
| 5 | **Mô tả ngắn** | `_______________` | 1 dòng mô tả sản phẩm/ngành |

---

## 📋 PHẦN B — FACEBOOK ADS MANAGER (Bắt buộc)

### ⚠️ QUY TẮC BẮT BUỘC KHI LÀM VIỆC TRÊN ADS MANAGER

> **PHẢI tuân thủ 100%** — không tuân thủ = dashboard hiển thị sai hoàn toàn.

#### B1. Cách đặt tên Campaign

```
[MÃ_MKT]_[THỊ_TRƯỜNG]_[LOẠI]_[TÊN_SP]_[NGÀY]
```

| Thành phần | Mô tả | Ví dụ |
|------------|--------|-------|
| MÃ_MKT | Mã marketer 2-4 ký tự viết hoa | `ANHNT`, `TUKT` |
| THỊ_TRƯỜNG | Mã quốc gia 2 ký tự | `SA`, `AE`, `US`, `VN` |
| LOẠI | Loại campaign | `CBO`, `ABO`, `RETARGET`, `TESTING` |
| TÊN_SP | Tên sản phẩm viết tắt | `SERUM_HA`, `COMBO_3` |
| NGÀY | Ngày bắt đầu ddmm | `1902` (19 tháng 2) |

✅ **Đúng**: `ANHNT_SA_CBO_SERUM_HA_1902`
❌ **Sai**: `campaign 1`, `test`, `new campaign`

#### B2. Thông tin cần điền

| # | Field | Giá trị | Hướng dẫn |
|---|-------|---------|-----------|
| 1 | **Ad Account ID(s)** | `act_________________` | Ads Manager → ⚙️ Settings → Ad Account ID |
| 2 | **Business ID** | `_______________` | Business Settings → Business Info → ID |
| 3 | **System User Access Token** | `_______________` | Business Settings → System Users → Generate Token |
| 4 | **Pixel ID** | `_______________` | Events Manager → Data Sources → Pixel ID |

#### B3. Cách lấy Access Token

```
1. Vào https://business.facebook.com/settings
2. Menu trái → Users → System Users
3. Chọn System User (hoặc tạo mới)
4. Bấm "Generate New Token"
5. Chọn App → chọn quyền:
   ✅ ads_read
   ✅ ads_management (nếu cần edit)
   ✅ read_insights
   ✅ business_management
6. Bấm "Generate Token" → Copy token
```

> ⚠️ **QUAN TRỌNG**: Token phải có quyền `ads_read` + `read_insights`. Thiếu = API trả 403.

---

## 📋 PHẦN C — POS (Pancake/Poscake) (Bắt buộc)

### ⚠️ QUY TẮC BẮT BUỘC KHI LÀM VIỆC TRÊN POS

#### C1. Quy tắc nhập đơn

| Quy tắc | Chi tiết | Tại sao |
|---------|----------|---------|
| **Mỗi đơn PHẢI có marketer** | Gán trường `Nhân viên tư vấn` (marketer) khi tạo đơn | Dashboard tracking doanh số theo marketer |
| **Số điện thoại PHẢI chuẩn** | Format: `+84xxxxxxxxx` hoặc `0xxxxxxxxx` | Dùng để nhận diện khách hàng duy nhất |
| **Tên khách PHẢI đầy đủ** | Họ + Tên, không viết tắt | Phân tích CRM, chống trùng |
| **Tỉnh/Thành PHẢI chọn từ dropdown** | KHÔNG gõ tay | Dashboard group theo tỉnh, gõ sai = mất data |
| **Tags chuẩn hóa** | Chỉ dùng tags đã được define sẵn | Lọc và phân tích theo tags |
| **KHÔNG sửa đơn đã delivered** | Nếu cần, tạo đơn đổi trả riêng | Ảnh hưởng doanh thu report |

#### C2. Quy tắc trạng thái đơn

```
Tạo đơn → [0: New]
       → Xác nhận → [1: Confirmed]
       → Đóng gói → [4: Packing] → [5: Packed]
       → Giao vận → [2: Picking] → [3: Shipping]
       → Giao thành công → [6: Delivered] = SUCCESS ✅
       → Hoàn thành → [16: Completed] = SUCCESS ✅
       → Hủy → [8: Cancelled] ❌
```

> ⚠️ **Code 6 = Delivered = Success** (KHÔNG phải Cancelled)
> Đây là lỗi hay gặp nhất khi setup project mới!

#### C3. Cách lấy API Key

```
1. Đăng nhập POS tại https://pos.pages.fm
2. Menu trái → ⚙️ Cài đặt → Tích hợp → API
3. Copy "API Key" (KHÔNG phải Access Token!)
4. Shop ID: nhìn trên URL → pos.pages.fm/shops/{SHOP_ID}
```

#### C4. Thông tin cần điền

| # | Field | Giá trị | Ghi chú |
|---|-------|---------|---------|
| 1 | **API URL** | `https://pos.pages.fm/api/v1` | ⚠️ KHÔNG dùng `api.poscake.vn` |
| 2 | **API Key** | `_______________` | ⚠️ KHÔNG dùng Access Token |
| 3 | **Shop ID** | `_______________` | Từ URL POS |
| 4 | **Tên shop** | `_______________` | |

> 🚨 **SAI phổ biến nhất**:
> - Dùng `access_token` thay `api_key` → lỗi "Invalid token"
> - Dùng `api.poscake.vn` thay `pos.pages.fm` → lỗi connection
> - Dùng `api_token` thay `api_key` → lỗi auth

---

## 📋 PHẦN D — THỊ TRƯỜNG & KHO

| # | Mã thị trường | Tên đầy đủ | Loại tiền | Kho phục vụ |
|---|---------------|------------|-----------|-------------|
| 1 | `___` | `_______________` | `___` | `_______________` |
| 2 | `___` | `_______________` | `___` | `_______________` |
| 3 | `___` | `_______________` | `___` | `_______________` |

---

## 📋 PHẦN E — TEAM MEMBERS

### Marketers (Bắt buộc — dashboard track theo MKT code)

| # | Mã MKT (3-4 ký tự) | Họ tên đầy đủ | Các tên/biến thể khác |
|---|---------------------|---------------|----------------------|
| 1 | `___` | `_______________` | `_______________` |
| 2 | `___` | `_______________` | `_______________` |
| 3 | `___` | `_______________` | `_______________` |
| 4 | `___` | `_______________` | `_______________` |

> ⚠️ "Các tên/biến thể khác" = tất cả cách viết khác mà marketer có thể gõ trong POS/Ads.
> VD: `ANHNT` có thể gõ là `Anh NT`, `anhnt`, `Nguyễn Tuấn Anh`, `nta`
> Nếu không list đầy đủ → Dashboard hiện marketer trùng.

### CS Staff (Tùy chọn)

| # | Mã CS | Họ tên |
|---|-------|--------|
| 1 | `___` | `_______________` |

---

## 📋 PHẦN F — FULFILLMENT / 3PL (Tùy chọn)

| # | Đơn vị vận chuyển | API URL | API Key |
|---|-------------------|---------|---------|
| 1 | `_______________` | `_______________` | `_______________` |

---

## 📋 PHẦN G — THÔNG BÁO (Tùy chọn)

| # | Field | Giá trị |
|---|-------|---------|
| 1 | Discord Webhook (báo cáo) | `_______________` |
| 2 | Discord Webhook (alert) | `_______________` |

---

## ✅ CHECKLIST TRƯỚC KHI GỬI

Người điền form tự check:

- [ ] Tất cả field REQUIRED đã điền
- [ ] Facebook Access Token có quyền `ads_read` + `read_insights`
- [ ] POS dùng `api_key` (KHÔNG phải `access_token`)
- [ ] POS API URL = `pos.pages.fm` (KHÔNG phải `api.poscake.vn`)
- [ ] Tất cả marketer đã list + ghi đầy đủ biến thể tên
- [ ] Quy tắc đặt tên campaign đã phổ biến cho team Ads
- [ ] Quy tắc nhập đơn POS đã phổ biến cho team CS/Ops
- [ ] Mỗi thị trường đã ghi rõ kho phục vụ

---

> **Gửi file này cho team tech tại**: [Zalo/Slack/Email]
> **Sau khi nhận**: Tech team sẽ setup trong ~2 giờ, sau đó gửi link dashboard.
