const assert = require("assert");
const R = require("../.test-build/cod-recon.js");

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log("  ✓", name); };

console.log("── Đọc file sao kê ──");
t("tách CSV có ô bọc nháy", () => {
    const rows = R.parseDelimited('a,b\n"x,1",2\n');
    assert.deepStrictEqual(rows, [["a","b"],["x,1","2"]]);
});
t("tự nhận TSV", () => {
    const rows = R.parseDelimited("a\tb\n1\t2\n");
    assert.deepStrictEqual(rows, [["a","b"],["1","2"]]);
});
t("tiền kiểu Anh-Mỹ 1,390 → 1390", () => assert.strictEqual(R.parseAmount("1,390"), 1390));
t("tiền kiểu châu Âu 1.234,56 → 1234.56", () => assert.strictEqual(R.parseAmount("1.234,56"), 1234.56));
t("tiền có ký hiệu NT$ 950 → 950", () => assert.strictEqual(R.parseAmount("NT$ 950"), 950));
t("ngoặc là số âm", () => assert.strictEqual(R.parseAmount("(120)"), -120));
t("ô rỗng → 0", () => assert.strictEqual(R.parseAmount(""), 0));

console.log("── Bóc mã vận đơn ──");
t("POS lưu thẳng mã", () => assert.strictEqual(R.trackingFromLink("TW123"), "TW123"));
t("link có query no=", () => assert.strictEqual(R.trackingFromLink("https://t.cc/track?no=TW999"), "TW999"));
t("link dạng đuôi path", () => assert.strictEqual(R.trackingFromLink("https://t.cc/track/TW777"), "TW777"));
t("rỗng → null", () => assert.strictEqual(R.trackingFromLink(""), null));

console.log("── Đối soát ──");
const pos = (id, tracking, cod) => ({
    order_uid: "TW-" + id, order_id: String(id), tracking,
    order_date: "2026-09-01", status_category: "GIAO_THANH_CONG",
    status_name: "delivered", cod_local: cod, marketer: "Lộc", sale: "(chưa gán sale)",
});
const stm = (tracking, amount, fee = 0) => ({
    tracking, order_id: "", amount, fee, paid_date: "2026-09-03", status: "paid",
});

t("khớp mã + khớp tiền → khop", () => {
    const r = R.reconcile([pos(336, "TW1", 950)], [stm("TW1", 950)]);
    assert.strictEqual(r.summary.matched, 1);
    assert.strictEqual(r.summary.mismatched, 0);
});
t("lệch quá ngưỡng → lech_tien", () => {
    const r = R.reconcile([pos(336, "TW1", 950)], [stm("TW1", 900)]);
    assert.strictEqual(r.summary.mismatched, 1);
    assert.strictEqual(r.lines[0].diff, -50);
});
t("lệch trong ngưỡng làm tròn → vẫn khop", () => {
    const r = R.reconcile([pos(336, "TW1", 950)], [stm("TW1", 950.5)]);
    assert.strictEqual(r.summary.matched, 1);
});
t("đã giao mà sao kê không có → tiền treo ở 3PL", () => {
    const r = R.reconcile([pos(336, "TW1", 950)], []);
    assert.strictEqual(r.summary.missing_in_statement, 1);
    assert.strictEqual(r.summary.pending_amount, 950);
});
t("sao kê có mà POS không có → thua_o_sao_ke", () => {
    const r = R.reconcile([], [stm("TWX", 500)]);
    assert.strictEqual(r.summary.extra_in_statement, 1);
});
t("khớp không phân biệt hoa thường và khoảng trắng", () => {
    const r = R.reconcile([pos(336, "tw1 ", 950)], [stm(" TW1", 950)]);
    assert.strictEqual(r.summary.matched, 1);
});
t("mỗi đơn chỉ ra đúng một dòng, không đếm trùng", () => {
    const r = R.reconcile([pos(1,"A",100), pos(2,"B",200)], [stm("A",100), stm("C",300)]);
    assert.strictEqual(r.lines.length, 3);          // A khớp, C thừa, B chưa về
    assert.strictEqual(r.summary.matched, 1);
    assert.strictEqual(r.summary.extra_in_statement, 1);
    assert.strictEqual(r.summary.missing_in_statement, 1);
});
t("tổng tiền cộng đúng", () => {
    const r = R.reconcile([pos(1,"A",100)], [stm("A",100,15)]);
    assert.strictEqual(r.summary.pos_total, 100);
    assert.strictEqual(r.summary.stm_total, 100);
    assert.strictEqual(r.summary.fee_total, 15);
});

console.log(`\n${pass} phép thử — tất cả đạt.`);
