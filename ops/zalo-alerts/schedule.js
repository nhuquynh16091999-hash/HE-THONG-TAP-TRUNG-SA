// Quyết định "mốc báo cáo giữa ngày này có phải gửi bây giờ không".
// Tách khỏi bot.js để TEST được: require("./bot") là đăng nhập luôn Zalo nên không đưa
// vào test được, mà đây lại đúng chỗ từng sinh bug giờ giấc (báo cáo 8h bắn lúc 0h05).
// Chép nguyên từ ops/whatsapp-alerts/schedule.js (bot WhatsApp đang tắt).
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

// ─── Đính chính: tin ĐÃ gửi khi số chưa đủ, chờ vòng sync đủ số rồi gửi lại số đúng ───
// Sỹ Anh chốt 22/09/2026: "chưa có vòng sync nào chạy để gửi báo cáo thì cứ gửi tạm theo
// đúng khung giờ, có vòng sync lấy đủ số rồi thì tự gửi thêm một tin đính chính".
// Câu hỏi "đã đủ số chưa" khác nhau theo loại tin — đúng HAI câu canhBaoSoCu đang hỏi:
//   - tin về NGÀY ĐÃ QUA (mốc 08:30): đủ khi có vòng OK chạy SAU KHI hết ngày đó;
//   - tin GIỮA NGÀY: đủ khi có vòng OK chạy SAU LÚC gửi tin tạm — số nhích tới hiện tại.
// "Vòng OK" = sync_rc 0 VÀ format_rc 0, tức số đã ghi được xuống Sheet; vòng bỏ ghi Sheet
// (SKIP format_all) KHÔNG tính, vì tin đọc số từ chính file Sheet đó.
//
// cho   = { ngay, luc, hanTs, intraday } — luc/hanTs là epoch ms
// stale = { lastOkTs } từ /api/talpha/sync-health; null = chưa biết → CHƯA kết luận
// →  "gui"     số đã đủ, gửi tin đính chính
//    "het-han" quá hạn mà số vẫn chưa đủ → bỏ chờ (đính chính muộn quá là tin rác)
//    null      chờ tiếp
function canDinhChinh(cho, stale, nowTs = Date.now()) {
    if (!cho || !/^\d{4}-\d{2}-\d{2}$/.test(String(cho.ngay))) return "het-han";   // rác trong state → dọn
    const han = Number(cho.hanTs);
    if (Number.isFinite(han) && nowTs > han) return "het-han";
    const ok = stale == null ? NaN : Number(stale.lastOkTs);
    if (!Number.isFinite(ok)) return null;
    if (cho.intraday) return ok > Number(cho.luc) ? "gui" : null;
    return ngayChuaDu(ok, cho.ngay) ? null : "gui";
}

// Hạn chờ đính chính của một tin:
//   - tin về NGÀY ĐÃ QUA: <gioHan> giờ kể từ lúc gửi (mặc định 24) — số cả ngày còn đáng
//     đính chính cả buổi chiều hôm sau;
//   - tin GIỮA NGÀY: chỉ tới HẾT NGÀY đó. Qua nửa đêm thì mốc 08:30 sáng sau đã là số cả
//     ngày đầy đủ — đính chính "số hôm nay lúc 22:00" vào sáng hôm sau là tin rác.
function hanDinhChinh({ ngay, luc, intraday }, gioHan = 24) {
    const h = Number(luc) + Number(gioHan) * 3600000;
    return intraday ? Math.min(h, hetNgay(ngay)) : h;
}

module.exports = { toMin, slotAction, hetNgay, ngayChuaDu, canDinhChinh, hanDinhChinh };
