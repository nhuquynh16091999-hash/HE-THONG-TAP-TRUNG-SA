# Chuẩn đặt tên campaign

> Mục đích: máy đọc được **chắc chắn**, không phải đoán. Đặt sai một ô là tiền
> chạy sang ô người khác mà báo cáo vẫn ra bình thường — không lỗi, không cảnh báo.

---

## Công thức

```
MARKETER/THỊTRƯỜNG/SANPHAM/TRANG/NGAY
```

Thêm `/TEST` ở cuối nếu là campaign thử sản phẩm.

### Ví dụ đúng

```
LOC/TW/042-BLACK/TaiwanPrimeLeather/2808
THUONG/PH/SET-KIM-CUONG/LuxeGold/0109
THAI/ID/040-VONGVANG1/LumoraJewelry/1908
SANH/TW/BONGTAI-TRON/LuckyClover/2808/TEST
```

---

## Năm ô, theo đúng thứ tự

### 1. Marketer — dùng mã, không dùng tên có dấu

| Người | Mã |
|---|---|
| Lộc | `LOC` |
| Sỹ Anh | `SANH` |
| Thái | `THAI` |
| Thương | `THUONG` |
| Quỳnh | `QUYNH` |
| Thắng | `THANG` |

**Vì sao phải là mã không dấu:** chữ hoa tiếng Việt **vẫn giữ dấu**. `"Thắng"`
viết hoa ra `"THẮNG"` — máy so với `"THANG"` là **không khớp**. Đây là lỗi thật,
đã có test canh riêng trong hệ thống.

**Marketer phải ở ô ĐẦU TIÊN.** Trước đây có lúc để sau tên thị trường, và luật
đọc theo kiểu "tìm thị trường rồi lấy ô kế tiếp" — mong manh, đổi thứ tự một chút
là hỏng. Ô đầu thì không bao giờ nhầm.

### 2. Thị trường — nơi GIAO HÀNG, dùng mã 2 chữ

| Thị trường | Mã |
|---|---|
| Đài Loan | `TW` |
| Philippines | `PH` |
| Indonesia | `ID` |
| Việt Nam | `VN` |

**Đây là ô đang gây lẫn lộn nhiều nhất.** Đo trên 30 ngày gần nhất: 45,6 triệu
chi tiêu ghi `Philippine`, `INDO`, `VN` — **không một đồng nào ghi Đài Loan**,
trong khi toàn bộ đơn hàng thực tế lại giao ở Đài qua 7-Eleven và FamilyMart.

Ô này phải là **nơi hàng được giao tới tay khách**, vì nó quyết định:
- tiền quy đổi theo tỷ giá nào
- phí vận chuyển tính theo bảng nào
- đơn nào vào báo cáo thị trường nào

Nếu muốn ghi thêm tệp khách nhắm tới thì để ở ô ghi chú cuối, đừng để ở đây.

### 3. Sản phẩm — mã SKU, không dấu, nối bằng gạch ngang

```
042-BLACK        036-BROWN        SET-KIM-CUONG
```

Có mã SKU thì dùng mã. Không có thì viết không dấu, thay khoảng trắng bằng `-`.

### 4. Trang — tên trang Facebook, viết liền hoặc nối gạch

```
TaiwanPrimeLeather      LuxeGold      LumoraJewelry
```

Bỏ dấu, bỏ khoảng trắng, bỏ ký tự trang trí. Tên trang kiểu
`𝑻𝒂𝒊𝒘𝒂𝒏 𝑷𝒓𝒊𝒎𝒆 𝑳𝒆𝒂𝒕𝒉𝒆𝒓` là chữ Unicode đặc biệt — nhìn giống chữ thường nhưng
máy đọc ra ký tự khác hẳn.

### 5. Ngày — bốn số `DDMM`, KHÔNG có dấu gạch chéo

```
2808   ✅
28-8   ✅ cũng được
28/08  ❌ SAI
```

**Đây là lỗi âm thầm tệ nhất.** Dấu `/` là ký tự ngăn ô. Viết `27/08` là tự đẻ
thêm một ô, mọi ô phía sau lệch vị trí hết. Đã gặp thật:

```
Thainx/Philippine/SET KIM CƯƠNG/ LuxeGold Jewelry - 27/08
                                                      ↑ ô thứ 5 thành "08"
```

**Trong tên campaign, `/` chỉ được dùng để ngăn ô. Không dùng ở bất kỳ chỗ nào khác.**

### 6. Campaign test — thêm `/TEST` ở cuối

```
SANH/TW/BONGTAI-TRON/LuckyClover/2808/TEST
```

Campaign test bị tách khỏi báo cáo doanh số nhưng vẫn được tính vào tổng chi —
tiền thật đã tiêu, không giấu.

---

## Bốn quy tắc cứng

1. **`/` chỉ để ngăn ô.** Không dùng trong ngày tháng, tên sản phẩm hay tên trang.
2. **Không dấu tiếng Việt** ở ô marketer và ô thị trường.
3. **Đúng thứ tự.** Marketer luôn ở ô đầu, thị trường luôn ở ô hai.
4. **Không đổi tên campaign sau khi đã chạy.** Đổi tên là số lịch sử gãy làm đôi:
   nửa cũ gán một người, nửa mới gán người khác.

---

## Đang chuyển đổi thì sao

Hệ thống hiện **đọc được cả tên cũ lẫn tên mới** — không phải đi sửa lại campaign
đang chạy. Nhưng tên cũ đọc bằng cách đoán, còn tên mới đọc chắc chắn.

Áp chuẩn này cho **campaign tạo mới từ nay**. Tên cũ để nguyên cho tới khi tự tắt.

---

## Kiểm nhanh trước khi bấm tạo

Đọc lại tên campaign và tự hỏi:

- [ ] Ô đầu có phải mã marketer không dấu trong bảng trên không?
- [ ] Ô hai có phải mã thị trường **nơi giao hàng** không?
- [ ] Trong tên còn dấu `/` nào không phải để ngăn ô không?
- [ ] Đếm đủ 5 ô chưa?

Sai một ô là tiền chạy sang người khác, mà báo cáo vẫn ra bình thường.
