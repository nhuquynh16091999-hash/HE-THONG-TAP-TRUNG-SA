# Đối soát COD với NAZA供应链

> Mọi con số trong tài liệu này đo từ **7 kỳ sao kê thật** (24/07 → 04/09/2026),
> **321 dòng COD**, **463 dòng phí**, đối chiếu với **631 đơn** trong file đơn tổng.

---

## Tiền đi đường nào

```
1. Lên đơn
        ↓
2. Xuất kho → giao NAZA
        ↓
3. NAZA đưa hàng tới 7-Eleven / FamilyMart / giao tận nhà
        ↓
4. Khách ra cửa hàng, TRẢ TIỀN tại quầy      ← tiền rời tay khách
        ↓
   ┌──────────────────────────────────┐
   │  VÙNG MÙ — tiền của mình          │  1–3 tuần
   │  nhưng đang nằm ở NAZA            │
   └──────────────────────────────────┘
        ↓
5. NAZA gửi sao kê + chuyển khoản về
```

Bước 4 tới 5 là chỗ đối soát sinh ra để canh. File đơn chỉ biết tới bước 4 —
"đã giao thành công" rồi im. Sổ ngân hàng chỉ thấy một cục tiền về, không biết
gồm những đơn nào. Không ai nối hai đầu thì không trả lời được **NAZA đã trả đủ chưa**.

---

## Sao kê NAZA có gì

Mỗi file `.xlsx` có **đúng ba sheet**, và cả ba đều cần:

| Sheet | Nội dung | Dùng để làm gì |
|---|---|---|
| `汇总 TỔNG` | phép quyết toán của kỳ | kiểm NAZA tính đúng không |
| `COD账单` | từng đơn **đã thu được tiền** | khớp với đơn của mình |
| `速递运费RMB` | từng đơn **đã xuất kho** + phí | soát phí với bảng giá |

⚠️ **Sheet COD và sheet PHÍ là hai tập đơn khác nhau**, không phải hai cột của
cùng một bảng. Đơn xuất kho tuần này thường tuần sau mới thu được tiền. Chính
chỗ lệch giữa hai tập đó là tiền đang treo.

### Phép quyết toán

```
TWD ròng  = COD thu về − hoàn tiền khiếu nại
RMB       = TWD ròng × tỷ giá TWD→RMB          (~0,20)
RMB ròng  = RMB − phí vận chuyển − phí thao tác
VND       = RMB ròng × tỷ giá RMB→VND          (~3.860)
Phải trả  = VND − phí mua hàng kỳ này ± điều chỉnh kỳ trước
```

**Đã kiểm cả 7 kỳ: lệch 0 đồng.** Số của NAZA tự khớp — nên việc của mình không
phải là bắt lỗi phép tính của họ, mà là **đối chiếu chi tiết với đơn của mình**.

Kỳ âm được mang sang kỳ sau. Thật: kỳ 24/07 ra −163,29 RMB, kỳ 31/07 trừ lại
đúng −636.831 VND (= −163,29 × 3.900).

---

## Khoá đối chiếu — hai tầng, không được đảo

### Tầng 1: MÃ VẬN ĐƠN (转单号)

Đo trên **784 dòng sao kê thật: duy nhất tuyệt đối**, không một mã nào lặp.
Đây là khoá chính.

### Tầng 2: MÃ ĐƠN (原单号) — chỉ khi tầng 1 trượt

Đơn giao lần đầu hỏng sẽ được **gửi lại bằng mã vận đơn MỚI**, trong khi mã đơn
giữ nguyên; file của mình vẫn ghi mã vận đơn cũ. Thật, 6 đơn:

| Mã đơn | File mình ghi | NAZA trả trên |
|---|---|---|
| T1014 | 17904604 | 17905748 |
| T1102 | 06718699199 | 06722405704 |
| T1115 | 17952890 | 17959110 |
| T1128 | 17952894 | 17959109 |
| T1129 | 17952895 | 17959106 |
| T1055 | 06718685230 | 06718699201 |

**Bỏ tầng 2 là 6 đơn này bị kết luận nhầm thành mất tiền**, trong khi NAZA đã trả đủ.

### Vì sao mã đơn KHÔNG được làm khoá chính

`T1402` thật sự được dùng lại cho **hai lần giao khác nhau**: 1.500 TWD trên mã
17916892, và 749 TWD trên 17992306. Lấy mã đơn làm khoá chính là gộp hai khoản
thanh toán khác nhau vào một đơn.

Mã đơn còn có tiền tố `TAIWAN-`, hậu tố `-Z` (转寄 = chuyển tiếp), `-1` (lần giao
lại), và có dòng ghi cả mã cũ trong ngoặc: `T1467 (7564042426-z)`. Tất cả đều
được cắt trước khi so.

---

## Năm kết luận

| Kết luận | Nghĩa | Làm gì |
|---|---|---|
| **Khớp** | khớp mã, khớp tiền | không cần làm gì |
| **Lệch tiền** | khớp mã nhưng khác số quá 1 TWD | soi từng đơn |
| **Chưa về tiền** | đã giao, sao kê chưa có, **dưới 30 ngày** | bình thường, chờ kỳ sau |
| **QUÁ HẠN** | đã giao, **quá 30 ngày** vẫn chưa về | **đi đòi** |
| **Thừa ở sao kê** | NAZA trả cho đơn mình không có | tra lại mã vận đơn |

Tách "chưa về" khỏi "quá hạn" mới ra được việc phải làm: đo thật, 43 đơn chưa về
là nhịp thanh toán bình thường, chỉ **2 đơn quá hạn** mới cần đi đòi.

---

## Đối soát theo BẢN SAO KÊ, không theo khoảng ngày

Hai cái bẫy đã dính khi dựng, cả hai đều đẻ ra báo động giả:

**1. Lọc đơn theo khoảng ngày.** Sao kê là một *kỳ thanh toán* — nó trả tiền cho
đơn đã giao xong, mà đơn đó có thể đặt từ hàng tháng trước. Kỳ 04/09 thật có đơn
đặt từ 10/07. Lọc đơn theo khoảng 15/08–08/09 rồi đem khớp thì **28 đơn** bị kết
luận "NAZA trả cho đơn mình không có", trong khi đơn nằm sẵn trong hệ thống.

→ Nạp **toàn bộ đơn đã giao**. Khoảng ngày ở thanh trên chỉ dùng làm mốc "hôm
nay" để tính đơn nào quá hạn.

**2. Chỉ khớp với một kỳ.** Tiền của một đơn chỉ về đúng một lần, ở đúng một kỳ.
Đem toàn bộ đơn đi khớp với riêng một kỳ thì mọi đơn đã trả ở kỳ khác đều thành
"chưa về tiền".

→ Khớp với **hợp của mọi bản sao kê đã tải**. Bản đang chọn chỉ quyết định xem
phần quyết toán và soát phí của kỳ nào.

**3. Tải lại cùng một file thì THAY, không cộng thêm.** Để hai bản của cùng một
kỳ nằm cạnh nhau thì mọi dòng bị đếm hai lượt — khoản lệch 14 TWD hoá thành 28.

---

## Soát phí với bảng giá

Bảng giá Đài Loan (nguồn: `18.10 COD TỪ TQ ĐI 8 NƯỚC.xlsx`, sheet `ĐÀI LOAN`):

| Kênh giao hàng | 1 kg đầu | Kg tiếp theo |
|---|---|---|
| Cửa hàng tiện lợi 7-Eleven / FamilyMart | **27 RMB** | <3kg: 15 RMB/kg |
| HCT Logistics — giao tận nhà | **32 RMB** | >3kg: 19 RMB/kg |
| Yamato Transport | **38 RMB** | |

**Kết quả soát 463 dòng phí thật: 463/463 đúng bảng giá, lệch 0 RMB.**
NAZA tính phí vận chuyển sòng phẳng.

Đang dùng: 417 đơn qua cửa hàng tiện lợi, 46 đơn giao tận nhà, 0 đơn Yamato.

### Một khoản cần hỏi

**Phí thao tác 3 RMB/đơn**, thu đều trên cả 463 đơn = **1.389 RMB** qua 7 kỳ.
Bảng giá ghi *"Phí thao tác chuyển hàng: Miễn phí"*. Có thể là hai khoản khác
nhau, nhưng đáng hỏi NAZA cho rõ.

### Phí mua hàng (采购费)

Bị trừ thẳng vào tiền chuyển về, **không nằm trong bảng giá vận chuyển**. Kỳ
04/09 trừ 5.832.938 VND, kỳ 28/08 trừ 8.715.781 VND. Dashboard cảnh báo mỗi kỳ
có khoản này để đối chiếu với đơn mua hàng.

---

## Dùng thế nào

Mỗi lần NAZA gửi sao kê:

1. Vào **🧮 Đối soát → Tải sao kê lên**, chọn file `.xlsx` (không phải đổi sang CSV)
2. Xem **Quyết toán kỳ này** — phép tính có tự khớp không
3. Xem **Soát phí** — có dòng nào lệch bảng giá không
4. Xem ô **QUÁ HẠN** — đơn nào phải đi đòi
5. Xuất CSV gửi NAZA những đơn cần đòi

---

## Nguồn đơn: POS hay file đối tác

Đối soát cần biết "đơn nào đã giao, thu bao nhiêu". Nguồn chuẩn là POS qua
BigQuery, nhưng **chưa có key Poscake** nên kho đó đang trống.

Nên hệ thống lấy tạm từ **file đơn tổng** (đã nạp qua tab Theo dõi vận đơn):
361 đơn đã giao có COD. Màn hình hiện rõ nhãn *"Đơn đọc từ file đối tác"* —
không giả vờ là số POS. Có key Poscake thì tự đổi sang POS, không phải sửa gì.

---

## Hai lỗi trong file đơn tổng cần sửa

Đây là lỗi **dữ liệu của mình**, không phải của NAZA — sửa file nguồn, không đi
đòi 3PL:

**1. Sáu mã vận đơn đang gán cho hai đơn khác nhau:**

| Mã vận đơn | Hai đơn cùng mang |
|---|---|
| 6722405677 | T1127 (799đ, đã giao) · T1131 (1.799đ, đã hoàn) |
| 17961048 | T1200 · T1200 (dòng lặp) |
| 18007240 | T1453 · T1464 |
| 1870459566 | T1455 · T1458 |
| 18008693 | T1465 · T1467 |
| 1870478046 | T1476 · T1477 |

Cặp đầu từng làm phân tích ra "lệch 1.000 TWD" — **báo động giả**: NAZA trả 799
cho T1127, còn file mình gán mã đó cho T1131 giá 1.799.

**2. 39 dòng không có mã vận đơn** — chỉ khớp được bằng mã đơn, kém chắc hơn hẳn.

---

## Kết quả hiện tại

Đo trên 7 kỳ, 361 đơn đã giao:

| | |
|---|---|
| Khớp sạch | **316 đơn** |
| Khớp qua mã đơn (giao lại) | 6 đơn |
| Lệch tiền | 1 đơn — 14 TWD |
| Chưa về tiền | 43 đơn |
| **Quá hạn — phải đi đòi** | **2 đơn — 1.598 TWD** |
| Thừa ở sao kê | 4 đơn |
| **Tiền treo ở NAZA** | **49.305 TWD ≈ 38,6 triệu VND** |
