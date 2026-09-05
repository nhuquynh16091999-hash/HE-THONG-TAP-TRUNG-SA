// Quyết định "mốc báo cáo giữa ngày này có phải gửi bây giờ không".
// Tách khỏi bot.js để TEST được: require("./bot") là mở luôn phiên WhatsApp nên không
// đưa vào test được, mà đây lại đúng chỗ từng sinh bug giờ giấc (báo cáo 8h bắn lúc 0h05).
const toMin = (hhmm) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm).trim());
    return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};

// nowHHMM  : "13:34" giờ VN (bên gọi tự lo múi giờ + hourCycle h23)
// sentDate : state.intraday[slot] — ngày đã gửi mốc này lần gần nhất ("2026-09-02")
// windowMin: cửa sổ catch-up, phút
// →  "send" tới giờ và còn trong cửa sổ
//    "skip" quá cửa sổ (bot vừa bật lại lúc 21h) → đánh dấu xong nhưng KHÔNG gửi, vì tin
//           dán nhãn "13:30" mà bắn lúc 21h thì vừa sai nhãn vừa dẫm chân mốc 22h
//    null   chưa tới giờ, hoặc hôm nay đã gửi mốc này rồi
function slotAction(slot, nowHHMM, sentDate, today, windowMin) {
    const at = toMin(slot), now = toMin(nowHHMM);
    if (!Number.isFinite(at) || !Number.isFinite(now)) return null;
    if (now < at) return null;
    if (sentDate === today) return null;
    return now - at > Number(windowMin) ? "skip" : "send";
}

// 00:00 của ngày KẾ TIẾP dateStr, theo giờ VN, tính bằng epoch ms. VN không có giờ mùa
// nên +07:00 là cố định — không cần thư viện múi giờ.
const hetNgay = (dateStr) => Date.parse(dateStr + "T00:00:00+07:00") + 86400000;

// Tin về một ngày ĐÃ QUA chỉ đủ số khi có vòng sync chạy SAU KHI ngày đó kết thúc.
// Ngưỡng tuổi KHÔNG trả lời được câu này, và sai về cả hai phía:
//   - đêm 31/08 sync chạy tới 23:22 → số ngày 31/08 gần như đủ, vậy mà 8h sáng hôm sau
//     nó đã "cũ 490 phút" → ngưỡng phẳng kêu oan, kêu oan vài lần là hết ai đọc;
//   - 03/09 sync chết từ 14:27 cũng chỉ là "cũ", mà thiếu tới 67% số cả ngày.
// Câu đúng phải hỏi là "đã có vòng nào chạy sau nửa đêm chưa", không phải "cũ bao lâu".
function ngayChuaDu(lastOkTs, dateStr) {
    if (lastOkTs == null || !Number.isFinite(lastOkTs)) return false;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateStr))) return false;
    return lastOkTs < hetNgay(dateStr);
}

module.exports = { toMin, slotAction, hetNgay, ngayChuaDu };
