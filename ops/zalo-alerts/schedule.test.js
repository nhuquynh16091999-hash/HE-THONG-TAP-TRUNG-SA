// node schedule.test.js   (không cần cài gì thêm)
const assert = require("assert");
const { slotAction, toMin } = require("./schedule");

const HOM_NAY = "2026-09-02", HOM_QUA = "2026-09-01", W = 60;
let ok = 0;
const t = (ten, thuc, mong) => { assert.strictEqual(thuc, mong, `${ten}: ra ${thuc}, mong ${mong}`); ok++; };
const A = (slot, now, sent = undefined) => slotAction(slot, now, sent, HOM_NAY, W);

t("13:00 chưa tới mốc 13:30",            A("13:30", "13:00"), null);
t("13:30 đúng mốc → gửi",                A("13:30", "13:30"), "send");
t("13:34 (vòng rà 5' sau) → gửi",        A("13:30", "13:34"), "send");
t("14:30 đúng biên cửa sổ 60' → gửi",    A("13:30", "14:30"), "send");
t("14:31 quá cửa sổ → bỏ, KHÔNG gửi",    A("13:30", "14:31"), "skip");
t("21:00 bot vừa bật lại → bỏ mốc 13:30", A("13:30", "21:00"), "skip");
t("hôm nay gửi rồi → im",                A("13:30", "13:40", HOM_NAY), null);
t("mới gửi HÔM QUA → sang ngày gửi lại", A("13:30", "13:31", HOM_QUA), "send");
t("21:59 chưa tới mốc 22:00",            A("22:00", "21:59"), null);
t("22:03 → gửi",                         A("22:00", "22:03"), "send");

// ── Bug cũ: hour12:false trả "24" lúc nửa đêm nên guard `< 8` bị vượt và báo cáo 8h
// bắn lúc 0h05. Với h23 nửa đêm là "00:05" → mọi mốc trong ngày đều phải im.
t("00:05 KHÔNG được bắn mốc 13:30",      A("13:30", "00:05"), null);
t("00:05 KHÔNG được bắn mốc 22:00",      A("22:00", "00:05"), null);
t("00:00 KHÔNG được bắn mốc 22:00",      A("22:00", "00:00"), null);

// Mốc viết sai trong config thì bỏ qua chứ không được NaN rồi bắn loạn
t("mốc rác 'abc' → im",                  A("abc", "13:40"), null);
t("mốc rỗng → im",                       A("", "13:40"), null);
t("toMin('13:30')", toMin("13:30"), 810);
t("toMin('00:00')", toMin("00:00"), 0);


// ── "ngày đó xong chưa" — luật của tin 8h (tin về NGÀY ĐÃ QUA) ──
const { ngayChuaDu, hetNgay } = require("./schedule");
const VN = (iso) => Date.parse(iso + "+07:00");     // giờ VN → epoch ms

t("hết ngày 03/09 = 0h 04/09", hetNgay("2026-09-03"), VN("2026-09-04T00:00:00"));

// 04/09: sync chết 14:27 hôm trước, máy ngủ → tin 8h báo thiếu 67%. PHẢI kêu.
t("sync 03/09 14:27, báo ngày 03/09 -> CHƯA đủ",
    ngayChuaDu(VN("2026-09-03T14:27:00"), "2026-09-03"), true);
// Cùng ngày đó nhưng sync sáng hôm sau đã chạy xong → đủ, không được kêu.
t("sync 04/09 08:22, báo ngày 03/09 -> đủ",
    ngayChuaDu(VN("2026-09-04T08:22:00"), "2026-09-03"), false);
// Đêm máy thức, sync chạy đều qua nửa đêm → đủ.
t("sync 03/09 07:33, báo ngày 02/09 -> đủ",
    ngayChuaDu(VN("2026-09-03T07:33:00"), "2026-09-02"), false);
// Sát nút: đúng 0h00 ngày kế tiếp là ĐỦ (không còn phút nào của ngày cũ chưa quét).
t("sync đúng 0h00 04/09, báo ngày 03/09 -> đủ",
    ngayChuaDu(VN("2026-09-04T00:00:00"), "2026-09-03"), false);
t("sync 23:59 ngày 03/09 -> CHƯA đủ",
    ngayChuaDu(VN("2026-09-03T23:59:00"), "2026-09-03"), true);
// Không đọc được sync-health → KHÔNG kêu (thà thiếu cảnh báo còn hơn chặn mất báo cáo).
t("lastOkTs null -> không kêu", ngayChuaDu(null, "2026-09-03"), false);
t("ngày rác -> không kêu", ngayChuaDu(VN("2026-09-03T14:27:00"), "hom qua"), false);

console.log(`schedule.test.js: ${ok}/${ok} PASS`);
