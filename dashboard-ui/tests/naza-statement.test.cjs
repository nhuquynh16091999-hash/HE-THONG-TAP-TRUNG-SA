/**
 * Phép thử bộ đọc sao kê NAZA.
 *
 * Mọi phép thử ở đây đều dựng từ một cái BẪY THẬT gặp khi đọc 7 file sao kê
 * của các kỳ 24/07 → 04/09/2026. File sao kê thật KHÔNG được đưa vào repo —
 * đó là chứng từ tài chính của đối tác. Nên mỗi bẫy được dựng lại thành một
 * file .xlsx sinh trong bộ nhớ, giữ đúng hình dạng đã gây lỗi.
 */
const assert = require("assert");
const ExcelJS = require("exceljs");
const N = require("../.test-build/naza-statement.js");

let pass = 0;
const t = async (name, fn) => { await fn(); pass++; console.log("  ✓", name); };

/** Dựng một file sao kê đúng hình dạng NAZA. `headerAt` mô phỏng việc dòng tiêu
 *  đề nằm ở r1/r3/r5 tuỳ kỳ. */
async function makeBook({ sheetNames, summaryRows, codRows, feeRows, headerAt = 1 }) {
    const wb = new ExcelJS.Workbook();
    const s = wb.addWorksheet(sheetNames[0]);
    summaryRows.forEach((r) => s.addRow(r));

    const c = wb.addWorksheet(sheetNames[1]);
    for (let i = 1; i < headerAt; i++) c.addRow(["COD结算清单"]);
    c.addRow(["收货日期", "原单号", "转单号", "产品名称", "国家名称", "COD金额"]);
    codRows.forEach((r) => c.addRow(r));

    const f = wb.addWorksheet(sheetNames[2]);
    f.addRow(["序号", "出货日期", "原单号", "转单号", "运输方式", "目的国家", "货物类型",
        "件数", "实重", "材积重", "中文品名", "计费重", "速递运费", "操作费"]);
    feeRows.forEach((r, i) => f.addRow([i + 1, r[0], r[1], r[2], r[3], "中国台湾", "包裹",
        1, r[4], r[4], "项链;", r[4], r[5], r[6]]));
    return Buffer.from(await wb.xlsx.writeBuffer());
}

const SUM_OK = [
    ["NAZA供应链"],
    ["本期回款金额", "Tổng cod thu về tuần này", 10000],
    ["台币汇总", "Tổng tiền Đài tệ (TWD)", 10000],
    ["汇率", "Tỷ giá", 0.2],
    ["台币折人民币", "Quy đổi", 2000],
    ["速递运费  RMB", "Phí vận chuyển (RMB)", -54],
    ["操作费RMB", "Phí thao tác", -6],
    ["本期应退金额RMB", "COD cần hoàn trả kỳ này", 1940],
    ["汇率", "Tỉ giá", 3860],
    ["本期采购费 VND", "Phí mua hàng VND", 1000000],
    ["本期应退金额VND", "COD cần hoàn", 6488400],
];
const COD_OK = [
    ["2026-08-25 10:58:27", "T1447", "17996795", "STWCOD专线-711", "中国台湾", 6000],
    ["2026-08-24 09:45:53", "T1417", "1870429923", "STWCOD专线-新竹", "中国台湾", 4000],
];
const FEE_OK = [
    ["2026-08-20 13:58:48", "T1447", "17996795", "STWCOD专线-711", 0.1, 27, 3],
    ["2026-08-20 13:58:48", "T1417", "1870429923", "STWCOD专线-新竹", 0.1, 32, 3],
];

(async () => {
    console.log("── Chuẩn hoá khoá ──");
    await t("mã vận đơn: bỏ số 0 ở đầu — '06722405704' và '6722405704' là MỘT đơn", () =>
        assert.strictEqual(N.normTracking("06722405704"), N.normTracking("6722405704")));
    await t("BẪY: mã có chữ thì GIỮ chữ — '73N17897055' không được cắt còn số", () =>
        assert.strictEqual(N.normTracking("73N17897055"), "73N17897055"));
    await t("hai mã 17TRACK khác nhau không được trùng khoá", () =>
        assert.notStrictEqual(N.normTracking("73N111"), N.normTracking("73P111")));
    await t("mã đơn: bỏ tiền tố TAIWAN-", () =>
        assert.strictEqual(N.normOrderId("TAIWAN-T1020"), "T1020"));
    await t("mã đơn: bỏ hậu tố -Z (转寄 = chuyển tiếp)", () =>
        assert.strictEqual(N.normOrderId("17916893-Z"), "17916893"));
    await t("mã đơn: bỏ hậu tố -1 (lần giao lại)", () =>
        assert.strictEqual(N.normOrderId("T1027-1"), "T1027"));
    await t("BẪY: mã kèm ngoặc 'T1467 (7564042426-z)' → chỉ lấy T1467", () =>
        assert.strictEqual(N.normOrderId("T1467 (7564042426-z)"), "T1467"));

    console.log("── Đọc số và ngày ──");
    await t("số dạng chuỗi có dấu phẩy", () => assert.strictEqual(N.toNumber("1,499"), 1499));
    await t("ô rỗng → null chứ không phải 0", () => assert.strictEqual(N.toNumber(""), null));
    await t("ngày ISO kèm giờ", () => assert.strictEqual(N.toIsoDate("2026-08-25 10:58:27"), "2026-08-25"));
    await t("ngày kiểu Việt Nam", () => assert.strictEqual(N.toIsoDate("25/08/2026"), "2026-08-25"));
    await t("ngày một chữ số được đệm 0", () => assert.strictEqual(N.toIsoDate("2/8/2026"), "2026-08-02"));

    console.log("── Bảng giá 3PL ──");
    await t("bảng giá đã được khai", () => assert.strictEqual(N.FEE_TABLE_DECLARED, true));
    await t("711 → cửa hàng tiện lợi 27 RMB", () =>
        assert.strictEqual(N.matchChannel("STWCOD专线-711").first_kg, 27));
    await t("全家 (FamilyMart) cũng là cửa hàng tiện lợi", () =>
        assert.strictEqual(N.matchChannel("STWCOD专线-全家").code, "cvs"));
    await t("新竹 (HCT) → giao tận nhà 32 RMB", () =>
        assert.strictEqual(N.matchChannel("STWCOD专线-新竹").first_kg, 32));
    await t("BẪY: kỳ cũ ghi tiếng Việt '7 ELEVEN' vẫn phải nhận ra", () =>
        assert.strictEqual(N.matchChannel("7 ELEVEN").code, "cvs"));
    await t("'GIAO TẠI NHÀ' → HCT", () =>
        assert.strictEqual(N.matchChannel("GIAO TẠI NHÀ").code, "hct"));
    await t("kênh lạ → null, KHÔNG đoán bừa", () =>
        assert.strictEqual(N.matchChannel("DHL EXPRESS"), null));
    await t("dưới 1kg tính đúng giá kg đầu", () =>
        assert.strictEqual(N.expectedShipFee(N.matchChannel("711"), 0.1), 27));
    await t("2kg = kg đầu + 1 kg tiếp × 15", () =>
        assert.strictEqual(N.expectedShipFee(N.matchChannel("711"), 2), 42));
    await t("không rõ kênh thì trả null chứ không tính bừa", () =>
        assert.strictEqual(N.expectedShipFee(null, 1), null));

    console.log("── Đọc file sao kê ──");
    await t("đọc đủ ba sheet, chi tiết cộng ra đúng sheet TỔNG", async () => {
        const st = await N.parseNazaStatement(
            await makeBook({ sheetNames: ["汇总 TỔNG", "COD账单 ĐỐI SOÁT COD", "速递运费RMB PHÍ VẬN CHUYỂN (RMB)"],
                summaryRows: SUM_OK, codRows: COD_OK, feeRows: FEE_OK }), "test.xlsx");
        assert.strictEqual(st.cod_lines.length, 2);
        assert.strictEqual(st.fee_lines.length, 2);
        assert.strictEqual(st.checks.cod_gap, 0);
        assert.strictEqual(st.checks.math_ok, true);
    });

    await t("BẪY: sheet phí phải được nhận TRƯỚC sheet COD, không thì nhận nhầm", async () => {
        const st = await N.parseNazaStatement(
            await makeBook({ sheetNames: ["汇总", "COD账单", "速递运费RMB"],
                summaryRows: SUM_OK, codRows: COD_OK, feeRows: FEE_OK }), "x.xlsx");
        assert.strictEqual(st.sheets.cod, "COD账单");
        assert.strictEqual(st.sheets.fee, "速递运费RMB");
    });

    await t("BẪY: tên sheet có dấu cách ở đầu (' ĐỐI SOÁT COD') vẫn nhận", async () => {
        const st = await N.parseNazaStatement(
            await makeBook({ sheetNames: ["TỔNG", " ĐỐI SOÁT COD", "PHÍ VẬN CHUYỂN"],
                summaryRows: SUM_OK, codRows: COD_OK, feeRows: FEE_OK }), "x.xlsx");
        assert.strictEqual(st.cod_lines.length, 2);
    });

    await t("BẪY: dòng tiêu đề nằm ở r5 chứ không phải r1", async () => {
        const st = await N.parseNazaStatement(
            await makeBook({ sheetNames: ["汇总 TỔNG", "COD账单", "速递运费RMB"],
                summaryRows: SUM_OK, codRows: COD_OK, feeRows: FEE_OK, headerAt: 5 }), "x.xlsx");
        assert.strictEqual(st.cod_lines.length, 2);
        assert.strictEqual(st.checks.cod_gap, 0);
    });

    await t("BẪY LỚN: kỳ gộp '速递运费 + 操作费' vào MỘT dòng — không được trừ hai lần", async () => {
        // Kỳ 24/07 thật: gộp hai phí thành 935. Dò riêng từng mã thì cùng con số
        // bị trừ hai lượt, ra −1.098,29 RMB trong khi file ghi −163,29 RMB.
        const sum = [
            ["NAZA供应链"],
            ["本期回款金额", "Tổng COD thu về", 10000],
            ["台币汇总", "Tổng TWD", 10000],
            ["汇率", "Tỉ giá", 0.2],
            ["台币折人民币", "TWD đổi RMB", 2000],
            // 27+32 phí ship, 3+3 phí thao tác = 65, gộp thành một dòng.
            ["速递运费 + 操作费  RMB", "PHÍ VẬN CHUYỂN + PHÍ THAO TÁC (RMB)", -65],
            ["本期应退金额RMB", "Số COD hoàn về", 1935],
        ];
        const st = await N.parseNazaStatement(
            await makeBook({ sheetNames: ["汇总 TOTAL", "COD账单", "速递运费RMB"],
                summaryRows: sum, codRows: COD_OK, feeRows: FEE_OK }), "gop.xlsx");
        assert.strictEqual(st.summary.fees_combined, true);
        assert.strictEqual(st.summary.op_fee_rmb, 0, "phí thao tác đã nằm trong dòng gộp");
        assert.strictEqual(st.checks.math_ok, true, "phép quyết toán phải khớp lại");
        assert.strictEqual(st.checks.ship_fee_detail_total, 65, "so tổng ship+op với con số gộp");
        assert.strictEqual(st.checks.ship_fee_summary_total, 65, "khớp đúng dòng gộp");
    });

    await t("BẪY: '汇率' xuất hiện hai lần — phân biệt TWD/RMB và RMB/VND bằng độ lớn", async () => {
        const st = await N.parseNazaStatement(
            await makeBook({ sheetNames: ["汇总 TỔNG", "COD账单", "速递运费RMB"],
                summaryRows: SUM_OK, codRows: COD_OK, feeRows: FEE_OK }), "x.xlsx");
        assert.strictEqual(st.summary.rate_twd_rmb, 0.2);
        assert.strictEqual(st.summary.rate_rmb_vnd, 3860);
    });

    await t("phí mua hàng được trừ thẳng vào tiền về, đọc đúng", async () => {
        const st = await N.parseNazaStatement(
            await makeBook({ sheetNames: ["汇总 TỔNG", "COD账单", "速递运费RMB"],
                summaryRows: SUM_OK, codRows: COD_OK, feeRows: FEE_OK }), "x.xlsx");
        assert.strictEqual(st.summary.purchase_vnd, 1000000);
    });

    console.log("── Soát phí với bảng giá ──");
    await t("phí đúng bảng giá → không báo lệch", async () => {
        const st = await N.parseNazaStatement(
            await makeBook({ sheetNames: ["汇总 TỔNG", "COD账单", "速递运费RMB"],
                summaryRows: SUM_OK, codRows: COD_OK, feeRows: FEE_OK }), "x.xlsx");
        assert.strictEqual(st.fee_audit.wrong, 0);
        assert.strictEqual(st.fee_audit.ok, 2);
        assert.strictEqual(st.fee_audit.overcharge_rmb, 0);
    });

    await t("thu 35 RMB cho đơn 711 0,1kg (đúng 27) → BÁO LỆCH +8", async () => {
        const bad = [["2026-08-20", "T9", "17996799", "STWCOD专线-711", 0.1, 35, 3]];
        const st = await N.parseNazaStatement(
            await makeBook({ sheetNames: ["汇总 TỔNG", "COD账单", "速递运费RMB"],
                summaryRows: SUM_OK, codRows: COD_OK, feeRows: bad }), "x.xlsx");
        assert.strictEqual(st.fee_audit.wrong, 1);
        assert.strictEqual(st.fee_audit.overcharge_rmb, 8);
        assert.strictEqual(st.fee_audit.lines[0].expected, 27);
        assert.strictEqual(st.fee_audit.lines[0].charged, 35);
    });

    await t("kênh lạ thì đếm riêng, KHÔNG kết luận là thu sai", async () => {
        const unk = [["2026-08-20", "T9", "17996799", "DHL EXPRESS", 0.1, 99, 3]];
        const st = await N.parseNazaStatement(
            await makeBook({ sheetNames: ["汇总 TỔNG", "COD账单", "速递运费RMB"],
                summaryRows: SUM_OK, codRows: COD_OK, feeRows: unk }), "x.xlsx");
        assert.strictEqual(st.fee_audit.unknown_channel, 1);
        assert.strictEqual(st.fee_audit.wrong, 0);
    });

    await t("chi tiết KHÔNG cộng ra tổng → cod_gap khác 0 để lộ ra ngay", async () => {
        const st = await N.parseNazaStatement(
            await makeBook({ sheetNames: ["汇总 TỔNG", "COD账单", "速递运费RMB"],
                summaryRows: SUM_OK, codRows: [COD_OK[0]], feeRows: FEE_OK }), "x.xlsx");
        assert.strictEqual(st.checks.cod_gap, -4000);
    });

    console.log(`\n${pass} phép thử — tất cả đạt.`);
})().catch((e) => { console.error("\n✗ HỎNG:", e.message); process.exit(1); });
