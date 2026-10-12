// node tests/pancake.test.cjs (chạy qua npm test — tsc dựng .test-build trước)
// Đếm tin nhắn Pancake theo page cho nước Meta không báo mess (Nhật, 09/10/2026).
// Mẫu hội thoại lấy đúng dạng API trả về ngày 09/10/2026 (giờ UTC không ghi múi).
const assert = require("assert");
const P = require("../.test-build/pancake.js");

let ok = 0;
const t = (ten, fn) => { try { fn(); ok++; console.log("  ✓", ten); } catch (e) { console.error("  ✗", ten); throw e; } };

console.log("── Pancake: tin nhắn theo page ──");
t("tên page chuẩn hoá — kiểu chữ trang trí, hoa thường, dấu câu", () => {
    assert.strictEqual(P.chuanTenPage("𝑱𝒂𝒑𝒂𝒏 𝑷𝒓𝒊𝒎𝒆 𝑳𝒆𝒂𝒕𝒉𝒆𝒓"), "japan prime leather");
    assert.strictEqual(P.chuanTenPage("Glow & Grace  - PH"), "glow grace ph");
    assert.strictEqual(P.chuanTenPage("Kreain Nature - Skin Soothing Cream JP"), "kreain nature skin soothing cream jp");
});
t("ô tên page trong tên camp (chuẩn mới + kiểu cũ)", () => {
    assert.strictEqual(P.trangCuaCamp("JP/THANG/PHI/002-ATTL/Lucky Charm JP/08-10"), "Lucky Charm JP");
    assert.strictEqual(P.trangCuaCamp("JP/THƯƠNG/PHI/011/Lucky Silver JP/08-10"), "Lucky Silver JP");
    assert.strictEqual(P.trangCuaCamp("Lộc/Philippine/042 - BLACK/Trang Da/28-8"), "Trang Da");
    assert.strictEqual(P.trangCuaCamp("Camp linh tinh"), null);
});
t("giờ UTC không múi → ngày VN", () => {
    assert.strictEqual(P.ngayVN("2026-10-08T22:39:09.188061"), "2026-10-09");
    assert.strictEqual(P.ngayVN("2026-10-08T16:59:59"), "2026-10-08");
    assert.strictEqual(P.ngayVN(""), null);
});
const HT = [
    { id: "a", type: "INBOX", inserted_at: "2026-10-08T22:39:09", updated_at: "2026-10-09T03:27:02", has_phone: false },
    { id: "b", type: "INBOX", inserted_at: "2026-10-09T01:41:00", updated_at: "2026-10-09T06:11:00", has_phone: true },
    { id: "c", type: "COMMENT", inserted_at: "2026-10-08T23:11:24", updated_at: "2026-10-08T23:11:14" },
    { id: "d", type: "INBOX", inserted_at: "2026-10-08T06:08:39", updated_at: "2026-10-09T07:29:02", has_phone: true },
    { id: "b", type: "INBOX", inserted_at: "2026-10-09T01:41:00", updated_at: "2026-10-09T06:11:00", has_phone: true },
];
t("đếm hội thoại MỚI trong ngày VN — khách cũ nhắn lại không tính, trùng id một lần", () => {
    assert.deepStrictEqual(P.demTrongNgay(HT, "2026-10-09"), { inbox_moi: 2, comment_moi: 1, co_sdt: 1 });
    assert.deepStrictEqual(P.demTrongNgay(HT, "2026-10-08"), { inbox_moi: 1, comment_moi: 0, co_sdt: 1 });
});
t("lật tiếp hay thôi: cả lô cập nhật trước 00:00 VN thì thôi", () => {
    assert.strictEqual(P.hetLoTrongNgay(HT, "2026-10-09"), false);
    assert.strictEqual(P.hetLoTrongNgay([{ id: "x", updated_at: "2026-10-08T16:00:00" }], "2026-10-09"), true);
    assert.strictEqual(P.hetLoTrongNgay([], "2026-10-09"), true);
});
t("page của nước theo tên: CHỈ từ cuối là mã nước — 'Japan Prime Leather' là page Đài", () => {
    const jp = ["JP", "JPN", "JAPAN", "NHẬT", "NHAT"];
    assert.ok(P.laTrangCuaNuoc("Lucky Charm JP", jp));
    assert.ok(P.laTrangCuaNuoc("Kreain Nature - Skin Soothing Cream JP", jp));
    assert.ok(!P.laTrangCuaNuoc("𝑱𝒂𝒑𝒂𝒏 𝑷𝒓𝒊𝒎𝒆 𝑳𝒆𝒂𝒕𝒉𝒆𝒓", jp));
    assert.ok(!P.laTrangCuaNuoc("Golden Fortune Energy Necklace TW", jp));
});
t("hạn token Pancake đọc từ JWT", () => {
    const pl = Buffer.from(JSON.stringify({ exp: 1798876733 })).toString("base64url");
    assert.strictEqual(P.hanToken(`x.${pl}.y`), 1798876733000);
    assert.strictEqual(P.hanToken("khong-phai-jwt"), null);
});
console.log("── Dashboard Nhật (13/10/2026): mess theo khoảng ngày, chia cho camp, bản số theo nước ──");
t("đếm hội thoại TẠO trong khoảng ngày VN, bỏ trùng id, comment tách riêng", () => {
    const hts = [
        { id: "a", type: "INBOX", inserted_at: "2026-10-10T17:30:00", has_phone: true },   // 11/10 VN
        { id: "b", type: "INBOX", inserted_at: "2026-10-12T02:00:00" },                    // 12/10
        { id: "b", type: "INBOX", inserted_at: "2026-10-12T02:00:00" },                    // trùng
        { id: "c", type: "COMMENT", inserted_at: "2026-10-12T03:00:00" },
        { id: "d", type: "INBOX", inserted_at: "2026-10-09T10:00:00" },                    // trước khoảng
    ];
    assert.deepStrictEqual(P.demTrongKhoang(hts, "2026-10-11", "2026-10-12"), { inbox_moi: 2, comment_moi: 1, co_sdt: 1 });
    assert.deepStrictEqual(P.demTrongKhoang(hts, "2026-10-12", "2026-10-12"), P.demTrongNgay(hts, "2026-10-12"));
});
t("chia mess page cho camp: theo click, không click thì theo tiền, tổng luôn đủ", () => {
    assert.deepStrictEqual(P.chiaMessTheoCamp(10, [{ link_clicks: 30 }, { link_clicks: 10 }]), [8, 2]);
    assert.deepStrictEqual(P.chiaMessTheoCamp(7, [{ spend_vnd: 100 }, { spend_vnd: 100 }]).reduce((a, b) => a + b, 0), 7);
    assert.deepStrictEqual(P.chiaMessTheoCamp(5, [{ spend_vnd: 1 }]), [5]);
    assert.deepStrictEqual(P.chiaMessTheoCamp(0, [{ link_clicks: 3 }, { link_clicks: 1 }]), [0, 0]);
});
const B = require("../.test-build/ban-nuoc.js");
t("bản số theo nước: tháng trong khoảng, gom mess Nhật theo người trong khoảng ngày", () => {
    assert.deepStrictEqual(B.cacThang("2026-09-28", "2026-11-02"), ["2026-09", "2026-10", "2026-11"]);
    assert.deepStrictEqual(B.cacThang("2026-12-30", "2027-01-02"), ["2026-12", "2027-01"]);
    const ban = { thang: "2026-10", nuoc: {
        Japan: { "2026-10-11": { SAnh: { mess: 56 }, Thang: { mess: 30 } }, "2026-10-12": { SAnh: { mess: 10 } }, "2026-10-13": { SAnh: { mess: 99 } } },
        Taiwan: { "2026-10-12": { Thuong: { mess: 40 } } },
    } };
    assert.deepStrictEqual(B.gomMess([ban], "2026-10-11", "2026-10-12", ["Japan"]), { tong: 96, theoNguoi: { SAnh: 66, Thang: 30 } });
    assert.deepStrictEqual(B.gomMess([ban], "2026-10-11", "2026-10-12", []), { tong: 0, theoNguoi: {} }, "người xem không thấy Nhật → 0");
});
console.log(`${ok} phép thử Pancake qua.`);
