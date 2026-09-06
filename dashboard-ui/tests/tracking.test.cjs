/**
 * Luật theo dõi vận đơn và cảnh báo.
 *
 * Hai chỗ sai là mất tiền thật, nên test bám chặt vào đó:
 *   • status_since bị đặt lại mỗi lần đồng bộ → đồng hồ đếm ngược luôn về 0,
 *     cảnh báo "sắp bị trả về" KHÔNG BAO GIỜ nổ, hàng âm thầm bị trả về
 *   • cắt lô quá 40 mã → 17TRACK từ chối cả lô
 */
const assert = require("assert");
const T = require("../.test-build/tracking.js");

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log("  ✓", name); };

const NOW = new Date("2026-09-10T08:00:00Z");
const daysAgo = (n) => new Date(NOW.getTime() - n * 86400000).toISOString();

const ship = (o = {}) => ({
    tracking: "TW001", order_uid: "TW-1", order_id: "1", order_date: "2026-09-01",
    customer: "Khách", phone: "0900", marketer: "Lộc", sale: "Thương",
    cod_local: 950, status: "InTransit", sub_status: null,
    status_since: daysAgo(1), last_event_time: daysAgo(1), last_event: "Đang đi",
    registered: true, ...o,
});

console.log("── Đếm ngày ──");
t("khoảng cách ngày tính đúng", () => {
    assert.strictEqual(T.daysBetween(daysAgo(5), NOW), 5);
    assert.strictEqual(T.daysBetween(daysAgo(0), NOW), 0);
});
t("mốc thiếu hoặc hỏng → null, KHÔNG trả 0", () => {
    // Trả 0 là nói dối "vừa mới xảy ra", cảnh báo sẽ im lặng sai.
    assert.strictEqual(T.daysBetween(null, NOW), null);
    assert.strictEqual(T.daysBetween("khong-phai-ngay", NOW), null);
});

console.log("── Hạn lấy hàng ở cửa hàng ──");
t("còn mấy ngày nữa bị trả về", () => {
    const s = ship({ status: "AvailableForPickup", status_since: daysAgo(2) });
    assert.strictEqual(T.daysLeftAtStore(s, NOW), T.TRACK_CFG.pickup_expire_days - 2);
});
t("quá hạn thì ra số âm", () => {
    const s = ship({ status: "AvailableForPickup", status_since: daysAgo(9) });
    assert.ok(T.daysLeftAtStore(s, NOW) < 0);
});
t("chưa tới cửa hàng thì không tính hạn", () => {
    assert.strictEqual(T.daysLeftAtStore(ship({ status: "InTransit" }), NOW), null);
});

console.log("── Cảnh báo ──");
const alertsFor = (s) => T.buildAlerts([s], NOW);

t("vừa tới cửa hàng → nhắc giục khách", () => {
    const a = alertsFor(ship({ status: "AvailableForPickup", status_since: daysAgo(0) }));
    assert.strictEqual(a.length, 1);
    assert.strictEqual(a[0].code, "toi_cua_hang");
    assert.strictEqual(a[0].level, "nhac");
});
t("nằm ở cửa hàng quá lâu → GẤP, sắp bị trả về", () => {
    const a = alertsFor(ship({ status: "AvailableForPickup", status_since: daysAgo(6) }));
    assert.strictEqual(a[0].code, "sap_bi_tra_ve");
    assert.strictEqual(a[0].level, "gap");
});
t("đã quá hạn vẫn báo gấp, không im lặng bỏ qua", () => {
    const a = alertsFor(ship({ status: "AvailableForPickup", status_since: daysAgo(12) }));
    assert.strictEqual(a[0].level, "gap");
    assert.ok(a[0].title.includes("quá hạn"));
});
t("giao hỏng → cảnh báo", () => {
    assert.strictEqual(alertsFor(ship({ status: "DeliveryFailure" }))[0].code, "giao_hong");
    assert.strictEqual(alertsFor(ship({ status: "Exception" }))[0].code, "giao_hong");
});
t("đứng im quá lâu → cảnh báo", () => {
    const a = alertsFor(ship({ status: "InTransit", status_since: daysAgo(30), last_event_time: daysAgo(30) }));
    assert.strictEqual(a[0].code, "dung_im");
});
t("đơn đã giao xong KHÔNG cảnh báo", () => {
    assert.strictEqual(alertsFor(ship({ status: "Delivered", status_since: daysAgo(30) })).length, 0);
    assert.strictEqual(alertsFor(ship({ status: "Expired", status_since: daysAgo(30) })).length, 0);
});
t("đang đi bình thường KHÔNG cảnh báo", () => {
    assert.strictEqual(alertsFor(ship({ status: "InTransit" })).length, 0);
});
t("chưa đăng ký → nhắc đăng ký, và không xét trạng thái nữa", () => {
    const a = alertsFor(ship({ registered: false, status: null, status_since: null }));
    assert.strictEqual(a.length, 1);
    assert.strictEqual(a[0].code, "chua_dang_ky");
});
t("việc gấp xếp lên trước việc nhắc", () => {
    const a = T.buildAlerts([
        ship({ tracking: "A", status: "AvailableForPickup", status_since: daysAgo(0) }),
        ship({ tracking: "B", status: "AvailableForPickup", status_since: daysAgo(6) }),
    ], NOW);
    assert.strictEqual(a[0].level, "gap");
    assert.strictEqual(a[0].shipment.tracking, "B");
});

console.log("── Gộp trạng thái ──");
t("BẪY: trạng thái KHÔNG đổi thì giữ nguyên status_since", () => {
    // Đây là lỗi chết người: đặt lại mốc mỗi lần đồng bộ thì đồng hồ đếm ngược
    // luôn về 0, và cảnh báo "sắp bị trả về" không bao giờ nổ.
    const since = daysAgo(5);
    const m = T.mergeStatus(
        { status: "AvailableForPickup", status_since: since },
        { status: "AvailableForPickup", last_event_time: daysAgo(0), last_event: "vẫn ở cửa hàng" },
        NOW);
    assert.strictEqual(m.status_since, since);
});
t("trạng thái đổi thật thì đặt lại status_since", () => {
    const m = T.mergeStatus(
        { status: "InTransit", status_since: daysAgo(5) },
        { status: "AvailableForPickup" }, NOW);
    assert.strictEqual(m.status_since, NOW.toISOString());
});
t("chưa có bản cũ thì lấy mốc hiện tại", () => {
    assert.strictEqual(T.mergeStatus(undefined, { status: "InTransit" }, NOW).status_since, NOW.toISOString());
});

console.log("── Cắt lô ──");
t("không lô nào quá 40 mã — trần cứng của 17TRACK", () => {
    const xs = Array.from({ length: 95 }, (_, i) => `TW${i}`);
    const lots = T.chunk(xs);
    assert.ok(lots.every((l) => l.length <= 40), "có lô vượt 40");
    assert.strictEqual(lots.flat().length, 95, "cắt lô làm mất mã");
});
t("xin lô to hơn 40 vẫn bị ép về 40", () => {
    assert.ok(T.chunk(Array.from({ length: 50 }, (_, i) => i), 100)[0].length <= 40);
});
t("danh sách rỗng → không lô nào", () => {
    assert.deepStrictEqual(T.chunk([]), []);
});

console.log("── Nhãn ──");
t("dịch trạng thái sang tiếng Việt", () => {
    assert.strictEqual(T.statusLabel("AvailableForPickup"), "Đã tới cửa hàng");
    assert.strictEqual(T.statusLabel(null), "Chưa rõ");
});
t("mọi trạng thái của 17TRACK đều có nhãn", () => {
    for (const s of ["NotFound", "InfoReceived", "InTransit", "Expired", "AvailableForPickup",
                     "OutForDelivery", "DeliveryFailure", "Delivered", "Exception"]) {
        assert.notStrictEqual(T.statusLabel(s), "Chưa rõ", `thiếu nhãn cho ${s}`);
    }
});

console.log("── Đồng hồ đếm hạn theo ngày xuất kho ──");
const shipDaysAgo = (n) => new Date(NOW.getTime() - n * 86400000).toISOString().slice(0, 10);

t("BẪY: file đối tác chỉ có ngày XUẤT KHO, không có ngày tới cửa hàng", () => {
    // Nếu chỉ đếm từ status_since thì lần nhập file đầu tiên coi MỌI đơn là "vừa
    // tới". Kiểm trên dữ liệu thật: cả 45 đơn ở cửa hàng đều xuất kho 8–21 ngày
    // trước, tức đều quá hạn, mà hệ thống lại báo nhẹ hều — hỏng đúng lúc cần nhất.
    const s = ship({
        status: "AvailableForPickup", source: "doi_tac",
        status_since: NOW.toISOString(),      // vừa nhập file xong
        ship_date: shipDaysAgo(13),           // nhưng hàng đã đi 13 ngày
    });
    const a = T.buildAlerts([s], NOW);
    assert.strictEqual(a[0].level, "gap", "phải báo GẤP theo ngày xuất kho");
    assert.ok(a[0].detail.includes("Xuất kho"));
});
t("đơn vừa xuất kho thì chỉ nhắc, không kêu gấp", () => {
    const s = ship({
        status: "AvailableForPickup", source: "doi_tac",
        status_since: NOW.toISOString(), ship_date: shipDaysAgo(2),
    });
    assert.strictEqual(T.buildAlerts([s], NOW)[0].level, "nhac");
});
t("có 17TRACK thì tin mốc của 17TRACK, bỏ ước lượng đi đường", () => {
    const s = ship({
        status: "AvailableForPickup", source: "17track",
        status_since: daysAgo(1), ship_date: shipDaysAgo(30),
    });
    assert.strictEqual(T.daysLeftAtStore(s, NOW), T.TRACK_CFG.pickup_expire_days - 1);
});
t("mốc vô lý quá 1 năm KHÔNG đẻ ra cảnh báo đứng im", () => {
    // Gặp thật: đối tác gõ nhầm năm, ra "đứng im 398 ngày".
    const s = ship({ status: "InTransit", status_since: daysAgo(398), last_event_time: daysAgo(398) });
    assert.strictEqual(T.buildAlerts([s], NOW).filter((a) => a.code === "dung_im").length, 0);
});
t("đứng im trong khoảng hợp lý thì vẫn báo", () => {
    const s = ship({ status: "InTransit", status_since: daysAgo(40), last_event_time: daysAgo(40) });
    assert.strictEqual(T.buildAlerts([s], NOW)[0].code, "dung_im");
});
t("file đối tác đã cho trạng thái thì KHÔNG giục đăng ký 17TRACK", () => {
    // Giục cả 589 đơn là hàng trăm dòng nhiễu, che mất việc thật.
    const s = ship({ registered: false, status: "InTransit", source: "doi_tac" });
    assert.strictEqual(T.buildAlerts([s], NOW).filter((a) => a.code === "chua_dang_ky").length, 0);
});


console.log(`\n${pass} phép thử — tất cả đạt.`);
