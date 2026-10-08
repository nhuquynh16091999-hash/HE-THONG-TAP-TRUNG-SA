# Đối soát COD với NAZA供应链

> Mọi con số trong tài liệu này đo từ **7 kỳ sao kê thật** (24/07 → 04/09/2026),
> **321 dòng COD**, **463 dòng phí**, đối chiếu với **631 đơn** trong file đơn tổng.

---

## Số trên màn cập nhật lúc nào

Màn Đối soát COD **không đọc POS hay BigQuery**. Mọi con số của nó — "Tiền về",
"Việc hôm nay", bảng từng kỳ — dựng từ đúng hai kho file trên máy chủ:

| Kho | Nội dung | Ai làm nó đổi |
|---|---|---|
| `data/tracking.json` | Bảng đơn của đối tác: đơn, khách, COD, trạng thái giao | **Việc nền 6h sáng** (`talpha-tracking.timer`), hoặc bấm “Đọc bảng đối tác” ở tab Theo dõi vận đơn |
| `data/cod_statements.json` | Sao kê NAZA từng kỳ | **Kéo file .xlsx** vào ô trên cùng của tab — NAZA gửi qua chat, máy không có chỗ nào tự lấy |

Hai timer còn lại (`talpha-sync`, `talpha-report`) **không đụng** hai kho này.

Hệ quả phải nhớ:

* Không nạp bảng đơn thì phần "còn phải gửi" đứng im — đơn giao xong hôm nay không tự
  chui vào. Ngày 16/09/2026 Sỹ Anh mở màn này và hỏi vì sao nó đứng yên: số khi đó nạp
  từ 09/09, đã bảy ngày, vì lúc ấy chưa có việc nền.
* Đầu màn giờ có dòng **"Bảng đơn đối tác: nạp lúc …"**, quá 24 giờ thì đỏ.
* Tới kỳ mà chưa tải sao kê thì mục "Việc hôm nay" tự mọc việc **"Chưa có sao kê kỳ mới"**
  (chu kỳ 7 ngày, khai ở `talpha_rules.json → cod_settlement.statement_cycle_days`).

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

⚠️ **Tên cột phí đổi nghĩa giữa các file.** File cũ: `速递运费` = phí ship,
`快递运费` = phí thao tác (NAZA đặt nhầm tên). Từ kỳ 11/09: `快递运费` = phí ship,
`操作费` = phí thao tác. Bộ đọc (`cotPhi` trong `naza-statement.ts`) ưu tiên
`操作费` nếu có — đọc theo tên cũ thì kỳ 11/09 ra 0 dòng phí.

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

## Khoá đối chiếu — ba tầng, không được đảo

### Tầng 0: MÃ GỐC của đơn giao lại (转寄)

Hàng hoàn gửi cho khách KHÁC thì NAZA cấp mã vận đơn mới và ghi mã đơn = **mã vận
đơn của đơn gốc + `-Z`**; Sheet ghi mã gốc đó trong ngoặc: `T1467 (7564042426-z)`.
Mã gốc là thứ duy nhất hai bên cùng ghi, còn mã vận đơn Sheet ghi cho loại đơn này
thì không tin được — cả ba đơn kỳ 9.11 đều sai:

| Mã đơn | Sheet ghi | NAZA trả trên |
|---|---|---|
| T1467 (7564042426-z) | 18008693 — mã của **T1465** | 18010780 |
| T1468 (17898044-z) | 18009095 | 18010779 |
| T1471 (17904603-z) | 06722435455 | 06722436439 |

Trước 17/09/2026 không có tầng này: T1467 ăn nhầm 749 TWD của T1465 thành "trả
thiếu 650", còn T1468 · T1471 nằm ở "chưa về tiền" dù NAZA đã trả đủ.

### Tầng 1: MÃ VẬN ĐƠN (转单号)

Đo trên **784 dòng sao kê thật: duy nhất tuyệt đối**, không một mã nào lặp.
Đây là khoá chính.

Phía Sheet thì KHÔNG duy nhất (xem "lỗi trong file đơn tổng" bên dưới). Mã nào nhiều
đơn trong sổ cùng mang thì khoản tiền về đơn có **mã đơn trùng mã đơn NAZA ghi**;
dòng phí cũng phải đúng mã đơn mới nhận.

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

### Phí mua hàng (采购费) — soát với file tiền hàng

Tiền hàng Trung Quốc mỗi đợt ghi ở file Google Sheet gốc **"NOTE ĐÀI LOAN - SIG - THANH
TOÁN"**, tab **"PHÍ MUA HÀNG COD ĐÀI"** (id + gid ở `cod_settlement.purchase_sheet` trong
`config/talpha_rules.json`, đọc bằng service account, chỉ đọc). Đọc thẳng file gốc theo gid,
KHÔNG qua bản sao: bản sao chỉ là một ô `IMPORTRANGE` theo tên tab, tab gốc đổi tên là cả
bản sao thành `#REF!` (dính thật 14/09/2026). Mỗi đợt một khối:
`THANH TOÁN NGÀY d/m` · `TỔNG: x VNĐ` · có thể kèm `a + b` (b là nợ kỳ trước) ·
`ĐÃ THANH TOÁN` · `CÒN THIẾU`.

Đợt được ghép vào kỳ sao kê **gần ngày nhất trong ±4 ngày**, mỗi đợt một kỳ
(đợt 27/07 ← sao kê 24/07). Ngày kỳ lấy từ tên file sao kê.

Có hai cách trả, và dashboard phân biệt bằng việc sheet TỔNG của NAZA có dòng
phí mua hàng hay không:

| Cách trả | Kỳ | Tính "phải nhận" |
|---|---|---|
| **NAZA trừ vào COD** | từ 21/08 | VND − tiền hàng **theo file** ± điều chỉnh kỳ trước |
| **Tự chuyển khoản riêng** | 24/07, 31/07, 07/08, 14/08 | không trừ; hiện đã trả / còn nợ của đợt |

NAZA trừ khác file thì **tin file**: phải nhận tính lại theo số của file, mục
soát B báo NAZA trừ dư / thiếu bao nhiêu. Đo thật: 4 kỳ NAZA trừ đều khớp file
tới từng đồng; đợt 14/08 còn nợ 1.405.597 VND.

Đọc file hỏng hay không ghép được đợt nào thì màn hình **nói rõ**, vẫn chạy phần
còn lại — không lặng lẽ coi tiền hàng là 0.

### Kỳ 24/09/2026 — NAZA gộp Singapore vào sao kê Đài

Kỳ này NAZA gửi hai bản: bản đầu **gộp Singapore** ("ĐỐI SOÁT COD 2026.09.24") và bản
sửa bỏ Sing ("ĐỐI SOÁT COD TAIWAN 2026.09.24"). **Sỹ Anh chốt 30/09/2026 dùng bản gộp**
— đúng số NAZA chuyển về. Tiền COD vẫn chỉ của Đài (54.857 NT$), nhưng trừ thêm:

| Phần Sing | Số |
|---|---|
| Phí 12 đơn Sing (28¥ nội địa + 7¥ chặng đầu + 3¥ đóng gói) | 456¥ ≈ 1.760.160đ |
| Tiền hàng Sing (`新加坡本期采购费`) | 1.840.046đ |
| **Phải nhận** | **28.630.337đ** (bản TAIWAN: 32.230.543đ, chênh đúng 3.600.206đ) |

Bộ đọc tách phần này ra (`sg_gop`, `purchase_sg_vnd`): tiền hàng Đài vẫn đem so file tiền
hàng Đài như mọi kỳ, tiền hàng Sing trừ trong luồng theo số NAZA (tab Đài không có khoản
này), đơn Sing không soát theo bảng giá Đài.

**Từ kỳ sau NAZA tách file Sing riêng.** Màn Đối soát COD **chặn** file Sing (nhận bằng
nội dung — không dòng COD Đài nào — hoặc tên file có SING / SIG / SG): kho này là sổ TWD,
và file Sing cùng ngày sẽ theo luật "cùng ngày là cùng kỳ" **đè mất** kỳ Đài. Từ
08/10/2026 câu báo chỉ sang nút **Singapore** — xem mục dưới.

---

## Singapore, UAE — tải sao kê (08/10/2026)

Sỹ Anh: "Singapore và UAE không có chỗ để up file giống Đài Loan à". Nay có: nút **Tải sao kê
Singapore / UAE** + kéo thả file vào màn, như Đài. Route `cod-recon/market?market=SG|AE`
(POST tải · DELETE xoá kỳ), đọc + khớp ở `lib/talpha/cod-statement-market.ts` (có test).

* **Kho riêng từng nước** — `data/cod_statements_sg.json`, `data/cod_statements_ae.json`.
  Không đụng kho Đài (sổ TWD, luật "cùng ngày là cùng kỳ").
* **Chưa có file mẫu nước nào**, nên nhận hai kiểu:
  * sao kê **NAZA** (.xlsx ba sheet) — chỉ lấy dòng của nước đang mở (`国家名称 = 新加坡`,
    kênh `S新加坡CODJT专线`); file Sing riêng có sheet TỔNG thì lấy luôn số phải nhận VND.
    File Đài tải nhầm sang Sing/UAE, file Sing tải nhầm sang UAE → báo bấm đúng nút;
  * **bảng bất kỳ** (.xlsx / .csv) có cột mã vận đơn (hoặc mã đơn) + cột tiền COD — dò tên cột
    kiểu Tracking / AWB / Mã vận đơn / 转单号 và COD / COD Amount / Số tiền / COD金额 (cột
    "COD Fee" không bị nhận là tiền). Đối tác đặt tên lạ → khai thêm ở
    `cod_settlement.column_map`. Màn hình in ra máy đã đọc cột nào để người tải soát.
  * Tiền có số lẻ kiểu "45,90" đọc là 45,9 (SGD/AED có xu) — "1,399" vẫn là nghìn.
* **Tải lại cùng kỳ thì THAY**: cùng tên file, hoặc trùng từ một nửa số đơn trở lên (bản sửa
  hay đổi tên). Không dùng luật "cùng ngày trên tên file" — chưa biết đối tác gửi mấy file/ngày.
* **Khớp với MỌI đơn của nước đó** (cả đơn bảng mình còn ghi "đang giao" — tiền thường về
  trước trạng thái): mã vận đơn trước, mã đơn sau, như Đài. Đơn có trên sao kê ra khỏi
  "còn phải gửi"; trả lệch / trả cho đơn mình không có / một đơn trả ở hai kỳ → khung
  **Khoản cần hỏi bên giao hàng**.
* **"Bên giao hàng đã gửi về"** = số phải nhận trên sao kê (NAZA); kỳ không ghi số đó thì
  ước = tiền COD × `markets.*.rate_vnd`, **chưa trừ phí** (ô có dấu ≈).

**Mẫu NAZA Singapore thật** (Sỹ Anh tải 08/10/2026 — lần đầu báo "không tìm ra cột"):

* `新加坡COD对账单 2026.10.05` — sheet COD mỗi đơn có COD金额 (SGD) · 汇率 5,2151 (SGD→¥) ·
  COD金额（RMB）· COD手续费（RMB）phí thu hộ 3% · 回款金额（RMB）tiền về. Sheet TỔNG: 本期回款金额
  là **TỆ sau phí thu hộ** (3.192,01¥), KHÔNG phải SGD như Đài; trừ phí ship 1.317,6¥ + 退仓上架
  (hàng hoàn lên kệ) 9¥ → × 3.860 → − tiền hàng Sing 1.751.680đ = **phải nhận 5.448.788đ**.
  Bộ đọc so tổng cột 回款金额 với sheet TỔNG (so tiền SGD là báo lệch giả). 9 đơn, khớp 9/9.
* `ĐỐI SOÁT COD SINGAPORE 2026.09.24` — kỳ **chưa thu được COD nào**: không có sheet COD, chỉ
  TỔNG + PHÍ (12 đơn · 456¥) + tiền hàng 1.840.046đ → **phải nhận âm 3.600.206đ**. Đây chính là
  phần Sing NAZA đã trừ thẳng vào tiền COD Đài kỳ 24/09 (bản gộp, Sỹ Anh chốt 30/09). Màn Sing
  vẫn nhận và hiện kỳ này, nhưng **không cộng kỳ âm vào "đã gửi về"** (như Đài: kỳ âm NAZA trừ ở
  chỗ khác) và ghi rõ "đã trừ vào tiền COD Đài kỳ 24/09 (bản gộp)" khi kho Đài có kỳ gộp cùng ngày.
  Tỷ giá 0,2021 ở sheet TỔNG file này là số Đài chép sang — không dùng.
* Hai file NAZA cùng ngày = cùng kỳ (tải bản sửa thì thay).

**Màn Sing/UAE cùng bố cục Đài** (Sỹ Anh 08/10/2026: "sao giao diện phần đối soát COD Sing không
giống Đài"). Sổ dựng ở `lib/talpha/cod-so-nuoc.ts` (có test, số lấy từ hai file thật), cùng luật Đài:

* Σ bốn ô (đã gửi về · còn phải gửi · chưa giao xong · ngân hàng) + "Cách tính". Còn phải gửi ước đi
  đúng luồng NAZA kỳ gần nhất: COD × tỷ giá S$→¥ × (1 − phí thu hộ thật) − phí giao trung bình cho
  đơn chưa bị trừ phí, × tỷ giá ¥→đ. Chưa có kỳ NAZA thì lùi về `markets.*.rate_vnd`.
* ① Việc hôm nay (khối `KhoiViec` dùng chung với Đài): trả lệch · đơn lạ · phí cao hơn bảng giá ·
  nhập tiền về · tiền về lệch · thiếu sao kê kỳ mới. "Đã hỏi NAZA" / "Bỏ qua" ghi **cả nhóm** một lần
  bấm (`done_keys`).
* ② Bảng các kỳ: phải nhận · **thực nhận** (nhập số ngân hàng, kho `data/cod_actions_<sg|ae>.json`,
  route `cod-recon/market/actions`, cùng luật ghi với Đài — `lib/talpha/cod-actions-store.ts`) ·
  lệch (ngưỡng 50.000đ) · tình trạng. Kỳ âm: "Âm · đã trừ ở Đài", không cần nhập.
* ③ Kỳ đang mở: luồng tiền S$ → ¥ → đ đọc thẳng các dòng trừ ở sheet TỔNG; máy soát A (phép tính,
  chi tiết = TỔNG, tỷ giá, phí trùng) · B (trả lệch, đơn lạ, **phí giao đúng bảng giá Sing** — 28¥
  2 kg đầu + 2,8¥/0,1 kg chặng đầu + 3¥ đóng gói, **phí thu hộ** ≤ 4% tối thiểu 8¥, tiền hàng).
  Thật: kỳ 24/09 NAZA tính chặng đầu 7¥ cho kiện 0,2 kg (bằng giá hàng đặc thù 3,5¥/0,1 kg) — dư
  1,4¥ × 12 đơn; kỳ 05/10 đúng bảng 36/36 đơn, thu hộ 3,0%.
* ④ Tỷ giá (`KhoiTyGia` dùng chung) — hiện khi có từ 2 kỳ có tỷ giá.

Kho tải trước bản này chưa lưu sheet TỔNG → màn nhắc tải lại file (thay bản cũ). Chưa làm: cột
tiền về ở Sổ đơn Singapore / UAE; so tiền hàng Sing với file tiền hàng (chưa có tab Sing). UAE chưa
có file mẫu.

---

## Tiền về — đã gửi bao nhiêu, còn phải gửi bao nhiêu

Khối **Σ Tiền về** trên tab:

* **NAZA đã gửi về** = cộng số *phải trả* NAZA ghi trên từng sao kê (kỳ âm đã
  được NAZA trừ vào kỳ sau nên cộng là đủ). Chưa đối chiếu ngân hàng thì đây vẫn
  là số NAZA cam kết. Nếu NAZA trừ tiền hàng lệch file, dòng này ghi thêm số lẽ
  ra phải nhận.
* **Còn phải gửi — đơn đã giao thành công**: đơn trạng thái Delivered chưa có
  trên sao kê nào.
* **Còn phải gửi — tất cả đơn còn lại**: mọi đơn chưa được trả, **trừ** đơn hoàn
  và đơn huỷ (không bao giờ về tiền).

Hai số dự tính đi đúng luồng NAZA với tỷ giá của kỳ mới nhất:
`(COD × tỷ giá TWD→RMB − phí) × tỷ giá RMB→VND`. Đơn đã bị NAZA trừ phí ship ở
một kỳ trước thì không trừ lại; đơn chưa bị trừ thì trừ phí ship kg đầu theo kênh
giao + 3 RMB thao tác. **Chưa trừ tiền hàng các kỳ tới** — chưa biết trước được.

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

**1. Mã vận đơn gán cho hai đơn khác nhau** (đo trên Sheet ngày 17/09/2026):

| Mã vận đơn | Hai đơn cùng mang | Sao kê NAZA nói |
|---|---|---|
| 06722405677 | T1127 (799đ, đã giao) · T1131 (1.799đ, đã hoàn) | mã của T1127 · T1131 là 06722402201 |
| 1870459566 | T1455 · T1458 | mã của T1458 · T1455 là 18006393 |
| 18008693 | T1465 · T1467 (7564042426-z) | mã của T1465 · T1467 là 18010780 |
| 18024614 | T1564 · T1646 | chưa có trên sao kê |

(`17961048` có hai dòng T1200 giống hệt nhau — Sheet chép đôi, vẫn tính MỘT đơn.)

Trước 17/09/2026 bộ nạp để dòng sau **đè** dòng trước, nên T1127 · T1455 · T1465 ·
T1564 biến hẳn khỏi sổ đơn, còn đơn đè lên thì ghép nhầm tiền: T1131 ra "lệch
1.000 TWD", T1467 ra "thiếu 650" — cả hai là **báo động giả**. Nay bộ nạp giữ đủ
hai đơn (dòng sau khoá theo mã đơn), màn Sổ đơn hàng liệt kê cặp trùng kèm mã đúng
theo NAZA, và thanh "Bảng đơn đối tác" ở cả hai màn nhắc số cặp còn phải sửa.

Cùng lần sửa đó: kho `tracking` chỉ ghi thêm chứ không xoá, nên đơn nào đổi khoá
(nạp lúc chưa có mã vận đơn rồi mới có, được sửa mã, mất số 0 đầu) thành **hai đơn**.
Kho máy chủ ngày 17/09/2026 có 52 bản cũ như thế — 764 đơn trong khi Sheet có 716,
thổi ô "Đơn còn lại — chưa giao xong" lên thêm 52 đơn · 57.498 TWD. Bộ nạp nay gỡ bản cũ khi mã đơn
của nó xuất hiện ở khoá khác; đơn biến mất khỏi Sheet thì vẫn giữ.

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
