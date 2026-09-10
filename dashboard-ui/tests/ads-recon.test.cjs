const assert = require("assert");
const path = require("path");
const RULES = require("../../config/talpha_rules.json");

/**
 * ĐỐI SOÁT CHI PHÍ QUẢNG CÁO — phép thử cho engine dùng chung.
 *
 * Engine là ESM thuần (.mjs) nên nạp bằng import động, không qua .test-build.
 * Dữ liệu dựng thẳng trong bộ nhớ dưới dạng "sheet" — không đọc file — để phép
 * thử này chạy được ở mọi nơi, kể cả trên máy chủ không có thư mục file mẫu.
 */
const ENGINE = path.join(__dirname, "..", "src", "lib", "talpha", "ads-recon", "recon.mjs");

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log("  ✓", name); };

const CFG = RULES.ads_settlement;

// Sheet giả lập đúng hình dạng bản xuất thật
const fbSheet = (rows) => [{
    name: "Payment activity",
    rows: [["Transaction ID", "Transaction Date", "Ad Account ID", "Ad Account Name", "Payment Method", "Amount", "Currency", "Status"], ...rows],
}];
const bankSheet = (rows) => [{
    name: "Sao ke",
    rows: [["Ngày giao dịch", "Số tham chiếu", "Nội dung giao dịch", "Số tiền ghi nợ", "Số tiền ghi có", "Số dư"], ...rows],
}];
const fbRow = (id, date, amount, acc = "act_ok", status = "Paid", card = "Visa *4281") =>
    [id, date, acc, "TK " + acc, card, amount, "VND", status];
const bankRow = (date, amount, desc = "FACEBK *AAA VISA*4281", ref = "FT1") => [date, ref, desc, amount, 0, 0];

const ROSTER = { projects: { talpha: { accounts: [{ id: "act_ok" }] } } };

(async () => {
    const E = await import(ENGINE);
    const chay = (fb, bank, opts = {}) =>
        E.reconcile([{ sheets: fbSheet(fb), name: "fb.xlsx" }, { sheets: bankSheet(bank), name: "bank.xlsx" }], CFG, opts);
    const codes = (r) => r.alerts.map((a) => a.code);

    console.log("── Luật nằm trong talpha_rules.json ──");
    t("có khối ads_settlement", () => assert.ok(CFG, "thiếu ads_settlement trong config/talpha_rules.json"));
    t("hai đầu đều VND nên dung sai phải chặt", () => {
        assert.strictEqual(CFG.currency, "VND");
        assert.ok(CFG.match.amount_tolerance_pct <= 0.1, "dung sai % nới quá thì lệch thật bị coi là làm tròn");
    });

    console.log("── Nhận diện nguồn ──");
    t("đảo thứ tự 2 file vẫn ra kết quả y hệt", () => {
        const fb = [fbRow("T1", "01/09/2026", 12500000)];
        const bank = [bankRow("01/09/2026", 12500000)];
        const xuoi = E.reconcile([{ sheets: fbSheet(fb) }, { sheets: bankSheet(bank) }], CFG);
        const nguoc = E.reconcile([{ sheets: bankSheet(bank) }, { sheets: fbSheet(fb) }], CFG);
        assert.deepStrictEqual(nguoc.summary, xuoi.summary);
    });

    console.log("── Ghép cặp ──");
    t("khớp đúng ngày đúng tiền", () => {
        const r = chay([fbRow("T1", "01/09/2026", 12500000)], [bankRow("01/09/2026", 12500000)]);
        assert.strictEqual(r.pairs.length, 1);
        assert.strictEqual(r.pairs[0].exact, true);
        assert.strictEqual(r.pairs[0].confidence, "cao");
    });
    t("thẻ cắt trễ trong cửa sổ ngày vẫn khớp", () => {
        const r = chay([fbRow("T1", "01/09/2026", 9000000)], [bankRow("03/09/2026", 9000000)]);
        assert.strictEqual(r.pairs.length, 1);
        assert.strictEqual(r.pairs[0].date_diff, 2);
    });
    t("trễ quá cửa sổ thì KHÔNG ghép — thà báo thiếu còn hơn ghép bừa", () => {
        const r = chay([fbRow("T1", "01/09/2026", 9000000)], [bankRow("12/09/2026", 9000000)]);
        assert.strictEqual(r.pairs.length, 0);
        assert.strictEqual(r.fb_unmatched.length, 1);
    });
    t("nhiều lựa chọn ngang nhau thì gắn nhãn nghi ngờ", () => {
        const r = chay([fbRow("T1", "02/09/2026", 5000000)],
                       [bankRow("01/09/2026", 5000000), bankRow("03/09/2026", 5000000)]);
        assert.strictEqual(r.pairs[0].ambiguous, true);
        assert.strictEqual(r.pairs[0].confidence, "thap");
    });

    console.log("── Cảnh báo ──");
    t("thẻ trừ mà không có hoá đơn là nghiêm trọng", () => {
        const r = chay([fbRow("T1", "01/09/2026", 1000000)], [bankRow("01/09/2026", 1000000), bankRow("02/09/2026", 21000000, "FACEBK *ZZZ VISA*4281", "FT9")]);
        const a = r.alerts.find((x) => x.code === "THE_TRU_MA_KHONG_CO_HOA_DON");
        assert.strictEqual(a.severity, "critical");
        assert.strictEqual(a.amount, 21000000);
    });
    t("hai dòng trừ giống nhau mà một hoá đơn = nghi trừ trùng", () => {
        const r = chay([fbRow("T1", "03/09/2026", 9900000)],
                       [bankRow("04/09/2026", 9900000, "FACEBK *QQ VISA*4281", "FT1"),
                        bankRow("04/09/2026", 9900000, "FACEBK *QQ VISA*4281", "FT2")]);
        assert.ok(codes(r).includes("TRU_TRUNG"));
    });
    t("hai hoá đơn cùng giá thì hai dòng trừ là bình thường", () => {
        const r = chay([fbRow("T1", "03/09/2026", 9900000), fbRow("T2", "03/09/2026", 9900000)],
                       [bankRow("04/09/2026", 9900000, "FACEBK *A VISA*4281", "FT1"),
                        bankRow("04/09/2026", 9900000, "FACEBK *B VISA*4281", "FT2")]);
        assert.ok(!codes(r).includes("TRU_TRUNG"));
    });
    t("hoá đơn Failed mà thẻ vẫn trừ thì phải đòi lại", () => {
        const r = chay([fbRow("T1", "03/09/2026", 11300000, "act_ok", "Failed")], [bankRow("03/09/2026", 11300000)]);
        assert.strictEqual(r.alerts.find((x) => x.code === "FB_LOI_MA_VAN_TRU").severity, "critical");
    });
    t("TKQC ngoài roster là cảnh báo đỏ", () => {
        const r = chay([fbRow("T1", "01/09/2026", 4500000, "act_la")], [bankRow("01/09/2026", 4500000)], { roster: ROSTER });
        const a = r.alerts.find((x) => x.code === "TKQC_LA");
        assert.strictEqual(a.severity, "critical");
        assert.ok(a.title.includes("act_la"));
    });
    t("ngân hàng trừ dư ngoài dung sai thì tách ra thành phí ẩn", () => {
        const r = chay([fbRow("T1", "02/09/2026", 15000000)], [bankRow("02/09/2026", 15450000)]);
        const a = r.alerts.find((x) => x.code === "PHI_AN");
        assert.strictEqual(a.amount, 450000);
        assert.strictEqual(r.summary.fee_total, 450000);
    });
    t("mọi cảnh báo đều phải kèm hướng xử lý", () => {
        const r = chay([fbRow("T1", "01/09/2026", 5000000)], [bankRow("01/09/2026", 21000000)]);
        assert.ok(r.alerts.length > 0);
        assert.ok(r.alerts.every((a) => a.hint && a.title), "cảnh báo không kèm cách xử lý chỉ làm người đọc lo");
    });

    t("chưa khai thẻ thì liệt kê thẻ có thật trong file, kèm mẩu JSON dán thẳng", () => {
        // Chỉ nhắc "đi mà khai" là việc này không bao giờ được làm — phải đưa
        // sẵn 4 số cuối moi từ chính hai file tuần đó.
        const r = chay([fbRow("T1", "01/09/2026", 5000000, "act_ok", "Paid", "Visa *4281")],
                       [bankRow("01/09/2026", 5000000, "FACEBK *A VISA*4281"),
                        bankRow("02/09/2026", 4500000, "FACEBK *B VISA*9911", "FT2")]);
        const a = r.alerts.find((x) => x.code === "CHUA_KHAI_THE");
        assert.ok(a.title.includes("2 thẻ"), "phải đếm đúng số thẻ thấy được");
        assert.ok(a.detail.includes("4281") && a.detail.includes("9911"));
        assert.ok(a.hint.includes('{ "last4": "4281"'), "hint phải dán được thẳng vào config");
        assert.ok(a.hint.includes("ads_settlement.cards.list"), "phải chỉ đúng chỗ trong talpha_rules.json");
    });

    console.log("── Nhiều file một lượt ──");
    t("hai sao kê của hai thẻ gộp thành một lượt đối soát", () => {
        // Công ty có mấy thẻ thì mấy sao kê. Bắt gộp tay bằng Excel trước khi
        // tải lên là trả việc về đúng chỗ hệ thống này sinh ra để bỏ đi.
        const fb = [fbRow("T1", "01/09/2026", 12500000, "act_ok", "Paid", "Visa *4281"),
                    fbRow("T2", "01/09/2026", 6750000, "act_ok", "Paid", "Mastercard *7733")];
        const r = E.reconcile([
            { sheets: fbSheet(fb), name: "tkqc.xlsx" },
            { sheets: bankSheet([bankRow("01/09/2026", 12500000, "FACEBK *A VISA*4281")]), name: "the-4281.xlsx" },
            { sheets: bankSheet([bankRow("01/09/2026", 6750000, "FACEBK *B MASTER*7733")]), name: "the-7733.xlsx" },
        ], CFG);
        assert.strictEqual(r.files.bank.length, 2);
        assert.strictEqual(r.summary.bank_total, 19250000);
        assert.strictEqual(r.stats.matched, 2);
    });

    t("tải trùng một file thì bỏ bản trùng, KHÔNG đếm gấp đôi", () => {
        // So bằng TÊN file thì hai bản cùng file trùng tên nhau và lọt lưới —
        // tổng tiền nhân đôi mà không ai biết. Phải so bằng số thứ tự bản tải.
        const bank = bankSheet([bankRow("01/09/2026", 12500000, "FACEBK *A VISA*4281", "FT1")]);
        const fb = fbSheet([fbRow("T1", "01/09/2026", 12500000)]);
        const r = E.reconcile([
            { sheets: fb, name: "tkqc.xlsx" },
            { sheets: bank, name: "sao-ke.xlsx" },
            { sheets: bank, name: "sao-ke.xlsx" },
        ], CFG);
        assert.strictEqual(r.summary.bank_total, 12500000, "tổng tiền không được nhân đôi");
        assert.ok(r.alerts.some((a) => a.code === "TRUNG_GIUA_FILE"), "phải nói ra là đã bỏ dòng trùng");
    });

    t("thiếu hẳn một phía thì báo rõ thiếu phía nào", () => {
        assert.throws(
            () => E.reconcile([{ sheets: fbSheet([fbRow("T1", "01/09/2026", 1000)]), name: "a.xlsx" }], CFG),
            /Cần cả hai phía/);
    });

    console.log("── Tiền không được biến mất giữa đường ──");
    t("tổng khớp + tổng dư = tổng nguồn, cả hai phía", () => {
        const r = chay([fbRow("T1", "01/09/2026", 12500000), fbRow("T2", "07/09/2026", 5600000)],
                       [bankRow("01/09/2026", 12500000), bankRow("08/09/2026", 21000000, "FACEBK *X VISA*4281", "FT9")]);
        const bankKhop = r.pairs.reduce((s, p) => s + p.bank.amount, 0);
        const bankDu = r.bank_unmatched.reduce((s, x) => s + x.amount, 0);
        assert.strictEqual(bankKhop + bankDu, r.summary.bank_total);
        const fbKhop = r.pairs.reduce((s, p) => s + p.fb.amount, 0);
        const fbDu = r.fb_unmatched.reduce((s, x) => s + x.amount, 0);
        assert.strictEqual(fbKhop + fbDu, r.summary.fb_total);
    });

    console.log(`\n${pass} phép thử — tất cả đạt.`);
})().catch((e) => { console.error("\n✗ HỎNG:", e.message); process.exit(1); });
