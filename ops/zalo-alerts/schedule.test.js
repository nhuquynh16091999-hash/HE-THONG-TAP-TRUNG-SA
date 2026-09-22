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


// ── Đính chính: tin tạm đã gửi, chờ vòng sync đủ số (Sỹ Anh chốt 22/09/2026) ──
const { canDinhChinh, hanDinhChinh } = require("./schedule");
const GIO = 3600000;
const SANG = { ngay: "2026-09-03", intraday: false, luc: VN("2026-09-04T08:30:00") };
const SANG_HAN = { ...SANG, hanTs: hanDinhChinh(SANG, 24) };
const TOI = { ngay: "2026-09-03", intraday: true, luc: VN("2026-09-03T20:00:00") };
const TOI_HAN = { ...TOI, hanTs: hanDinhChinh(TOI, 24) };

// Tin 8h30 nói về NGÀY ĐÃ QUA: chỉ đủ khi có vòng OK chạy sau khi hết ngày đó.
t("sáng: sync vẫn đứng từ chiều hôm trước → chờ",
    canDinhChinh(SANG_HAN, { lastOkTs: VN("2026-09-03T14:27:00") }, VN("2026-09-04T09:00:00")), null);
t("sáng: vòng sync 09:20 chạy xong → GỬI đính chính",
    canDinhChinh(SANG_HAN, { lastOkTs: VN("2026-09-04T09:22:00") }, VN("2026-09-04T09:25:00")), "gui");
t("sáng: quá 24 giờ mà số vẫn chưa đủ → bỏ chờ",
    canDinhChinh(SANG_HAN, { lastOkTs: VN("2026-09-03T14:27:00") }, VN("2026-09-05T09:00:00")), "het-han");
// Đọc sync-health lỗi → KHÔNG kết luận, cũng KHÔNG bỏ chờ (thà đính chính muộn còn hơn im).
t("sáng: chưa đọc được sync-health → chờ tiếp",
    canDinhChinh(SANG_HAN, null, VN("2026-09-04T09:00:00")), null);
t("sáng: sync-health không có vòng OK nào → chờ tiếp",
    canDinhChinh(SANG_HAN, { lastOkTs: null }, VN("2026-09-04T09:00:00")), null);

// Tin giữa ngày nói về HÔM NAY: đủ khi có vòng OK chạy SAU LÚC gửi tin tạm.
t("22h: vòng OK cũ hơn lúc gửi → chờ",
    canDinhChinh(TOI_HAN, { lastOkTs: VN("2026-09-03T17:20:00") }, VN("2026-09-03T20:30:00")), null);
t("22h: vòng OK 20:25 sau lúc gửi 20:00 → GỬI đính chính",
    canDinhChinh(TOI_HAN, { lastOkTs: VN("2026-09-03T20:25:00") }, VN("2026-09-03T20:30:00")), "gui");
// Hạn của tin giữa ngày = HẾT NGÀY đó: sang 0h05 thì mốc 08:30 sáng sau mới là số cả ngày.
t("tin giữa ngày hết hạn lúc nửa đêm", hanDinhChinh(TOI, 24), hetNgay("2026-09-03"));
t("22h: qua nửa đêm mới có số → bỏ chờ, để mốc 08:30 báo số cả ngày",
    canDinhChinh(TOI_HAN, { lastOkTs: VN("2026-09-04T00:22:00") }, VN("2026-09-04T00:25:00")), "het-han");
t("tin ngày đã qua hết hạn sau 24 giờ", hanDinhChinh(SANG, 24), SANG.luc + 24 * GIO);

// state.json có rác (bản cũ, sửa tay) → dọn, không được ném lỗi làm chết vòng rà.
t("state rác không có ngày → dọn", canDinhChinh({ luc: 1, hanTs: 9e15 }, { lastOkTs: 2 }, 3), "het-han");
t("state rỗng → dọn", canDinhChinh(null, { lastOkTs: 2 }, 3), "het-han");
// Bản cũ chưa có hanTs: không có hạn thì đừng tự bỏ chờ, cứ xét theo số liệu.
t("chờ không có hanTs vẫn xét bình thường",
    canDinhChinh({ ngay: "2026-09-03", intraday: false, luc: 1 }, { lastOkTs: VN("2026-09-04T09:00:00") }, VN("2026-09-04T09:01:00")), "gui");

console.log(`schedule.test.js: ${ok}/${ok} PASS`);
