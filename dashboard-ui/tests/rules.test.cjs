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
t("campaign lạc quy ước → không đoán MARKETER, nhưng thị trường mặc định là Đài", () => {
    // Chỉ có MỘT thị trường nên tên campaign không cần ghi — suy ra từ cấu hình,
    // không phải đoán. Còn marketer thì tuyệt đối không đoán.
    assert.deepStrictEqual(R.parseCampaign("Camp linh tinh khong theo mau"), ["Taiwan", null]);
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

console.log("── Tên gọi khác ──");
t("Lâm là Lộc — tên xuất hiện NHIỀU NHẤT trong file đối tác", () => {
    // Sỹ Anh xác nhận 07/09/2026. Không khai thì 35 đơn của Lộc rơi vào ô trống.
    assert.strictEqual(pos("Lâm"), "Loc");
    assert.strictEqual(pos("Lam"), "Loc");
    assert.strictEqual(pos("Nguyễn Văn Lâm"), "Loc");
});
t("khai tên gọi khác không làm hỏng người khác", () => {
    for (const key of ROSTER) {
        assert.strictEqual(pos(R.RULES.marketers[key].display), key);
    }
});
t("campaign ghi Lâm cũng về Lộc", () => {
    assert.strictEqual(R.parseCampaign("TAIWAN / Lâm / SP / 1")[1], "Loc");
});


console.log("── Hai quy ước đặt tên campaign ──");
t("quy ước MỚI: marketer ở ô ĐẦU", () => {
    // Quy ước đang dùng thật: "Marketer / Thị trường / SP / Trang / Ngày".
    // Luật cũ chỉ biết quy ước "Thị trường / Marketer" nên bỏ sót 88% chi tiêu.
    assert.strictEqual(R.parseCampaign("Lộc/Philippine/042 - BLACK/Taiwan Prime Leather/28-8")[1], "Loc");
    assert.strictEqual(R.parseCampaign("THƯƠNG/VN/TÚI DU LỊCH/A.T.Shop/1347370118449146/1-9")[1], "Thuong");
});
t("quy ước CŨ vẫn chạy, không phá bản cũ", () => {
    assert.strictEqual(R.parseCampaign("Taiwan / Lộc / Vòng tay / 123456")[1], "Loc");
});
t("không theo quy ước nào thì quét cả tên", () => {
    assert.strictEqual(R.parseCampaign("khuyến mãi hè Lộc chạy thử")[1], "Loc");
});
t("thật sự không có ai thì marketer trả null, KHÔNG đoán bừa", () => {
    assert.strictEqual(R.parseCampaign("Camp linh tinh khong ten nguoi")[1], null);
});


console.log("── Chuẩn đặt tên campaign ──");
const CHUAN = [
    ["LOC/PHI/042-BLACK/TaiwanPrimeLeather/2808", "PHI",  "Loc"],
    ["SANH/TW/BONGTAI-TRON/LuckyClover/2808",     "TW",   "SAnh"],
    ["THAI/INDO/040-VONGVANG1/Lumora/1908",       "INDO", "Thai"],
    ["THUONG/VN/SET-KIM-CUONG/LuxeGold/0109",     "VN",   "Thuong"],
    ["QUYNH/PHI/TUI-DU-LICH/ATShop/0109",         "PHI",  "Quynh"],
    ["THANG/INDO/036-BROWN/TaiwanSavings/2808",   "INDO", "Thang"],
];
t("cả 6 marketer và 4 tệp khách đọc đúng theo chuẩn", () => {
    for (const [name, aud, key] of CHUAN) {
        assert.strictEqual(R.parseCampaign(name)[1], key, `marketer của ${name}`);
        assert.strictEqual(R.parseAudience(name), aud, `tệp khách của ${name}`);
    }
});
t("BẪY: tệp khách KHÔNG phải thị trường — mọi đơn đều ở Đài Loan", () => {
    // Đọc nhầm ô hai thành nước giao hàng là tưởng công ty bán ở bốn nước, rồi
    // quy đổi tiền theo bốn tỷ giá. Thực tế chỉ một thị trường: Đài Loan.
    for (const [name] of CHUAN) {
        assert.strictEqual(R.parseCampaign(name)[0], "Taiwan", name);
    }
    assert.deepStrictEqual(Object.keys(R.RULES.markets), ["Taiwan"]);
});
t("cách viết cũ của tệp khách vẫn đọc được", () => {
    assert.strictEqual(R.parseAudience("Lộc/Philippine/036/TaiwanSavings/28-8"), "PHI");
    assert.strictEqual(R.parseAudience("Thainx/INDO/040/Lumora/19-8"), "INDO");
    assert.strictEqual(R.parseAudience("THƯƠNG/VN/TÚI/ATShop/1-9"), "VN");
});
t("/TEST ở cuối được nhận là campaign thử", () => {
    assert.strictEqual(R.isTestCampaign("SANH/TW/BONGTAI/LuckyClover/2808/TEST"), true);
    assert.strictEqual(R.isTestCampaign("SANH/TW/BONGTAI/LuckyClover/2808"), false);
});
t("BẪY: ngày viết 27/08 tự đẻ thêm ô — marketer vẫn phải đúng", () => {
    // Dấu / là ký tự ngăn ô. Ô đầu vẫn là marketer nên vẫn cứu được — đó chính
    // là lý do marketer phải nằm ở ô ĐẦU.
    assert.strictEqual(R.parseCampaign("THUONG/PHI/SET KIM CUONG/LuxeGold - 27/08")[1], "Thuong");
});
t("mã không dấu tránh bẫy chữ hoa tiếng Việt", () => {
    assert.strictEqual("Thắng".toUpperCase().includes("THANG"), false);
    assert.strictEqual(R.parseCampaign("THANG/PHI/SP/Trang/2808")[1], "Thang");
});
t("không rõ tệp thì trả null, KHÔNG mặc định về tệp nào", () => {
    assert.strictEqual(R.parseAudience("Camp linh tinh khong theo mau"), null);
});


console.log(`\n${pass} phép thử — tất cả đạt.`);
