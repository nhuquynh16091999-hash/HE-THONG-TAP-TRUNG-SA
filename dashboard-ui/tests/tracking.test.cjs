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
// fromDate: null = luật tuổi cũ (rules đang khai khung ngày cố định — test riêng bên dưới).
const plan = (xs, o = {}) => T.planRegister(xs, NOW, { scope: "tat_ca", fromDate: null, ...o });
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
t("rules: theo dõi hết đơn, không chia nhịp → tat_ca (Sỹ Anh chốt 25/09/2026)", () => {
    assert.strictEqual(T.TRACK_CFG.register_scope, "tat_ca");
});

console.log("── 17TRACK: tu_dong — đơn cảnh báo lấy hết, đơn thường chia nhịp theo tháng ──");
const nhieuThuong = (n) => Array.from({ length: n }, (_, i) =>
    reg({ track17_code: `73N9${String(i).padStart(7, "0")}`, status: "InTransit" }));
t("đơn cảnh báo lấy hết, đơn thường chỉ lấy (còn − giữ lại) ÷ số ngày còn lại", () => {
    // 2 đơn cảnh báo + 50 đơn thường; quota tổng 200, còn 100, còn 5 ngày, giữ lại 10% = 20
    // → nhịp = floor((100 − 2 − 20) / 5) = 15 đơn thường.
    const p = T.planRegister([...coCanhBao(), ...nhieuThuong(50)], NOW,
        { scope: "tu_dong", quotaRemain: 100, quotaTotal: 200, daysLeft: 5 });
    const codes = p.pick.map((s) => s.track17_code);
    assert.ok(codes.includes("73N00000001") && codes.includes("73N00000002"), "đơn cảnh báo phải có");
    assert.strictEqual(p.pick.length, 2 + 15);
    assert.strictEqual(p.deferred, 52 - 15);   // đơn thường = 50 + 2 đơn không cảnh báo của coCanhBao
    assert.strictEqual(p.quota_limited, false, "chia nhịp không phải hết quota");
});
t("đơn cảnh báo đứng trước dù quota ít", () => {
    const p = T.planRegister([...nhieuThuong(10), ...coCanhBao()], NOW,
        { scope: "tu_dong", quotaRemain: 2, quotaTotal: 200, daysLeft: 5 });
    assert.deepStrictEqual(p.pick.map((s) => s.track17_code).sort(), ["73N00000001", "73N00000002"]);
});
t("quota không đủ cho đơn cảnh báo → báo hết quota", () => {
    const p = T.planRegister(coCanhBao(), NOW, { scope: "tu_dong", quotaRemain: 1, quotaTotal: 200, daysLeft: 5 });
    assert.strictEqual(p.pick.length, 1);
    assert.strictEqual(p.quota_limited, true);
});
t("không hỏi được quota → chỉ đăng ký đơn cảnh báo (mù quota không đốt vào đơn thường)", () => {
    const p = T.planRegister([...coCanhBao(), ...nhieuThuong(20)], NOW, { scope: "tu_dong", quotaRemain: null });
    assert.strictEqual(p.pick.length, 2);
});
t("số ngày còn lại trong tháng tính theo giờ Việt Nam", () => {
    assert.strictEqual(T.daysLeftInMonth(new Date("2026-09-25T01:00:00Z")), 6);   // 25→30/09
    assert.strictEqual(T.daysLeftInMonth(new Date("2026-09-30T18:00:00Z")), 31);  // 01/10 giờ VN
});

console.log("── 17TRACK: khung theo NGÀY TẠO đơn (từ 20/08) ──");
t("đơn tạo từ ngày khung trở đi thì theo dõi, trước đó thì bỏ", () => {
    const xs = [
        reg({ track17_code: "73N00000019", order_date: "2026-08-19", ship_date: "2026-08-25" }),
        reg({ track17_code: "73N00000020", order_date: "2026-08-20", ship_date: "2026-08-22" }),
    ];
    const p = T.planRegister(xs, NOW, { scope: "tat_ca", fromDate: "2026-08-20", terminal: false });
    assert.deepStrictEqual(p.pick.map((s) => s.track17_code), ["73N00000020"]);
});
t("khung ngày cố định thay luật tuổi: đơn tạo 20/08 vẫn theo dõi dù quá 45 ngày", () => {
    const xa = new Date("2026-10-20T08:00:00Z");
    const s = reg({ order_date: "2026-08-21", ship_date: "2026-08-23" });
    assert.strictEqual(T.planRegister([s], xa, { scope: "tat_ca", fromDate: "2026-08-20" }).pick.length, 1);
});
t("đơn đã kết thúc: đăng ký để đối chiếu, đứng cuối hàng", () => {
    const xs = [
        reg({ track17_code: "73N00000001", status: "Delivered", order_date: "2026-08-25" }),
        reg({ track17_code: "73N00000002", status: "InTransit", order_date: "2026-08-25" }),
    ];
    const p = T.planRegister(xs, NOW, { scope: "tat_ca", fromDate: "2026-08-20", terminal: true });
    assert.deepStrictEqual(p.pick.map((s) => s.track17_code), ["73N00000002", "73N00000001"]);
});
t("không có khung ngày cố định thì KHÔNG đăng ký đơn đã kết thúc (tránh cả nghìn mã)", () => {
    const s = reg({ status: "Delivered" });
    assert.strictEqual(T.planRegister([s], NOW, { scope: "tat_ca", fromDate: null, terminal: true }).pick.length, 0);
});
t("scope canh_bao thì không đăng ký đơn đã kết thúc", () => {
    const s = reg({ status: "Delivered", order_date: "2026-08-25" });
    assert.strictEqual(T.planRegister([s], NOW, { scope: "canh_bao", fromDate: "2026-08-20", terminal: true }).pick.length, 0);
});
t("rules: khung từ 20/08, đối chiếu đơn đã kết thúc", () => {
    assert.strictEqual(T.TRACK_CFG.register_from_date, "2026-08-20");
    assert.strictEqual(T.TRACK_CFG.register_terminal, true);
});

console.log("── 17TRACK: đối chiếu đơn đối tác ghi kết thúc ──");
t("đối tác ghi đã giao, 17TRACK ghi đang hoàn → cảnh báo mất tiền", () => {
    assert.match(T.statusMismatch("Delivered", "Exception", "Exception_Returning"), /đang\/đã HOÀN/);
});
t("đối tác ghi đã giao, 17TRACK ghi giao hỏng → cảnh báo", () => {
    assert.match(T.statusMismatch("Delivered", "DeliveryFailure", null), /kiểm lại/);
});
t("đối tác ghi hoàn/huỷ, 17TRACK ghi khách đã nhận → tiền phải về", () => {
    assert.match(T.statusMismatch("Returned", "Delivered", null), /KHÁCH ĐÃ NHẬN/);
    assert.match(T.statusMismatch("Cancelled", "Delivered", null), /KHÁCH ĐÃ NHẬN/);
});
t("khớp, hoặc 17TRACK chỉ chậm cập nhật → không báo (tránh nhiễu)", () => {
    assert.strictEqual(T.statusMismatch("Delivered", "Delivered", null), null);
    assert.strictEqual(T.statusMismatch("Delivered", "AvailableForPickup", null), null);
    assert.strictEqual(T.statusMismatch("Returned", "Exception", "Exception_Returned"), null);
    assert.strictEqual(T.statusMismatch("Delivered", "NotFound", null), null);
    assert.strictEqual(T.statusMismatch("Delivered", null, null), null);
});
t("buildAlerts nêu đơn lệch ở mức Cảnh báo", () => {
    const s = ship({ status: "Delivered", t17_status: "Exception", t17_sub_status: "Exception_Returning", t17_event: "退回寄件人" });
    const a = T.buildAlerts([s], NOW);
    assert.strictEqual(a.length, 1);
    assert.strictEqual(a[0].code, "lech_trang_thai");
    assert.strictEqual(a[0].level, "canh_bao");
    assert.match(a[0].detail, /退回寄件人/);
});
t("đơn đối tác ghi kết thúc đã đăng ký vẫn được hỏi trạng thái (để đối chiếu)", () => {
    const xs = [
        reg({ registered: true, track17_code: "73N00000001", status: "Delivered", source: "doi_tac" }),
        reg({ registered: true, track17_code: "73N00000002", status: "Delivered", source: "17track" }),
    ];
    assert.deepStrictEqual(T.planTrack(xs), ["73N00000001"]);
});

console.log("── 17TRACK: sửa mã hỏng từ Sheet ──");
t("FamilyMart mất số 0 đầu (10 số 67…) → thêm lại số 0", () => {
    assert.strictEqual(T.fixTrack17Code("6722460150"), "06722460150");
});
t("mã khác giữ nguyên (giao tận nhà 187…, 7-Eleven)", () => {
    assert.strictEqual(T.fixTrack17Code("1870459566"), "1870459566");
    assert.strictEqual(T.fixTrack17Code("73N18053018"), "73N18053018");
    assert.strictEqual(T.fixTrack17Code(null), null);
});

console.log("── 17TRACK: chọn mã hỏi trạng thái (miễn phí) ──");
t("chỉ hỏi mã đã đăng ký, bỏ mã 17TRACK đã tự báo kết thúc", () => {
    const xs = [
        reg({ registered: true, track17_code: "73N00000001", status: "InTransit" }),
        reg({ registered: true, track17_code: "73N00000002", status: "Delivered", source: "17track" }),
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

console.log("── 17TRACK: khai thẳng mã hãng, không để tự đoán ──");
t("73N + 8 số → 7-ELEVEN (TW) 190456", () => {
    // Để tự đoán: 36 mã 7-Eleven bị từ chối "Carrier cannot be detected" (25/09/2026).
    assert.strictEqual(T.carrierFor("73N18053018"), 190456);
});
t("11 số → FamiPort (TW) 100227", () => {
    // Để tự đoán: 7 mã FamilyMart thành Poste Italiane — tốn quota, không bao giờ có tin.
    assert.strictEqual(T.carrierFor("06722435584"), 100227);
});
t("giao tận nhà (10 số) → HCT 新竹物流 190466 (Sỹ Anh xác nhận đối tác đi Hsinchu)", () => {
    assert.strictEqual(T.carrierFor("1870459566"), 190466);
    assert.strictEqual(T.carrierFor("7564409963"), 190466);
});
t("mã 12 số chưa rõ hãng, hoặc không có mã → để 17TRACK tự đoán", () => {
    assert.strictEqual(T.carrierFor("620712345678"), T.TRACK_CFG.carrier);
    assert.strictEqual(T.carrierFor(null), T.TRACK_CFG.carrier);
});
t("mã FamilyMart mất số 0 được sửa TRƯỚC khi chọn hãng → FamiPort, không thành HCT", () => {
    assert.strictEqual(T.carrierFor(T.fixTrack17Code("6722460150")), 100227);
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


console.log("── Thị trường: Singapore tách riêng Đài Loan ──");
const SG = T.trackMarket("SG");
t("SG khai trong rules: sổ riêng, J&T Express (SG) 100229, SGD, đứng im 7 ngày", () => {
    assert.strictEqual(SG.code, "SG");
    assert.strictEqual(SG.store, "tracking_sg");
    assert.strictEqual(SG.carrier, 100229);
    assert.strictEqual(SG.currency, "SGD");
    assert.strictEqual(SG.stale_days, 7);
    assert.deepStrictEqual(T.TRACK_MARKETS.map((m) => m.code), ["TW", "SG"]);
});
t("mã thị trường lạ hoặc trống → Đài (sổ gốc)", () => {
    assert.strictEqual(T.trackMarket(null).code, "TW");
    assert.strictEqual(T.trackMarket("xx").store, "tracking");
    assert.strictEqual(T.trackMarket("sg").code, "SG");
});
t("hãng: SG luôn J&T SG; Đài vẫn theo dạng mã", () => {
    assert.strictEqual(T.carrierFor("JT20260922012345", "SG"), 100229);
    assert.strictEqual(T.carrierFor("73N18053018", "SG"), 100229);
    assert.strictEqual(T.carrierFor("73N18053018"), 190456);
    assert.strictEqual(T.carrierFor("JT20260922012345"), T.TRACK_CFG.carrier);
});
t("trạng thái bảng SG → chuẩn; chữ lạ → null (hiện nguyên văn)", () => {
    assert.strictEqual(T.mapMarketStatus(SG, "Đang trung chuyển"), "InTransit");
    assert.strictEqual(T.mapMarketStatus(SG, " đã giao thành công "), "Delivered");
    assert.strictEqual(T.mapMarketStatus(SG, "Khách hẹn lúc khác giao"), "DeliveryFailure");
    assert.strictEqual(T.mapMarketStatus(SG, "Chưa lên đơn"), "InfoReceived");
    assert.strictEqual(T.mapMarketStatus(SG, "Trạng thái mới lạ"), null);
    assert.strictEqual(T.mapMarketStatus(SG, ""), null);
});
const row = (o = {}) => ({
    order_no: "S1010", tracking: "JT20260922012345", status: "Đang trung chuyển", note: "",
    order_date: "2026-09-20", ship_date: "2026-09-21", contact_name: "Ana", phone: "81234567", cod: 89, ...o,
});
t("dòng bảng SG → vận đơn: mã J&T là mã 17TRACK, tiền SGD, ghi chú đi kèm", () => {
    const s = T.partnerOrderShipment(SG, row({ note: "khách muốn nhận ngày 9/10" }), undefined, false);
    assert.strictEqual(s.tracking, "JT20260922012345");
    assert.strictEqual(s.track17_code, "JT20260922012345");
    assert.strictEqual(s.order_id, "S1010");
    assert.strictEqual(s.status, "InTransit");
    assert.strictEqual(s.source, "doi_tac");
    assert.strictEqual(s.cod_local, 89);
    assert.strictEqual(s.note, "khách muốn nhận ngày 9/10");
    assert.strictEqual(s.status_since, "2026-09-21T00:00:00Z");
});
t("chưa có mã vận đơn → khoá theo mã đơn, không đem đăng ký", () => {
    const s = T.partnerOrderShipment(SG, row({ tracking: "", status: "Chưa lên đơn" }), undefined, false);
    assert.strictEqual(s.tracking, "DON-S1010");
    assert.strictEqual(s.track17_code, null);
});
t("17TRACK có tin thì dùng 17TRACK", () => {
    const saved = { status: "OutForDelivery", source: "17track", status_since: "2026-09-24T02:00:00Z", last_event: "Out for delivery" };
    const s = T.partnerOrderShipment(SG, row(), saved, true);
    assert.strictEqual(s.status, "OutForDelivery");
    assert.strictEqual(s.source, "17track");
    assert.strictEqual(s.t17_status, null);
});
t("đối tác ghi KẾT THÚC mà 17TRACK chưa → giữ đối tác, 17TRACK sang t17_* để báo lệch", () => {
    const saved = { status: "Exception", sub_status: "Exception_Returning", source: "17track", last_event: "Return to sender" };
    const s = T.partnerOrderShipment(SG, row({ status: "Đã giao thành công" }), saved, true);
    assert.strictEqual(s.status, "Delivered");
    assert.strictEqual(s.t17_status, "Exception");
    assert.strictEqual(T.buildAlerts([s], NOW)[0].code, "lech_trang_thai");
});
t("chưa có mã vận đơn mà nằm lâu → 'Chưa gửi hàng', hỏi đối tác chứ không hỏi hãng", () => {
    const s = T.partnerOrderShipment(SG, row({ tracking: "", status: "Đã lên đơn", ship_date: null, order_date: "2026-09-01" }), undefined, false);
    const a = T.buildAlerts([s], NOW, { staleDays: 7 });
    assert.strictEqual(a[0].code, "dung_im");
    assert.match(a[0].title, /^Chưa gửi hàng 9 ngày$/);
    assert.match(a[0].detail, /hỏi đối tác/);
});
t("đứng im theo ngưỡng từng nước: SG 7 ngày, Đài 21 ngày", () => {
    const s = ship({ status: "InTransit", status_since: daysAgo(8), last_event_time: daysAgo(8) });
    assert.strictEqual(T.buildAlerts([s], NOW, { staleDays: 7 })[0].code, "dung_im");
    assert.strictEqual(T.buildAlerts([s], NOW).length, 0);
});

console.log("── 17TRACK: nhiều khoá ──");
t("đọc mọi khoá theo thứ tự, bỏ khoá trùng và khoá rỗng", () => {
    const ks = K.apiKeys({
        TRACK17_API_KEY_10: "KHOA10", TRACK17_API_KEY: "KHOA1", TRACK17_API_KEY_2: "KHOA2",
        TRACK17_API_KEY_3: "KHOA1", TRACK17_API_KEY_4: "  ", KHAC: "x",
    });
    assert.deepStrictEqual(ks.map((k) => k.key), ["KHOA1", "KHOA2", "KHOA10"]);
    assert.deepStrictEqual(ks.map((k) => k.label), ["khoá 1", "khoá 2", "khoá 3"]);
    assert.ok(ks.every((k) => /^[0-9a-f]{8}$/.test(k.id)), "id là băm, không phải khoá thật");
    assert.ok(!ks.some((k) => k.id.includes("KHOA")));
});
t("chia mã cho khoá còn nhiều quota trước, khoá không rõ quota thì không giao", () => {
    const m = K.allocateToKeys(["a", "b", "c", "d", "e"], [
        { id: "k1", remain: 2 }, { id: "k2", remain: 10 }, { id: "chet", remain: null }, { id: "het", remain: 0 },
    ]);
    assert.deepStrictEqual(m.get("k2"), ["a", "b", "c", "d", "e"]);
    assert.strictEqual(m.has("k1"), false);
    const m2 = K.allocateToKeys(["a", "b", "c", "d", "e"], [{ id: "k1", remain: 2 }, { id: "k2", remain: 1 }]);
    assert.deepStrictEqual(m2.get("k1"), ["a", "b"]);
    assert.deepStrictEqual(m2.get("k2"), ["c"]);
});

// Lô sau hỏng thì lô trước (đã trừ quota) vẫn phải về tay bên gọi để ghi sổ —
// không thì lượt sau đem đăng ký lại ở một khoá KHÁC, tốn quota hai lần.
(async () => {
    const goc = global.fetch;
    let lan = 0;
    global.fetch = async (_url, init) => {
        lan++;
        const body = JSON.parse(init.body);
        if (lan === 1) {
            return { ok: true, status: 200, json: async () => ({ code: 0, data: { accepted: body.map((x) => ({ number: x.number, carrier: 190456 })), rejected: [] } }) };
        }
        return { ok: false, status: 429, json: async () => ({}) };
    };
    try {
        const so = Array.from({ length: 45 }, (_, i) => `73N8${String(i).padStart(7, "0")}`);
        await assert.rejects(K.register({ id: "k", label: "khoá 1", key: "x" }, so), (e) => {
            assert.strictEqual(e.code, 429);
            assert.strictEqual(e.partial.accepted.length, 40, "lô đầu 40 mã đã đăng ký phải còn");
            return true;
        });
        pass++; console.log("  ✓ lô sau hỏng vẫn trả về phần đã đăng ký (e.partial)");
    } finally { global.fetch = goc; }
    console.log(`\n${pass} phép thử — tất cả đạt.`);
})().catch((e) => { console.error(e); process.exit(1); });
