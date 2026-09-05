# 📋 HƯỚNG DẪN MARKETER — AUUS1 (PiAlpha US-AU)
## Quy định đặt tên Ads, gắn UTM, Quy trình POS & Đặc thù thị trường

> **Phiên bản:** v1.0 — 24/02/2026  
> **Áp dụng cho:** Tất cả marketer team AUUS (PiAlpha)  
> **Thị trường:** 🇺🇸 Mỹ (US) & 🇦🇺 Úc (AU)  
> **Tiền tệ base:** USD

---

## 1. 🏷️ QUY ĐỊNH ĐẶT TÊN CAMPAIGN

### Format bắt buộc:
```
{MARKET}/{MARKETER}/{PRODUCT}/{PAGE_ID}/{PAGE_NAME}/{DATE}
```

### Ví dụ đúng ✅
```
AUS/Kính/Body Lotion/61585337499878/Skin Glow AU/1702
US/Thắng/dầu gội Fa Le Mei/61586530110932/Luxe Avenue US/15022025
AUS/Mạnh/Serum Vitamin C/61585337499878/Skin Glow AU/2002
```

### Ví dụ sai ❌
```
Kính - Body Lotion - AU           ← Sai format, không dùng "/" phân tách
AUS/Kính/Body Lotion              ← Thiếu Page ID, Page Name, Date
test campaign kinh                ← Không theo format, hệ thống không parse được
```

### Giải thích từng phần:

| Vị trí | Phần | Ý nghĩa | Lưu ý |
|:------:|:-----|:--------|:------|
| 0 | `MARKET` | Thị trường mục tiêu | `US` = Mỹ, `AUS` = Úc (hệ thống tự normalize AUS → AU) |
| 1 | `MARKETER` | Tên marketer | Viết đúng tên, **phải khớp registry** |
| 2 | `PRODUCT` | Tên sản phẩm | Viết tự do, bám sát registry để gom nhóm |
| 3 | `PAGE_ID` | Facebook Page ID | Copy từ Fan Page đang chạy ads |
| 4 | `PAGE_NAME` | Tên Page | Tên Fan Page |
| 5 | `DATE` | Ngày tạo | Format: `DDMM` hoặc `DDMMYYYY` |

### Đội ngũ Marketer:

| ID | Tên đầy đủ | Vai trò |
|:--:|:-----------|:--------|
| `THANHNT` | Nguyễn Tất Thành | Leader |
| `THANGNH` / `Thắng` | Nguyễn Hữu Thắng | Marketer |
| `KINHBN` / `Kính` | Bùi Nguyên Kính | Marketer |
| `MANHDS` / `Mạnh` | Đặng Sỹ Mạnh | Marketer |

> ⚠️ **QUAN TRỌNG:** Tên marketer trong campaign phải khớp registry. Ví dụ: `Kính`, `Thắng`, `Mạnh`. KHÔNG viết sai tên hoặc thêm ký tự lạ.

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
| `utm_medium` | `{{adset.id}}` | `p_utm_medium` | Gán nhóm quảng cáo (adset) |
| `utm_campaign` | `{{campaign.name}}` | `p_utm_campaign` | Parse tên → marketer + sản phẩm |
| `utm_content` | `{{ad.name}}` | `p_utm_content` | Biết creative nào |
| `utm_term` | `{{ad.id}}` | `p_utm_term` | **Quan trọng nhất** — ID ad duy nhất |

### Kiểm tra UTM đã gắn chưa:
1. Vào Ads Manager → chọn Ad → Edit
2. Tìm mục "Tracking" hoặc "URL Parameters"
3. Phải thấy đủ 5 tham số trên
4. Nếu thiếu → thêm ngay, ad cũ KHÔNG cần tắt, chỉ cần edit lại

---

## 3. 💰 GIÁ BÁN & COMBO — ĐẶC THÙ AUUS

### 🇺🇸 Thị trường Mỹ (USD):

| Combo | Giá bán | Ghi chú |
|:-----:|:-------:|:--------|
| 3 SP | **$199** | ✅ Combo tiêu chuẩn |
| 5 SP | **$299** | ✅ Combo lớn |

> ⚠️ **Mỹ KHÔNG bán lẻ 1-2 sản phẩm.** Chỉ bán combo 3 hoặc 5.

### 🇦🇺 Thị trường Úc (AUD):

| Combo | Giá bán (AUD) | Ghi chú |
|:-----:|:-------------:|:--------|
| 1 SP | **$149** | Bán lẻ |
| 2 SP | **$99** | ⚠️ Rẻ hơn 1 SP! |
| 3 SP | **$149** | — |
| 4 SP | **$149** | Cố định |
| 5 SP | **$249** | — |
| 10 SP | **$299** | Combo lớn nhất |

> ⚠️ **Lưu ý đặc biệt:** 2 SP ($99) rẻ hơn 1 SP ($149), và combo 4 luôn $149.

### POS lưu giá ÷ 100:
- Trên hệ thống POS, giá hiển thị nhân 100. Ví dụ: `19900` = **$199.00**
- Doanh thu lấy từ trường **`COD`** (money_to_collect ÷ 100)

---

## 4. 📱 QUY TRÌNH LÀM VIỆC TRÊN POSCAKE (POS)

### 4.1 Hai shop riêng biệt

| Shop | Shop ID | Tiền tệ | Warehouse |
|:----:|:-------:|:-------:|:---------:|
| 🇺🇸 US | `100197417` | USD | AMI, NAZA |
| 🇦🇺 AU | `1328333296` | AUD | NAZA |

> Mỗi thị trường dùng shop riêng trên Poscake. **KHÔNG nhầm shop khi xử lý đơn.**

### 4.2 Xử lý đơn hàng

| Bước | Hành động | Lưu ý |
|:----:|:----------|:------|
| 1 | Đơn mới vào → Kiểm tra thông tin | Tên, SĐT, địa chỉ đầy đủ |
| 2 | Xác nhận đơn → Chuyển **"Đã xác nhận"** | KHÔNG để đơn ở trạng thái "Mới" quá 2h |
| 3 | Gửi đối tác vận chuyển (AMI/NAZA) | Đảm bảo đúng sản phẩm + đúng combo |
| 4 | Cập nhật tracking | Nhập mã vận đơn ngay khi có |
| 5 | Đơn giao thành công → **"Đã giao"** | ⚠️ Giao 100% tự động |
| 6 | Thu tiền → **"Đã nhận tiền"** | Chờ 10-20 ngày mới nhận tiền |

### 4.3 Quy tắc Status (QUAN TRỌNG)

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

### 4.4 Flow xử lý đơn chuẩn

```
Mới (0) → Đã xác nhận (1) → Đóng gói (8) → Đã ship (2) 
    → Đã giao (3) → Đã nhận tiền (16)  ✅ THÀNH CÔNG

    → Đang hoàn (4) → Đã hoàn (5)      ↩️ HOÀN HÀNG

Mới (0) → Đã hủy (6)                   🚫 HỦY
```

### 4.5 Các lỗi thường gặp trên POS

| Lỗi | Hậu quả | Cách fix |
|:----|:--------|:---------|
| Để đơn "Mới" không xác nhận | Đơn bị lọt, không theo dõi được | Xác nhận trong 2h |
| Không nhập tracking | Không biết đơn đang ở đâu | Nhập ngay khi ship |
| Chuyển status sai | Tính sai doanh thu trên dashboard | Chỉ dùng đúng flow |
| Không ghi lý do hoàn | Không phân tích được nguyên nhân | Ghi vào "Ghi chú" |
| Sai sản phẩm/combo | COGS và doanh thu sai | Kiểm tra combo trước ship |
| **Nhầm shop US ↔ AU** | **Sai tiền tệ, sai giá** | **Kiểm tra shop đúng market** |

---

## 5. ⚠️ ĐẶC THÙ MÔ HÌNH AUUS (RẤT QUAN TRỌNG)

### 5.1 Mô hình Pre-Paid / Post-Delivery Payment

```
┌──────────────┐     ┌───────────────┐     ┌──────────────────┐
│  Giao hàng   │ ──►│  Thu tiền      │ ──►│  Nhận tiền thực  │
│  100% thành  │     │  Sau 10-20    │     │  Chỉ 60-80%     │
│  công        │     │  ngày         │     │  số đơn          │
└──────────────┘     └───────────────┘     └──────────────────┘
```

| Đặc điểm | Chi tiết |
|:----------|:---------|
| Tỷ lệ giao thành công | **100%** (hệ thống tự gán thành công) |
| Thời gian thu tiền | **10-20 ngày** sau khi giao |
| Tỷ lệ thu hồi tiền | **60-80%** (20-40% đơn KHÔNG thu được tiền) |
| Phí COD | **$0** (không có phí COD) |
| Phí hoàn hàng | **$0** (không có return) |

> 🚨 **CẢNH BÁO:** Doanh thu trên Dashboard là doanh thu **giao thành công**, CHƯA PHẢI doanh thu **thực thu**. Lợi nhuận thực tế sẽ thấp hơn 20-40% so với hiển thị.

### 5.2 Chi phí Fulfillment (3PL)

| 3PL | Thị trường | Packing | Ship | Tổng/đơn |
|:---:|:----------:|:-------:|:----:|:--------:|
| **AMI** | 🇺🇸 US | $1.00 USD | $10.00 USD | **$11.00 USD** |
| **NAZA** | 🇺🇸 US | $1.00 USD | $10.00 USD | **$11.00 USD** |
| **NAZA** | 🇦🇺 AU | $1.00 AUD | $10.00 AUD | **$11.00 AUD** → convert USD |

### 5.3 Quy đổi tiền tệ

| Từ | Sang | Tỷ giá |
|:--:|:----:|:------:|
| AUD | VND | 17,100 |
| USD | VND | 25,700 |

- **Tất cả doanh thu Úc (AUD)** → quy đổi về **USD** trên Dashboard
- **Ads Spend** đã tính bằng USD (trực tiếp qua Meta)

---

## 6. 📊 CÁCH ĐỌC DASHBOARD

### 6.1 Dashboard URL
- **Truy cập:** `http://localhost:3000/auus1` (hoặc domain server)

### 6.2 Các tab chính cần theo dõi:

| Tab | Mục đích | Tần suất check |
|:----|:---------|:---------------:|
| **CEO Intelligence** | Tổng quan doanh thu, đơn, ROAS | Hàng ngày |
| **Marketing & Ads** | Hiệu quả ads (Spend, Revenue, ROAS) | Hàng ngày |
| **P&L** | Lãi/Lỗ theo ngày | Hàng ngày |
| **Marketer Performance** | So sánh hiệu suất giữa marketer | Hàng tuần |
| **Products & Inventory** | Sản phẩm nào bán chạy | Hàng tuần |

### 6.3 Các chỉ số quan trọng:

| Chỉ số | Công thức | KPI Target |
|:-------|:----------|:----------:|
| **ROAS** | Revenue ÷ Ads Spend | **> 5.0** |
| **Gross Profit** | Revenue − COGS − 3PL Cost | Dương |
| **Net Profit** | Gross Profit − Ads Spend | Dương |
| **Success Rate** | Đơn thành công ÷ Tổng đơn | > 80% |

---

## 7. 🧪 CAMPAIGN TEST (SẢN PHẨM THỬ)

### Quy tắc test sản phẩm mới:
- Campaigns chạy thử nghiệm **KHÔNG cần match POS** (ít hoặc không có đơn)
- Hệ thống **vẫn kéo 100%** dữ liệu ads (Spend, Impressions, CPC, CTR, CPM)
- **Mục đích:** Theo dõi ngân sách test, dập camp vượt hạn mức

### Khi nào dập campaign test:
- Spend > **$50 USD** mà không có đơn → Cân nhắc dập
- CTR < **0.5%** sau 1000 impressions → Content không hiệu quả
- CPC > **$5 USD** → Targeting cần điều chỉnh

> 📌 Khi có sản phẩm mới → **báo admin** để cập nhật vào registry trước khi chạy ads.

---

## 8. ⚡ CHECKLIST HÀNG NGÀY

### Sáng (9:00)
- [ ] Kiểm tra đơn mới trên POS (cả 2 shop US + AU)
- [ ] Xác nhận đơn trong vòng 2h
- [ ] Kiểm tra ads đang chạy, UTM đã gắn chưa (5 tham số)
- [ ] Kiểm tra campaign test: có camp nào cần dập không?

### Chiều (15:00)
- [ ] Cập nhật tracking cho đơn đã ship
- [ ] Đổi status đơn hoàn trả → "Đã hoàn" + ghi lý do
- [ ] Kiểm tra Dashboard: ROAS, Revenue, Spend

### Cuối ngày (18:00)
- [ ] Đơn đã giao → cập nhật "Đã nhận tiền" (nếu đã thu)
- [ ] Review tên campaign mới tạo — đúng format chưa?
- [ ] Ghi chú bất kỳ vấn đề nào vào nhóm Discord

---

## 9. ❓ CÂU HỎI THƯỜNG GẶP (FAQ)

**Q: Tại sao doanh thu trên Dashboard khác tiền thực nhận?**  
A: Doanh thu trên Dashboard = đơn giao thành công. Tiền thực nhận chỉ 60-80% (sau 10-20 ngày).

**Q: Tôi chạy ads cho cả US và AU, cần lưu ý gì?**  
A: Phân biệt rõ market trong tên campaign (`US/...` hoặc `AUS/...`). Xử lý đơn đúng shop.

**Q: Campaign test có ảnh hưởng đến ROAS tổng không?**  
A: Có! Spend từ campaign test được tính vào tổng spend → giảm ROAS. Dập camp kém sớm.

**Q: Tại sao combo 2 SP ở Úc rẻ hơn 1 SP?**  
A: Đây là chiến lược giá. Combo 2 = $99 AUD, đơn lẻ = $149 AUD. Đẩy khách mua combo.

**Q: Shop AU giá AUD, Dashboard hiện USD — có sai không?**  
A: Không sai. Hệ thống tự quy đổi AUD → USD theo tỷ giá để so sánh thống nhất.

---

## 10. 📞 LIÊN HỆ & HỖ TRỢ

| Vấn đề | Liên hệ |
|:-------|:--------|
| Thêm mã sản phẩm mới | Admin (cập nhật registry) |
| Lỗi dashboard / Data sai | Admin (kiểm tra BigQuery) |
| Đổi/thêm marketer | Admin (cập nhật AUUS1.yaml) |
| Ads account có vấn đề | Leader (Thành) |
| Hết token Meta Ads | Admin (token hết hạn ~16/04/2026) |

> 📌 **Discord:** Mọi alert và báo cáo tự động được gửi về kênh Discord của team.

---

> 📝 **Ghi nhớ:** Làm đúng 3 việc = Dashboard chính xác:  
> 1️⃣ Đặt tên campaign đúng format  
> 2️⃣ Gắn UTM đầy đủ 5 tham số  
> 3️⃣ Cập nhật status POS kịp thời
