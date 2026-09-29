/**
 * Link WhatsApp của khách + sổ đơn Singapore/UAE (Sỹ Anh yêu cầu 29/09/2026).
 *
 * Chỗ sai là hại thật:
 *   • dựng link cho số không chắc → sale nhắn nhầm người lạ;
 *   • quên mã nước → wa.me mở ra "số không có WhatsApp", sale tưởng khách không dùng;
 *   • sổ Sing/UAE tô đơn giao hỏng thành "đang chờ" → không ai gọi khách.
 * Dạng số dưới đây theo đúng dạng đo trên số thật 29/09/2026 (số giả, cùng độ dài, cùng đầu số).
 */
const assert = require("assert");
const W = require("../.test-build/whatsapp.js");
const L = require("../.test-build/market-ledger.js");
const R = require("../.test-build/rules.js");

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log("  ✓", name); };

const AE = R.PHONE_RULES.AE;
// Đài, Singapore không bật WhatsApp (Sỹ Anh chốt 29/09/2026) nhưng luật chuẩn hoá số vẫn phải
// đúng nếu sau này bật lại — test bằng đúng luật đang khai trong talpha_rules.json.
const TW = { cc: "886", national_len: 9, trunk: "0" }, SG = { cc: "65", national_len: 8 };

console.log("── Luật WhatsApp khai ở talpha_rules.json ──");
t("CHỈ UAE bật WhatsApp; Đài, Singapore không có luật → không có nút", () => {
    assert.deepStrictEqual(Object.keys(R.PHONE_RULES), ["AE"]);
    assert.deepStrictEqual(AE, { cc: "971", national_len: 9, trunk: "0" });
    assert.strictEqual(W.waLink("970150630", R.PHONE_RULES.TW), null);
    assert.strictEqual(W.waLink("83123456", R.PHONE_RULES.SG), null);
});

console.log("── Đài Loan ──");
t("9 số thiếu mã nước (dạng phổ biến nhất) → +886", () => {
    assert.strictEqual(W.waNumber("970150630", TW), "886970150630");
    assert.strictEqual(W.waLink("970150630", TW), "https://wa.me/886970150630");
});
t("có số 0 đầu, có dấu cách/gạch → bỏ 0, thêm 886", () => {
    assert.strictEqual(W.waNumber("0912-345 678", TW), "886912345678");
});
t("đã có mã nước, kể cả ghi thừa số 0", () => {
    assert.strictEqual(W.waNumber("+886 912345678", TW), "886912345678");
    assert.strictEqual(W.waNumber("+886 0912345678", TW), "886912345678");
    assert.strictEqual(W.waNumber("00886912345678", TW), "886912345678");
});
t("hai số trong một ô → lấy số đầu", () => {
    assert.strictEqual(W.waNumber("0912345678 / 0987654321", TW), "886912345678");
    assert.strictEqual(W.waNumber("09123456780987654321", TW), "886912345678");   // dính liền, gặp thật
});
t("số nước khác ghi rõ + (Philippines) → giữ nguyên", () => {
    assert.strictEqual(W.waNumber("+63 917 123 4567", TW), "639171234567");
});
t("số cụt, số lạ, chữ → KHÔNG dựng link", () => {
    for (const x of ["140000", "90123456", "6912345678", "", null, "LINE: abc"]) {
        assert.strictEqual(W.waLink(x, TW), null, String(x));
    }
});

console.log("── Singapore ──");
t("8 số → +65; đã có 65 đầu (10 số) → giữ", () => {
    assert.strictEqual(W.waNumber("83123456", SG), "6583123456");
    assert.strictEqual(W.waNumber("6583123456", SG), "6583123456");
    assert.strictEqual(W.waNumber("+65 8312 3456", SG), "6583123456");
});
t("7 số hay 9 số → không dựng", () => {
    assert.strictEqual(W.waNumber("8312345", SG), null);
    assert.strictEqual(W.waNumber("831234567", SG), null);
});

console.log("── UAE ──");
t("9 số 5xxxxxxxx → +971; 05… bỏ 0; 971… giữ", () => {
    assert.strictEqual(W.waNumber("563086727", AE), "971563086727");
    assert.strictEqual(W.waNumber("0563086727", AE), "971563086727");
    assert.strictEqual(W.waNumber("971563086727", AE), "971563086727");
});
t("không có luật nước → không dựng", () => {
    assert.strictEqual(W.waLink("563086727", null), null);
});

console.log("── Tin xác nhận đơn soạn sẵn ──");
t("đủ hàng, tiền, địa chỉ; gọi khách bằng tên đầu", () => {
    const x = W.tinXacNhan({ customer: "Raquel Dimaano Arellano", product: "Gold Bracelet 001", quantity: 2,
        cod: 119, currency: "AED", address: "Villa 3, 33A Street,  Al Mamourah" });
    assert.ok(x.startsWith("Hi Raquel, thank you for your order!"), x);
    assert.ok(x.includes("- Item: Gold Bracelet 001 x2"), x);
    assert.ok(x.includes("- Total: 119 AED (cash on delivery)"), x);
    assert.ok(x.includes("- Address: Villa 3, 33A Street, Al Mamourah"), x);
    assert.ok(x.includes("reply YES to confirm"), x);
});
t("thiếu ô nào bỏ dòng đó — không bao giờ in 'undefined'", () => {
    const x = W.tinXacNhan({ customer: "", cod: 0 });
    assert.ok(x.startsWith("Hi there,"), x);
    assert.ok(!/undefined|null|Item|Total|Address/.test(x), x);
});
t("hàng đã ghi ×2 thì không thêm số lượng lần nữa", () => {
    const x = W.tinXacNhan({ product: "Oralhoe Dental 002 ×2", quantity: 2 });
    assert.ok(x.includes("- Item: Oralhoe Dental 002 ×2\n"), x);
});
t("link kèm tin: mã hoá URL, mở đúng số", () => {
    const l = W.waLink("563086727", AE, "Hi Ann,\nTotal: 119 AED");
    assert.strictEqual(l, "https://wa.me/971563086727?text=Hi%20Ann%2C%0ATotal%3A%20119%20AED");
});

console.log("── Sổ đơn Singapore / UAE ──");
const NOW = new Date("2026-09-29T08:00:00Z");
const ship = (o = {}) => ({
    tracking: "VS1", track17_code: "VS1", order_uid: null, order_id: "12", order_date: "2026-09-24",
    customer: "Maria", phone: "563086727", marketer: "Lộc", sale: null, cod_local: 119,
    status: "InTransit", sub_status: null, status_since: "2026-09-28T06:00:00Z",
    last_event_time: "2026-09-28T06:00:00Z", last_event: "Đã vào kho hãng", registered: true,
    source: "weship", city: "Dubai", note: "", ...o,
});
const dung = (shipments, products = new Map()) =>
    L.buildMarketLedger(shipments, products, require("../.test-build/tracking.js").buildAlerts(shipments, NOW, { staleDays: 4 }),
        { rateVnd: 7000, phone: AE, carrier: "WeShip", currency: "AED" });

t("giao hỏng → đèn đỏ kèm lý do, có link WhatsApp", () => {
    const [r] = dung([ship({ status: "DeliveryFailure", sub_status: "DeliveryFailure_Rejected", last_event: "Khách từ chối nhận (lần 2)", fail_count: 2 })]);
    assert.strictEqual(r.light, "do");
    assert.match(r.light_note, /Giao không thành công/);
    assert.strictEqual(r.status_vi, "Giao hỏng, chờ giao lại");
    assert.ok(r.wa.startsWith("https://wa.me/971563086727?text=Hi%20Maria"), r.wa);
    assert.ok(decodeURIComponent(r.wa).includes("Total: 119 AED"), r.wa);
    assert.strictEqual(r.cod_vnd, 833000);
    assert.strictEqual(r.carrier, "WeShip");
});
t("đã giao → vàng (tiền còn ở bên giao hàng, chưa có sao kê), KHÔNG xanh", () => {
    const [r] = dung([ship({ status: "Delivered" })]);
    assert.strictEqual(r.light, "vang");
    assert.strictEqual(r.status_vi, "Giao thành công");
    assert.match(r.light_note, /chờ sao kê/);
});
t("hoàn / đang hoàn → xám, không đòi", () => {
    const rs = dung([ship({ tracking: "A", status: "Returned" }), ship({ tracking: "B", status: "Exception", sub_status: "Exception_Returning" })]);
    assert.deepStrictEqual(rs.map((r) => r.light), ["xam", "xam"]);
});
t("chưa có mã vận đơn quá hạn → đỏ 'Chưa gửi hàng'", () => {
    const [r] = dung([ship({ tracking: "DON-30", track17_code: null, status: "InfoReceived", status_since: "2026-09-20T00:00:00Z", last_event_time: "2026-09-20T00:00:00Z" })]);
    assert.strictEqual(r.light, "do");
    assert.strictEqual(r.status_vi, "Chờ gửi hàng");
    assert.match(r.light_note, /Chưa gửi hàng/);
});
t("dòng đối tác mới lên, chưa trạng thái, chưa mã → 'Chờ gửi hàng', không nói 'đang đi'", () => {
    const [r] = dung([ship({ tracking: "DON-S1072", track17_code: null, status: null, raw_status: null,
        status_since: "2026-09-28T00:00:00Z", last_event_time: "2026-09-28T00:00:00Z" })]);
    assert.strictEqual(r.status_vi, "Chờ gửi hàng");
    assert.strictEqual(r.light, "vang");
    assert.match(r.light_note, /Chưa gửi hàng/);
});
t("ghép hàng của đơn theo mã đơn; mới nhất lên đầu", () => {
    const rs = dung([ship({ tracking: "A", order_id: "3", order_date: "2026-09-23" }), ship({ tracking: "B", order_id: "20", order_date: "2026-09-26" })],
        new Map([["20", { sku: "Oralhoe Dental 002 ×2", quantity: 2 }]]));
    assert.deepStrictEqual(rs.map((r) => r.order_no), ["20", "3"]);
    assert.strictEqual(rs[0].sku, "Oralhoe Dental 002 ×2");
    assert.strictEqual(rs[0].quantity, 2);
    assert.strictEqual(rs[1].sku, "");
});

console.log(`\n${pass} phép thử — tất cả đạt.`);
