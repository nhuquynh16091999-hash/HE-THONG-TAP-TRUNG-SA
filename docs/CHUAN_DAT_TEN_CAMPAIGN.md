# Chuẩn đặt tên campaign

> Mục đích: máy đọc được **chắc chắn**, không phải đoán. Đặt sai một ô là tiền
> chạy sang ô người khác mà báo cáo vẫn ra bình thường — không lỗi, không cảnh báo.

---

## Công thức

```
THỊTRƯỜNG/MARKETER/TỆPKHÁCH/MÃSANPHAM/TENTRANG/NGAY/TEST
```

Thêm `/TEST` ở cuối nếu là campaign thử sản phẩm.

### Ví dụ đúng

```
TW/LOC/PHI/042-BLACK/TaiwanPrimeLeather/2808
TW/THUONG/INDO/SET-KIM-CUONG/LuxeGold/0109
TW/THAI/VN/040-VONGVANG1/LumoraJewelry/1908
TW/SANH/TW/BONGTAI-TRON/LuckyClover/2808/TEST
```

---

## Các ô, theo đúng thứ tự

### 1. Thị trường — hiện luôn là `TW`

Công ty chỉ bán ở Đài Loan nên ô này luôn `TW`. Giữ ô này để sau có thêm thị
trường thì không phải đổi lại chuẩn, cũng không phải sửa tên campaign cũ.

### 2. Marketer — dùng mã, không dùng tên có dấu

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

Máy nhận ra marketer bằng chính mã trong bảng trên chứ không bằng vị trí, nên vẫn
đọc được tên cũ đặt khác thứ tự. Nhưng đặt đúng chỗ thì chắc chắn hơn.

### 3. Tệp khách — cộng đồng ở Đài mà quảng cáo nhắm tới

| Tệp khách | Mã |
|---|---|
| Người Philippines | `PHI` |
| Người Indonesia | `INDO` |
| Người Việt | `VN` |
| Người Đài bản địa | `TW` |

**Đây KHÔNG phải thị trường.** Hàng vẫn giao ở Đài qua 7-Eleven và FamilyMart,
vẫn thu TWD. Bốn mã trên là các cộng đồng đang **sống tại Đài** — lao động
Philippines, Indonesia, Việt Nam, và người Đài bản địa.

⚠️ **`TW` xuất hiện ở hai ô với hai nghĩa khác nhau:** ô 1 là thị trường Đài Loan,
ô 3 là tệp *người Đài bản địa*. Nên `TW/SANH/TW/...` là hoàn toàn hợp lệ — Sỹ Anh
chạy quảng cáo nhắm người Đài, bán tại Đài.

Máy phân biệt được: khi tìm tệp khách nó **loại ô thị trường và ô marketer ra
trước**. Không loại thì mọi campaign đều bị gán tệp "người Đài" vì vớ ngay ô đầu —
không lỗi, không cảnh báo, chỉ có toàn bộ bảng tệp khách sai. Đã thử và dính thật.

Bổ chi tiêu theo tệp là chiều phân tích đáng tiền. Đo 30 ngày thật:

| Tệp | Chi tiêu | Ngân sách | Giá mỗi tin nhắn |
|---|---|---|---|
| Người Philippines | 31,5 tr | 69% | 20.172đ |
| Người Indonesia | 10,0 tr | 22% | 23.473đ |
| **Người Việt** | 2,6 tr | 6% | **10.504đ** ← rẻ nhất |
| Người Đài | 948 k | 2% | 30.594đ |

Tệp người Việt ra tin nhắn rẻ chưa bằng nửa tệp Philippines, mà chỉ được 6% ngân sách.

### 4. Mã sản phẩm — BẮT BUỘC bắt đầu bằng mã SKU ba số

```
042-BLACK        036-BROWN        040-VONGVANG1        053-SET10
```

Ba số đầu là mã SKU, phần sau là biến thể. **Phải có ba số đầu** — đó là thứ nối
chi phí quảng cáo với giá vốn, tức là thứ cho biết mã hàng nào thật sự có lãi.

Viết `SET-KIM-CUONG` không có mã thì tiền chạy vào ô "không rõ mã". Đo 30 ngày
thật: **23,5 triệu** đang nằm ở ô đó, không quy được về sản phẩm nào.

Và trong số đã có mã, **20 triệu chạy vào mã CHƯA KHAI GIÁ VỐN** — lãi gộp của
phần này đang ảo cao. Dashboard có đánh dấu ⚠ ở bảng "Theo mã sản phẩm"; thấy dấu
đó thì khai giá vốn vào `config/talpha_rules.json → products`.

### 5. Tên trang — viết liền hoặc nối gạch

```
TaiwanPrimeLeather      LuxeGold      LumoraJewelry
```

Bỏ dấu, bỏ khoảng trắng, bỏ ký tự trang trí. Tên trang kiểu
`𝑻𝒂𝒊𝒘𝒂𝒏 𝑷𝒓𝒊𝒎𝒆 𝑳𝒆𝒂𝒕𝒉𝒆𝒓` là chữ Unicode đặc biệt — nhìn giống chữ thường nhưng
máy đọc ra ký tự khác hẳn.

### 6. Ngày — bốn số `DDMM`, KHÔNG có dấu gạch chéo

```
2808   ✅
28-8   ✅ cũng được
28/08  ❌ SAI
```

**Đây là lỗi âm thầm tệ nhất.** Dấu `/` là ký tự ngăn ô. Viết `27/08` là tự đẻ
thêm một ô, mọi ô phía sau lệch vị trí hết. Đã gặp thật:

```
TW/THUONG/PHI/SET KIM CƯƠNG/LuxeGold Jewelry - 27/08
                                                  ↑ đẻ thêm ô, mọi ô sau lệch
```

**Trong tên campaign, `/` chỉ được dùng để ngăn ô. Không dùng ở chỗ nào khác.**

### 7. `/TEST` — chỉ thêm khi là campaign thử

```
TW/SANH/TW/BONGTAI-TRON/LuckyClover/2808/TEST
```

Campaign test bị tách khỏi báo cáo doanh số nhưng vẫn được tính vào tổng chi —
tiền thật đã tiêu, không giấu.

---

## Bốn quy tắc cứng

1. **`/` chỉ để ngăn ô.** Không dùng trong ngày tháng, tên sản phẩm hay tên trang.
2. **Không dấu tiếng Việt** ở ô marketer và ô tệp khách.
3. **Đúng thứ tự.** Thị trường ô 1, marketer ô 2, tệp khách ô 3.
4. **Không đổi tên campaign sau khi đã chạy.** Đổi tên là số lịch sử gãy làm đôi:
   nửa cũ gán một người, nửa mới gán người khác.

---

## Đang chuyển đổi thì sao

Hệ thống **đọc được cả tên cũ lẫn tên mới** — không phải đi sửa lại campaign đang
chạy. Nhưng tên cũ đọc bằng cách đoán, còn tên mới đọc chắc chắn.

Áp chuẩn này cho **campaign tạo mới từ nay**. Tên cũ để nguyên cho tới khi tự tắt.

---

## Kiểm nhanh trước khi bấm tạo

- [ ] Ô 1 có phải `TW` không?
- [ ] Ô 2 có phải mã marketer không dấu trong bảng trên không?
- [ ] Ô 3 có phải mã tệp khách (`PHI` / `INDO` / `VN` / `TW`) không?
- [ ] Trong tên còn dấu `/` nào không phải để ngăn ô không?
- [ ] Ô 4 có bắt đầu bằng **mã SKU ba số** không?
- [ ] Đếm đủ 6 ô chưa? (7 nếu là campaign test)

Sai một ô là tiền chạy sang người khác, mà báo cáo vẫn ra bình thường.
