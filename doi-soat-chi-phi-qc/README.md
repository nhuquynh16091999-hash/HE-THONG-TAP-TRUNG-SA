# ĐỐI SOÁT CHI PHÍ QUẢNG CÁO — bản dòng lệnh

Mỗi tuần có hai con số nói về cùng một khoản tiền: **Facebook nói đã thu bao
nhiêu**, và **ngân hàng nói đã trừ bao nhiêu**. Không ai đối chiếu thì phần
lệch cứ nằm im — tiền bị trừ hai lần, thẻ lạ tiêu tiền công ty, hoá đơn báo
lỗi mà tiền vẫn ra, phí ngoại tệ đội lên vài phần trăm mỗi giao dịch.

> **Chỗ dùng chính là dashboard**, không phải thư mục này:
> http://localhost:3000/talpha → mục **💳 Đối soát chi phí QC** (sidebar,
> ngang hàng với Báo cáo). Kéo thả 2 file vào là xong.
>
> Thư mục này là bản chạy ở terminal — dùng khi muốn chạy nhanh, chạy tự động
> theo lịch, hoặc lúc dashboard chưa bật.

**Nghiệp vụ nằm ở một chỗ duy nhất** cho cả hai lối vào:
`../dashboard-ui/src/lib/talpha/ads-recon/`
Sửa ở đó là cả dashboard lẫn dòng lệnh cùng đổi — không bao giờ có chuyện hai
nơi ra hai kết quả khác nhau.

---

## Dùng

```bash
cd "/Users/macbook/Desktop/Dashboard Sỹ Anh/Doi-Soat-Chi-Phi-QC" && ./doisoat
```

Thả file vào `data/inbox/` rồi chạy lệnh trên — nó lấy **hết** file trong đó.
Thứ tự file nào trước cũng được, máy tự nhận đâu là TKQC đâu là sao kê.

Định dạng nhận được: **.xlsx · .csv · .tsv · .txt · .pdf**

**Mỗi phía nhận NHIỀU file.** Công ty mấy thẻ thì mấy sao kê, TKQC xuất theo
từng tài khoản thì mấy bản chi phí — chọn hết vào một lượt, máy gộp lại. Không
phải gộp tay bằng Excel trước khi tải lên.

Tải nhầm cùng một khoản ở hai file (hai bản xuất chồng ngày, hoặc cùng một sao
kê ở cả .xlsx lẫn .pdf) thì **bản trùng bị bỏ, tiền không đếm hai lần** — và
hệ thống nói ra đã bỏ những gì. Không bỏ thì bản thứ hai không ghép được với ai
và nổi lên thành "TKQC thu mà thẻ không trừ" — báo động giả đắt tiền nhất.

```bash
./doisoat file1.xlsx file2.xlsx …    # chỉ đích danh, nhiều file cũng được
./doisoat --gui-tin                  # chạy xong bắn cảnh báo sang chat
./doisoat --csv ket-qua.csv          # xuất thêm CSV
./doisoat --khong-luu                # chạy thử, không ghi vào data/ky/
npm test                             # 45 phép thử
```

Lệnh trả mã thoát **2** khi có cảnh báo nghiêm trọng — bắc cron thì dựa vào đó.

---

## Luật và ngưỡng

Nằm chung trong `../config/talpha_rules.json` → khối
**`ads_settlement`** (cùng chỗ với `cod_settlement`, vì cùng họ việc: một bên
soát tiền VỀ, một bên soát tiền RA). Sửa JSON, **không sửa code**.

Ba chỗ cần điền trước khi dùng thật — không điền thì hệ thống vẫn chạy nhưng
tự tắt bớt kiểm tra và nói rõ đang tắt cái gì:

| Khoá | Để làm gì |
|---|---|
| `cards.list` | 4 số cuối từng thẻ công ty → bắt được giao dịch từ **thẻ lạ** |
| `budget.weekly_cap` | Trần chi tuần → bắt **vượt ngân sách**. `null` = chỉ so với tuần trước |
| `notify.telegram` / `notify.webhook` | Kênh nhận cảnh báo. Token đặt ở biến môi trường `DOISOAT_TELEGRAM_TOKEN`, đừng ghi vào JSON |

Đổi định dạng file đầu vào? Thêm bí danh cột vào `ads_settlement.columns`,
không cần sửa code.

---

## Hệ thống bắt được gì

| Mã | Mức | Nghĩa là gì |
|---|---|---|
| `THE_TRU_MA_KHONG_CO_HOA_DON` | 🔴 | Tiền ra khỏi thẻ mà TKQC không có hoá đơn nào. Nguy hiểm nhất. |
| `TRU_TRUNG` | 🔴 | Hai lần trừ cùng số tiền trong vài ngày mà chỉ có một hoá đơn. |
| `FB_LOI_MA_VAN_TRU` | 🔴 | TKQC ghi **Failed** nhưng thẻ vẫn bị trừ. Đòi lại được. |
| `THE_LA` · `TKQC_LA` | 🔴 | Thẻ hoặc tài khoản quảng cáo ngoài danh sách công ty. |
| `VUOT_NGAN_SACH` | 🔴 | Chi vượt trần tuần. |
| `FB_THU_MA_THE_KHONG_TRU` | 🔴/🟡 | TKQC báo thu mà sao kê không có dòng trừ. Sát cuối kỳ thì chỉ 🟡. |
| `PHI_AN` | 🟡/⚪ | Ngân hàng trừ nhiều hơn hoá đơn — phí ngoại tệ, phí quốc tế. |
| `TRU_THIEU` | 🟡 | Ngân hàng trừ **ít hơn** hoá đơn. |
| `LECH_THE` | 🟡 | Hoá đơn ghi thẻ này, sao kê trừ thẻ khác. |
| `TANG_BAT_THUONG` · `NGAY_DOT_BIEN` | 🔴/🟡 | Chi vọt so với kỳ trước, hoặc một ngày gấp nhiều lần trung bình. |
| `GHEP_NGHI_NGO` | 🟡 | Nhiều dòng cùng số tiền cùng khung ngày — máy phải đoán. |
| `FB_TREO` | 🟡 | Giao dịch đang chờ xử lý — chưa trừ nhưng sẽ trừ. |
| `TRUNG_GIUA_FILE` | ⚪ | Cùng một khoản có mặt ở hai file đã tải lên — đã bỏ bản trùng. |
| `PHI_THE_RIENG` · `ADS_KENH_KHAC` · `DONG_BO_QUA` · `THIEU_COT` | ⚪ | Ghi nhận để biết. |

Mỗi cảnh báo bắt buộc kèm **số tiền + số dòng trong file + phải làm gì tiếp**.

---

## Ghép cặp hoạt động thế nào

Sao kê ngân hàng **không mang mã giao dịch của Facebook**, nên khoá ghép là
**SỐ TIỀN + NGÀY**:

1. Sinh mọi cặp khả dĩ: lệch ngày ≤ 3 (FB cắt tiền trễ), lệch tiền ≤ 1.000₫
   hoặc 0,1% — hoặc ngân hàng trừ dư nhưng phần dư còn trong khung phí ≤ 5%.
2. Chấm điểm: ngày càng sát càng tốt, tiền khớp càng tốt, trùng 4 số cuối thẻ
   thì cộng điểm, lệch thẻ thì trừ nặng.
3. Xếp theo điểm rồi lấy dần — **mỗi dòng chỉ được dùng một lần**. Đây chính là
   chỗ phát hiện trừ trùng: dòng thứ hai không tìm được hoá đơn nào để ghép.
4. Cặp nào có đối thủ ngang điểm thì gắn nhãn **nghi ngờ**, không im lặng chọn hộ.

**Đừng nới cửa sổ ngày quá rộng** — nới càng rộng càng dễ ghép bừa và giấu mất
lệch thật.

---

## Đọc PDF

Sao kê PDF không có khái niệm "ô" hay "cột" — chỉ là một đống mẩu chữ kèm toạ
độ. `pdf.mjs` dựng lại bảng theo ba bước: gom theo toạ độ **y** thành dòng →
dính mẩu gần nhau thành ô → gom ô của **cả trang** theo toạ độ **x** chồng lấn
thành cột.

Bước ba phải nhìn cả trang chứ không nhìn từng dòng: dòng nào thiếu ô (cột
"ghi có" để trống chẳng hạn) mà đếm theo thứ tự trong dòng là mọi ô sau đó lệch
một cột — tiền rơi vào nhầm chỗ mà bảng vẫn trông đẹp. Và chỉ dòng **có dáng
bảng** mới được quyền định nghĩa cột, vì mấy dòng văn xuôi đầu sao kê ("Chủ thẻ:
… Số thẻ: …") trải ngang qua nhiều cột sẽ kéo dính chúng lại.

Ngưỡng phân biệt "khoảng trắng trong ô" với "khoảng cách giữa hai cột" **không
đặt cứng**: đo hết khoảng cách trên trang rồi cắt ở chỗ đứt gãy lớn nhất (trên
sao kê thật: 6 so với 24). Đặt cứng là sớm muộn cắt nhầm giữa một ô.

Bộ đọc dùng `pdfjs-dist`, **nạp trễ** — tuần nào cũng .xlsx thì không phải trả
giá cho thư viện 10MB đó.

**Phép thử quan trọng nhất:** `data/mau/` có cùng một sao kê ở hai định dạng
.xlsx và .pdf, và có test ép hai bản phải ra **đúng cùng một kết quả**. Sai một
cột là tiền rơi sang cột khác mà vẫn ra số đẹp — nên phải so bằng con số cuối
cùng chứ không chỉ xem có đọc được hay không.

---

## File mẫu — chạy thử trước khi có file thật

```bash
./doisoat --khong-luu data/mau/MAU_chi-phi-tkqc-fb_2026-09-01_07.xlsx data/mau/MAU_sao-ke-the_2026-09-01_08.xlsx
```

Đáp án đúng: **3 nghiêm trọng** (21tr trừ không hoá đơn · trừ trùng 9,9tr ·
TKQC lạ 4,5tr) và **4 cần xem** (5,6tr chưa thấy trừ · lệch thẻ · phí ẩn 450k ·
1 cặp ghép nghi ngờ). Tổng cần đòi/làm rõ: **35.400.000₫**.

Sinh lại file mẫu: `python3 data/mau/tao_file_mau.py`

---

## Cấu trúc

```
src/engine.mjs        cầu nối tới engine dùng chung trong repo dashboard
src/run.mjs           đọc đĩa · lưu kỳ · nhớ kỳ trước (phần engine cố tình không làm)
bin/doisoat.mjs       dòng lệnh
tests/                45 phép thử — chạy trên chính engine dùng chung
data/inbox/           thả file tuần này vào đây
data/ky/<tuần>/       kết quả + bản sao 2 file gốc
data/mau/             file mẫu đã gài sẵn đủ loại lệch
```

Kỳ chạy ở dòng lệnh lưu tại `data/ky/`; kỳ chạy trên dashboard lưu ở kho riêng
của dashboard (`ANTALO/data/ads_recon.json`). **Hai kho tách nhau** —
so sánh "tăng so với kỳ trước" chỉ nhìn kỳ cùng kho. Muốn một dòng lịch sử duy
nhất thì dùng hẳn một lối, đừng chạy xen kẽ.

---

## Những gì hệ thống KHÔNG làm

- **Không đọc PDF SCAN.** PDF phải có lớp chữ bên trong (bản ngân hàng xuất ra
  thì luôn có). Ảnh chụp màn hình hay bản scan giấy thì không — hệ thống báo lỗi
  rõ chứ không trả bảng rỗng. Muốn đọc được loại đó phải thêm OCR, chưa làm.
- **Không tự lấy file.** Chưa nối API ngân hàng hay Meta.
- **Không quy được từng cặp về TKQC khi trùng số tiền** — tổng vẫn đúng, từng
  cặp là phỏng đoán (đã gắn nhãn nghi ngờ).
- **Không xử lý ngoại tệ.** Đang cấu hình VND ↔ VND.
- **Không tự chạy định kỳ.** Muốn tự động thì bắc cron gọi `./doisoat --gui-tin`.
