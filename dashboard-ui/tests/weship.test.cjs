/**
 * Vận đơn UAE — trang tra đơn WeShip (Sỹ Anh chốt 28/09/2026).
 *
 * Chỗ sai là mất tiền thật:
 *   • đọc "DELIVERY SCHEDULED" thành "Delivered" → đơn chưa giao tính là tiền đã về;
 *   • trang đổi cấu trúc mà báo "không thấy đơn" → cả sổ im lặng đứng yên;
 *   • đơn chưa có mã AWB lặng lẽ biến mất → không ai hỏi D&T vì sao chưa gửi.
 * Trang mẫu dưới là HTML thật (rút gọn) của AWB VS1068057 ngày 28/09/2026.
 */
const assert = require("assert");
const W = require("../.test-build/weship.js");
const T = require("../.test-build/tracking.js");

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log("  ✓", name); };

const AE = T.trackMarket("AE");
const TZ = "+04:00";

const dong = (ngay, gio, noi, viec) => `
    <tr>
    <td align="left" class="text-center">
   ${ngay}  <div class="second-line">${gio}</div>
    </td>
    <td align="left" class="text-left">${noi}&nbsp;</td>
    <td align="left" class="text-left">${viec}</td>
    </tr>`;
const trang = (status, events, ref = "AF101090498O8") => `<html><body>
<div class="tracking-number">Tracking Number: VS1068057</div>
 <div class="panel-title">(Ref : ${ref})</div>  <table>
<thead><tr><th>From</th><th>To</th><th>Current Status</th><th>Current Activity</th></tr></thead>
<tbody>
    <tr>
        <td><div class="from-location">Dubai</div><div class="from-country">ANTALO</div></td>
        <td><div class="from-location">Ajman</div><div class="from-country">United Arab Emirates</div></td>
        <td><strong>${status}</strong></td>
        <td>${status} On: <br> 25/09/2026        9:41 AM</td>
      </tr>
 </tbody>
</table>
<table width="100%" border="0" align="center" class="status-table">
<tr>
    <th align="center" class="date"><strong>Date</strong></th>
    <th align="left"><strong>Location</strong></th>
    <th align="left"><strong>Activity</strong></th>
</tr>${events.join("")}
  </table>
<table><tr><td><div class="shipment-details">Domestic Parcel</div></td>
  <td align="left"><div class="shipment-details">0.5 Kgs</div></td>
  <td align="left"><div class="shipment-details">4</div></td></tr></table>
</body></html>`;

const GIAO = trang("Delivered", [
    dong("25 Sep 2026", "05:40 PM", "Receiver Destination", "Delivered"),
    dong("25 Sep 2026", "09:41 AM", "MAIN OFFICE", "OUT FOR DELIVERY"),
    dong("24 Sep 2026", "01:27 PM", "123456789", "Check-in process done at hub"),
    dong("24 Sep 2026", "11:51 AM", "Customer Location", "Shipment at Collection Point"),
]);

console.log("── Giờ trên trang (giờ UAE +04:00) ──");
t("dạng bảng History: '25 Sep 2026 05:40 PM' → 13:40 UTC", () => {
    assert.strictEqual(W.weshipTime("25 Sep 2026 05:40 PM", TZ), "2026-09-25T13:40:00.000Z");
});
t("dạng ô tóm tắt: '25/09/2026 9:41 AM' → 05:41 UTC", () => {
    assert.strictEqual(W.weshipTime("25/09/2026 9:41 AM", TZ), "2026-09-25T05:41:00.000Z");
});
t("12 AM là nửa đêm, 12 PM là trưa", () => {
    assert.strictEqual(W.weshipTime("01 Oct 2026 12:05 AM", TZ), "2026-09-30T20:05:00.000Z");
    assert.strictEqual(W.weshipTime("01 Oct 2026 12:05 PM", TZ), "2026-10-01T08:05:00.000Z");
});
t("chữ lạ → null, không bịa mốc", () => {
    assert.strictEqual(W.weshipTime("hôm qua", TZ), null);
    assert.strictEqual(W.weshipTime("", TZ), null);
});

console.log("── Đọc trang ──");
t("trang có kết quả: mã tham chiếu, điểm đến, trạng thái, lịch sử mới nhất trước", () => {
    const p = W.parseWeshipPage(GIAO, "VS1068057", TZ);
    assert.strictEqual(p.found, true);
    assert.strictEqual(p.ref, "AF101090498O8");
    assert.strictEqual(p.to_city, "Ajman");
    assert.strictEqual(p.status_text, "Delivered");
    assert.strictEqual(p.events.length, 4);
    assert.deepStrictEqual(p.events[0], { at: "2026-09-25T13:40:00.000Z", location: "Receiver Destination", activity: "Delivered" });
    assert.strictEqual(p.weight, "0.5 Kgs");
    assert.strictEqual(p.pieces, "4");
});
t("trang báo 'Awb not found' → found=false", () => {
    const p = W.parseWeshipPage('<div class="alert">Awb not found</div>', "VS0", TZ);
    assert.strictEqual(p.found, false);
});
t("trang lạ (đổi cấu trúc) → NÉM lỗi, không báo 'không thấy đơn'", () => {
    assert.throws(() => W.parseWeshipPage("<html>Maintenance</html>", "VS0", TZ), /đổi cấu trúc/);
});

console.log("── Chữ trạng thái WeShip → trạng thái chuẩn (talpha_rules.json) ──");
const st = (x) => { const r = W.mapWeshipStatus(x, AE.status_rules); return r ? [r.status, r.sub_status] : null; };
t("UAE khai provider weship, nguồn POS", () => {
    assert.strictEqual(AE.provider, "weship");
    assert.strictEqual(AE.source, "pos");
    assert.strictEqual(AE.pos_market, "AE");
    assert.ok(AE.status_rules.length >= 8);
});
t("DELIVERY SCHEDULED ON NEXT DAY KHÔNG phải đã giao", () => {
    assert.deepStrictEqual(st("DELIVERY SCHEDULED ON NEXT DAY"), ["InTransit", "InTransit_Scheduled"]);
    assert.deepStrictEqual(st("Delivered"), ["Delivered", null]);
});
t("Rescheduled là hẹn lại (không nhầm với 'scheduled')", () => {
    assert.deepStrictEqual(st("Rescheduled"), ["DeliveryFailure", "DeliveryFailure_Rescheduled"]);
});
t("REFUSED / CUSTOMER CANCELLED / package cancelled → khách từ chối, còn cứu được", () => {
    for (const x of ["REFUSED", "CUSTOMER CANCELLED", "package cancelled"]) {
        assert.deepStrictEqual(st(x), ["DeliveryFailure", "DeliveryFailure_Rejected"], x);
    }
});
t("NO RESPONSE → không nghe máy", () => {
    assert.deepStrictEqual(st("NO RESPONSE"), ["DeliveryFailure", "DeliveryFailure_NoResponse"]);
});
t("các chặng thường", () => {
    assert.deepStrictEqual(st("Dispatched"), ["OutForDelivery", null]);
    assert.deepStrictEqual(st("OUT FOR DELIVERY"), ["OutForDelivery", null]);
    assert.deepStrictEqual(st("Check-in process done at hub"), ["InTransit", null]);
    assert.deepStrictEqual(st("Submitted"), ["InfoReceived", null]);
    assert.deepStrictEqual(st("Shipment at Collection Point"), ["InfoReceived", null]);
});
t("hoàn về người gửi là kết thúc, đang hoàn là sự cố", () => {
    assert.deepStrictEqual(st("Returned to Shipper"), ["Returned", null]);
    assert.deepStrictEqual(st("Return in progress"), ["Exception", "Exception_Returning"]);
});
t("chữ chưa khai → null (hiện nguyên văn để khai thêm)", () => {
    assert.strictEqual(st("Held at customs"), null);
});

console.log("── Trạng thái một đơn ──");
t("đã giao: mốc giao lấy ở History, KHÔNG lấy ô 'Delivered On' (ghi sai giờ)", () => {
    const k = W.weshipTrack(W.parseWeshipPage(GIAO, "VS1068057", TZ), AE.status_rules);
    assert.strictEqual(k.status, "Delivered");
    assert.strictEqual(k.status_time, "2026-09-25T13:40:00.000Z");
    assert.strictEqual(k.fail_count, 0);
});
t("hẹn lại hai lần: giao hỏng TỪ lần đầu, đếm 2 lần, câu có 'lần 2'", () => {
    const p = W.parseWeshipPage(trang("Rescheduled", [
        dong("28 Sep 2026", "10:54 AM", "MAIN OFFICE", "Rescheduled"),
        dong("26 Sep 2026", "11:02 AM", "MAIN OFFICE", "Rescheduled"),
        dong("25 Sep 2026", "09:41 AM", "MAIN OFFICE", "OUT FOR DELIVERY"),
    ]), "VS1068056", TZ);
    const k = W.weshipTrack(p, AE.status_rules);
    assert.strictEqual(k.status, "DeliveryFailure");
    assert.strictEqual(k.sub_status, "DeliveryFailure_Rescheduled");
    assert.strictEqual(k.status_time, "2026-09-26T07:02:00.000Z");
    assert.strictEqual(k.last_event_time, "2026-09-28T06:54:00.000Z");
    assert.strictEqual(k.fail_count, 2);
    assert.match(k.last_event, /Hẹn giao lại \(lần 2\)/);
});
t("ô tóm tắt REFUSED + hoạt động 'package cancelled' cùng là từ chối", () => {
    const p = W.parseWeshipPage(trang("REFUSED", [
        dong("28 Sep 2026", "10:45 AM", "MAIN OFFICE", "package cancelled"),
        dong("26 Sep 2026", "10:55 AM", "MAIN OFFICE", "package cancelled"),
    ]), "VS1068045", TZ);
    const k = W.weshipTrack(p, AE.status_rules);
    assert.strictEqual(k.sub_status, "DeliveryFailure_Rejected");
    assert.strictEqual(k.raw_status, "REFUSED");
    assert.strictEqual(k.fail_count, 2);
});
t("chữ lạ: không trạng thái, giữ chữ gốc", () => {
    const p = W.parseWeshipPage(trang("Held at customs", [dong("28 Sep 2026", "10:00 AM", "X", "Held at customs")]), "VS1", TZ);
    const k = W.weshipTrack(p, AE.status_rules);
    assert.strictEqual(k.status, null);
    assert.strictEqual(k.raw_status, "Held at customs");
});

console.log("── Mã AWB trong đơn POS ──");
t("đọc extend_code trong chuỗi dict Python của POS", () => {
    const p = "{'updated_at': '2026-09-25T07:48:11', 'cod': 0, 'extend_code': 'VS1068347', 'partner_name': 'UAE EXP'}";
    assert.strictEqual(W.awbFromPartner(p), "VS1068347");
    assert.strictEqual(W.awbFromPartner('{"extend_code": "vs1068347"}'), "VS1068347");
});
t("không có mã → null", () => {
    assert.strictEqual(W.awbFromPartner(null), null);
    assert.strictEqual(W.awbFromPartner("{'extend_code': None}"), null);
});

console.log("── Đơn POS → vận đơn ──");
const NOW = new Date("2026-10-05T08:00:00Z");
const don = (o = {}) => ({ order_id: "15", order_date: "2026-09-26", status_name: "pending", status_category: "DANG_GIAO",
    cod: 159, partner: "{'extend_code': 'VS1069070'}", customer: "Maria", phone: "0501234567",
    province: "Abu Dhabi", district: "Al Ain", note: "delivery - 3/10", time_send_partner: "2026-09-28T08:00:37", ...o });
t("có mã, chưa tra: 'đã tạo vận đơn' tính từ lúc POS gửi hãng (giờ UTC)", () => {
    const s = W.posWeshipShipment(don(), undefined);
    assert.strictEqual(s.tracking, "VS1069070");
    assert.strictEqual(s.track17_code, "VS1069070");
    assert.strictEqual(s.status, "InfoReceived");
    assert.strictEqual(s.status_since, "2026-09-28T08:00:37.000Z");
    assert.strictEqual(s.registered, false);
    assert.strictEqual(s.city, "Al Ain, Abu Dhabi");
    assert.strictEqual(s.cod_local, 159);
});
t("đã tra: trạng thái WeShip thắng trạng thái POS", () => {
    const s = W.posWeshipShipment(don({ status_name: "shipped" }), {
        status: "DeliveryFailure", sub_status: "DeliveryFailure_Rejected", status_since: "2026-09-26T06:55:00.000Z",
        last_event_time: "2026-09-28T06:45:00.000Z", last_event: "Khách từ chối nhận (lần 2)", source: "weship",
        raw_status: "REFUSED", fail_count: 2,
    });
    assert.strictEqual(s.status, "DeliveryFailure");
    assert.strictEqual(s.source, "weship");
    assert.strictEqual(s.registered, true);
    assert.strictEqual(s.fail_count, 2);
});
t("chưa có mã AWB quá 4 ngày → cảnh báo 'Chưa gửi hàng' (hỏi D&T)", () => {
    const s = W.posWeshipShipment(don({ partner: null, time_send_partner: "" }), undefined);
    assert.strictEqual(s.tracking, "DON-15");
    assert.strictEqual(s.track17_code, null);
    const a = T.buildAlerts([s], NOW, { staleDays: AE.stale_days });
    assert.strictEqual(a.length, 1);
    assert.strictEqual(a[0].code, "dung_im");
    assert.match(a[0].title, /Chưa gửi hàng 9 ngày/);
});
t("giao hỏng → cảnh báo giao_hong kèm lý do", () => {
    const s = W.posWeshipShipment(don(), {
        status: "DeliveryFailure", sub_status: "DeliveryFailure_NoResponse", status_since: "2026-10-04T06:00:00.000Z",
        last_event_time: "2026-10-04T06:00:00.000Z", last_event: "Khách không nghe máy · “NO RESPONSE”", source: "weship",
    });
    const a = T.buildAlerts([s], NOW, { staleDays: AE.stale_days });
    assert.strictEqual(a[0].code, "giao_hong");
    assert.match(a[0].detail, /không nghe máy/);
});

(async () => {
    console.log("── Tra nhiều mã cùng lúc ──");
    let dang = 0, max = 0;
    const kq = await W.mapPool([1, 2, 3, 4, 5, 6, 7], 3, async (x) => {
        dang++; max = Math.max(max, dang);
        await new Promise((r) => setTimeout(r, 5 * (8 - x)));
        dang--;
        return x * 10;
    });
    assert.deepStrictEqual(kq, [10, 20, 30, 40, 50, 60, 70]);
    assert.ok(max <= 3, `chạy ${max} việc cùng lúc`);
    pass++; console.log("  ✓ giữ thứ tự kết quả, không quá 3 việc cùng lúc");

    const goi = [];
    const f = async (url, init) => { goi.push([url, init.body]); return { ok: true, text: async () => GIAO }; };
    const p = await W.fetchWeship("VS1068057", { url: "https://portal.weshipme.com/tracking", tz_offset: TZ, timeout_ms: 5000 }, f);
    assert.strictEqual(p.status_text, "Delivered");
    assert.deepStrictEqual(goi, [["https://portal.weshipme.com/tracking", "trackno=VS1068057"]]);
    pass++; console.log("  ✓ gửi form trackno=<AWB> tới trang tra đơn");

    await assert.rejects(W.fetchWeship("VS1", { url: "u", tz_offset: TZ, timeout_ms: 5000 },
        async () => ({ ok: false, status: 503, text: async () => "" })), /HTTP 503/);
    pass++; console.log("  ✓ trang lỗi HTTP → ném lỗi (lượt tra báo hỏng, không im lặng)");

    console.log(`\n${pass} phép thử — tất cả đạt.`);
})().catch((e) => { console.error(e); process.exit(1); });
