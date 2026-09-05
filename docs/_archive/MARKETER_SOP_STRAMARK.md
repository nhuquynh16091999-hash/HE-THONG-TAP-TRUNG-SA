# 📋 HƯỚNG DẪN MARKETER — STRAMARK
## Quy định đặt tên Ads, gắn UTM, và Quy trình POS

> **Phiên bản:** v2.0 — 23/02/2026  
> **Áp dụng cho:** Tất cả marketer Stramark

---

## 1. 🏷️ QUY ĐỊNH ĐẶT TÊN CAMPAIGN

### Format bắt buộc:
```
DD.MM - MÃ_SP - THỊ_TRƯỜNG - LOẠI - THƯƠNG_HIỆU - MÃ_MKTER
```

### Ví dụ đúng ✅
```
22.01 - D04 - Romania - CĐ - Aurelia Wear Top - LC
11.02 - D02 - Romania - CĐ - Aurelia Wear Top - TA
15.02 - V09 - Romania - CĐ - Grația Jewelry - TÚ
```

### Ví dụ sai ❌
```
D04 campain moi LC              ← Thiếu format, hệ thống không parse được
22.01-D04-Romania-CĐ-LC        ← Thiếu dấu cách quanh dấu "-"
22.01 - D04 - Romania - CĐ - Aurelia Wear Top - TA-lich  ← Thêm hậu tố vào mã marketer
```

### Giải thích từng phần:

| Phần | Ý nghĩa | Lưu ý |
|------|---------|-------|
| `DD.MM` | Ngày tạo chiến dịch | Luôn 2 chữ số: `05.02` (không phải `5.2`) |
| `MÃ_SP` | Mã sản phẩm trên POS | Xem bảng bên dưới, **phải khớp 100%** |
| `THỊ_TRƯỜNG` | Thị trường mục tiêu | `Romania`, `CD` (đợt sau có thể thêm) |
| `LOẠI` | Loại chiến dịch | `CĐ` = Chuyển đổi, `TN` = Tin nhắn, `TK` = Tương tác |
| `THƯƠNG_HIỆU` | Tên thương hiệu | Viết đúng tên brand, nhất quán |
| `MÃ_MKTER` | Mã marketer (2-3 ký tự) | **KHÔNG thêm bất kỳ hậu tố nào** |

### Mã Marketer (BẮT BUỘC dùng đúng):

| Mã | Tên đầy đủ |
|:--:|:-----------|
| `TA` | Nguyễn Tuấn Anh |
| `LC` | Phạm Thị Linh Chi |
| `TÚ` | Kim Thanh Tú |
| `Lệ` | Trần Cẩm Lệ |

> ⚠️ **QUAN TRỌNG:** Chỉ dùng đúng mã trên. KHÔNG viết: `TA-lich`, `LC trondoi`, `Lệ new`

### Mã Sản Phẩm:

| Mã | Sản phẩm | Giá bán |
|:--:|:---------|:-------:|
| D04 | Rochie plisată cu decolteu rotund | 169 RON |
| D02 | Rochie elegantă plisată | 169 RON |
| T12 | Ceas premium rezistent la apă | 159 RON |
| V02 | Colier "Darul Maicii Domnului" | 139 RON |
| V09 | Colier Grația | 139 RON |
| L20 | Pulover | 129 RON |
| T07 | Ceas sport | 62 RON |
| V03 | Colier Religios | 79 RON |

> Khi có sản phẩm mới → báo admin để cập nhật mã vào hệ thống trước khi chạy ads.

---

## 2. 🔗 GẮN UTM TRACKING (BẮT BUỘC)

### Tại sao cần UTM?
- UTM giúp **tự động gán đơn hàng ↔ marketer ↔ chiến dịch ads**
- Không có UTM → hệ thống chỉ đoán đúng ~80%, **mất 20% attribution**
- Có UTM → **100% chính xác**, biết chính xác ad nào đem về đơn nào

### Cách gắn UTM trên Facebook Ads Manager:

**Bước 1:** Khi tạo Ad, tìm mục **"URL Parameters"** (ở cấp Ad)

**Bước 2:** Copy CHÍNH XÁC đoạn này vào ô URL Parameters:

```
utm_source=facebook&utm_medium={{adset.id}}&utm_campaign={{campaign.name}}&utm_content={{ad.name}}&utm_term={{ad.id}}
```

> ⚠️ **Copy nguyên xi** — KHÔNG sửa bất kỳ ký tự nào trong `{{...}}`  
> Facebook sẽ tự thay thế `{{campaign.name}}` bằng tên thật của campaign

### Bảng mapping UTM → BigQuery:

| UTM Parameter | Giá trị | Cột trong BQ | Mục đích |
|:-------------|:--------|:-------------|:---------|
| `utm_source` | `facebook` | `p_utm_source` | Biết kênh quảng cáo |
| `utm_medium` | `{{adset.id}}` | `p_utm_medium` | Gán nhóm quảng cáo |
| `utm_campaign` | `{{campaign.name}}` | `p_utm_campaign` | Parse tên → marketer + sản phẩm |
| `utm_content` | `{{ad.name}}` | `p_utm_content` | Biết creative nào |
| `utm_term` | `{{ad.id}}` | `p_utm_term` | **Quan trọng nhất** — ID ad duy nhất |

### Kiểm tra UTM đã gắn chưa:
1. Vào Ads Manager → chọn Ad → Edit
2. Tìm mục "Tracking" hoặc "URL Parameters"
3. Phải thấy đủ 5 tham số trên
4. Nếu thiếu → thêm ngay, ad cũ KHÔNG cần tắt, chỉ cần edit lại

---

## 3. 📱 QUY TRÌNH LÀM VIỆC TRÊN POSCAKE (POS)

### 3.1 Xử lý đơn hàng

| Bước | Hành động | Lưu ý |
|:----:|:----------|:------|
| 1 | Đơn mới vào → Kiểm tra thông tin | Tên, SĐT, địa chỉ đầy đủ |
| 2 | Xác nhận đơn → Chuyển **"Đã xác nhận"** | KHÔNG để đơn ở trạng thái "Mới" quá 2h |
| 3 | Gửi đối tác vận chuyển | Đảm bảo đúng sản phẩm + đúng variant |
| 4 | Cập nhật tracking | Nhập mã vận đơn ngay khi có |
| 5 | Đơn giao thành công → **"Đã nhận tiền"** | Kiểm tra số tiền khớp |
| 6 | Đơn hoàn → **"Đã hoàn"** | Ghi lý do hoàn vào note |

### 3.2 Quy tắc status (QUAN TRỌNG)

Các trạng thái trên POS và ý nghĩa trong hệ thống:

| Status POS | Mã | Nhóm | Tính doanh thu? |
|:-----------|:--:|:-----:|:---------------:|
| Mới (new) | 0 | Mới | ❌ Chờ |
| Đã gửi (submitted) | 1 | Xác nhận | ❌ Chờ |
| Đã ship (shipped) | 2 | Đang giao | ❌ Chờ |
| **Đã giao (delivered)** | **3** | **✅ Thành công** | **✅ Có** |
| Đang hoàn (returning) | 4 | ↩️ Hoàn | ❌ Trừ |
| **Đã hoàn (returned)** | **5** | **↩️ Hoàn** | **❌ Trừ** |
| **Đã hủy (canceled)** | **6** | **🚫 Hủy** | **❌ Không** |
| Đóng gói (packing) | 8 | Xử lý | ❌ Chờ |
| Chờ xử lý (pending) | 9 | Xác nhận | ❌ Chờ |
| Đang chờ (waitting) | 11 | Xử lý | ❌ Chờ |
| **Đã nhận tiền (received_money)** | **16** | **✅ Thành công** | **✅ Có** |

> **Chỉ status "Đã giao" (3) và "Đã nhận tiền" (16) mới tính doanh thu!**

### 3.3 Các lỗi thường gặp trên POS

| Lỗi | Hậu quả | Cách fix |
|:----|:--------|:---------|
| Để đơn "Mới" không xác nhận | Đơn bị lọt, không theo dõi được | Xác nhận trong 2h |
| Không nhập tracking | Không biết đơn đang ở đâu | Nhập ngay khi ship |
| Chuyển status sai | Tính sai doanh thu trên dashboard | Chỉ dùng đúng flow |
| Không ghi lý do hoàn | Không phân tích được nguyên nhân | Ghi vào "Ghi chú" |
| Sai sản phẩm/variant | COGS và tồn kho sai | Kiểm tra lại trước ship |

### 3.4 Flow xử lý đơn chuẩn

```
Mới (0) → Đã xác nhận (1) → Đóng gói (8) → Đã ship (2) 
    → Đã giao (3) → Đã nhận tiền (16)  ✅ THÀNH CÔNG

    → Đang hoàn (4) → Đã hoàn (5)      ↩️ HOÀN HÀNG

Mới (0) → Đã hủy (6)                   🚫 HỦY
```

---

## 4. 📊 ẢNH HƯỞNG ĐẾN DASHBOARD

| Hành động của bạn | Ảnh hưởng trên dashboard |
|:------------------|:------------------------|
| Đặt tên campaign đúng format | ✅ Tự nhận diện marketer + sản phẩm + thị trường |
| Gắn UTM đúng | ✅ Gán chính xác đơn → ad → marketer |
| Cập nhật status POS kịp thời | ✅ Revenue, P&L, ROAS chính xác |
| Ghi note lý do hoàn | ✅ Phân tích return rate theo nguyên nhân |

### Ví dụ thực tế:
- Bạn chạy campaign `15.02 - D04 - Romania - CĐ - Aurelia Wear Top - LC`
- Gắn UTM → Poscake nhận `utm_term={{ad.id}}` → BQ gán đơn cho ad ID
- Đơn giao thành công → Cập nhật "Đã nhận tiền" trên POS
- Dashboard: **LC** có thêm 1 đơn thành công, 169 RON doanh thu, ROAS tăng

---

## 5. ⚡ CHECKLIST HÀNG NGÀY

- [ ] Kiểm tra tên campaign mới có đúng format chưa
- [ ] UTM đã gắn chưa (5 tham số)
- [ ] Đơn mới trên POS đã xác nhận chưa
- [ ] Đơn đã giao → cập nhật "Đã nhận tiền"
- [ ] Đơn hoàn → cập nhật "Đã hoàn" + ghi lý do
- [ ] Kiểm tra dashboard để nắm ROAS, SR%, và chi phí

---

> 📌 **Liên hệ admin** nếu cần: Thêm mã sản phẩm mới, sửa mã marketer, hoặc có lỗi trên dashboard.
