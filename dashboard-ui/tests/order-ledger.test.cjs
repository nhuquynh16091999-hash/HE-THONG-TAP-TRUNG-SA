/**
 * Phép thử sổ đơn hàng — ghép file đơn + sao kê + bảng phí + giá vốn.
 * Mỗi phép thử dựng lại một tình huống THẬT gặp trong 629 đơn của TALPHA.
 */
const assert = require("assert");
const L = require("../.test-build/order-ledger.js");

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log("  ✓", name); };

const ord = (o) => ({
    order_no: "T1", tracking: "17900001", cod_twd: 1000,
    order_date: "2026-08-20", status: "Delivered", sku: "040 - X", quantity: 1, ...o,
});
const pay = (o) => ({
    tracking: "17900001", order_no: "T1", amount_twd: 1000,
    paid_date: "2026-08-25", period: "ky1", rate_twd_rmb: 0.2, rate_rmb_vnd: 4000, ...o,
});
const fee = (o) => ({
    tracking: "17900001", order_no: "T1", ship_fee_rmb: 27, op_fee_rmb: 3,
    expected_ship_fee: 27, period: "ky1", rate_rmb_vnd: 4000, ...o,
});
const one = (orders, paid = [], fees = [], opts = {}) =>
    L.buildLedger(orders, paid, fees, { asOf: "2026-09-08", ...opts });

console.log("── Chuẩn hoá khoá ──");
t("mã vận đơn bỏ số 0 đầu", () =>
    assert.strictEqual(L.trackKey("06722405704"), L.trackKey("6722405704")));
t("BẪY: mã có chữ giữ nguyên chữ", () =>
    assert.strictEqual(L.trackKey("73N17897055"), "73N17897055"));
t("mã đơn bỏ tiền tố TAIWAN- và hậu tố -Z", () => {
    assert.strictEqual(L.orderKey("TAIWAN-T1020"), "T1020");
    assert.strictEqual(L.orderKey("17916893-Z"), "17916893");
});

console.log("── Đọc mã sản phẩm từ SKU ──");
t("SKU thường → một mã", () =>
    assert.deepStrictEqual(L.productCodes("040 - VONGVANG1"), ["040"]));
t("BẪY: đơn GHÉP hai sản phẩm → hai mã", () =>
    assert.deepStrictEqual(L.productCodes("042 - BLACK + 043 - COFFEE"), ["042", "043"]));
t("SKU không có mã ba số → rỗng", () =>
    assert.deepStrictEqual(L.productCodes("SET KIM CUONG"), []));
t("mã lặp chỉ tính một lần", () =>
    assert.deepStrictEqual(L.productCodes("042 - A + 042 - B"), ["042"]));

console.log("── Ghép tiền vào ──");
t("khớp bằng mã vận đơn → tích Đối soát", () => {
    const { rows } = one([ord()], [pay()], [fee()]);
    assert.strictEqual(rows[0].tick.doi_soat, true);
    assert.strictEqual(rows[0].matched_by, "tracking");
    assert.strictEqual(rows[0].light, "xanh");
});
t("BẪY THẬT: đơn giao lại đổi mã vận đơn, giữ mã đơn → vẫn khớp", () => {
    const { rows } = one(
        [ord({ order_no: "T1115", tracking: "17952890" })],
        [pay({ order_no: "T1115", tracking: "17959110" })],
    );
    assert.strictEqual(rows[0].tick.doi_soat, true);
    assert.strictEqual(rows[0].matched_by, "order_id_giao_lai");
});
t("mã vận đơn thắng mã đơn khi cả hai khớp được", () => {
    const { rows } = one(
        [ord({ order_no: "TA", tracking: "111" }), ord({ order_no: "TB", tracking: "222" })],
        [pay({ order_no: "TA", tracking: "222", amount_twd: 1000 })],
    );
    assert.strictEqual(rows[1].matched_by, "tracking");
    assert.strictEqual(rows[0].tick.doi_soat, false);
});
t("dòng sao kê không ghép được đơn nào → trả về ở `extra`", () => {
    const { extra } = one([ord()], [pay({ tracking: "999", order_no: "TX" })]);
    assert.strictEqual(extra.length, 1);
});

console.log("── Đơn giao lại và mã vận đơn Sheet ghi sai ──");
t("đọc mã gốc của đơn giao lại ở cả hai phía", () => {
    assert.strictEqual(L.maGocGiaoLai("T1467 (7564042426-z)"), "7564042426");
    assert.strictEqual(L.maGocGiaoLai("T1471 ( 06722436439 - Z )"), "6722436439");
    assert.strictEqual(L.maGocGiaoLai("T1465"), "");
    assert.strictEqual(L.maGocNaza("7564042426-Z"), "7564042426");
    assert.strictEqual(L.maGocNaza("T1465"), "");
});

// Kỳ 9.11 thật: T1467 là hàng hoàn của T1020 gửi cho khách khác. NAZA cấp mã
// mới 18010780 và ghi mã đơn "7564042426-Z"; Sheet lại chép nhầm mã vận đơn
// 18008693 của T1465 sang dòng T1467.
const t1465 = () => ord({ order_no: "T1465", tracking: "18008693", cod_twd: 749 });
const t1467 = () => ord({ order_no: "T1467 (7564042426-z)", tracking: "18008693", cod_twd: 1399 });
const tra1465 = () => pay({ order_no: "T1465", tracking: "18008693", amount_twd: 749 });
const tra1467 = () => pay({ order_no: "7564042426-Z", tracking: "18010780", amount_twd: 1399 });
const theoMa = (rows) => Object.fromEntries(rows.map((r) => [r.order_no, r]));

t("BẪY THẬT T1467: mang nhầm mã của đơn khác → ghép qua mã gốc, KHÔNG báo thiếu 650", () => {
    // Thứ tự dòng không được đổi kết quả.
    for (const orders of [[t1465(), t1467()], [t1467(), t1465()]]) {
        const { rows, extra } = one(orders, [tra1465(), tra1467()]);
        const by = theoMa(rows);
        assert.strictEqual(by["T1467 (7564042426-z)"].paid_twd, 1399);
        assert.strictEqual(by["T1467 (7564042426-z)"].diff_twd, 0);
        assert.strictEqual(by["T1467 (7564042426-z)"].matched_by, "order_id_giao_lai");
        assert.strictEqual(by.T1465.paid_twd, 749);
        assert.strictEqual(by.T1465.diff_twd, 0);
        assert.strictEqual(extra.length, 0, "tiền của T1467 không được rơi vào nhóm 'đơn mình không có'");
    }
});
t("BẪY THẬT T1468: mã Sheet ghi không có trên sao kê → vẫn về tiền, không thành 'chưa về'", () => {
    const { rows, extra } = one(
        [ord({ order_no: "T1468 (17898044-z)", tracking: "18009095", cod_twd: 1299 })],
        [pay({ order_no: "17898044-Z", tracking: "18010779", amount_twd: 1299 })],
    );
    assert.strictEqual(rows[0].paid_twd, 1299);
    assert.strictEqual(rows[0].light, "xanh");
    assert.strictEqual(extra.length, 0);
});
t("BẪY THẬT T1127 · T1131: hai đơn chung mã → mã đơn NAZA ghi chỉ ra đơn nào nhận tiền", () => {
    // Sheet chép mã của T1127 sang T1131, và dòng mang nhầm mã đứng TRƯỚC.
    const { rows, extra } = one(
        [ord({ order_no: "T1131", tracking: "06722405677", cod_twd: 1799, status: "Returned" }),
         ord({ order_no: "T1127", tracking: "06722405677", cod_twd: 799 })],
        [pay({ order_no: "T1127", tracking: "06722405677", amount_twd: 799 })],
        [fee({ order_no: "T1127", tracking: "06722405677", ship_fee_rmb: 27 }),
         fee({ order_no: "T1131", tracking: "06722402201", ship_fee_rmb: 32, expected_ship_fee: 32 })],
    );
    const by = theoMa(rows);
    assert.strictEqual(by.T1127.paid_twd, 799);
    assert.strictEqual(by.T1131.paid_twd, null);
    assert.strictEqual(extra.length, 0);
    assert.strictEqual(by.T1127.ship_fee_rmb, 27);
    assert.strictEqual(by.T1131.ship_fee_rmb, 32, "phí của đơn mang nhầm mã phải là phí của chính nó");
});
t("phí của đơn giao lại lấy theo mã gốc — không cộng phí của đơn bị mang nhầm mã", () => {
    const { rows } = one([t1465(), t1467()], [tra1465(), tra1467()], [
        fee({ order_no: "T1465", tracking: "18008693", ship_fee_rmb: 27 }),
        fee({ order_no: "7564042426-Z", tracking: "18010780", ship_fee_rmb: 32, expected_ship_fee: 32 }),
    ]);
    const by = theoMa(rows);
    assert.strictEqual(by.T1465.ship_fee_rmb, 27);
    assert.strictEqual(by["T1467 (7564042426-z)"].ship_fee_rmb, 32);
});

console.log("── Giá vốn ──");
t("đủ giá vốn → tích Trừ tiền hàng", () => {
    const { rows } = one([ord({ sku: "040 - X", quantity: 1 })], [pay()], [fee()]);
    assert.strictEqual(rows[0].tick.tru_tien_hang, true);
    assert.strictEqual(rows[0].cogs_vnd, 7 * 4000);   // 040 = 7 tệ × tỷ giá kỳ
});
t("giá vốn nhân theo số lượng", () => {
    const { rows } = one([ord({ sku: "040 - X", quantity: 3 })], [pay()], [fee()]);
    assert.strictEqual(rows[0].cogs_vnd, 7 * 4000 * 3);
});
t("BẪY: đơn ghép mà THIẾU một mã → KHÔNG tính nửa vời", () => {
    // Cộng nửa vời ra giá vốn thấp hơn thật, mà thấp hơn thật thì lãi trông
    // đẹp hơn thật — sai theo đúng hướng nguy hiểm nhất.
    const { rows } = one([ord({ sku: "040 - X + 999 - CHUAKHAI" })], [pay()], [fee()]);
    assert.strictEqual(rows[0].cogs_vnd, null);
    assert.deepStrictEqual(rows[0].cogs_missing, ["999"]);
    assert.strictEqual(rows[0].tick.tru_tien_hang, false);
});
t("mã 011 đã có giá thật — không còn dùng giá GCC cũ", () => {
    // Giá GCC cũ ghi 145.000đ ≈ 37,6 tệ cho một vòng cổ. Bảng "Giá tới Taiwan"
    // của Sỹ Anh (10/09/2026) nói 5,5 tệ — cao gấp gần 7 lần. Phép thử này giữ
    // lại để nếu ai đó lỡ nhét giá VND cũ vào, số sẽ vọt lên và test kêu ngay.
    const { rows } = one([ord({ sku: "011 - ATTL" })], [pay()], [fee()]);
    assert.strictEqual(rows[0].cogs_vnd, 5.5 * 4000);
    assert.deepStrictEqual(rows[0].cogs_missing, []);
});
t("chỉ tin cost_price_rmb — mã lạ thì báo thiếu, KHÔNG lùi về giá VND nào khác", () => {
    const { rows } = one([ord({ sku: "999 - KHONGCO" })], [pay()], [fee()]);
    assert.strictEqual(rows[0].cogs_vnd, null);
    assert.deepStrictEqual(rows[0].cogs_missing, ["999"]);
});
t("SKU không có mã nào → coi như chưa khai giá vốn", () => {
    const { rows } = one([ord({ sku: "SET KIM CUONG" })], [pay()], [fee()]);
    assert.strictEqual(rows[0].cogs_vnd, null);
});

console.log("── Tính tiền còn lại ──");
t("còn lại = tiền về − phí − giá vốn, theo tỷ giá của kỳ trả", () => {
    const { rows } = one([ord({ sku: "040 - X", quantity: 1 })], [pay()], [fee()]);
    const r = rows[0];
    assert.strictEqual(r.gross_vnd, 1000 * 0.2 * 4000);        // 800.000
    assert.strictEqual(r.fee_vnd, 30 * 4000);                   // 120.000
    assert.strictEqual(r.net_vnd, 800000 - 120000 - 28000);
    assert.strictEqual(r.net_before_cogs, false);
});
t("thiếu giá vốn → còn lại là số TẠM, có cờ báo", () => {
    const { rows } = one([ord({ sku: "999 - CHUAKHAI" })], [pay()], [fee()]);
    assert.strictEqual(rows[0].net_before_cogs, true);
    assert.strictEqual(rows[0].net_vnd, 800000 - 120000);
});
t("chưa có tiền về → không tính còn lại, KHÔNG trả 0", () => {
    const { rows } = one([ord()], [], [fee()]);
    assert.strictEqual(rows[0].net_vnd, null);
    assert.strictEqual(rows[0].gross_vnd, null);
});
t("mỗi kỳ một tỷ giá riêng, không dùng chung", () => {
    const a = one([ord()], [pay({ rate_twd_rmb: 0.1995, rate_rmb_vnd: 3900 })]).rows[0];
    const b = one([ord()], [pay({ rate_twd_rmb: 0.203, rate_rmb_vnd: 3860 })]).rows[0];
    assert.notStrictEqual(a.gross_vnd, b.gross_vnd);
    assert.strictEqual(Math.round(a.gross_vnd), Math.round(1000 * 0.1995 * 3900));
});

console.log("── Đèn xanh vàng đỏ ──");
t("tiền về + khớp số → XANH", () =>
    assert.strictEqual(one([ord()], [pay()], [fee()]).rows[0].light, "xanh"));
t("đã giao, tiền chưa về, còn trong hạn → VÀNG", () =>
    assert.strictEqual(one([ord({ order_date: "2026-09-01" })]).rows[0].light, "vang"));
t("đã giao quá 30 ngày, tiền chưa về → ĐỎ", () =>
    assert.strictEqual(one([ord({ order_date: "2026-07-01" })]).rows[0].light, "do"));
t("lệch tiền quá ngưỡng → ĐỎ dù tiền đã về", () => {
    const r = one([ord({ cod_twd: 1799 })], [pay({ amount_twd: 799 })]).rows[0];
    assert.strictEqual(r.light, "do");
    assert.strictEqual(r.diff_twd, -1000);
});
t("lệch trong ngưỡng làm tròn → vẫn XANH", () =>
    assert.strictEqual(one([ord({ cod_twd: 1000 })], [pay({ amount_twd: 1000.5 })]).rows[0].light, "xanh"));
t("hàng hoàn về kho → XÁM, không đòi tiền", () => {
    const r = one([ord({ status: "Returned", order_date: "2026-06-01" })]).rows[0];
    assert.strictEqual(r.light, "xam");
    assert.match(r.light_note, /hoàn về kho/i);
});
t("đơn huỷ → XÁM", () =>
    assert.strictEqual(one([ord({ status: "Cancelled" })]).rows[0].light, "xam"));
t("chưa giao xong → XÁM, chưa tới lượt đòi", () =>
    assert.strictEqual(one([ord({ status: "InTransit", order_date: "2026-06-01" })]).rows[0].light, "xam"));

console.log("── Quá hạn: ĐẾM KỲ SAO KÊ, không đếm ngày ──");
// Luật Sỹ Anh chốt 08/09/2026: "đơn đã giao mà qua hai kỳ sao kê liền vẫn không
// thấy". Đếm ngày là sai bản chất — NAZA trả theo KỲ chứ không theo ngày, nên
// đơn giao sát trước kỳ và đơn giao ngay sau kỳ có cùng số ngày chờ nhưng khác
// hẳn nhau về mức đáng lo. Bản đầu tau đặt 30 ngày, hoàn toàn tự đoán.
const ky = (...d) => ({ periodDates: d });

t("chưa kỳ nào chốt sau ngày giao → VÀNG, chưa tới lượt đòi", () => {
    const r = one([ord({ ship_date: "2026-09-05" })], [], [], ky("2026-08-20", "2026-09-01")).rows[0];
    assert.strictEqual(r.ky_da_qua, 0);
    assert.strictEqual(r.light, "vang");
});
t("mới qua MỘT kỳ → vẫn VÀNG, chỉ theo dõi", () => {
    const r = one([ord({ ship_date: "2026-08-25" })], [], [], ky("2026-08-20", "2026-09-01")).rows[0];
    assert.strictEqual(r.ky_da_qua, 1);
    assert.strictEqual(r.light, "vang");
    assert.match(r.light_note, /1 kỳ/);
});
t("qua HAI kỳ mà chưa có tiền → ĐỎ, phải đòi", () => {
    const r = one([ord({ ship_date: "2026-08-10" })], [], [], ky("2026-08-20", "2026-09-01")).rows[0];
    assert.strictEqual(r.ky_da_qua, 2);
    assert.strictEqual(r.light, "do");
    assert.match(r.light_note, /2 kỳ/);
});
t("BẪY: đơn CŨ nhưng chưa kỳ nào chốt sau nó → KHÔNG phải quá hạn", () => {
    // Đếm ngày thì đơn này 200 ngày, đỏ chót. Nhưng NAZA chưa chốt kỳ nào sau
    // ngày giao thì họ chưa có nghĩa vụ trả — báo đỏ là đòi oan.
    const r = one([ord({ ship_date: "2026-02-01" })], [], [], ky("2026-01-10")).rows[0];
    assert.strictEqual(r.light, "vang");
});
t("chưa tải sao kê nào thì lùi về đếm ngày, và nói rõ là đang đếm ngày", () => {
    const r = one([ord({ order_date: "2026-07-01", ship_date: "2026-07-01" })]).rows[0];
    assert.strictEqual(r.light, "do");
    assert.match(r.light_note, /Chưa có sao kê nào/);
});
t("đã có tiền về thì không xét quá hạn nữa", () => {
    const r = one([ord({ ship_date: "2026-08-01" })], [pay()], [fee()], ky("2026-08-20", "2026-09-01")).rows[0];
    assert.strictEqual(r.light, "xanh");
});

console.log("── Soát phí ──");
t("phí đúng bảng giá → không gắn cờ", () =>
    assert.strictEqual(one([ord()], [pay()], [fee()]).rows[0].fee_wrong, false));
t("phí lệch bảng giá → gắn cờ", () =>
    assert.strictEqual(one([ord()], [pay()], [fee({ ship_fee_rmb: 35 })]).rows[0].fee_wrong, true));

console.log("── Tên marketer về một cách gọi ──");
t("BẪY THẬT: file đối tác ghi 'Lâm', hệ thống gọi 'Lộc' — phải quy về một", () => {
    // Để nguyên thì Sổ đơn hàng và bảng chi tiêu quảng cáo nói về hai người
    // khác nhau, không ai nối được doanh thu với chi phí của chính người đó.
    const { rows } = one([ord({ marketer: "Lâm" })]);
    assert.strictEqual(rows[0].marketer, "Lộc");
});
t("tên đã chuẩn thì giữ nguyên", () =>
    assert.strictEqual(one([ord({ marketer: "Thái" })]).rows[0].marketer, "Thái"));
t("bỏ trống thì để trống, KHÔNG đoán", () =>
    assert.strictEqual(one([ord({ marketer: "" })]).rows[0].marketer, ""));

console.log("── Tổng hợp ──");
t("đếm đèn và cộng tiền đúng", () => {
    const { rows, extra } = one(
        [ord({ order_no: "A", tracking: "1", sku: "040 - X" }),
         ord({ order_no: "B", tracking: "2", order_date: "2026-09-01" }),
         ord({ order_no: "C", tracking: "3", order_date: "2026-07-01" })],
        [pay({ order_no: "A", tracking: "1" })],
        [fee({ order_no: "A", tracking: "1" })],
    );
    const s = L.summarise(rows, extra);
    assert.strictEqual(s.total, 3);
    assert.strictEqual(s.by_light.xanh, 1);
    assert.strictEqual(s.by_light.vang, 1);
    assert.strictEqual(s.by_light.do, 1);
    assert.strictEqual(s.pending_twd, 2000);   // B đang chờ + C quá hạn
    assert.strictEqual(s.overdue_twd, 1000);
});
t("tiền còn lại tách riêng: đã trừ giá vốn vs chưa", () => {
    const { rows } = one(
        [ord({ order_no: "A", tracking: "1", sku: "040 - X" }),
         ord({ order_no: "B", tracking: "2", sku: "999 - CHUAKHAI" })],
        [pay({ order_no: "A", tracking: "1" }), pay({ order_no: "B", tracking: "2" })],
        [fee({ order_no: "A", tracking: "1" }), fee({ order_no: "B", tracking: "2" })],
    );
    const s = L.summarise(rows);
    assert.strictEqual(s.net_total_vnd, 800000 - 120000 - 28000);   // đã trừ giá vốn
    assert.strictEqual(s.net_partial_vnd, 680000);    // mới trừ phí
    assert.strictEqual(s.cogs_missing_orders, 1);
});

// ── Nhắc sao kê: NAZA gửi đều mỗi 7 ngày, trễ thì phải kêu ────────────────
// Sao kê là thứ DUY NHẤT phải tải lên bằng tay. Không nhắc thì cả tháng không ai
// tải mà màn hình vẫn trông "sạch" — số cũ không tự xấu đi.
const KY = ["2026-08-28", "2026-09-04", "2026-09-11"];

t("đúng nhịp thì im", () => {
    assert.strictEqual(L.saoKeTreHan(KY, "2026-09-16").tre, false);   // kỳ tới dự kiến 18/09
    assert.strictEqual(L.saoKeTreHan(KY, "2026-09-18").tre, false);   // đúng ngày dự kiến
    assert.strictEqual(L.saoKeTreHan(KY, "2026-09-19").tre, false);   // trễ 1 ngày: còn ân hạn
});

t("trễ quá ân hạn thì kêu, kèm số ngày trễ", () => {
    const r = L.saoKeTreHan(KY, "2026-09-22");
    assert.strictEqual(r.tre, true);
    assert.strictEqual(r.ky_gan_nhat, "2026-09-11");
    assert.strictEqual(r.du_kien, "2026-09-18");
    assert.strictEqual(r.tre_ngay, 4);
});

t("bỏ qua kỳ thiếu ngày, vẫn lấy kỳ mới nhất", () => {
    const r = L.saoKeTreHan([null, "2026-09-11", undefined, "rác", "2026-08-28"], "2026-09-25");
    assert.strictEqual(r.ky_gan_nhat, "2026-09-11");
    assert.strictEqual(r.tre, true);
});

t("chưa có kỳ nào thì KHÔNG kêu — không biết nhịp bắt đầu từ đâu", () => {
    assert.deepStrictEqual(L.saoKeTreHan([], "2026-09-25"),
        { tre: false, tre_ngay: 0, ky_gan_nhat: null, du_kien: null });
});

t("đổi nhịp gửi thì đổi luôn ngày dự kiến", () => {
    const r = L.saoKeTreHan(["2026-09-11"], "2026-09-30", { chuKy: 14 });
    assert.strictEqual(r.du_kien, "2026-09-25");
    assert.strictEqual(r.tre_ngay, 5);
});

console.log(`\n${pass} phép thử — tất cả đạt.`);
