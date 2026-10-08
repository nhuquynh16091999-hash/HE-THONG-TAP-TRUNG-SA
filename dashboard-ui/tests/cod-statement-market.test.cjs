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

// Kỳ Sing CHƯA thu COD (thật: "ĐỐI SOÁT COD SINGAPORE 2026.09.24") — chỉ có sheet TỔNG + PHÍ.
const phiSg = (n) => Array.from({ length: n }, (_, i) => ({ market: "SG", channel: "S新加坡CODJT专线", tracking: "JT" + i,
    order_id: "O" + i, ship_fee: 28, op_fee: 3, first_leg_fee: 7 }));
t("màn Sing: kỳ chỉ có phí → nhận, phải nhận âm, đếm đơn bị tính phí", () => {
    const n = { ...naza([], { cod_twd: 0, rate_twd_rmb: 0.2021, payable_vnd: -3600206, purchase_sg_vnd: 1840046 }), fee_lines: phiSg(12) };
    const r = S.chonDongNaza(n, "SG", "ĐỐI SOÁT COD SINGAPORE 2026.09.24.xlsx");
    assert.strictEqual(r.rows.length, 0);
    assert.strictEqual(r.tong.phai_nhan_vnd, -3600206);
    assert.strictEqual(r.tong.don_phi, 12); assert.strictEqual(r.tong.phi_rmb, 456);
    assert.strictEqual(r.tong.tien_hang_vnd, 1840046);
    assert.strictEqual(r.tong.ty_gia_rmb, null, "tỷ giá 0,2021 là số Đài chép sang, không tin");
});
t("màn UAE: kỳ Sing chỉ có phí cũng bị chặn", () => {
    const n = { ...naza([]), fee_lines: phiSg(2) };
    assert.ok(/SINGAPORE/.test(S.chonDongNaza(n, "AE", "x.xlsx").loi));
});
// Mẫu Sing thật kỳ 05/10/2026: sheet TỔNG ghi 本期回款金额 bằng TỆ sau phí thu hộ, không phải SGD.
t("mẫu Sing: so tiền về (tệ) từng đơn với sheet TỔNG — khớp thì KHÔNG báo lệch", () => {
    const n = naza([["JT1", "SG", "", 69], ["JT2", "SG", "", 99]], { cod_twd: 849.85, payable_vnd: 5448788 });
    n.cod_lines[0].ve_rmb = 349.05; n.cod_lines[0].ty_gia_rmb = 5.2151;
    n.cod_lines[1].ve_rmb = 500.80; n.cod_lines[1].ty_gia_rmb = 5.2151;
    const r = S.chonDongNaza(n, "SG", "新加坡COD对账单 2026.10.05.xlsx");
    assert.deepStrictEqual(r.canh_bao, []);
    assert.strictEqual(r.tong.cod_local, 168); assert.strictEqual(r.tong.ty_gia_rmb, 5.2151);
});
t("mẫu Sing: tiền về lệch sheet TỔNG → cảnh báo bằng tệ", () => {
    const n = naza([["JT1", "SG", "", 69]], { cod_twd: 400 });
    n.cod_lines[0].ve_rmb = 349.05;
    assert.ok(/349,05¥.*400¥/.test(S.chonDongNaza(n, "SG", "新加坡COD对账单.xlsx").canh_bao[0]));
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
t("hai file NAZA cùng ngày → cùng kỳ (kỳ chỉ có phí không có đơn để so trùng)", () => {
    const a = { ...ky("a", "ĐỐI SOÁT COD SINGAPORE 2026.09.24.xlsx", []), kieu: "naza", ngay: "2026-09-24" };
    const b = { ...ky("b", "SINGAPORE 2026.09.24 (sửa).xlsx", []), kieu: "naza", ngay: "2026-09-24" };
    const c = { ...ky("c", "新加坡COD对账单 2026.10.05.xlsx", ["JT1"]), kieu: "naza", ngay: "2026-10-05" };
    assert.deepStrictEqual(S.thayKyCu([a, c], b).list.map((x) => x.id), ["c", "b"]);
    // Bảng đối tác khác cùng ngày thì GIỮ cả hai — chưa biết họ gửi mấy file một ngày.
    const d = { ...ky("d", "cod 1.csv", ["X1"]), ngay: "2026-10-05" }, e = { ...ky("e", "cod 2.csv", ["X2"]), ngay: "2026-10-05" };
    assert.deepStrictEqual(S.thayKyCu([d], e).list.map((x) => x.id), ["d", "e"]);
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
t("kỳ âm KHÔNG cộng vào đã gửi về; gộp vào kỳ Đài cùng ngày thì ghi rõ", () => {
    const am = { ...ky("am", "SING 24.09.xlsx", []), kieu: "naza", ngay: "2026-09-24", naza: { phai_nhan_vnd: -3600206, don_phi: 12, phi_rmb: 456 } };
    const duong = { ...KHO[0], kieu: "naza", ngay: "2026-10-05", naza: { phai_nhan_vnd: 5448788 } };
    const k = S.khopSaoKeNuoc(DON, [am, duong], 20000, ["2026-09-24"]);
    assert.strictEqual(k.da_gui_ve.vnd, 5448788);
    assert.strictEqual(k.da_gui_ve.ky_am, 1); assert.strictEqual(k.da_gui_ve.am_vnd, -3600206);
    const kyAm = k.ky.find((x) => x.id === "am");
    assert.strictEqual(kyAm.tinh_vao_da_gui, false); assert.strictEqual(kyAm.tru_vao_dai, "2026-09-24");
    assert.strictEqual(kyAm.uoc_vnd, null);
    assert.strictEqual(S.khopSaoKeNuoc(DON, [am], 20000).ky[0].tru_vao_dai, null);
});
t("tên kho riêng từng nước", () => {
    assert.strictEqual(S.tenKhoSaoKe("SG"), "cod_statements_sg");
    assert.strictEqual(S.tenKhoSaoKe("AE"), "cod_statements_ae");
});

console.log("── Sổ một nước, giống màn Đài (số thật Sing 24/09 + 05/10/2026) ──");
const N = require("../.test-build/cod-so-nuoc.js");
// Kỳ 05/10 thật: 631 S$ × 5,2151 = 3.290,73¥ → về 3.192,01¥ (thu hộ 3%) − ship 1.317,6 − hàng hoàn 9 = 1.865,41¥
// × 3.860 − tiền hàng 1.751.680 = 5.448.788đ.
const ky05 = {
    id: "k05", filename: "新加坡COD对账单 2026.10.05.xlsx", uploaded_at: "2026-10-08T07:00:00Z", kieu: "naza", ngay: "2026-10-05", canh_bao: [],
    rows: [{ tracking: "JT1", order_id: "O1", amount: 631, fee: 0, paid_date: "2026-09-18", status: "paid" }],
    naza: {
        cod_local: 631, ty_gia_rmb: 5.2151, ty_gia_vnd: 3860, phi_rmb: 1317.6, don_phi: 36, tien_hang_vnd: 1751680, phai_nhan_vnd: 5448788.15202,
        sheets: {}, quy_te_rmb: 3290.73, ve_rmb: 3192.01,
        tong_dong: [
            { zh: "本期回款金额", vi: "Tổng cod thu về", so: 3192.006257 },
            { zh: "速递运费  RMB", vi: "Phí vận chuyển (RMB)", so: -1317.6 },
            { zh: "退仓上架 RMB", vi: "Phí hàng hoàn về kho lên kệ ", so: -9 },
            { zh: "本期应退金额RMB", vi: "COD cần hoàn trả kỳ này (RMB )", so: 1865.406257 },
            { zh: "汇率", vi: "Tỷ giá", so: 3860 },
            { zh: "新加坡本期采购费 VND", vi: "Phí mua hàng Singapore (VND)", so: 1751680 },
            { zh: "本期应退金额 VND", vi: "COD cần hoàn trả kỳ này (VND)", so: 5448788.15202 },
        ],
        thu_ho: [{ tracking: "JT1", cod_rmb: 3290.73, phi_rmb: 98.72 }],
        phi_dong: Array.from({ length: 36 }, (_, i) => ({ tracking: "JTF" + i, order_id: "F" + i, kg: 0.2, ship: 28, first_leg: 5.6, op: 3 })),
        trung_phi: [],
    },
};
const ky24 = {
    id: "k24", filename: "ĐỐI SOÁT COD SINGAPORE 2026.09.24.xlsx", uploaded_at: "2026-10-08T07:00:00Z", kieu: "naza", ngay: "2026-09-24", canh_bao: [], rows: [],
    naza: {
        cod_local: 0, ty_gia_rmb: null, ty_gia_vnd: 3860, phi_rmb: 456, don_phi: 12, tien_hang_vnd: 1840046, phai_nhan_vnd: -3600206,
        sheets: {}, quy_te_rmb: 0, ve_rmb: 0, thu_ho: [],
        tong_dong: [
            { zh: "本期回款金额", vi: "Tổng cod thu về", so: 0 }, { zh: "汇率", vi: "Tỷ giá", so: 0.2021 },
            { zh: "速递运费  RMB", vi: "Phí vận chuyển (RMB)", so: -456 }, { zh: "本期应退金额RMB", vi: "", so: -456 },
            { zh: "汇率", vi: "Tỷ giá", so: 3860 }, { zh: "新加坡本期采购费 VND", vi: "Phí mua hàng Singapore  (VND)", so: 1840046 },
            { zh: "本期应退金额 VND", vi: "", so: -3600206 },
        ],
        phi_dong: Array.from({ length: 12 }, (_, i) => ({ tracking: "JTG" + i, order_id: "G" + i, kg: 0.2, ship: 28, first_leg: 7, op: 3 })),
        trung_phi: [],
    },
};
t("luồng tiền kỳ 05/10: S$ → ¥ (− thu hộ − ship − hàng hoàn) → đ (− tiền hàng) = phải nhận", () => {
    const l = N.luongKy(ky05);
    assert.deepStrictEqual(l.tru_rmb.map((x) => [x.nhan, x.so]), [["Phí thu hộ COD", 98.72], ["Phí vận chuyển", 1317.6], ["Phí hàng hoàn về kho lên kệ", 9]]);
    assert.strictEqual(l.rmb_rong, 1865.406257);
    assert.deepStrictEqual(l.tru_vnd.map((x) => x.so), [1751680]);
    assert.strictEqual(l.chenh_vnd, 0);
});
t("luồng tiền kỳ chỉ có phí 24/09: không lấy tỷ giá 0,2021 làm khoản trừ, ra đúng âm 3.600.206đ", () => {
    const l = N.luongKy(ky24);
    assert.deepStrictEqual(l.tru_rmb.map((x) => x.so), [456]);
    assert.strictEqual(Math.round(l.vnd - l.tru_vnd[0].so), -3600206);
});
const B = { last_leg: { first_2kg: 28, extra_per_kg: 6 }, first_leg_per_100g: { thuong: 2.8, dac_thu: 3.5 }, single_parcel_fee: 3, cod_fee: { pct: 0.04, min: 8 } };
t("phí đúng bảng giá Sing: 0,2 kg = 28 + 2×2,8 + 3 = 36,6¥", () => {
    assert.strictEqual(N.soatPhiDong({ tracking: "a", order_id: "a", kg: 0.2, ship: 28, first_leg: 5.6, op: 3 }, B), null);
});
t("chặng đầu 7¥ cho 0,2 kg (kỳ 24/09) → sai bảng, dư 1,4¥, ghi rõ bằng giá hàng đặc thù", () => {
    const f = N.soatPhiDong({ tracking: "a", order_id: "a", kg: 0.2, ship: 28, first_leg: 7, op: 3 }, B);
    assert.strictEqual(f.chenh, 1.4); assert.ok(/đặc thù/.test(f.ly_do));
});
t("chặng cuối quá 2 kg tính thêm theo kg", () => {
    assert.strictEqual(N.soatPhiDong({ tracking: "a", order_id: "a", kg: 2.3, ship: 34, first_leg: 64.4, op: 3 }, B), null);
});
const S2 = require("../.test-build/cod-statement-market.js");
const DON2 = [
    { order_id: "O1", tracking: "JT1", order_date: "2026-09-15", trang_thai: "", nhom: "da_giao", cod_local: 631, khach: "" },
    { order_id: "O9", tracking: "JT9", order_date: "2026-09-20", trang_thai: "", nhom: "da_giao", cod_local: 69, khach: "" },
];
const so = (actions = { bank: {}, done: {} }, asOf = "2026-10-08") => {
    const k = S2.khopSaoKeNuoc(DON2, [ky05, ky24], 20000, ["2026-09-24"]);
    return N.soCodNuoc({ code: "SG", currency: "SGD", symbol: "S$", rateVnd: 20000, don: DON2, kho: [ky05, ky24], k, actions, asOf });
};
t("bảng các kỳ: 05/10 chờ nhập tiền về; 24/09 âm, đã trừ vào kỳ Đài", () => {
    const x = so();
    assert.deepStrictEqual(x.ky.map((k) => k.trang_thai), ["cho_nhap", "am"]);
    assert.strictEqual(x.ky[1].trang_thai_chu, "Âm · đã trừ ở Đài");
    assert.strictEqual(x.ky[1].tru_vao_dai, "2026-09-24");
    assert.strictEqual(x.tong_quan.ky_cho_nhap, 1);
});
t("việc hôm nay: nhập tiền về kỳ 05/10 + hỏi phí 12 đơn kỳ 24/09 thu cao hơn bảng", () => {
    const x = so();
    assert.deepStrictEqual(x.viec.map((v) => v.id).sort(), ["bank", "phi-sai"]);
    assert.strictEqual(x.viec.find((v) => v.id === "phi-sai").so, 12);
});
t("nhập tiền về khớp trong 50.000đ → kỳ xong; đã hỏi phí → hết việc", () => {
    const x = so({ bank: { [ky05.filename.toLowerCase()]: { thuc_nhan_vnd: 5448000, ngay_ve: "2026-10-07", luc: "" } },
        done: { "phi:JTG0": { viec: "da_hoi", ngay: "2026-10-08", lan: 1 } } });
    assert.strictEqual(x.ky[0].trang_thai, "khop");
    assert.deepStrictEqual(x.viec.map((v) => v.id), ["phi-sai"], "đã hỏi đơn đầu nhưng còn 11 đơn khác");
});
t("việc nhóm mang đủ khoá — một lần bấm ghi cả 12 đơn phí sai", () => {
    const v = so().viec.find((x) => x.id === "phi-sai");
    assert.strictEqual(v.done_keys.length, 12);
    const done = Object.fromEntries(v.done_keys.map((k) => [k, { viec: "da_hoi", ngay: "2026-10-08", lan: 1 }]));
    assert.ok(!so({ bank: {}, done }).viec.some((x) => x.id === "phi-sai"));
});
t("máy soát kỳ mới nhất: phép tính tự khớp, chi tiết khớp TỔNG, phí đúng bảng, thu hộ 3% dưới bảng 4%", () => {
    const c = Object.fromEntries(so().checks.map((x) => [x.ten, x.ok]));
    assert.strictEqual(c["Phép tính trong file"], true);
    assert.strictEqual(c["Chi tiết cộng ra đúng số tổng"], true);
    assert.strictEqual(c["Phí giao hàng đúng bảng giá"], true);
    assert.strictEqual(c["Phí thu hộ đúng bảng giá"], true);
});
t("còn phải gửi đi đúng luồng NAZA: COD × 5,2151 × (1 − 3%) − phí chưa trừ, × 3.860", () => {
    const x = so();
    const u = x.tien_ve.con_lai_da_giao;
    assert.strictEqual(x.tien_ve.cach_uoc, "naza");
    assert.strictEqual(u.so_don, 1); assert.strictEqual(u.don_chua_tru_phi, 1);
    const phiTb = (36 * 36.6 + 12 * 38) / 48;
    assert.ok(Math.abs(u.vnd_uoc - Math.round((69 * 5.2151 * (1 - 98.72 / 3290.73) - phiTb) * 3860)) <= 1);
});
t("quá 7 ngày + 1 ngày ân hạn không có kỳ mới → nhắc tải sao kê", () => {
    assert.ok(so(undefined, "2026-10-14").viec.some((v) => v.id === "thieu-sao-ke"));
    assert.ok(!so(undefined, "2026-10-13").viec.some((v) => v.id === "thieu-sao-ke"));
});

console.log(`\n${pass} phép thử đạt`);
