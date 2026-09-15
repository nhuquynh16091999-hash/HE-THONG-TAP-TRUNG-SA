// node commands.test.js   (không gọi mạng, không cần cài zca-js)
const assert = require("assert");
const { docLenh, huongDan, homQua } = require("./commands");
const { toZalo } = require("./zalo_text");

const NGUOI = [
    { key: "Loc", ten: "Lộc" }, { key: "SAnh", ten: "Sỹ Anh" }, { key: "Thai", ten: "Thái" },
    { key: "Thuong", ten: "Thương" }, { key: "Quynh", ten: "Quỳnh" }, { key: "Thang", ten: "Thắng" },
];
const HOM_NAY = "2026-09-15";
const doc = (text) => docLenh(text, { today: HOM_NAY, nguoi: NGUOI });

let ok = 0;
const t = (ten, thuc, mong) => { assert.deepStrictEqual(thuc, mong, `${ten}: ra ${JSON.stringify(thuc)}`); ok++; };

// Không phải lệnh → bot im. Tin báo cáo của chính bot cũng đi qua bộ đọc này.
t("chữ thường không phải lệnh", doc("báo cáo cho anh với"), null);
t("tin báo cáo của bot", doc("🏆 TỔNG TEAM — 14/09\n💰 Tiền ads: 3.317.956đ"), null);
t("lệnh lạ", doc("/kho"), null);
t("rỗng", doc(""), null);

t("/baocao = số hôm nay, đủ tin", doc("/baocao"), { lenh: "baocao", ngay: HOM_NAY, homNay: true, loc: null });
t("/BaoCao hoa thường", doc("  /BaoCao "), { lenh: "baocao", ngay: HOM_NAY, homNay: true, loc: null });
t("/bc viết tắt", doc("/bc"), { lenh: "baocao", ngay: HOM_NAY, homNay: true, loc: null });
t("hôm qua có dấu", doc("/baocao hôm qua"), { lenh: "baocao", ngay: "2026-09-14", homNay: false, loc: null });
t("homqua không dấu", doc("/baocao homqua"), { lenh: "baocao", ngay: "2026-09-14", homNay: false, loc: null });
t("hôm nay ghi rõ", doc("/baocao hôm nay"), { lenh: "baocao", ngay: HOM_NAY, homNay: true, loc: null });
t("ngày dd/mm", doc("/baocao 14/09"), { lenh: "baocao", ngay: "2026-09-14", homNay: false, loc: null });
t("ngày d/m", doc("/baocao 3/9"), { lenh: "baocao", ngay: "2026-09-03", homNay: false, loc: null });
t("ngày có năm", doc("/baocao 30/08/2026"), { lenh: "baocao", ngay: "2026-08-30", homNay: false, loc: null });
t("ngày = hôm nay thì là số đang chạy", doc("/baocao 15/09"), { lenh: "baocao", ngay: HOM_NAY, homNay: true, loc: null });

t("một người, có dấu", doc("/baocao Lộc"), { lenh: "baocao", ngay: HOM_NAY, homNay: true, loc: "Lộc" });
t("một người, không dấu", doc("/baocao thuong"), { lenh: "baocao", ngay: HOM_NAY, homNay: true, loc: "Thương" });
t("Sỹ Anh viết S.Anh", doc("/baocao S.Anh"), { lenh: "baocao", ngay: HOM_NAY, homNay: true, loc: "Sỹ Anh" });
t("Sỹ Anh viết sy anh", doc("/baocao sy anh"), { lenh: "baocao", ngay: HOM_NAY, homNay: true, loc: "Sỹ Anh" });
t("ghép ngày + người", doc("/baocao homqua Thắng"), { lenh: "baocao", ngay: "2026-09-14", homNay: false, loc: "Thắng" });
t("ghép người + ngày", doc("/baocao quỳnh 14/09"), { lenh: "baocao", ngay: "2026-09-14", homNay: false, loc: "Quỳnh" });
t("chỉ TỔNG TEAM", doc("/baocao team"), { lenh: "baocao", ngay: HOM_NAY, homNay: true, loc: "team" });
t("tổng không dấu", doc("/baocao tong homqua"), { lenh: "baocao", ngay: "2026-09-14", homNay: false, loc: "team" });

t("ngày chưa tới", doc("/baocao 16/09"), { loi: "Ngày 16/09 chưa tới — chưa có số." });
t("ngày không có thật", doc("/baocao 31/02"), { loi: "Ngày \"31/02\" không có thật. Viết kiểu /baocao 14/09." });
t("người lạ", doc("/baocao Hùng"), { loi: "Không hiểu \"Hùng\". Gõ /bot xem cách dùng." });

t("/canhbao", doc("/canhbao"), { lenh: "canhbao" });
t("/cảnh báo có dấu", doc("/cảnhbáo"), { lenh: "canhbao" });
t("/bot", doc("/bot"), { lenh: "trogiup" });

t("hôm qua của ngày đầu tháng", homQua("2026-10-01"), "2026-09-30");

const hd = toZalo(huongDan({ at: "08:30", nguoi: NGUOI })).msg;
assert.ok(hd.includes("Tự gửi lúc 08:30") && hd.includes("/baocao homqua Lộc") && hd.includes("/canhbao"));
ok++;

console.log(`commands.test.js: ${ok}/${ok} PASS`);
