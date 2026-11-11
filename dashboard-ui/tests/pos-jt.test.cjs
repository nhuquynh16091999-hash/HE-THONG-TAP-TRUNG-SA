/**
 * Vận đơn Việt Nam (11/11/2026): trạng thái J&T nằm trong đơn POS (partner.extend_update).
 * Chữ mẫu lấy từ đơn thật shop VIỆT NAM 1329125435.
 */
const assert = require("assert");
const J = require("../.test-build/pos-jt.js");
const T = require("../.test-build/tracking.js");

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log("  ✓", name); };
const VN = T.trackMarket("VN");
const don = (events, o = {}) => ({
    order_id: 7, order_date: "2026-11-05", status_name: "shipped", cod: 99000,
    customer: "Nguyễn Văn A", phone: "0912345678", province: "Nghệ An", district: "Yên Thành",
    time_send_partner: "2026-11-05T09:00:00",
    partner: JSON.stringify({ extend_code: "802861888430", extend_update: events }), ...o,
});
const ev = (status, at, note = null) => ({ status, update_at: at, note, tracking_id: "802861888430" });

console.log("── Vận đơn Việt Nam (J&T qua POS) ──");
t("VN khai provider pos, nguồn pos", () => {
    assert.strictEqual(VN.code, "VN");
    assert.strictEqual(VN.provider, "pos");
    assert.strictEqual(VN.source, "pos");
    assert.ok(VN.status_rules.length >= 8);
});
t("sự kiện MỚI NHẤT quyết định trạng thái, không theo thứ tự trong mảng", () => {
    const s = J.posJtShipment(don([
        ev("Giao kiện thành công | Ký nhận", "2026-11-08T10:00:00+07:00"),
        ev("Đang giao hàng", "2026-11-08T07:00:00+07:00"),
        ev("Chờ vận chuyển lấy hàng", "2026-11-05T16:00:00+07:00"),
    ]), VN.status_rules);
    assert.strictEqual(s.status, "Delivered");
    assert.strictEqual(s.track17_code, "802861888430");
    assert.strictEqual(s.source, "pos");
    assert.strictEqual(s.cod_local, 99000);
});
t("giao hỏng: lý do từ ghi chú, đếm số lần hỏng", () => {
    const evs = [
        ev("Đang giao hàng", "2026-11-07T07:00:00+07:00"),
        ev("Giao hàng không thành công", "2026-11-07T15:00:00+07:00", "Không liên lạc được Khách hàng/khóa máy"),
        ev("Đang giao hàng", "2026-11-08T07:00:00+07:00"),
        ev("Giao hàng không thành công", "2026-11-08T15:00:00+07:00", "Người mua hẹn lại ngày nhận"),
    ];
    const s = J.posJtShipment(don(evs), VN.status_rules);
    assert.strictEqual(s.status, "DeliveryFailure");
    assert.strictEqual(s.sub_status, "DeliveryFailure_Rescheduled");
    assert.strictEqual(s.fail_count, 2);
    const s2 = J.posJtShipment(don(evs.slice(0, 2)), VN.status_rules);
    assert.strictEqual(s2.sub_status, "DeliveryFailure_NoResponse");
    const s3 = J.posJtShipment(don([ev("Giao hàng không thành công", "2026-11-07T15:00:00+07:00", "Từ chối-Không đặt hàng")]), VN.status_rules);
    assert.strictEqual(s3.sub_status, "DeliveryFailure_Rejected");
});
t("chuyển hoàn: đang hoàn ≠ đã hoàn", () => {
    assert.strictEqual(J.posJtShipment(don([ev("Chuyển hoàn", "2026-11-09T10:00:00+07:00")]), VN.status_rules).status, "Exception");
    assert.strictEqual(J.posJtShipment(don([ev("Chuyển hoàn thành công | Ký nhận", "2026-11-10T10:00:00+07:00")]), VN.status_rules).status, "Returned");
});
t("trung chuyển = đang đi; status_since lùi về sự kiện đầu cùng trạng thái", () => {
    const s = J.posJtShipment(don([
        ev("Đã lấy hàng thành công", "2026-11-05T18:00:00+07:00"),
        ev("Kiện hàng đến kho trung chuyển", "2026-11-06T02:00:00+07:00"),
        ev("Xuất kho trung chuyển", "2026-11-06T09:00:00+07:00"),
    ]), VN.status_rules);
    assert.strictEqual(s.status, "InTransit");
    assert.strictEqual(s.status_since, "2026-11-05T11:00:00.000Z");
});
t("chưa có mã J&T → không bịa trạng thái", () => {
    const s = J.posJtShipment(don([], { partner: null, status_name: "pending" }), VN.status_rules);
    assert.strictEqual(s.status, null);
    assert.strictEqual(s.tracking, "DON-7");
    assert.ok(s.last_event.includes("Chưa có mã vận đơn"));
});
console.log(`\n${pass} phép thử vận đơn Việt Nam qua.`);
