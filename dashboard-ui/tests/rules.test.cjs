/**
 * Luật nhận diện người — 6 marketer của đội Đài Loan.
 *
 * Đây là chỗ dễ sai nhất mà không ai phát hiện: gán nhầm người thì số vẫn cộng
 * đủ, báo cáo vẫn ra, chỉ có tiền chạy sang ô của người khác. Nên test ở đây
 * bám vào những cái bẫy thật:
 *   • Chữ HOA tiếng Việt VẪN GIỮ DẤU — "THẮNG" không chứa "THANG"
 *   • "ANH" nằm trong rất nhiều tên Việt, không được dùng làm mồi bắt Sỹ Anh
 *   • Tên này không được nuốt tên kia khi là chuỗi con
 */
const assert = require("assert");
const R = require("../.test-build/rules.js");

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log("  ✓", name); };

const ROSTER = ["Loc", "SAnh", "Thai", "Thuong", "Quynh", "Thang"];

console.log("── Danh sách đội ──");
t("đúng 6 marketer", () => {
    assert.deepStrictEqual(Object.keys(R.RULES.marketers), ROSTER);
});
t("Thương có mặt ở cả marketer và sale", () => {
    assert.ok(R.RULES.marketers.Thuong, "thiếu ở marketers");
    assert.ok(R.SALES.Thuong, "thiếu ở sales");
});
t("tên hiển thị giữ nguyên dấu tiếng Việt", () => {
    assert.strictEqual(R.DISPLAY.Loc, "Lộc");
    assert.strictEqual(R.DISPLAY.Thuong, "Thương");
    assert.strictEqual(R.DISPLAY.Thang, "Thắng");
});

console.log("── Tag POS → marketer ──");
const pos = (s) => R.normPosMarketer(s);
t("tên có dấu bắt đúng", () => {
    assert.strictEqual(pos("Hồ Sỹ Lộc"), "Loc");
    assert.strictEqual(pos("Nguyễn Thái"), "Thai");
    assert.strictEqual(pos("Trần Thương"), "Thuong");
    assert.strictEqual(pos("Lê Quỳnh"), "Quynh");
    assert.strictEqual(pos("Phạm Thắng"), "Thang");
});
t("tên KHÔNG dấu cũng bắt đúng", () => {
    assert.strictEqual(pos("Ho Sy Loc"), "Loc");
    assert.strictEqual(pos("Nguyen Thai"), "Thai");
    assert.strictEqual(pos("Tran Thuong"), "Thuong");
    assert.strictEqual(pos("Le Quynh"), "Quynh");
    assert.strictEqual(pos("Pham Thang"), "Thang");
});
t("Sỹ Anh bắt được cả ba cách viết", () => {
    assert.strictEqual(pos("Hồ Sỹ Anh"), "SAnh");
    assert.strictEqual(pos("Ho Sy Anh"), "SAnh");
    assert.strictEqual(pos("S.Anh"), "SAnh");
});
t("BẪY: tên khác có chữ 'Anh' KHÔNG được rơi vào Sỹ Anh", () => {
    // Nếu luật dùng 'ANH' trần thì mấy tên này bị vơ hết về Sỹ Anh.
    for (const name of ["Nguyễn Thanh", "Trần Ánh", "Lê Anh Tuấn", "Vũ Ngọc Anh"]) {
        assert.notStrictEqual(pos(name), "SAnh", `"${name}" bị nhận nhầm là Sỹ Anh`);
    }
});
t("BẪY: 'THẮNG' viết hoa vẫn còn dấu nên phải khai riêng bản không dấu", () => {
    assert.strictEqual("Thắng".toUpperCase().includes("THANG"), false);
    assert.strictEqual(pos("Thắng"), "Thang");   // bản có dấu
    assert.strictEqual(pos("Thang"), "Thang");   // bản không dấu
});
t("không ai trong đội nuốt tên người khác", () => {
    const seen = new Map();
    for (const key of ROSTER) {
        const name = R.RULES.marketers[key].display;
        const got = pos(name);
        assert.strictEqual(got, key, `"${name}" ra "${got}" thay vì "${key}"`);
        seen.set(name, got);
    }
    assert.strictEqual(new Set(seen.values()).size, ROSTER.length);
});
t("người lạ → null, không gán bừa", () => {
    assert.strictEqual(pos("Người Lạ Hoắc"), null);
    assert.strictEqual(pos(""), null);
    assert.strictEqual(pos(null), null);
});

console.log("── Tên campaign → marketer ──");
t("campaign đúng quy ước tách được người", () => {
    const [mkt, key] = R.parseCampaign("Taiwan / Lộc / Vòng tay / 123456");
    assert.strictEqual(mkt, "Taiwan");
    assert.strictEqual(key, "Loc");
});
t("segment không dấu vẫn ra đúng người", () => {
    assert.strictEqual(R.parseCampaign("TAIWAN / Thuong / SP / 1")[1], "Thuong");
    assert.strictEqual(R.parseCampaign("TAIWAN / S.Anh / SP / 1")[1], "SAnh");
});
t("campaign lạc quy ước → null, không đoán", () => {
    assert.deepStrictEqual(R.parseCampaign("Camp linh tinh khong theo mau"), [null, null]);
});

console.log("── Thị trường ──");
t("chỉ còn Đài Loan", () => {
    assert.deepStrictEqual(Object.keys(R.RULES.markets), ["Taiwan"]);
});
t("số chia của Đài là 1, không phải 100", () => {
    assert.strictEqual(R.RULES.markets.Taiwan.pos_money_divisor, 1);
});

console.log("── Gán sale ──");
t("chưa khai luật nào thì trả null, KHÔNG đoán bừa", () => {
    assert.strictEqual(R.resolveSale({ order_uid: "TW-1", page_id: "999", tags: "Thương" }), null);
});
t("gán tay theo order_uid được ưu tiên cao nhất", () => {
    const sa = R.RULES.sale_assignment;
    sa.manual["TW-42"] = "Thuong";
    assert.strictEqual(R.resolveSale({ order_uid: "TW-42" }), "Thuong");
    delete sa.manual["TW-42"];
});

console.log(`\n${pass} phép thử — tất cả đạt.`);
