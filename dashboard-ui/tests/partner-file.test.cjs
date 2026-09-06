/**
 * Máy đọc file đơn hàng của đối tác 3PL.
 *
 * Dữ liệu trong test là dựng tay, KHÔNG lấy từ file thật — file thật có tên,
 * số điện thoại và địa chỉ khách, không đưa vào repo.
 *
 * Mấy chỗ canh kỹ đều là lỗi đã gặp thật khi chạy trên 621 dòng của đối tác.
 */
const assert = require("assert");
const P = require("../.test-build/partner-file.js");

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log("  ✓", name); };

const HEAD = "MKT,Đối soát,Ghi chú,NOTE,Ngày xuất kho,Ngày lên đơn ," +
    "PHƯƠNG THỨC VẬN CHUYỂN ,Order No.,Tracking number ,MÃ TRA CỨU 17 TRACK ,COD Amount (NT$)";
const row = (o = {}) => [
    o.mkt ?? "Thái", o.recon ?? "", o.note2 ?? "", o.status ?? "Đợi khách đến lấy hàng",
    o.ship ?? "13/07/2026", o.order ?? "10/07/2026", o.method ?? "7 ELEVEN",
    o.no ?? "T1000", o.tracking ?? "17897055", o.code ?? "", o.cod ?? "1499",
].join(",");
const file = (...rows) => [HEAD, ...rows].join("\n");

console.log("── Nhận cột ──");
t("nhận đủ cột dù tiêu đề có dấu và khoảng trắng thừa", () => {
    const r = P.parsePartnerFile(file(row()));
    for (const c of ["order_no", "tracking", "status", "ship_method", "cod", "marketer", "ship_date"]) {
        assert.notStrictEqual(r.columns[c], undefined, `thiếu cột ${c}`);
    }
    assert.deepStrictEqual(r.missing_columns, []);
});
t("thiếu cột bắt buộc thì NÊU RA, không đọc bừa", () => {
    const r = P.parsePartnerFile("Order No.,COD Amount (NT$)\nT1,999");
    assert.ok(r.missing_columns.includes("tracking"));
    assert.ok(r.missing_columns.includes("status"));
});

console.log("── Trạng thái ──");
t("đợi khách lấy → AvailableForPickup, đúng tín hiệu cần cứu đơn", () => {
    assert.strictEqual(P.mapPartnerStatus("Đợi khách đến lấy hàng"), "AvailableForPickup");
});
t("dịch đủ các trạng thái đối tác dùng", () => {
    const cases = {
        "Đã giao thành công": "Delivered", "Đang trung chuyển": "InTransit",
        "Đang giao hàng": "OutForDelivery", "Đã lên đơn": "InfoReceived",
        "Đang hoàn về kho": "DeliveryFailure", "Đã hoàn về kho": "Returned",
    };
    for (const [vi, en] of Object.entries(cases)) assert.strictEqual(P.mapPartnerStatus(vi), en, vi);
});
t("BẪY: 'Hủy' và 'Huỷ' là một — hai kiểu dấu Unicode khác nhau", () => {
    assert.strictEqual(P.mapPartnerStatus("Hủy đơn"), "Cancelled");
    assert.strictEqual(P.mapPartnerStatus("Huỷ đơn"), "Cancelled");
});
t("trạng thái lạ → null và được ĐẾM, không nuốt lặng lẽ", () => {
    assert.strictEqual(P.mapPartnerStatus("Trạng thái trời ơi"), null);
    const r = P.parsePartnerFile(file(row({ status: "Trạng thái trời ơi" })));
    assert.deepStrictEqual(r.unknown_statuses, [{ value: "Trạng thái trời ơi", count: 1 }]);
});

console.log("── Sinh mã tra cứu 17TRACK ──");
t("8 số (7-Eleven) → thêm tiền tố 73N", () => {
    assert.strictEqual(P.track17CodeFor("17897055"), "73N17897055");
});
t("10–11 số (Family Mart, giao tại nhà) → giữ nguyên", () => {
    assert.strictEqual(P.track17CodeFor("06718668650"), "06718668650");
    assert.strictEqual(P.track17CodeFor("7564409963"), "7564409963");
});
t("đối tác đã điền tay thì tin họ, không ghi đè", () => {
    const r = P.parsePartnerFile(file(row({ tracking: "17897055", code: "TAY-DIEN" })));
    assert.strictEqual(r.rows[0].track17_code, "TAY-DIEN");
});
t("bỏ trống thì tự sinh — đối tác chỉ điền tay khoảng một nửa", () => {
    const r = P.parsePartnerFile(file(row({ tracking: "17897055", code: "" })));
    assert.strictEqual(r.rows[0].track17_code, "73N17897055");
});

console.log("── Ngày ──");
t("đọc ngày kiểu Việt Nam", () => {
    assert.strictEqual(P.parseDmy("13/07/2026"), "2026-07-13");
    assert.strictEqual(P.parseDmy("2/8/2026"), "2026-08-02");
});
t("ngày hỏng → null, KHÔNG đoán", () => {
    assert.strictEqual(P.parseDmy("linh tinh"), null);
    assert.strictEqual(P.parseDmy(""), null);
});
t("BẪY: xuất kho TRƯỚC ngày lên đơn là gõ nhầm năm → bỏ", () => {
    // Gặp thật: xuất kho 04/08/2025 mà lên đơn 2/8/2026. Giữ lại thì đẻ ra
    // cảnh báo "đứng im 398 ngày", người đọc mất tin vào toàn bộ cảnh báo.
    const r = P.parsePartnerFile(file(row({ ship: "04/08/2025", order: "02/08/2026" })));
    assert.strictEqual(r.rows[0].ship_date, null);
    assert.strictEqual(r.rows[0].order_date, "2026-08-02");
});
t("ngày hợp lý thì giữ", () => {
    const r = P.parsePartnerFile(file(row({ ship: "13/07/2026", order: "10/07/2026" })));
    assert.strictEqual(r.rows[0].ship_date, "2026-07-13");
});

console.log("── Tiền và dòng rác ──");
t("đọc số tiền", () => {
    assert.strictEqual(P.parseMoney("1499"), 1499);
    assert.strictEqual(P.parseMoney("NT$ 1,499"), 1499);
    assert.strictEqual(P.parseMoney(""), 0);
});
t("bỏ dòng trống, không đếm thành đơn", () => {
    const r = P.parsePartnerFile(file(row(), ",,,,,,,,,,"));
    assert.strictEqual(r.rows.length, 1);
});

console.log("── Tóm tắt ──");
t("đếm đúng đơn chờ khách lấy và tiền đang treo", () => {
    const r = P.parsePartnerFile(file(
        row({ no: "T1", tracking: "17000001", cod: "1000" }),
        row({ no: "T2", tracking: "17000002", cod: "500" }),
        row({ no: "T3", tracking: "17000003", cod: "900", status: "Đã giao thành công" }),
    ));
    const s = P.summarise(r.rows);
    assert.strictEqual(s.waiting_pickup.orders, 2);
    assert.strictEqual(s.waiting_pickup.cod, 1500);
    assert.strictEqual(s.total, 3);
});
t("tỷ lệ hoàn tính cả đơn ĐANG hoàn — đó cũng là tiền đã mất", () => {
    const r = P.parsePartnerFile(file(
        row({ no: "T1", tracking: "17000001", status: "Đã hoàn về kho" }),
        row({ no: "T2", tracking: "17000002", status: "Đang hoàn về kho" }),
        row({ no: "T3", tracking: "17000003", status: "Đã giao thành công" }),
        row({ no: "T4", tracking: "17000004", status: "Đã giao thành công" }),
    ));
    assert.strictEqual(P.summarise(r.rows).return_rate, 0.5);
});

console.log(`\n${pass} phép thử — tất cả đạt.`);
