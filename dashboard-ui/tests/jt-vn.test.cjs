/**
 * Đối soát COD Việt Nam — J&T VIP (13/11/2026). Số lấy từ các kỳ thật của mã KH 238LC41894.
 */
const assert = require("assert");
const J = require("../.test-build/jt-vn.js");

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log("  ✓", name); };
const kyRaw = (ma, cod, phi, mo, ds, cuoi, tra, payTime) => ({
    reconciliationNumber: ma, totalCodFee: cod, totalMonthFee: phi, monthAdjustmentAmount: 0,
    openingBalance: mo, payCurrentPayableAmount: ds, endingBalance: cuoi,
    totalPayStatus: tra ? "FINISH_PAY" : "UN_PAY", payTime: payTime || "", createTime: ma.slice(11, 15) + "-" + ma.slice(15, 17) + "-" + ma.slice(17, 19) + " 04:03:00",
});

console.log("── Đối soát COD Việt Nam (J&T VIP) ──");
t("hạn token đọc từ exp của JWT", () => {
    const b = (o) => Buffer.from(JSON.stringify(o)).toString("base64").replace(/=+$/, "");
    assert.strictEqual(J.hanToken(`${b({ alg: "HS256" })}.${b({ exp: 1794554848 })}.chuky`), "2026-11-13T07:27:28.000Z");
    assert.strictEqual(J.hanToken("khong-phai-jwt"), null);
});
t("làm sạch token dán kèm nháy / 'authToken:'", () => {
    assert.strictEqual(J.lamSachToken(' "a.b.c" '), "a.b.c");
    assert.strictEqual(J.lamSachToken("authToken: a.b.c"), "a.b.c");
});
t("mã đơn KH J&T → số đơn POS", () => {
    assert.strictEqual(J.orderIdTuMaKh("S1329125435O159"), "159");
    assert.strictEqual(J.orderIdTuMaKh("S13291254350871U1"), null);
    assert.strictEqual(J.orderIdTuMaKh(""), null);
});
t("trạng thái tiếng Trung → tiếng Việt", () => {
    assert.strictEqual(J.trangThaiJt("退件确认"), "Đã xác nhận hoàn");
    assert.strictEqual(J.trangThaiJt("运输中"), "Đang vận chuyển");
    assert.strictEqual(J.trangThaiJt("lạ"), "lạ");
});

// 4 kỳ thật 09/11 → 12/11 (thực nhận âm mang sang kỳ sau).
const ky = [
    kyRaw("238LC41894-20261109-1109", 200000, 464000, 0, -264000, -264000, true, "2026-11-12 15:37:47"),
    kyRaw("238LC41894-20261110-1110", 378000, 432000, -264000, -54000, -318000, true, "2026-11-12 15:37:47"),
    kyRaw("238LC41894-20261111-1111", 1277000, 320000, -318000, 957000, 639000, true, "2026-11-12 15:37:47"),
    kyRaw("238LC41894-20261112-1112", 0, 576000, 0, -576000, -576000, false),
].map(J.chuanKy);
const donKy = (vd, ma, cod, cuoc, ky) => J.chuanDonKy({
    waybillNo: vd, customerOrderId: ma, codAmount: cod, monthTaxAmount: cuoc, monthCodAmount: 0,
    monthRefundAmount: 0, monthPartialSignFee: 0, adjustmentAmount: 0, difference: cod - cuoc,
    signTime: cod ? "2026-11-10 15:00:00" : null, sendTime: "2026-11-09 17:00:00", recipientProv: "Sơn La", recipientCity: "Mộc Châu",
});
ky[2].don = [donKy("802855752889", "S1329125435O22", 200000, 0), donKy("802861238137", "S1329125435O159", 0, 16000),
    donKy("802800000001", "S1329125435O30", 99000, 16000), donKy("802899999999", "", 50000, 16000)];
ky[3].don = [donKy("802861315162", "S1329125435O176", 0, 16000)];
const du = {
    keo_luc: "2026-11-13T01:00:00Z", so_du: -576000, so_du_cap_nhat: "2026-11-13 00:11:45",
    dang_chay_tong: { so_don: 71, cod: 7334000, cuoc: 1136000 },
    ky, dang_chay: [J.chuanDangChay({ waybillNo: "802877777777", customerOrderId: "S1329125435O53", waybillStatusCode: "退件确认", codMoney: 80000, taxAfterFee: 16000 })],
};
const pos = [
    { order_id: "22", tracking: "802855752889", order_date: "2026-11-03", trang_thai: "Đã giao", nhom: "da_giao", cod: 200000, khach: "A" },
    { order_id: "30", tracking: "802800000001", order_date: "2026-11-05", trang_thai: "Đã giao", nhom: "da_giao", cod: 149000, khach: "B" },
    { order_id: "53", tracking: "802877777777", order_date: "2026-11-04", trang_thai: "Đang hoàn", nhom: "khong_tinh", cod: 80000, khach: "C" },
    { order_id: "60", tracking: "802866666666", order_date: "2026-11-08", trang_thai: "Đã giao", nhom: "da_giao", cod: 99000, khach: "D" },
    { order_id: "61", tracking: "802877777778", order_date: "2026-11-08", trang_thai: "Đã giao", nhom: "da_giao", cod: 49000, khach: "E" },
];
du.dang_chay.push(J.chuanDangChay({ waybillNo: "802877777778", customerOrderId: "S1329125435O61", waybillStatusCode: "派件中", codMoney: 49000, taxAfterFee: 16000 }));
const s = J.soJtVn(du, pos);

t("đã chuyển về = Σ thực nhận dương của kỳ đã trả (kỳ âm không cộng)", () => {
    assert.strictEqual(s.tong.da_ve, 639000);
    assert.strictEqual(s.tong.so_ky_da_tra, 3);
    assert.strictEqual(s.tong.so_lan_chuyen, 1);
    assert.strictEqual(s.tong.lan_tra_cuoi, "2026-11-12 15:37:47");
});
t("kỳ chưa trả âm → chờ trả 0, số dư âm giữ nguyên", () => {
    assert.strictEqual(s.tong.cho_tra, 0);
    assert.strictEqual(s.tong.so_ky_cho_tra, 1);
    assert.strictEqual(s.tong.so_du, -576000);
});
t("kỳ xếp mới nhất trước, có số đơn", () => {
    assert.strictEqual(s.ky[0].ma, "238LC41894-20261112-1112");
    assert.strictEqual(s.ky[1].so_don, 4);
    assert.strictEqual(s.ky[3].so_don, null);
});
t("ngày kỳ đọc từ mã kỳ (kỳ gộp 06→08/11, kỳ vắt năm)", () => {
    assert.deepStrictEqual(J.ngayKy({ ma: "238LC41894-20261106-1108", tao_luc: "2026-11-09 04:04:25" }), { ngay: "2026-11-06", den: "2026-11-08" });
    assert.deepStrictEqual(J.ngayKy({ ma: "238LC41894-20261230-0102", tao_luc: "" }), { ngay: "2026-12-30", den: "2027-01-02" });
    assert.strictEqual(s.ky[0].ngay, "2026-11-12");
});
t("đang luân chuyển lấy tổng của J&T", () => assert.deepStrictEqual(s.tong.dang_chay, { so_don: 71, cod: 7334000, cuoc: 1136000 }));
t("cước trung bình chỉ tính đơn có cước", () => {
    assert.strictEqual(s.tong.don_co_cuoc, 4);
    assert.strictEqual(s.tong.cuoc_tb, 16000);
});
t("lệch COD: đơn #30 POS 149k, J&T trả 99k", () => {
    assert.strictEqual(s.doi_chieu.lech_cod.length, 1);
    assert.strictEqual(s.doi_chieu.lech_cod[0].order_id, "30");
    assert.strictEqual(s.doi_chieu.lech_cod[0].cod_jt, 99000);
});
t("đã giao chưa vào kỳ: chỉ #60 (#61 còn đang luân chuyển, #22 đã vào kỳ)", () => {
    assert.deepStrictEqual(s.doi_chieu.da_giao_chua_doi_soat.map((x) => x.order_id), ["60"]);
});
t("vận đơn J&T không ra đơn POS (đơn #159, #176 và đơn không mã)", () => {
    assert.deepStrictEqual(s.doi_chieu.khong_co_tren_pos.map((x) => x.van_don).sort(),
        ["802861238137", "802861315162", "802899999999"]);
});

console.log(`\n${pass} phép thử đối soát J&T Việt Nam đều qua.`);
