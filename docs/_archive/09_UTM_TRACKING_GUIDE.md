# UTM Tracking Guide — Stramark Marketers

## Tại sao UTM quan trọng?

UTM parameters cho phép hệ thống **tự động gán đơn hàng ↔ marketer ↔ chiến dịch ads**. Không có UTM, chúng ta phải dùng tên chiến dịch để đoán → chỉ đạt **80% chính xác**.

## Campaign Naming Convention (BẮT BUỘC)

Format: `DD.MM - PRODUCT_CODE - MARKET - TYPE - BRAND - MARKETER_CODE`

| Part | Ví dụ | Giải thích |
|------|-------|------------|
| DD.MM | `22.01` | Ngày tạo chiến dịch |
| PRODUCT_CODE | `D04`, `D02`, `T12` | Mã sản phẩm trên POS |
| MARKET | `Romania` | Thị trường |
| TYPE | `CĐ` | Loại (CĐ = Chuyển đổi) |
| BRAND | `Aurelia Wear Top` | Thương hiệu |
| MARKETER_CODE | `LC`, `TA`, `TÚ`, `Lệ` | Mã marketer (2-3 ký tự) |

### Ví dụ đúng:
```
22.01 - D04 - Romania - CĐ - Aurelia Wear Top - LC
11.02 - D02 - Romania - CĐ - Aurelia Wear Top - TA
```

### ⚠️ KHÔNG nên thêm hậu tố vào MARKETER_CODE:
```
❌ TA-lich        → Hệ thống không nhận ra
❌ LC trondoi     → Hệ thống không nhận ra
❌ Lệ new         → Hệ thống không nhận ra
✅ TA             → Chính xác
✅ LC             → Chính xác
✅ Lệ             → Chính xác
```

## UTM Parameters cho Facebook Ads

Khi tạo ad trên Facebook, thêm các UTM sau vào URL:

```
?utm_source=facebook
&utm_medium={{adset.id}}
&utm_campaign={{campaign.name}}
&utm_content={{ad.name}}
&utm_term={{ad.id}}
```

### Mapping:
| UTM | Facebook Field | BQ Column | Mục đích |
|-----|---------------|-----------|----------|
| `utm_source` | `facebook` | `p_utm_source` | Kênh quảng cáo |
| `utm_medium` | `{{adset.id}}` | `p_utm_medium` | Nhóm quảng cáo |
| `utm_campaign` | `{{campaign.name}}` | `p_utm_campaign` | Tên chiến dịch |
| `utm_content` | `{{ad.name}}` | `p_utm_content` | Tên quảng cáo |
| `utm_term` | `{{ad.id}}` | `p_utm_term` | ID quảng cáo (quan trọng nhất) |

## Marketer Codes hiện tại

| Code | Marketer |
|------|----------|
| `TA` | Nguyễn Tuấn Anh |
| `LC` | Phạm Thị Linh Chi |
| `TÚ` | Kim Thanh Tú |
| `Lệ` | Trần Cẩm Lệ |

## Product Codes

| Code | Sản phẩm | Giá bán |
|------|----------|---------|
| D04 | Rochie plisată cu decolteu rotund | 169 RON |
| D02 | Rochie elegantă plisată | 169 RON |
| T12 | Ceas premium rezistent la apă | 159 RON |
| V02 | Colier "Darul Maicii Domnului" | 139 RON |
| V09 | Colier Grația | 139 RON |
| L20 | L20 - Pulover | 129 RON |
| T07 | Ceas sport | 62 RON |
| V03 | Colier Religios | 79 RON |
