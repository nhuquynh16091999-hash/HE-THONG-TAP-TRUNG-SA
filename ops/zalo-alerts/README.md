# TALPHA — Bot báo cáo ads vào nhóm Zalo

Gửi vào **một nhóm Zalo**, chỉ tin **ads** (Sỹ Anh chốt 15/09/2026):

| Lúc | Tin |
|---|---|
| **08:30** | TỔNG TEAM + mỗi marketer một tin — số **hôm qua** |
| **13:30 · 22:00** | Như trên, số **đang chạy hôm nay**, dán nhãn `HÔM NAY dd/mm · 13:30` |
| **Mỗi 3 giờ** | Camp đốt tiền ≥ 300k mà 0 tin nhắn · tổng chi tiêu ≥ 1,5 lần TB 7 ngày (và ≥ 3tr) |

Không gửi từ 23h đến 7h. Không có tồn kho, thẻ/TKQC hay lệnh gõ trong nhóm như bot
WhatsApp cũ (`ops/whatsapp-alerts/`, đang tắt) — muốn thêm thì chép từ đó sang.

## Số lấy ở đâu

Cùng máy chủ với dashboard, gọi `http://localhost:3000`:

* **Số đầu bài** mọi tin: `/api/talpha/sheet-report` — đọc thẳng file Google Sheet
  **TỔNG TEAM THÁNG n**, đúng file CEO xem. Tin và Sheet không lệch được.
* **Chi tiết từng campaign**: `/api/talpha/realtime` (Meta + POS live). Chủ campaign tính
  **đúng luật của Sheet** (`rules.js → chuCamp`), nên cộng lại khớp số đầu bài. Route lỗi thì
  tin vẫn đi, chỉ thiếu phần campaign.
* **Cảnh báo**: `/api/talpha/ads-alerts` (BigQuery).
* **Tuổi số**: `/api/talpha/sync-health` — sync đứng thì tin tự in `⚠️ SỐ CHƯA ĐỦ`.

## Cách gửi — nick Zalo PHỤ, không chính thức

Dùng [zca-js](https://github.com/RFS-ADRENO/zca-js): giả làm Zalo Web bằng một nick thật.
Không cần trình duyệt, nhẹ (bot WhatsApp phải chạy Chromium).

**Rủi ro phải biết:**

* Trái điều khoản Zalo — nick **có thể bị khoá**. Chỉ dùng nick phụ.
* Zalo chỉ cho **một phiên web** mỗi nick. Mở Zalo Web hay Zalo PC bằng nick phụ ở máy
  khác là bot bị đá ra và **im lặng**. Điện thoại thì không sao.
* `.zalo_session.json` là **khoá đăng nhập** của nick đó: quyền 600, gitignore, không chép
  đi đâu. Mất file → ghép lại.

## Bật lần đầu (trên máy chủ)

```bash
cd /opt/talpha/ops/zalo-alerts && npm ci
node pair.js                      # in "QR_READY": mở qr.png, quét bằng app Zalo của NICK PHỤ
node pair.js --chon <id nhóm>     # id lấy từ danh sách nhóm vừa in
node bot.js --dry-run --report    # IN thử báo cáo hôm qua, không gửi
node bot.js --report              # GỬI thật một báo cáo vào nhóm — nhìn chữ đậm có đúng chỗ
pm2 start /opt/talpha/ops/pm2/ecosystem.vps.config.js --only talpha-zalo-alerts
pm2 save
```

Nick phụ phải **nằm sẵn trong nhóm**. QR hết hạn sau ~100 giây, `pair.js` tự làm mã mới 5 lần.
Lần đầu chạy dịch vụ, bot gửi **một** tin giới thiệu lịch gửi vào nhóm (không lặp khi restart).

## Deploy

`bash ops/deploy/from-mac.sh` kéo code mới về máy chủ. Nếu bot **đang chạy** trong pm2,
`vps-setup.sh` tự `npm ci` và `pm2 restart talpha-zalo-alerts`. Chưa từng bật thì để yên.

## Lệnh

```bash
node bot.js --report 2026-09-14   # gửi ngay báo cáo ngày đó (bỏ ngày = hôm qua)
node bot.js --intraday-now        # gửi ngay báo cáo giữa ngày
node bot.js --ads-now             # gửi ngay cảnh báo ads nếu có
node bot.js --dry-run --report    # thêm --dry-run: chỉ in, không đăng nhập, không gửi
node pair.js --groups             # nick phụ đang ở những nhóm nào
pm2 logs talpha-zalo-alerts --lines 40
```

Chạy thử từ máy Mac: `TALPHA_DASHBOARD_URL=http://139.180.131.21:3000 node bot.js --dry-run --report`.

## Bot im lặng thì soát

1. `pm2 logs talpha-zalo-alerts` — `Đăng nhập Zalo lỗi` / `Gửi lỗi` là phiên chết → `node pair.js`
   rồi `pm2 restart talpha-zalo-alerts`. Thường do ai đó mở Zalo Web bằng nick phụ.
2. `Mốc 08:30 lỗi — vòng sau thử lại` + `Sheet chưa có dòng ngày` — vòng báo cáo Sheet chưa
   chạy; bot tự thử lại mỗi 5' tới 12:00.
3. `Bỏ mốc … (quá cửa sổ …)` — bot bật lại muộn hơn mốc quá cửa sổ nên bỏ mốc đó hôm nay,
   cố ý: tin dán nhãn "13:30" mà tới lúc 21h là sai nhãn.

## Tinh chỉnh (`config.json`)

| Khoá | Mặc định | Nghĩa |
|---|---|---|
| `dailyReport.at` / `atCatchUpMinutes` | `08:30` / 210 | Giờ tin sáng; quá 210' (12:00) thì bỏ hôm đó |
| `dailyReport.intradaySlots` / `intradayCatchUpMinutes` | `13:30, 22:00` / 60 | Mốc giữa ngày; `[]` là tắt |
| `adsPollMinutes` | 180 | Chu kỳ cảnh báo ads |
| `adsWasteSpend` | 300000 | Camp tiêu từ mức này mà 0 tin nhắn thì báo |
| `adsSpikeRatio` / `adsMinTotalForSpike` | 1,5 / 3000000 | Chi tiêu hôm nay ≥ 1,5 lần TB 7 ngày VÀ ≥ 3tr. Bot WhatsApp để sàn 20tr — ở mức chi ~3tr/ngày bây giờ là không bao giờ kêu |
| `quietStartHour` / `quietEndHour` | 23 / 7 | Giờ im lặng |
| `maxChars` / `sendGapMs` | 1800 / 4000 | Tin dài hơn thì chia; nghỉ giữa hai tin để Zalo khỏi coi là spam |

## File

| File | Việc |
|---|---|
| `bot.js` | Lịch gửi, đăng nhập, gửi |
| `pair.js` | Ghép nick bằng QR, chọn nhóm |
| `zalo.js` | Phiên + gửi qua zca-js |
| `daily_report.js` · `ads_alerts.js` | Dựng nội dung tin (hàm thuần, có test) |
| `zalo_text.js` | Chữ đậm/nghiêng → style Zalo, chia tin dài |
| `rules.js` | Đọc `config/talpha_rules.json` — thiếu file là dừng, không dùng bảng dự phòng |
| `schedule.js` | "Mốc này gửi bây giờ không" — chép từ bot WhatsApp |

```bash
npm test        # 3 bộ test, không gọi mạng, không cần đăng nhập
```
