# TALPHA — Bot báo cáo ads vào nhóm Zalo

Gửi vào **một nhóm Zalo** — hiện là **BOT AI NHẬN THÔNG BÁO** — chỉ tin **ads**.
Sỹ Anh chốt 15/09/2026: **tự động chỉ gửi mốc 8h30**, còn lại gửi khi có người gõ lệnh.

| Khi nào | Tin |
|---|---|
| **08:30** mỗi ngày | TỔNG TEAM + mỗi marketer một tin — số **hôm qua** |
| Có người gõ lệnh trong nhóm | Xem bảng lệnh dưới |

Không tự gửi từ 23h đến 7h (lệnh gõ tay thì trả lời bất cứ lúc nào). Không có tồn kho,
thẻ/TKQC như bot WhatsApp cũ (`ops/whatsapp-alerts/`, đang tắt).

## Lệnh trong nhóm

| Gõ | Bot trả |
|---|---|
| `/baocao` | Số **đang chạy hôm nay**: TỔNG TEAM + từng marketer, dán nhãn `HÔM NAY dd/mm · giờ` |
| `/baocao homqua` · `/baocao 14/09` | Số hôm qua · số một ngày |
| `/baocao Lộc` · `/baocao homqua Lộc` | Chỉ tin của một người |
| `/baocao team` | Chỉ tin TỔNG TEAM |
| `/canhbao` | Camp tiêu ≥ 300k mà 0 tin nhắn, chi tiêu hôm nay so với TB 7 ngày |
| `/bot` | Cách dùng |

Có dấu hay không dấu, hoa hay thường đều được; `/bc`, `/cb` là viết tắt. Chữ không bắt đầu
bằng `/` bot bỏ qua. Cùng một lệnh gõ lại trong 60 giây thì bot bỏ lần sau.
**Chỉ nghe nhóm nhận tin**: nick phụ còn ở các nhóm COD có người của đối tác — gõ `/baocao`
ở đó bot im, không lộ số ra ngoài.

## Số lấy ở đâu

Cùng máy chủ với dashboard, gọi `http://localhost:3000`:

* **Số đầu bài** mọi tin: `/api/talpha/sheet-report` — đọc thẳng file Google Sheet
  **TỔNG TEAM THÁNG n**, đúng file CEO xem. Tin và Sheet không lệch được.
* **Chi tiết từng campaign**: `/api/talpha/realtime` (Meta + POS live). Chủ campaign tính
  **đúng luật của Sheet** (`rules.js → chuCamp`), nên cộng lại khớp số đầu bài. Route lỗi thì
  tin vẫn đi, chỉ thiếu phần campaign.
* **`/canhbao`**: `/api/talpha/ads-alerts` (BigQuery).
* **Tuổi số**: `/api/talpha/sync-health` — sync đứng thì tin tự in `⚠️ SỐ CHƯA ĐỦ`.

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
node pair.js --chon <id nhóm>     # id lấy từ danh sách nhóm vừa in
node bot.js --dry-run --report    # IN thử báo cáo hôm qua, không gửi
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
node bot.js --lenh "/baocao homqua"   # làm như có người gõ lệnh đó trong nhóm (gửi thật)
node bot.js --report 2026-09-14       # gửi báo cáo ngày đó (bỏ ngày = hôm qua)
node bot.js --dry-run --lenh "/baocao Lộc"   # --dry-run: chỉ in, không đăng nhập, không gửi
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
| `dailyReport.intradaySlots` | `[]` — **tắt** | Mốc tự gửi số giữa ngày, ví dụ `["13:30", "22:00"]` |
| `adsPollMinutes` | `0` — **tắt** | Tự gửi cảnh báo ads mỗi N phút (bot WhatsApp để 180) |
| `adsWasteSpend` | 300000 | Camp tiêu từ mức này mà 0 tin nhắn là camp đốt tiền |
| `adsSpikeRatio` / `adsMinTotalForSpike` | 1,5 / 3000000 | Chi tiêu hôm nay ≥ 1,5 lần TB 7 ngày VÀ ≥ 3tr là bất thường |
| `quietStartHour` / `quietEndHour` | 23 / 7 | Giờ không tự gửi |
| `maxChars` / `sendGapMs` | 1800 / 4000 | Tin dài hơn thì chia; nghỉ giữa hai tin để Zalo khỏi coi là spam |

## File

| File | Việc |
|---|---|
| `bot.js` | Lịch gửi, nghe lệnh, đăng nhập, gửi |
| `commands.js` | Đọc lệnh gõ trong nhóm (hàm thuần, có test) |
| `pair.js` | Ghép nick bằng QR, chọn nhóm |
| `zalo.js` | Phiên, gửi, nghe tin qua zca-js |
| `daily_report.js` · `ads_alerts.js` | Dựng nội dung tin (hàm thuần, có test) |
| `zalo_text.js` | Chữ đậm/nghiêng → style Zalo, chia tin dài |
| `rules.js` | Đọc `config/talpha_rules.json` — thiếu file là dừng, không dùng bảng dự phòng |
| `schedule.js` | "Mốc này gửi bây giờ không" — chép từ bot WhatsApp |

```bash
npm test        # 4 bộ test, không gọi mạng, không cần đăng nhập
```
