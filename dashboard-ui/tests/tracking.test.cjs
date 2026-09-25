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


console.log("── 17TRACK: chọn mã đăng ký (tốn quota) ──");
const reg = (o = {}) => ship({ registered: false, track17_code: "73N18024614", ship_date: shipDaysAgo(3), ...o });
// Luật chung, không phụ thuộc scope đang khai — test ở scope rộng nhất.
const plan = (xs, o = {}) => T.planRegister(xs, NOW, { scope: "tat_ca", ...o });
t("đơn đã kết thúc KHÔNG đem đăng ký — đốt quota vô ích", () => {
    const xs = ["Delivered", "Returned", "Cancelled", "Destroyed", "Expired"]
        .map((st, i) => reg({ status: st, track17_code: `73N1802461${i}` }));
    assert.strictEqual(plan(xs).pick.length, 0);
});
t("đơn đang đi, còn mới thì đăng ký", () => {
    assert.strictEqual(plan([reg()]).pick.length, 1);
});
t("đơn cũ quá hạn tuổi thì bỏ (dòng đối tác quên cập nhật)", () => {
    const s = reg({ ship_date: shipDaysAgo(T.TRACK_CFG.register_max_age_days + 1) });
    assert.strictEqual(plan([s]).pick.length, 0);
});
t("đã đăng ký thì không đăng ký lại", () => {
    assert.strictEqual(plan([reg({ registered: true })]).pick.length, 0);
});
t("hai dòng chung một mã chỉ tốn MỘT quota", () => {
    const p = plan([reg({ tracking: "A" }), reg({ tracking: "B" })]);
    assert.strictEqual(p.pick.length, 1);
    assert.strictEqual(p.eligible, 1);
});
t("dòng chung mã với đơn đã đăng ký thì không đăng ký nữa", () => {
    assert.strictEqual(plan([reg({ tracking: "A", registered: true }), reg({ tracking: "B" })]).pick.length, 0);
});
t("khoá dạng mã đơn (T1304) không phải mã vận đơn → bỏ", () => {
    assert.strictEqual(plan([reg({ track17_code: "T1304" })]).pick.length, 0);
    assert.strictEqual(plan([reg({ track17_code: null })]).pick.length, 0);
});
t("chạm trần mỗi lượt thì cắt, đơn ở cửa hàng lên trước", () => {
    const xs = [
        reg({ track17_code: "73N00000001", status: "InTransit" }),
        reg({ track17_code: "73N00000002", status: "AvailableForPickup" }),
        reg({ track17_code: "73N00000003", status: "DeliveryFailure" }),
    ];
    const p = plan(xs, { maxPerRun: 2 });
    assert.deepStrictEqual(p.pick.map((s) => s.track17_code), ["73N00000002", "73N00000003"]);
    assert.strictEqual(p.over_cap, 1);
    assert.strictEqual(p.eligible, 3);
    assert.strictEqual(p.quota_limited, false);
});

console.log("── 17TRACK: gói miễn phí — chỉ đơn có cảnh báo, không quá quota ──");
const coCanhBao = () => [
    // sắp bị trả về (gấp): 17TRACK xuất kho 9 ngày trước, 3 ngày đi đường → quá hạn
    reg({ track17_code: "73N00000001", status: "AvailableForPickup", source: "doi_tac", ship_date: shipDaysAgo(9) }),
    // giao hỏng (cảnh báo)
    reg({ track17_code: "73N00000002", status: "DeliveryFailure" }),
    // đang đi bình thường — KHÔNG có cảnh báo
    reg({ track17_code: "73N00000003", status: "InTransit" }),
    // vừa tới cửa hàng — chỉ là "nhắc", không đáng tốn quota
    reg({ track17_code: "73N00000004", status: "AvailableForPickup", source: "doi_tac", ship_date: shipDaysAgo(3) }),
];
t("scope canh_bao: chỉ đơn Gấp/Cảnh báo, bỏ đơn đang đi và đơn chỉ là nhắc", () => {
    const p = T.planRegister(coCanhBao(), NOW, { scope: "canh_bao" });
    assert.deepStrictEqual(p.pick.map((s) => s.track17_code).sort(), ["73N00000001", "73N00000002"]);
});
t("scope tat_ca: mọi đơn chưa kết thúc", () => {
    assert.strictEqual(T.planRegister(coCanhBao(), NOW, { scope: "tat_ca" }).pick.length, 4);
});
t("không bao giờ gửi quá quota còn lại — đơn gấp lên trước", () => {
    const p = T.planRegister(coCanhBao(), NOW, { scope: "canh_bao", quotaRemain: 1 });
    assert.deepStrictEqual(p.pick.map((s) => s.track17_code), ["73N00000001"]);
    assert.strictEqual(p.over_cap, 1);
    assert.strictEqual(p.quota_limited, true);
});
t("hết quota thì không gửi mã nào", () => {
    const p = T.planRegister(coCanhBao(), NOW, { scope: "canh_bao", quotaRemain: 0 });
    assert.strictEqual(p.pick.length, 0);
    assert.strictEqual(p.quota_limited, true);
});
t("không hỏi được quota (null) thì chỉ cắt theo trần mỗi lượt", () => {
    const p = T.planRegister(coCanhBao(), NOW, { scope: "canh_bao", quotaRemain: null });
    assert.strictEqual(p.pick.length, 2);
    assert.strictEqual(p.quota_limited, false);
});
t("rules đang khai gói miễn phí → mặc định canh_bao", () => {
    assert.strictEqual(T.TRACK_CFG.register_scope, "canh_bao");
});

console.log("── 17TRACK: chọn mã hỏi trạng thái (miễn phí) ──");
t("chỉ hỏi mã đã đăng ký và chưa kết thúc", () => {
    const xs = [
        reg({ registered: true, track17_code: "73N00000001", status: "InTransit" }),
        reg({ registered: true, track17_code: "73N00000002", status: "Delivered" }),
        reg({ registered: false, track17_code: "73N00000003", status: "InTransit" }),
    ];
    assert.deepStrictEqual(T.planTrack(xs), ["73N00000001"]);
});
t("mã vừa đăng ký lượt này thì hỏi luôn", () => {
    const s = reg({ track17_code: "73N00000003", status: "InTransit" });
    assert.deepStrictEqual(T.planTrack([s], new Set(["73N00000003"])), ["73N00000003"]);
});

console.log("── 17TRACK: mốc đổi trạng thái ──");
t("đổi trạng thái thì lấy mốc 17TRACK, không lấy lúc đồng bộ", () => {
    // Đồng bộ mỗi sáng: lấy lúc đồng bộ là hạn lấy hàng tính lùi gần một ngày.
    const m = T.mergeStatus(undefined, { status: "AvailableForPickup", status_time: daysAgo(1) }, NOW);
    assert.strictEqual(m.status_since, daysAgo(1));
});
t("mốc ở tương lai thì bỏ, dùng lúc đồng bộ", () => {
    const tuongLai = new Date(NOW.getTime() + 3 * 86400000).toISOString();
    const m = T.mergeStatus(undefined, { status: "AvailableForPickup", status_time: tuongLai }, NOW);
    assert.strictEqual(m.status_since, NOW.toISOString());
});
t("không đổi trạng thái thì giữ mốc cũ dù 17TRACK gửi mốc khác", () => {
    const m = T.mergeStatus({ status: "AvailableForPickup", status_since: daysAgo(4) },
        { status: "AvailableForPickup", status_time: daysAgo(1) }, NOW);
    assert.strictEqual(m.status_since, daysAgo(4));
});
t("cảnh báo ở cửa hàng mang theo số ngày còn lại", () => {
    const s = ship({ status: "AvailableForPickup", source: "17track", status_since: daysAgo(6) });
    assert.strictEqual(T.buildAlerts([s], NOW)[0].days_left, T.TRACK_CFG.pickup_expire_days - 6);
});

console.log("── 17TRACK: đọc kết quả gettrackinfo v2.4 ──");
const K = require("../.test-build/track17.js");
t("đọc đúng tên trường v2.4 (time_utc, description) và mốc milestone", () => {
    // Bản cũ đọc latest_event.time / .content — tên của API cũ, ra trống hết.
    const r = K.parseTrackInfo({
        number: "73N18024614", carrier: 100123,
        track_info: {
            latest_status: { status: "AvailableForPickup", sub_status: "AvailableForPickup_Other" },
            latest_event: { time_iso: "2026-09-08T10:00:00+08:00", time_utc: "2026-09-08T02:00:00Z",
                description: "貨件已送達取件門市", location: "新城康樂店" },
            milestone: [
                { key_stage: "InfoReceived", time_utc: "2026-09-05T01:00:00Z" },
                { key_stage: "AvailableForPickup", time_utc: "2026-09-07T09:00:00Z" },
            ],
        },
    });
    assert.strictEqual(r.status, "AvailableForPickup");
    assert.strictEqual(r.status_time, "2026-09-07T09:00:00Z");
    assert.strictEqual(r.last_event_time, "2026-09-08T02:00:00Z");
    assert.strictEqual(r.last_event, "貨件已送達取件門市 · 新城康樂店");
    assert.strictEqual(r.carrier, 100123);
});
t("không có milestone thì mốc trạng thái = mốc sự kiện mới nhất", () => {
    const r = K.parseTrackInfo({ number: "X", track_info: {
        latest_status: { status: "InTransit" },
        latest_event: { time_iso: "2026-09-08T10:00:00+08:00", description: "運送中" } } });
    assert.strictEqual(r.status_time, "2026-09-08T10:00:00+08:00");
});
t("17TRACK chưa có tin → trạng thái null, không vỡ", () => {
    const r = K.parseTrackInfo({ number: "X", carrier: null });
    assert.strictEqual(r.status, null);
    assert.strictEqual(r.last_event, null);
    assert.strictEqual(r.carrier, null);
});


console.log(`\n${pass} phép thử — tất cả đạt.`);
