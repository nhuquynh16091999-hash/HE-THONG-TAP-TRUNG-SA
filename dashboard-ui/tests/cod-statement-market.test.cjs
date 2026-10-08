/**
 * Sao kê COD Singapore / UAE — bước 2 (08/10/2026): đọc file, chọn đúng dòng của nước,
 * thay kỳ cũ, khớp với đơn. Chỗ sai là mất tiền thật: đọc nhầm cột phí thành tiền COD,
 * hay để file Đài lọt vào sổ Sing, là số "đã gửi về" sai hẳn.
 */
const assert = require("assert");
const S = require("../.test-build/cod-statement-market.js");

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log("  ✓", name); };

console.log("── Dò cột ──");
t("tiếng Anh: AWB · Order Ref · COD Amount · COD Fee · Delivered Date", () => {
    const c = S.timCotSaoKe(["AWB No.", "Order Ref", "COD Amount", "COD Fee", "Delivered Date"]);
    assert.deepStrictEqual(c, { tracking: 0, order_id: 1, amount: 2, fee: 3, paid_date: 4 });
});
t("tiếng Việt có dấu: Mã vận đơn · Mã đơn · Số tiền thu hộ", () => {
    const c = S.timCotSaoKe(["STT", "Mã vận đơn", "Mã đơn", "Số tiền thu hộ", "Phí"]);
    assert.strictEqual(c.tracking, 1); assert.strictEqual(c.order_id, 2);
    assert.strictEqual(c.amount, 3); assert.strictEqual(c.fee, 4);
});
t("NAZA hai thứ tiếng trong một ô: 转单号 Mã vận đơn · COD金额", () => {
    const c = S.timCotSaoKe(["收货日期 Ngày xuất kho", "原单号 Mã đơn hệ thống", "转单号 Mã vận đơn", "COD金额"]);
    assert.strictEqual(c.tracking, 2); assert.strictEqual(c.order_id, 1); assert.strictEqual(c.amount, 3);
});
t("cột 'COD Fee' đứng trước KHÔNG bị nhận là tiền COD", () => {
    const c = S.timCotSaoKe(["Tracking", "COD Fee", "Collected (SGD)"]);
    assert.strictEqual(c.amount, 2); assert.strictEqual(c.fee, 1);
});

console.log("── Đọc bảng ──");
t("tiêu đề nằm dưới dòng tên công ty, bỏ dòng Tổng, ngày về ISO", () => {
    const d = S.docBangSaoKe([
        ["D&T Fulfillment — COD remittance"], [],
        ["AWB", "Order No", "COD Amount"],
        ["AE001", "A1", "120.50"],
        ["AE002", "A2", "1,099"],
        ["Total", "", "1219.5"],
    ]);
    assert.strictEqual(d.rows.length, 2);
    assert.strictEqual(d.rows[1].amount, 1099);
});
t("CSV chấm phẩy kiểu châu Âu", () => {
    const d = S.docCsvSaoKe("Tracking;COD\nJT1;45,90\nJT2;12\n");
    assert.deepStrictEqual(d.rows.map((r) => r.amount), [45.9, 12]);
});
t("số tiền: phẩy thập phân '45,90' · ngăn nghìn '1,399' · kiểu Anh '1,234.50' · ngoặc âm", () => {
    assert.strictEqual(S.soTienSaoKe("45,90"), 45.9);
    assert.strictEqual(S.soTienSaoKe("SGD 7,5"), 7.5);
    assert.strictEqual(S.soTienSaoKe("1,399"), 1399);
    assert.strictEqual(S.soTienSaoKe("1,234.50"), 1234.5);
    assert.strictEqual(S.soTienSaoKe("(12,50)"), -12.5);
});
t("không có cột tiền → không nhận bảng", () => {
    assert.strictEqual(S.docBangSaoKe([["Tracking", "Name"], ["JT1", "A"]]), null);
});
t("nhiều sheet → lấy sheet nhiều dòng nhất", () => {
    const b = S.chonSheetSaoKe([
        { name: "Summary", rows: [["Tracking", "COD"], ["Total", "100"]] },
        { name: "Detail", rows: [["Tracking", "COD"], ["JT1", "60"], ["JT2", "40"]] },
    ]);
    assert.strictEqual(b.sheet, "Detail"); assert.strictEqual(b.rows.length, 2);
});

console.log("── Sao kê NAZA tải ở màn nước khác ──");
const naza = (lines, summary = {}) => ({
    cod_lines: lines.map(([tracking, market, channel, cod]) => ({
        recv_date: "2026-10-03", order_id: "O-" + tracking, tracking, channel, cod_twd: cod, market,
    })),
    summary: { cod_twd: null, rate_twd_rmb: null, rate_rmb_vnd: null, ship_fee_rmb: null, op_fee_rmb: null, payable_vnd: null, ...summary },
    sheets: { summary: "TỔNG", cod: "COD", fee: null },
});
t("màn Sing: file Sing riêng → lấy hết, kèm số phải nhận", () => {
    const r = S.chonDongNaza(naza([["JT1", "SG", "S新加坡CODJT专线", 50]], { cod_twd: 50, payable_vnd: 900000 }), "SG", "新加坡COD对账单 2026.10.05.xlsx");
    assert.strictEqual(r.rows.length, 1); assert.strictEqual(r.tong.phai_nhan_vnd, 900000);
});
t("màn Sing: file gộp → chỉ dòng Sing, KHÔNG lấy số phải nhận của cả file", () => {
    const r = S.chonDongNaza(naza([["JT1", "SG", "S新加坡CODJT专线", 50], ["1870", "TW", "STWCOD专线-711", 1399]],
        { payable_vnd: 28000000 }), "SG", "ĐỐI SOÁT COD 2026.09.24.xlsx");
    assert.strictEqual(r.rows.length, 1); assert.strictEqual(r.bo_qua, 1);
    assert.strictEqual(r.tong.phai_nhan_vnd, null);
});
t("màn Sing: file Đài → báo bấm nút Đài Loan", () => {
    const r = S.chonDongNaza(naza([["1870", "TW", "STWCOD专线-711", 1399]]), "SG", "台湾COD对账单 2026.10.05.xlsx");
    assert.ok(/ĐÀI LOAN/.test(r.loi));
});
t("màn Sing: file tên SING mà dòng không ghi nước → tin tên file", () => {
    const r = S.chonDongNaza(naza([["JT1", "TW", "", 50]]), "SG", "ĐỐI SOÁT COD SING 2026.10.05.xlsx");
    assert.strictEqual(r.rows.length, 1);
});
t("màn UAE: file Sing / file Đài đều bị chặn", () => {
    assert.ok(/SINGAPORE/.test(S.chonDongNaza(naza([["JT1", "SG", "S新加坡CODJT专线", 50]]), "AE", "x.xlsx").loi));
    assert.ok(/ĐÀI LOAN/.test(S.chonDongNaza(naza([["1870", "TW", "STWCOD专线-711", 1399]]), "AE", "x.xlsx").loi));
});

console.log("── Thay kỳ cũ ──");
const ky = (id, filename, trks) => ({
    id, filename, uploaded_at: "2026-10-08T00:00:00Z", kieu: "bang", ngay: null, canh_bao: [],
    rows: trks.map((x) => ({ tracking: x, order_id: "", amount: 10, fee: 0, paid_date: "", status: "" })),
});
t("cùng tên file (khác dạng Unicode NFC/NFD) → thay", () => {
    const r = S.thayKyCu([ky("a", "SOÁT 05.10.xlsx".normalize("NFD"), ["JT1"])], ky("b", "SOÁT 05.10.xlsx", ["JT9"]));
    assert.deepStrictEqual(r.list.map((x) => x.id), ["b"]); assert.strictEqual(r.thay.length, 1);
});
t("đổi tên nhưng trùng ≥ nửa số đơn → bản sửa, thay", () => {
    const r = S.thayKyCu([ky("a", "k1.xlsx", ["JT1", "JT2", "JT3"])], ky("b", "k1 sua.xlsx", ["JT1", "JT2", "JT4"]));
    assert.deepStrictEqual(r.list.map((x) => x.id), ["b"]);
});
t("kỳ khác (không trùng đơn) → giữ cả hai", () => {
    const r = S.thayKyCu([ky("a", "k1.xlsx", ["JT1", "JT2"])], ky("b", "k2.xlsx", ["JT3", "JT4"]));
    assert.deepStrictEqual(r.list.map((x) => x.id), ["a", "b"]); assert.strictEqual(r.thay.length, 0);
});
t("ngày kỳ: theo tên file, không có thì ngày trả muộn nhất", () => {
    const ten = (f) => (/(\d{4})\.(\d{2})\.(\d{2})/.exec(f) || []).slice(1).join("-") || null;
    assert.strictEqual(S.ngayKy("COD 2026.10.05.xlsx", [], ten), "2026-10-05");
    assert.strictEqual(S.ngayKy("cod.csv", [{ paid_date: "2026-10-01" }, { paid_date: "2026-10-03" }, { paid_date: "x" }], ten), "2026-10-03");
});

console.log("── Khớp với đơn ──");
const don = (order_id, tracking, nhom, cod) => ({ order_id, tracking, order_date: "2026-09-25", trang_thai: "", nhom, cod_local: cod, khach: "" });
const dong = (tracking, amount) => ({ tracking, order_id: "", amount, fee: 0, paid_date: "2026-10-03", status: "" });
const DON = [don("A", "JT1", "da_giao", 50), don("B", "JT2", "da_giao", 30), don("C", "JT3", "chua_giao", 20), don("E", "JT5", "da_giao", 10)];
const KHO = [
    { ...ky("k1", "k1.xlsx", []), rows: [dong("JT1", 50), dong("JT3", 20), dong("JT9", 15)] },
    { ...ky("k2", "k2.xlsx", []), rows: [dong("JT2", 25), dong("JT1", 50)] },
];
const K = S.khopSaoKeNuoc(DON, KHO, 20000);
t("đơn có trên sao kê → đã trả; đơn chưa thấy → còn phải gửi", () => {
    assert.strictEqual(K.da_tra.so_don, 3);
    assert.deepStrictEqual(K.don.filter((d) => d.nhom === "da_giao" && !d.da_tra).map((d) => d.order_id), ["E"]);
});
t("bảng mình ghi 'chưa giao' mà đối tác đã trả → vẫn tính đã trả", () => {
    assert.ok(K.don.find((d) => d.order_id === "C").da_tra);
});
t("trả lệch · trả cho đơn mình không có · trả hai lần", () => {
    assert.deepStrictEqual(K.lech.map((x) => [x.order_id, x.cod_don, x.tra]), [["B", 30, 25]]);
    assert.deepStrictEqual(K.khong_co_don.map((x) => x.tracking), ["JT9"]);
    assert.deepStrictEqual(K.tra_hai_lan.map((x) => x.order_id), ["A"]);
});
t("đã gửi về: không có số phải nhận → ước theo tỷ giá, đánh dấu ước", () => {
    assert.strictEqual(K.da_gui_ve.cod_local, 160);
    assert.strictEqual(K.da_gui_ve.vnd, 160 * 20000);
    assert.strictEqual(K.da_gui_ve.co_uoc, true);
});
t("kỳ có số phải nhận (NAZA) → dùng đúng số đó, không ước", () => {
    const k = S.khopSaoKeNuoc(DON, [{ ...KHO[0], naza: { phai_nhan_vnd: 1234567 } }], 20000);
    assert.strictEqual(k.da_gui_ve.vnd, 1234567); assert.strictEqual(k.da_gui_ve.co_uoc, false);
});
t("tên kho riêng từng nước", () => {
    assert.strictEqual(S.tenKhoSaoKe("SG"), "cod_statements_sg");
    assert.strictEqual(S.tenKhoSaoKe("AE"), "cod_statements_ae");
});

console.log(`\n${pass} phép thử đạt`);
