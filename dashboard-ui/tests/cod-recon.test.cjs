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

// ─── Khoá hai tầng — dựng lại từ dữ liệu thật 7 kỳ sao kê NAZA ──────────────
console.log("── Khoá hai tầng: mã vận đơn rồi mới tới mã đơn ──");

/** Sao kê ghi cả mã đơn — cần để thử tầng khoá thứ hai. */
const stm2 = (tracking, orderId, amount, fee = 0) => ({
    tracking, order_id: orderId, amount, fee, paid_date: "2026-09-03", status: "paid",
});

t("mã vận đơn có số 0 ở đầu vẫn khớp — '06722405704' = '6722405704'", () => {
    const r = R.reconcile([pos(1, "6722405704", 749)], [stm("06722405704", 749)]);
    assert.strictEqual(r.summary.matched, 1);
});

t("BẪY THẬT: đơn GIAO LẠI đổi mã vận đơn nhưng giữ mã đơn → vẫn phải khớp", () => {
    // T1115 thật: file mình ghi 17952890, NAZA trả trên 17959110 sau khi gửi lại.
    const r = R.reconcile(
        [{ ...pos(0, "17952890", 799), order_id: "T1115", order_uid: "TW-T1115" }],
        [stm2("17959110", "T1115", 799)],
    );
    assert.strictEqual(r.summary.matched, 1, "phải khớp qua tầng 2, không được báo mất tiền");
    assert.strictEqual(r.lines[0].matched_by, "order_id_giao_lai");
    assert.strictEqual(r.lines[0].paid_tracking, "17959110", "giữ mã vận đơn 3PL thật sự trả");
    assert.strictEqual(r.lines[0].tracking, "17952890", "vẫn giữ mã vận đơn gốc của mình");
});

t("mã vận đơn luôn thắng mã đơn khi cả hai cùng khớp được", () => {
    const r = R.reconcile(
        [{ ...pos(0, "111", 100), order_id: "T1", order_uid: "u1" },
         { ...pos(0, "222", 200), order_id: "T2", order_uid: "u2" }],
        [stm2("222", "T1", 200)],
    );
    assert.strictEqual(r.lines[0].matched_by, "tracking");
    assert.strictEqual(r.lines[0].order_uid, "u2");
});

t("BẪY THẬT: mã đơn dùng lại (T1402) không được nuốt hai lần thanh toán", () => {
    // T1402 thật xuất hiện 2 lần: 1.500 TWD trên mã 17916892, 749 TWD trên 17992306.
    const r = R.reconcile(
        [{ ...pos(0, "17916892", 1500), order_id: "T1402", order_uid: "u-a" }],
        [stm2("17916892", "T1402", 1500), stm2("17992306", "T1402", 749)],
    );
    assert.strictEqual(r.summary.matched, 1);
    assert.strictEqual(r.summary.extra_in_statement, 1, "lần trả thứ hai là tiền thừa, phải lộ ra");
});

t("tầng 2 bỏ qua tiền tố TAIWAN- và hậu tố -Z", () => {
    const r = R.reconcile(
        [{ ...pos(0, "999", 500), order_id: "T1020", order_uid: "u1" }],
        [stm2("888", "TAIWAN-T1020", 500)],
    );
    assert.strictEqual(r.summary.matched, 1);
    assert.strictEqual(r.lines[0].matched_by, "order_id_giao_lai");
});

console.log("── Tách tiền còn chờ khỏi tiền quá hạn ──");

t("đã giao gần đây, tiền chưa về → chua_ve_tien (nhịp thanh toán bình thường)", () => {
    const r = R.reconcile([pos(1, "A", 900)], [], { asOf: "2026-09-10", overdueDays: 30 });
    assert.strictEqual(r.lines[0].verdict, "chua_ve_tien");
    assert.strictEqual(r.summary.overdue, 0);
});

t("đã giao quá 30 ngày mà tiền vẫn chưa về → qua_han, phải đi đòi", () => {
    const r = R.reconcile([pos(1, "A", 900)], [], { asOf: "2026-11-01", overdueDays: 30 });
    assert.strictEqual(r.lines[0].verdict, "qua_han");
    assert.strictEqual(r.summary.overdue, 1);
    assert.strictEqual(r.summary.overdue_amount, 900);
});

t("cả hai loại đều là tiền treo — pending_amount cộng chung", () => {
    const r = R.reconcile(
        [pos(1, "A", 900), { ...pos(2, "B", 100), order_date: "2026-01-01" }],
        [], { asOf: "2026-09-10", overdueDays: 30 },
    );
    assert.strictEqual(r.summary.missing_in_statement, 2);
    assert.strictEqual(r.summary.pending_amount, 1000);
    assert.strictEqual(r.summary.overdue_amount, 100);
});

t("diff_total chỉ cộng phần LỆCH THẬT, không cộng đơn chưa về tiền", () => {
    // Trộn chung thì một đơn chưa về 900 sẽ giả dạng thành 'lệch 900' và
    // nuốt mất khoản lệch thật 50 — hai việc khác hẳn nhau.
    const r = R.reconcile([pos(1, "A", 900), pos(2, "B", 950)], [stm("B", 900)]);
    assert.strictEqual(r.summary.mismatched, 1);
    assert.strictEqual(r.summary.diff_total, -50);
    assert.strictEqual(r.summary.pending_amount, 900);
});

console.log(`\n${pass} phép thử — tất cả đạt.`);
