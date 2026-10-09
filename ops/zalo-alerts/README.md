# TALPHA — Bot báo cáo ads + vận đơn vào nhóm Zalo

**Mỗi nước một nhóm** (Sỹ Anh chốt 08/10/2026): **ADS + VẬN ĐƠN TAIWAN · SGP · UAE · JAPAN**.
Tin ads của nước đó và tin vận đơn của nước đó chung một nhóm; nhóm nào chỉ thấy số nước mình.
**Bỏ hẳn nhóm cũ** — BÁO CÁO ADS (tin gộp mọi nước) và VẬN ĐƠN TW / SGP / UAE: bot không đọc
`zalo_group.json`, `zalo_group_vandon*.json` nữa, không gửi, không nghe lệnh ở đó.
**Tin MỖI GIỜ cho Nhật** (Sỹ Anh yêu cầu 09/10/2026): HH:05 từ 07:05 tới 23:05, trừ 13h · 18h · 22h
(giờ đã có bản tin ads). Quảng cáo ở Nhật KHÔNG có chỉ số tin nhắn trên Meta (luật bảo vệ thông tin
liên lạc của Nhật), nên tin ghép: tiền ads Meta trực tiếp + **tin nhắn / bình luận mới / SĐT đếm từ
Pancake** + đơn, doanh số POS — theo từng page (camp nối page bằng tên page trong tên camp), có
"(+N)" thêm trong giờ qua. Nguồn `/api/talpha/pancake-nuoc` (token tài khoản Pancake ở
`TALPHA_PANCAKE_API_TOKEN`, hết hạn 02/01/2027 — tin tự nhắc trước 14 ngày). Bản tin ads thường của
nhóm Nhật cũng lấy số mess từ Pancake (`nhomNuoc.messPancake`). Gõ `/gio` trong nhóm, hoặc
`node bot.js --dry-run --gio --nuoc JP` để in thử. Cấu hình: `config.json → moiGio`.
Nhật (mở 08/10/2026, shop POS nối 09/10/2026): tin ads đủ đơn / DS như các nước khác, chưa có vận đơn
(chưa biết hãng giao). Nước nào còn `sap_chay` (chưa shop) thì tin chỉ có tiền ads + tin nhắn.
(Lịch sử: 15/09/2026 chỉ gửi mốc 8h30 vào một nhóm ads; thêm dần 13:00 · 18:00 · 22:00.)

| Khi nào | Tin |
|---|---|
| **08:30** mỗi ngày | Mỗi nhóm **một tin ads** của nước đó (số **hôm qua**), rồi tin **vận đơn** sáng |
| **13:00**, **18:00** và **22:00** mỗi ngày | Tin ads số **ĐANG CHẠY HÔM NAY** của nước đó; 22:00 thêm tin vận đơn tối |
| Có người gõ lệnh trong nhóm | Xem bảng lệnh dưới |

Không tự gửi từ 23h đến 7h (lệnh gõ tay thì trả lời bất cứ lúc nào). Không có tồn kho,
thẻ/TKQC như bot WhatsApp cũ (`ops/whatsapp-alerts/`, đang tắt).

## Bản tin sáng 08:30 · tối 22:00 (Sỹ Anh duyệt mẫu 26/09/2026)

Nguyên tắc: **đọc xong tin là làm được ngay**, không mở dashboard. Mẫu duyệt ở trang
"Bản tin Zalo 08:30 · 22:00" (bản 3).

| Tin | 08:30 | 22:00 |
|---|---|---|
| **Ads** (mọi nhóm) | Kết quả hôm qua CỦA NƯỚC ĐÓ: tiền ads · DS · %ads · đơn · mess · chốt, **xếp hạng người trong nước**, **chi tiết mọi camp của nước đó** (tên đầy đủ như trên Meta, theo marketer, tiêu nhiều trước). Nhật: tiền ads · mess · giá/mess, chưa có đơn | Cùng khuôn, số hôm nay, **▲▼ so với cả ngày hôm qua của nước đó** |
| **Vận đơn Đài** (nhóm TAIWAN) | Hôm qua (khách đã lấy, mới tới, bắt đầu hoàn) + **@Thương gọi khách sắp bị trả về** và **nhắn khách mới tới** + **🔁 nhắc lại khách đã nhắn mà chưa lấy** (mỗi sáng tới khi lấy; sổ nhắc ở state.json → vanDonNhac): mỗi khách đủ tên, SĐT, cửa hàng, mã lấy hàng (= mã tracking), hạn, **💬 tin tiếng Trung soạn sẵn** (lần đầu nhẹ nhàng, nhắc lại gấp hơn) · hỏi đối tác · kiểm đơn lệch | Khách phải gọi sáng nay: đã lấy (cứu bao nhiêu tiền) / chưa lấy (MAI HẾT HẠN) / bị trả về · khách mới tới đã lấy chưa · số cả ngày |
| **Vận đơn Singapore** (nhóm SGP) | Cùng khuôn; gọi = **đơn giao hỏng / khách hẹn giao lại**, kèm khu vực, ghi chú đối tác, **💬 tin tiếng Anh soạn sẵn** | Đơn hẹn lại đã giao chưa · số cả ngày |
| **Vận đơn UAE** (nhóm UAE, 28/09/2026) | Cùng khuôn Singapore; trạng thái tra ở **trang WeShip** (không qua 17TRACK). Gọi = khách **từ chối / không nghe máy / hẹn giao lại** kèm số lần, khu vực, ghi chú đơn POS, **💬 tin tiếng Anh theo lý do** | Như Singapore |

* Bỏ phần "việc hôm nay" của ads, bỏ lệnh /tin và /xong (Sỹ Anh chốt).
* **Ads 13:00 (TRƯA) · 18:00 (CHIỀU)** — Sỹ Anh thêm 29/09/2026. Cùng khuôn tin 22:00, số
  lấy từ vòng ghi Sheet mới nhất (chạy phút :20 mỗi giờ, dòng nguồn in giờ sync). ▲▼ so với
  **cùng mốc hôm qua** (bot nhớ số đã báo mỗi mốc ở `state.json → soMoc`), KHÔNG so với cả
  ngày hôm qua — 13:00 mà so cả ngày thì chữ nào cũng ▼ nửa. Ngày đầu chưa có số hôm qua thì
  tin không có ▲▼. Mốc sau đã gửi thì đính chính còn chờ của mốc trước cùng ngày bị bỏ (tin
  mới nhất đã mang số mới hơn). In thử: `node bot.js --dry-run --moc 13:00`.
* @Thương là **nhắc tên thật** (mention Zalo) — `vanDon.phuTrach` trong `config.json`.
* Tin sáng lưu danh sách khách phải gọi/nhắn vào `state.json → vanDonSang` để tin tối chấm.
  17TRACK cập nhật lại 21:30 (`talpha-tracking.timer`) trước tin 22:00.
* Ngày đông khách: tin vận đơn tự tách thành 2–3 tin Zalo (khung 1800 ký tự).
* Mỗi nước một nhóm, một mốc riêng: nước này hỏng không kéo nước kia. Trong một nhóm, tin ads
  luôn đứng trước tin vận đơn cùng mốc.
* **Số ads theo nước** đọc `data/bao_cao_nuoc/<tháng>.json` — `format_all.py` ghi ngay sau khi
  ghi file TỔNG TEAM, cùng bộ ô, nên tổng người trong nước = đúng tab nước của Sheet, và có xếp
  hạng người TRONG nước (file TỔNG TEAM không có: tab người gộp mọi nước). Chưa có file (hoặc cũ
  hơn vòng ghi Sheet OK gần nhất quá 45') → đọc tab nước của TỔNG TEAM, tin ghi rõ thiếu xếp hạng.
* ▲▼ trưa/chiều nhớ theo nước: `state.json → soMoc["TW|13:00"]`. Mốc ghi `state.json → moc["ads:TW:sang"]`.

Chọn nhóm (nick phụ phải nằm sẵn trong nhóm). **Bot tự nhận** lúc khởi động và mỗi vòng 5' khi
còn nước thiếu nhóm — chỉ nhận nhóm đúng mẫu tên `ADS + VẬN ĐƠN <nước>` (TAIWAN · SGP · UAE ·
JAPAN); một nước khớp hai nhóm thì không đoán:

```bash
node pair.js --groups                                  # xem id nhóm
node pair.js --tu-nhan                                 # nhận nhóm từng nước theo tên → zalo_group_nuoc_<mã>.json
node pair.js --chon-nuoc <id> --nuoc JP                # chọn tay một nước
pm2 restart talpha-zalo-alerts
node bot.js --dry-run --report --nuoc TW               # IN thử tin ads sáng của Đài, không gửi
node bot.js --dry-run --vandon sang --nuoc SG          # IN thử vận đơn, không gửi
node bot.js --vandon toi                               # gửi ngay tin vận đơn tối mọi nước
```

## Lệnh trong nhóm

| Gõ | Bot trả |
|---|---|
| `/baocao` | Số **đang chạy hôm nay** của nước của nhóm, một tin |
| `/baocao homqua` · `/baocao 14/09` | Số hôm qua · số một ngày |
| `/baocao Lộc` · `/baocao homqua Lộc` | Số + camp của một người Ở NƯỚC CỦA NHÓM |
| `/baocao team` | Chỉ phần số đầu tin, không kèm camp |
| `/canhbao` | Camp của nước đó tiêu ≥ 300k mà 0 tin nhắn (Meta trực tiếp) |
| `/vandon` · `/vd` | Vận đơn mới nhất của nước của nhóm (khuôn tin sáng). Nhóm Nhật: báo chưa theo dõi |
| `/bot` | Cách dùng |

Mọi lệnh chỉ trả số của **nước của nhóm** — gõ `/vandon sg` trong nhóm UAE vẫn ra UAE.

Có dấu hay không dấu, hoa hay thường đều được; `/bc`, `/cb` là viết tắt. Chữ không bắt đầu
bằng `/` bot bỏ qua. Cùng một lệnh gõ lại trong 60 giây thì bot bỏ lần sau.
**Một tin, không phải năm** (Sỹ Anh chốt 16/09/2026). Bản đầu gửi tin TỔNG TEAM rồi thêm
một tin cho mỗi marketer — 5–6 tin liền nhau, trong nhóm đọc thành loạn. Nay mốc 08:30 và
`/baocao` gửi đúng một tin ~700–900 ký tự (khung Zalo 1800). Chi tiết từng campaign của
từng người KHÔNG mất, gõ `/baocao <tên>` là ra — gộp cả vào một tin thì dài gấp ba khung,
lại bị Zalo chia thành mấy tin, đúng cái đang tránh.

**Chỉ nghe 4 nhóm nước**: nick phụ còn ở các nhóm COD có người của đối tác và ở nhóm cũ —
gõ `/baocao` ở đó bot im, không lộ số ra ngoài.

## Số lấy ở đâu

Cùng máy chủ với dashboard, gọi `http://localhost:3000`:

* **Số đầu bài** mọi tin: `/api/talpha/sheet-report` — đọc thẳng file Google Sheet
  **TỔNG TEAM THÁNG n**, đúng file CEO xem. Tin và Sheet không lệch được.
* **Chi tiết từng campaign**: `/api/talpha/realtime` (Meta + POS live). Chủ campaign tính
  **đúng luật của Sheet** (`rules.js → chuCamp`), nên cộng lại khớp số đầu bài. Route lỗi thì
  tin vẫn đi, chỉ thiếu phần campaign.
* **`/canhbao`**: `/api/talpha/ads-alerts` (BigQuery).
* **Tuổi số**: `/api/talpha/sync-health` — sync đứng thì tin tự in `⚠️ SỐ CHƯA ĐỦ`.

## Gửi tạm rồi tự đính chính (22/09/2026)

Sỹ Anh chốt: **chưa có vòng sync nào lấy đủ số thì cứ gửi tạm theo đúng khung giờ**, và
**khi có vòng sync đủ số thì bot tự gửi thêm một tin đính chính**.

Vì sao cần: 21/09 máy chủ chết từ 19:25 tới 08:26 hôm sau, thêm 3 TKQC mất quyền `ads_read`
nên mỗi vòng đều `SKIP format_all` → Sheet đứng ở số 19:25. Tin 08:30 vẫn gửi (đúng khung
giờ, có dán nhãn `SỐ CHƯA ĐỦ`) nhưng người đọc lúc đó nhớ số sai và **không ai quay lại xem
số đúng**.

Cách chạy:

1. Gửi tin tạm xong, thấy cờ `chuaDu` → bot ghi lại **số đã báo** vào `state.json → dinhChinh`
   (ghi ra file nên pm2 restart / máy chủ reboot giữa lúc chờ không mất lịch — đúng ca hay
   gặp, vì sync đứng thường đi kèm máy chủ vừa có sự cố).
2. Vòng rà 5 phút hỏi `/api/talpha/sync-health`. "Đủ số" = có vòng **OK** (sync_rc 0 **và**
   format_rc 0, tức đã ghi được xuống Sheet):
   * tin về **ngày đã qua** (mốc 08:30): cần vòng OK chạy **sau khi hết ngày đó**;
   * tin **giữa ngày** (20:00 / 22:00): cần vòng OK chạy **sau lúc gửi tin tạm**.
3. Gửi tin `🔄 ĐÍNH CHÍNH` nêu đúng chỗ lệch (`Tiền ads · Đơn · Doanh số · Mess`, số cũ → số
   đúng) rồi đính kèm bản báo cáo đủ số. **Số không lệch chỗ nào** thì chỉ gửi mấy dòng đầu,
   không lặp lại cả bản báo cáo.
4. **Hạn chờ** `dailyReport.dinhChinhHanGio` (24 giờ). Tin giữa ngày chỉ chờ **tới hết ngày
   đó** — qua nửa đêm thì mốc 08:30 sáng sau đã là số cả ngày, đính chính "số hôm nay lúc
   22:00" vào sáng hôm sau là tin rác. Quá hạn mà số vẫn chưa đủ → bỏ chờ, có log.
5. Giờ im (23h–7h) thì đợi, không đánh thức nhóm giữa đêm.

**TKQC mất quyền nhưng không tiêu tiền (30/09/2026).** Sync bỏ qua TK mất quyền mà 7 ngày
không chi đồng nào (`sync/core/tk_loi.py`), vòng vẫn OK nên tin KHÔNG mang "SỐ CHƯA ĐỦ" — chỉ
thêm dòng `ℹ️ TKQC mất quyền đọc, đã bỏ qua…` nêu tên để người ta cấp lại quyền hoặc gỡ TK.
Tên lấy từ `/api/talpha/sync-health → fetch_errors.bo_qua` (nhãn `TKQC_BO_QUA` trong
`daily_guarded.sh`).

**Sheet chưa có số hôm nay.** Sheet tạo sẵn dòng cho mọi ngày, nên vòng ghi chưa chạy được
lần nào từ 00:00 thì dòng hôm nay toàn 0. Tin giữa ngày khi đó KHÔNG in "Ads 0đ · 0 đơn" mà ghi
`💰 Sheet chưa có số hôm nay` kèm tiền ads Meta trực tiếp; vẫn xếp lịch đính chính như thường.

`node bot.js --report <ngày>` cũng xếp lịch đính chính (gửi lại tay lúc sync đang đứng là
đúng ca cần); lệnh `/baocao` gõ trong nhóm thì **không** — đó là người ta hỏi số lúc này,
gõ 10 lần mà 10 tin đính chính là loạn nhóm.

## Cách gửi — nick Zalo PHỤ, không chính thức

Nick **"Hoàng Rin"**, ghép 15/09/2026. Dùng [zca-js](https://github.com/RFS-ADRENO/zca-js):
giả làm Zalo Web bằng một nick thật. Không cần trình duyệt (bot WhatsApp phải chạy Chromium).

**Rủi ro phải biết:**

* Trái điều khoản Zalo — nick **có thể bị khoá**. Chỉ dùng nick phụ.
* Zalo chỉ cho **một phiên web** mỗi nick. Mở Zalo Web hay Zalo PC bằng nick phụ ở máy
  khác là bot bị đá ra: không gửi được, không nghe lệnh. Điện thoại thì không sao.
* `.zalo_session.json` là **khoá đăng nhập** của nick đó: quyền 600, gitignore, không chép
  đi đâu. Mất file → ghép lại.

## Ghép nick / đổi nhóm (trên máy chủ)

```bash
cd /opt/talpha/ops/zalo-alerts && npm ci
node pair.js                      # in "QR_READY": mở qr.png, quét bằng app Zalo của NICK PHỤ
node pair.js --tu-nhan            # nhận nhóm "ADS + VẬN ĐƠN <nước>" theo tên
node bot.js --dry-run --report    # IN thử báo cáo hôm qua mọi nước, không gửi
pm2 start /opt/talpha/ops/pm2/ecosystem.vps.config.js --only talpha-zalo-alerts
pm2 save
```

Nick phụ phải **nằm sẵn trong nhóm**. QR hết hạn sau ~100 giây, `pair.js` tự làm mã mới 5 lần.
Lần đầu chạy dịch vụ ở một nhóm, bot gửi **một** tin hướng dẫn lệnh (không lặp khi restart).
Ghép lại khi bot đang chạy: xong thì `pm2 restart talpha-zalo-alerts`.

## Deploy

`bash ops/deploy/from-mac.sh` kéo code mới về máy chủ. Nếu bot **đang chạy** trong pm2,
`vps-setup.sh` tự `npm ci` và `pm2 restart talpha-zalo-alerts`. Chưa từng bật thì để yên.

## Chạy tay

```bash
node bot.js --lenh "/baocao homqua" --nuoc TW   # làm như có người gõ lệnh đó trong nhóm Đài (gửi thật)
node bot.js --report 2026-09-14 --nuoc SG       # gửi báo cáo ngày đó (bỏ ngày = hôm qua, bỏ --nuoc = mọi nước)
node bot.js --moc 18:00                         # gửi ngay tin mốc 18:00 mọi nước (không ghi đè số đã nhớ)
node bot.js --dry-run --lenh "/baocao Lộc" --nuoc AE   # --dry-run: chỉ in, không đăng nhập, không gửi
node pair.js --groups                 # nick phụ đang ở những nhóm nào
pm2 logs talpha-zalo-alerts --lines 40
```

Chạy thử từ máy Mac: `TALPHA_DASHBOARD_URL=http://139.180.131.21:3000 node bot.js --dry-run --lenh "/baocao"`.

## Bot im lặng thì soát

1. `pm2 logs talpha-zalo-alerts`:
   * `Bộ nhận lệnh bị đóng` / `Đăng nhập Zalo lỗi` / `Gửi lỗi` — phiên bị đá, thường do ai
     đó mở Zalo Web/PC bằng nick phụ. Bot tự đăng nhập lại sau 10', 20', 40'… (tối đa 2 giờ).
     Vẫn hỏng → `node pair.js` rồi `pm2 restart talpha-zalo-alerts`.
   * `Mốc 08:30 lỗi — vòng sau thử lại` + `Sheet chưa có dòng ngày` — vòng ghi Sheet chưa
     chạy; bot tự thử lại mỗi 5' tới 12:00, quá thì bỏ hôm đó (`Bỏ mốc 08:30`).
2. Gõ `/baocao` mà không thấy dòng `Lệnh "/baocao" từ …` trong log → bot không nghe được
   nhóm: soát lại phiên, hoặc lệnh gõ ở nhóm khác nhóm nhận tin.

## Tinh chỉnh (`config.json`)

| Khoá | Đang để | Nghĩa |
|---|---|---|
| `dailyReport.at` / `atCatchUpMinutes` | `08:30` / 210 | Giờ tin sáng; quá 210' (12:00) thì bỏ hôm đó |
| `dailyReport.intradaySlots` | `["13:00", "18:00", "22:00"]` | Mốc tự gửi số ĐANG CHẠY HÔM NAY (bỏ 20:00 từ 26/09, thêm 13:00 + 18:00 từ 29/09/2026). Trước 16h là tin TRƯA, trước 20h là CHIỀU, còn lại TỐI. Trễ quá `intradayCatchUpMinutes` (60') thì bỏ mốc đó, không dồn sang mốc sau |
| `adsPollMinutes` | `0` | Bỏ từ 08/10/2026 (cảnh báo gộp mọi nước không hợp nhóm theo nước) — bot không đọc khoá này nữa |
| `adsWasteSpend` | 300000 | Camp tiêu từ mức này mà 0 tin nhắn là camp đốt tiền |
| `adsSpikeRatio` / `adsMinTotalForSpike` | 1,5 / 3000000 | Chi tiêu hôm nay ≥ 1,5 lần TB 7 ngày VÀ ≥ 3tr là bất thường |
| `quietStartHour` / `quietEndHour` | 23 / 7 | Giờ không tự gửi |
| `vanDon.at` / `catchUpMinutes` | `08:30` / 180 | Giờ tin vận đơn sáng; để trống `at` là tắt. Dashboard lỗi thì thử lại mỗi 5' tới 11:30 |
| `vanDon.toiAt` / `toiCatchUpMinutes` | `22:00` / 60 | Giờ tin vận đơn tối |
| `vanDon.phuTrach` | Thương | Người được @nhắc trong tin vận đơn (tên + uid Zalo) |
| `vanDon.maxMoiToi` | 20 | Số khách mới tới in đủ chi tiết, còn lại trỏ về dashboard |
| `vanDon.maxGap` | 15 | Số khách "gọi ngay" in đủ chi tiết, còn lại trỏ về dashboard |
| `vanDon.quotaWarn` | 200 | Nhắc khi quota 17TRACK còn dưới mức này — hoặc dưới 15% cỡ gói nếu nhỏ hơn (gói miễn phí vài trăm mã thì không kêu mỗi ngày) |
| `maxChars` / `sendGapMs` | 1800 / 4000 | Tin dài hơn thì chia; nghỉ giữa hai tin để Zalo khỏi coi là spam |

## File

| File | Việc |
|---|---|
| `bot.js` | Lịch gửi, nghe lệnh, đăng nhập, gửi |
| `commands.js` | Đọc lệnh gõ trong nhóm (hàm thuần, có test) |
| `pair.js` | Ghép nick bằng QR, chọn nhóm |
| `zalo.js` | Phiên, gửi, nghe tin qua zca-js |
| `daily_report.js` · `van_don.js` | Dựng nội dung tin (hàm thuần, có test) — `buildBaoCaoNuoc` là tin ads một nước |
| `tin_gio.js` | Tin mỗi giờ + số mess Pancake (ghép camp · page · đơn theo tên page; hàm thuần, có test) |
| `ads_alerts.js` | Cảnh báo ads gộp mọi nước (BigQuery) — bot không dùng từ 08/10/2026, giữ lại cùng test |
| `zalo_text.js` | Chữ đậm/nghiêng → style Zalo, chia tin dài |
| `rules.js` | Đọc `config/talpha_rules.json` — thiếu file là dừng, không dùng bảng dự phòng. `NUOC`, `nuocTuTenNhom`: mã nước ↔ tên nhóm |
| `schedule.js` | "Mốc này gửi bây giờ không" — chép từ bot WhatsApp |

```bash
npm test        # 7 bộ test, không gọi mạng, không cần đăng nhập
```
