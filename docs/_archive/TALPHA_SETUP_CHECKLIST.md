# 🚀 SETUP FORM — Dự Án TALPHA (Tiểu Alpha)

> **Trạng thái**: ⚠️ CẦN BỔ SUNG — đã điền từ dữ liệu thô, cần bạn xác nhận + bổ sung phần thiếu
> **Nguồn dữ liệu**: `pialpha.yaml` (file gốc từ team)

---

## 📋 PHẦN A — THÔNG TIN DỰ ÁN ✅

| # | Field | Giá trị | Status |
|---|-------|---------|--------|
| 1 | **Tên dự án** | `Tiểu Alpha (TALPHA)` | ✅ |
| 2 | **Mã dự án** (project_id) | `talpha` | ✅ |
| 3 | **Loại tiền chính** | ❓ **CẦN XÁC NHẬN** | ⚠️ Xem bên dưới |
| 4 | **Múi giờ** | `Asia/Dubai` (UTC+4) | ⚠️ Đã sửa — file gốc ghi "Vinh/Nghệ An" nhưng thị trường là GCC |
| 5 | **Mô tả** | Bán trang sức cho phụ nữ Philippines tại thị trường GCC (Vùng Vịnh) | ✅ |

> ⚠️ **CURRENCY**: File gốc ghi `(AED,SAR,KWD,QAR,OMR,BHD...)` — nhiều loại tiền. Cần chọn **1 loại tiền chính** để dashboard tính toán:
> - Nếu đa số đơn bằng **AED** (Dubai) → chọn `AED`
> - Nếu đa số đơn bằng **SAR** (Saudi) → chọn `SAR`
> - **Câu hỏi cho bạn**: Tiền nào chiếm đa số doanh thu?

---

## 📋 PHẦN B — FACEBOOK ADS ✅ (đã trích xuất)

| # | Field | Giá trị | Status |
|---|-------|---------|--------|
| 1 | **App ID** | `904939858795500` | ✅ |
| 2 | **App Secret** | `6d6757336b5c9398d9b68a20333afe45` | ✅ |
| 3 | **Access Token** | `EAAM3CbrTmZBwBQ...` (đã có đầy đủ) | ✅ |
| 4 | **Business ID** | ❌ **THIẾU** | 🔴 |
| 5 | **Pixel ID** | ❌ **THIẾU** | 🟡 (optional) |

### Ad Account IDs (9 tài khoản):

| # | Tên tài khoản | Account ID | Status |
|---|---------------|------------|--------|
| 1 | Sỹ Lộc 01 | `act_855567553811483` | ✅ |
| 2 | Kuwait +3 | `act_3534017756739334` | ✅ ⚠️ TRÙNG #5 |
| 3 | Chu Thuý 02 | `act_848995974322757` | ✅ |
| 4 | Tiểu Alpha 4 | `act_719840773771124` | ✅ |
| 5 | KUWAIT +3 | `act_3534017756739334` | ❌ TRÙNG #2 — sẽ bỏ |
| 6 | Trang sức 2 - Dubai | `act_1119368126847210` | ✅ |
| 7 | Chu Thuý 01 | `act_833593695771745` | ✅ |
| 8 | Trang sức 1 - Dubai | `act_703242242813144` | ✅ |
| 9 | Tiểu Alpha 3 | `act_1503790877534258` | ✅ |

> ⚠️ Account #2 và #5 **TRÙNG ID** (`3534017756739334`). Sẽ chỉ dùng 1 → **8 tài khoản thực tế**.

---

## 📋 PHẦN C — POS ⚠️ (CÓ NHƯNG SAI FORMAT)

### Poscake:
| # | Field | Giá trị gốc | Vấn đề | Cần sửa |
|---|-------|-------------|--------|---------|
| 1 | **API URL** | `https://api.poscake.vn/api/v1` | 🔴 **SAI!** | → `https://pos.pages.fm/api/v1` |
| 2 | **Token** | `eyJhbGciOi...` (JWT) | 🔴 **Đây là JWT, không phải API Key!** | Cần lấy **API Key** từ POS |
| 3 | **Shop ID** | ❌ **TRỐNG** | 🔴 | Cần lấy từ URL POS |

### Pancake (CRM):
| # | Field | Giá trị | Status |
|---|-------|---------|--------|
| 1 | API URL | `https://pages.fm/api/v1` | ✅ |
| 2 | Token | `eyJhbGciOi...` (JWT, thuộc user "Sỹ Anh") | ✅ |
| 3 | Page IDs | ❌ **TRỐNG** | 🟡 |

> 🚨 **3 LỖI CRITICAL CỦA POS**:
> 1. **API URL sai**: `api.poscake.vn` → phải là `pos.pages.fm`
> 2. **Dùng JWT token** thay vì **API Key** → lấy API Key từ POS Settings
> 3. **Shop ID trống** → nhìn trên URL: `pos.pages.fm/shops/{SHOP_ID}`

---

## 📋 PHẦN D — THỊ TRƯỜNG ❌ THIẾU

Dựa trên tên ad accounts, suy luận các thị trường:

| # | Mã | Tên đầy đủ | Tiền | Kho | Status |
|---|-----|-----------|------|-----|--------|
| 1 | `AE`? | Dubai / UAE | AED | ❓ | ⚠️ Cần xác nhận |
| 2 | `KW`? | Kuwait | KWD | ❓ | ⚠️ Cần xác nhận |
| 3 | `SA`? | Saudi Arabia | SAR | ❓ | ⚠️ Cần xác nhận |

> **Câu hỏi**: Bạn đang bán ở chính xác những nước nào? Kho hàng ở đâu?

---

## 📋 PHẦN E — TEAM ❌ THIẾU

Dựa trên tên ad accounts, suy luận marketers:

| # | Mã MKT | Họ tên (suy luận) | Biến thể | Status |
|---|--------|-------------------|----------|--------|
| 1 | `SL`? | Sỹ Lộc | | ⚠️ Cần xác nhận |
| 2 | `CT`? | Chu Thuý | | ⚠️ Cần xác nhận |
| 3 | ❓ | ❓ | | ❌ Còn ai nữa? |

> **Câu hỏi**: Liệt kê TẤT CẢ marketer + mã viết tắt + các tên biến thể mà họ có thể gõ.

---

## 📋 PHẦN F-G — FULFILLMENT & DISCORD ❌ THIẾU

Chưa có thông tin. Có thể bổ sung sau.

---

## ❓ TÓM TẮT — CẦN BẠN ĐIỀN

| # | Thông tin cần | Ưu tiên |
|---|--------------|---------|
| 1 | **Currency chính** (AED hay SAR hay khác?) | 🔴 Bắt buộc |
| 2 | **Timezone** — xác nhận `Asia/Dubai` (UTC+4) hay theo VN? | 🔴 Bắt buộc |
| 3 | **POS API Key** (KHÔNG phải JWT token) | 🔴 Bắt buộc |
| 4 | **POS Shop ID** | 🔴 Bắt buộc |
| 5 | **Facebook Business ID** | 🔴 Bắt buộc |
| 6 | **Danh sách marketers** (mã + tên + biến thể) | 🔴 Bắt buộc |
| 7 | **Thị trường chính xác** (AE, KW, SA, ...?) | 🟡 Cần sớm |
| 8 | **Kho hàng** (ở đâu?) | 🟡 Cần sớm |
| 9 | **Pixel ID** | 🟡 Tùy chọn |
| 10 | **3PL / Vận chuyển** | 🟡 Tùy chọn |
| 11 | **Discord webhooks** | 🟢 Sau cũng được |
| 12 | **Pancake Page IDs** | 🟢 Sau cũng được |
