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
console.log(`${ok} phép thử Pancake qua.`);
