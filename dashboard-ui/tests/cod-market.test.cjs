/**
 * Đối soát COD thị trường ngoài Đài (Singapore, UAE) — bước 1: tiền còn ở đâu.
 * Chỗ sai là mất tiền thật: đếm đơn hoàn vào "còn phải gửi" là hứa tiền không bao giờ về.
 */
const assert = require("assert");
const C = require("../.test-build/cod-market.js");

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log("  ✓", name); };
const don = (o = {}) => ({ order_id: "S1", tracking: "JT1", order_date: "2026-09-20", trang_thai: "Đang vận chuyển",
    nhom: "chua_giao", cod_local: 69, khach: "Joy", ...o });

console.log("── Phân nhóm theo trạng thái vận đơn (bảng đối tác + 17TRACK) ──");
t("đã giao → tiền đang ở bên giao hàng", () => {
    assert.deepStrictEqual(C.nhomTheoVanDon("Delivered"), { nhom: "da_giao" });
});
t("hoàn / đang hoàn / huỷ / tiêu huỷ → không tính", () => {
    assert.deepStrictEqual(C.nhomTheoVanDon("Returned"), { nhom: "khong_tinh", ly_do: "hoan" });
    assert.deepStrictEqual(C.nhomTheoVanDon("Exception", "Exception_Returning"), { nhom: "khong_tinh", ly_do: "hoan" });
    assert.deepStrictEqual(C.nhomTheoVanDon("Cancelled"), { nhom: "khong_tinh", ly_do: "huy" });
    assert.deepStrictEqual(C.nhomTheoVanDon("Destroyed"), { nhom: "khong_tinh", ly_do: "tieu_huy" });
});
t("đang đi, giao hỏng còn cứu được, chưa rõ → chưa giao", () => {
    for (const st of ["InTransit", "InfoReceived", "OutForDelivery", "DeliveryFailure", null]) {
        assert.strictEqual(C.nhomTheoVanDon(st).nhom, "chua_giao", String(st));
    }
    assert.strictEqual(C.nhomTheoVanDon("Exception", "Exception_Other").nhom, "chua_giao");
});

console.log("── Phân nhóm theo POS (nước chưa có bảng đối tác) ──");
t("GIAO_THANH_CONG / DON_HOAN / HUY / đang giao", () => {
    assert.deepStrictEqual(C.nhomTheoPos("GIAO_THANH_CONG"), { nhom: "da_giao" });
    assert.deepStrictEqual(C.nhomTheoPos("DON_HOAN"), { nhom: "khong_tinh", ly_do: "hoan" });
    assert.deepStrictEqual(C.nhomTheoPos("HUY"), { nhom: "khong_tinh", ly_do: "huy" });
    assert.deepStrictEqual(C.nhomTheoPos("DANG_GIAO"), { nhom: "chua_giao" });
    assert.deepStrictEqual(C.nhomTheoPos("DA_XAC_NHAN"), { nhom: "chua_giao" });
});
t("đơn thô chưa phải đơn thật → bỏ khỏi danh sách", () => {
    assert.strictEqual(C.nhomTheoPos("DON_THO"), null);
});

console.log("── Cộng tiền ──");
t("cộng từng nhóm, quy VND theo tỷ giá rules, chia chưa giao theo trạng thái", () => {
    const x = C.tongHopCod([
        don({ nhom: "da_giao", cod_local: 99 }),
        don({ nhom: "da_giao", cod_local: 69 }),
        don({ nhom: "chua_giao", trang_thai: "Đang vận chuyển", cod_local: 69 }),
        don({ nhom: "chua_giao", trang_thai: "Đang vận chuyển", cod_local: 79 }),
        don({ nhom: "chua_giao", trang_thai: "Giao hỏng", cod_local: 99 }),
        don({ nhom: "khong_tinh", ly_do: "hoan", cod_local: 69 }),
        don({ nhom: "khong_tinh", ly_do: "huy", cod_local: 99 }),
    ], 20000);
    assert.deepStrictEqual(x.da_giao, { so_don: 2, cod_local: 168, vnd_uoc: 3360000 });
    assert.strictEqual(x.chua_giao.so_don, 3);
    assert.strictEqual(x.chua_giao.vnd_uoc, 247 * 20000);
    assert.deepStrictEqual(x.chua_giao.theo_trang_thai[0], { trang_thai: "Đang vận chuyển", so_don: 2, cod_local: 148 });
    assert.strictEqual(x.khong_tinh.hoan, 1);
    assert.strictEqual(x.khong_tinh.huy, 1);
    assert.strictEqual(x.khong_tinh.cod_local, 168);
});
t("chưa khai tỷ giá → không quy VND (null), không nhân bừa", () => {
    assert.strictEqual(C.tongHopCod([don({ nhom: "da_giao" })], 0).da_giao.vnd_uoc, null);
});
t("nhãn trạng thái: chuẩn trước, chữ gốc sau", () => {
    assert.strictEqual(C.nhanTrangThai("Delivered", "Đã giao thành công"), "Đã giao");
    assert.strictEqual(C.nhanTrangThai(null, "Khách hẹn lúc khác giao"), "Khách hẹn lúc khác giao");
    assert.strictEqual(C.nhanTrangThai(null, ""), "Chưa rõ");
});

t("tên trạng thái POS dịch sang tiếng Việt, lạ thì giữ chữ gốc", () => {
    assert.strictEqual(C.nhanTrangThaiPos("shipped", "DANG_GIAO"), "Đã gửi hàng, đang giao");
    assert.strictEqual(C.nhanTrangThaiPos("PENDING", "DANG_GIAO"), "Chờ xử lý (pending)");
    assert.strictEqual(C.nhanTrangThaiPos("abc", "DANG_GIAO"), "abc");
    assert.strictEqual(C.nhanTrangThaiPos("", "DANG_GIAO"), "DANG_GIAO");
});

console.log(`\n${pass} phép thử — tất cả đạt.`);
