// node van_don.test.js   (không gọi mạng, không cần cài zca-js)
// Số liệu dưới đây là số DỰNG cho test, không phải đơn thật.
const assert = require("assert");
const { buildTinVanDon, fetchVanDon } = require("./van_don");
const { toZalo, chiaTin } = require("./zalo_text");

let ok = 0;
const t = async (ten, fn) => {
    try { await fn(); ok++; }
    catch (e) { console.error(`✗ ${ten}`); throw e; }
};
const tron = (s) => toZalo(s).msg;

const NOW = Date.parse("2026-09-26T01:00:00Z");          // 08:00 giờ VN
const TODAY = "2026-09-26";
const don = (o = {}) => ({
    tracking: "18024614", order_id: "T1466", customer: "Ghen", phone: "0975475359",
    store_name: "全家新城康樂店", store_code: "026205", cod_local: 1499, ...o,
});
const canh = (code, o = {}, s = {}) => ({ level: "gap", code, title: "", detail: "", days: 3, shipment: don(s), ...o });
const DATA = (o = {}) => ({
    has_api_key: true,
    last_sync: { at: "2026-09-25T23:05:00Z", ok: true, registered: 12, checked: 140, quota: { total: 10000, used: 400, remain: 9600 } },
    last_import: "2026-09-25T23:01:00Z",
    counts: { AvailableForPickup: 51 },
    totals: { at_store_value: 53699 },
    alerts: [],
    ...o,
});
const dung = (d, o = {}) => tron(buildTinVanDon(d, { today: TODAY, nowTs: NOW, link: "http://dash/talpha", ...o }));
const nhieu = (n, code, o = {}) => Array.from({ length: n }, (_, i) => canh(code, typeof o === "function" ? o(i) : o, { order_id: `X${i}` }));

(async () => {
    await t("không có việc thì nói rõ, không im", () => {
        const m = dung(DATA());
        assert.match(m, /VẬN ĐƠN 26\/09 · cập nhật 06:05/);
        assert.match(m, /Không có đơn nào cần xử lý/);
    });

    await t("đầu tin 2 dòng: ngày + giờ cập nhật, đơn ở cửa hàng + tiền chờ lấy", () => {
        const m = dung(DATA({ alerts: [canh("sap_bi_tra_ve", { days_left: 1 })] }));
        const [d1, d2] = m.split("\n");
        assert.strictEqual(d1, "📦 VẬN ĐƠN 26/09 · cập nhật 06:05");
        assert.strictEqual(d2, "🏪 51 đơn ở cửa hàng · 53.699 NT$ chờ lấy");
    });

    await t("đơn cần gọi: MỘT dòng, đủ mã · tiền · hạn · tên SĐT · cửa hàng #mã lấy hàng", () => {
        const m = dung(DATA({ alerts: [canh("sap_bi_tra_ve", { days_left: 1 })] }));
        assert.match(m, /☎️ GỌI NGAY — sắp bị trả về \(1\)\n1\. T1466 · 1\.499 · còn 1 ngày · Ghen 0975475359 · 全家新城康樂店 #026205\n/);
    });

    await t("gọi ngay: gần hết hạn lên đầu; quá hạn: quá ÍT ngày lên đầu, gộp một dòng", () => {
        const m = dung(DATA({ alerts: [
            canh("sap_bi_tra_ve", { days_left: -20 }, { order_id: "QUA20" }),
            canh("sap_bi_tra_ve", { days_left: 2 }, { order_id: "CON2" }),
            canh("sap_bi_tra_ve", { days_left: -1 }, { order_id: "QUA1" }),
            canh("sap_bi_tra_ve", { days_left: 0 }, { order_id: "CON0" }),
        ] }));
        assert.match(m, /1\. CON0 · 1\.499 · HÔM NAY ·/);
        assert.match(m, /2\. CON2 · 1\.499 · còn 2 ngày ·/);
        assert.match(m, /⏰ Quá hạn lấy \(2\): QUA1 \(1n\) · QUA20 \(20n\)/);
    });

    await t("có trần: danh sách gọi và dòng liệt kê mã đều nói còn bao nhiêu", () => {
        const m = dung(DATA({ alerts: [
            ...nhieu(20, "sap_bi_tra_ve", { days_left: 1 }),
            ...nhieu(12, "sap_bi_tra_ve", (i) => ({ days_left: -i - 1 })),
        ] }), { maxGap: 15, maxCanhBao: 8 });
        assert.match(m, /15\. X14 ·/);
        assert.ok(!/16\. /.test(m), "không in quá 15 dòng gọi");
        assert.match(m, /… \+5 đơn nữa trên dashboard/);
        assert.match(m, /Quá hạn lấy \(12\): [^\n]* … \+4\n/);
    });

    await t("giao hỏng: hàng hoàn chỉ ĐẾM, sự cố khác liệt kê mã kèm lý do", () => {
        const m = dung(DATA({ alerts: [
            canh("giao_hong", { level: "canh_bao" }, { order_id: "H1", source: "17track", status: "Exception", sub_status: "Exception_Returning" }),
            canh("giao_hong", { level: "canh_bao" }, { order_id: "H2", source: "17track", status: "Exception", sub_status: "Exception_Returned" }),
            canh("giao_hong", { level: "canh_bao" }, { order_id: "H3", source: "doi_tac", status: "DeliveryFailure", raw_status: "Đang hoàn về kho" }),
            canh("giao_hong", { level: "canh_bao" }, { order_id: "T1552", source: "doi_tac", status: "DeliveryFailure", raw_status: "Khách từ chối nhận hàng" }),
            canh("giao_hong", { level: "canh_bao" }, { order_id: "T1553", source: "17track", status: "Exception", sub_status: "Exception_Other" }),
        ] }));
        assert.match(m, /↩️ Hoàn hàng \(3\): đang hoàn 2 · đã hoàn 1/);
        assert.match(m, /⚠️ Giao hỏng \(2\): T1552 \(khách từ chối\) · T1553 \(sự cố\)/);
        assert.ok(!/H1|H2|H3/.test(m), "đơn hoàn không liệt kê mã");
    });

    await t("đứng im, lệch đối tác ↔ 17TRACK, nhắc — mỗi loại một dòng", () => {
        const m = dung(DATA({ alerts: [
            canh("dung_im", { level: "canh_bao", days: 25 }, { order_id: "T1300", track17_code: "73N18000001" }),
            canh("dung_im", { level: "canh_bao", days: 9 }, { order_id: "S1050", track17_code: null }),
            canh("lech_trang_thai", { level: "canh_bao" }, { order_id: "T1400", status: "Delivered", t17_status: "Exception", t17_sub_status: "Exception_Returning" }),
            canh("lech_trang_thai", { level: "canh_bao" }, { order_id: "T1401", status: "Returned", t17_status: "Delivered" }),
            ...nhieu(3, "toi_cua_hang", { level: "nhac", days_left: 5 }),
            canh("chua_dang_ky", { level: "nhac" }),
        ] }));
        assert.match(m, /🐢 Đứng im \(1\): T1300 \(25n\)/);
        assert.match(m, /📦 Chưa gửi hàng \(1\) — hỏi đối tác: S1050 \(9n\)/);
        assert.match(m, /❗ Lệch đối tác ↔ 17TRACK \(2\): T1400 \(ghi giao · 17T hoàn\) · T1401 \(ghi hoàn\/huỷ · 17T khách đã nhận\)/);
        assert.match(m, /📬 3 đơn vừa tới cửa hàng — nhắn khách ra lấy · 1 chưa rõ vị trí/);
    });

    await t("dòng cuối là link dashboard", () => {
        const m = dung(DATA({ alerts: [canh("sap_bi_tra_ve", { days_left: 1 })] }));
        assert.match(m, /\n\n👉 Chi tiết, chép tin nhắn khách: http:\/\/dash\/talpha$/);
    });

    await t("không có vấn đề nguồn thì KHÔNG có dòng cảnh báo nào (quota dư không in)", () => {
        const m = dung(DATA({ alerts: [canh("sap_bi_tra_ve", { days_left: 1 })] }));
        assert.ok(!m.includes("⚠️"), m);
        assert.ok(!/quota/i.test(m));
    });

    await t("17TRACK lỗi thì tin TỰ TỐ, đầu tin không ghi 'cập nhật'", () => {
        const m = dung(DATA({
            last_sync: { at: "2026-09-25T23:05:00Z", ok: false, error: "17TRACK báo lỗi -18010001 — sai khoá" },
            alerts: [canh("sap_bi_tra_ve", { days_left: 1 })],
        }));
        assert.strictEqual(m.split("\n")[0], "📦 VẬN ĐƠN 26/09");
        assert.match(m, /⚠️ 17TRACK lỗi 06:05 26\/09: 17TRACK báo lỗi -18010001 — sai khoá/);
    });

    await t("17TRACK không chạy sáng nay (lần cuối quá 26 giờ) → cảnh báo", () => {
        const m = dung(DATA({ last_sync: { at: "2026-09-23T23:05:00Z", ok: true }, alerts: [canh("sap_bi_tra_ve", { days_left: 1 })] }));
        assert.match(m, /⚠️ 17TRACK chưa chạy từ 06:05 24\/09 — số có thể trễ/);
    });

    await t("hết quota → nói rõ bao nhiêu đơn chưa được theo dõi và làm gì", () => {
        const m = dung(DATA({ last_sync: { at: "2026-09-25T23:05:00Z", ok: true, quota_out: true, over_cap: 7, quota: { total: 200, remain: 0 } } }));
        assert.match(m, /⚠️ HẾT QUOTA 17TRACK — 7 đơn chưa được theo dõi: thêm khoá mới hoặc chờ ngày 1/);
    });

    await t("hết quota: không đếm đơn thường để lượt sau (chia nhịp)", () => {
        const m = dung(DATA({ last_sync: { at: "2026-09-25T23:05:00Z", ok: true, quota_out: true, over_cap: 40, deferred: 35, quota: { total: 400, remain: 0 } } }));
        assert.match(m, /HẾT QUOTA 17TRACK — 5 đơn chưa được theo dõi/);
    });

    await t("sắp hết quota: ngưỡng theo cỡ gói, gói miễn phí không kêu mỗi ngày", () => {
        const ls = (total, remain) => ({ last_sync: { at: "2026-09-25T23:05:00Z", ok: true, quota: { total, remain } } });
        assert.match(dung(DATA(ls(5000, 150))), /Quota 17TRACK sắp hết: còn 150\/5\.000/);
        assert.ok(!/sắp hết/.test(dung(DATA(ls(200, 150)))), "gói 200 còn 150 là bình thường");
        assert.match(dung(DATA(ls(600, 20))), /Quota 17TRACK sắp hết: còn 20\/600/);
    });

    await t("nhiều khoá: khoá hỏng nêu đích danh, khoá tốt không in", () => {
        const m = dung(DATA({ last_sync: { at: "2026-09-25T23:05:00Z", ok: true, quota: { total: 400, remain: 300 },
            keys: [{ label: "khoá 1", ok: true }, { label: "khoá 2", ok: false, error: "17TRACK báo lỗi -18010002 ở khoá 2" }] } }));
        assert.match(m, /⚠️ 17TRACK khoá 2 lỗi: 17TRACK báo lỗi -18010002 ở khoá 2/);
        assert.ok(!m.includes("khoá 1 lỗi"));
    });

    await t("mã thuộc khoá đã gỡ → cảnh báo", () => {
        const m = dung(DATA({ last_sync: { at: "2026-09-25T23:05:00Z", ok: true, orphaned: 12 } }));
        assert.match(m, /⚠️ 12 mã thuộc khoá đã gỡ — không cập nhật được nữa/);
    });

    await t("chưa có khoá 17TRACK → đầu tin ghi 'theo bảng đối tác'", () => {
        const m = dung(DATA({ has_api_key: false, last_sync: null }));
        assert.strictEqual(m.split("\n")[0], "📦 VẬN ĐƠN 26/09 · theo bảng đối tác");
    });

    await t("bảng đối tác không nạp sáng nay → cảnh báo", () => {
        const m = dung(DATA({ last_import: "2026-09-23T23:01:00Z" }));
        assert.match(m, /⚠️ Bảng đối tác chưa nạp từ 06:01 24\/09/);
    });

    await t("thiếu tên / SĐT / cửa hàng / tiền thì bỏ trống gọn, không để dấu · thừa", () => {
        const m = dung(DATA({ alerts: [canh("sap_bi_tra_ve", { days_left: 1 }, { customer: "", phone: "", store_name: "", cod_local: 0 })] }));
        assert.match(m, /\n1\. T1466 · còn 1 ngày\n/);
    });

    await t("ngày bình thường vừa MỘT tin Zalo (1800 ký tự)", () => {
        // Cỡ ngày 25/09/2026: 11 đơn gọi ngay, 10 quá hạn, 46 giao hỏng (44 là hoàn), 28 vừa tới.
        const alerts = [
            ...nhieu(11, "sap_bi_tra_ve", { days_left: 1 }),
            ...nhieu(10, "sap_bi_tra_ve", (i) => ({ days_left: -i - 1 })),
            ...nhieu(44, "giao_hong", { level: "canh_bao" }).map((a) => ({ ...a, shipment: { ...a.shipment, source: "17track", sub_status: "Exception_Returning" } })),
            ...nhieu(2, "giao_hong", { level: "canh_bao" }).map((a) => ({ ...a, shipment: { ...a.shipment, source: "17track", status: "Exception", sub_status: "Exception_Other" } })),
            ...nhieu(28, "toi_cua_hang", { level: "nhac" }),
        ];
        const phan = chiaTin(toZalo(buildTinVanDon(DATA({ alerts }), { today: TODAY, nowTs: NOW, link: "http://139.180.131.21:3000/talpha" })), 1800);
        assert.strictEqual(phan.length, 1, `ra ${phan.length} tin, ${phan.map((p) => p.msg.length).join("+")} ký tự`);
    });

    await t("tin dài bất thường vẫn chia được theo khung 1800 ký tự của Zalo", () => {
        const alerts = nhieu(60, "sap_bi_tra_ve", { days_left: 1 });
        const phan = chiaTin(toZalo(buildTinVanDon(DATA({ alerts }), { today: TODAY, nowTs: NOW, maxGap: 60 })), 1800);
        assert.ok(phan.every((p) => p.msg.length <= 1800));
    });

    // ── Singapore: giao tận nhà (J&T), tin riêng ──
    const SG_DATA = (o = {}) => DATA({ market: { code: "SG", label: "Singapore", currency: "SGD" },
        counts: { InTransit: 30, OutForDelivery: 2 }, totals: { at_store_value: 0 }, ...o });
    await t("SG: tiêu đề có tên nước, không có dòng cửa hàng, có dòng đang đi giao", () => {
        const m = dung(SG_DATA({ alerts: [canh("dung_im", { level: "canh_bao", days: 8 }, { order_id: "S1001" })] }));
        const [d1, d2] = m.split("\n");
        assert.strictEqual(d1, "📦 VẬN ĐƠN SINGAPORE 26/09 · cập nhật 06:05");
        assert.strictEqual(d2, "🚚 2 đơn đang đi giao — báo khách để máy");
        assert.ok(!m.includes("cửa hàng"));
    });
    await t("SG: giao hỏng / khách hẹn lên mục GỌI NGAY, kèm lý do và ghi chú khách", () => {
        const m = dung(SG_DATA({ alerts: [
            canh("giao_hong", { level: "canh_bao" }, { order_id: "S1012", cod_local: 89, customer: "Ana", phone: "81234567",
                store_name: "", store_code: "", source: "doi_tac", status: "DeliveryFailure",
                raw_status: "Khách hẹn lúc khác giao", note: "khách muốn nhận ngày 9/10" }),
            canh("giao_hong", { level: "canh_bao" }, { order_id: "S1013", source: "17track", status: "Exception", sub_status: "Exception_Returning" }),
        ] }));
        assert.match(m, /☎️ GỌI NGAY — giao hỏng, gọi hẹn lại \(1\)\n1\. S1012 · 89 · khách hẹn giao lại · Ana 81234567 · “khách muốn nhận ngày 9\/10”/);
        assert.match(m, /↩️ Hoàn hàng \(1\): đang hoàn 1/);
        assert.ok(!/⚠️ Giao hỏng/.test(m), "SG không lặp giao hỏng ở dòng tóm tắt");
    });
    await t("Đài có tên nước thì tiêu đề ghi ĐÀI LOAN, tiền NT$", () => {
        const m = dung(DATA({ market: { code: "TW", label: "Đài Loan", currency: "NT$" }, alerts: [canh("sap_bi_tra_ve", { days_left: 1 })] }));
        assert.match(m, /^📦 VẬN ĐƠN ĐÀI LOAN 26\/09 · cập nhật 06:05\n🏪 51 đơn ở cửa hàng · 53\.699 NT\$ chờ lấy/);
        assert.match(m, /GỌI NGAY — sắp bị trả về/);
    });
    await t("fetchVanDon gắn market vào địa chỉ", async () => {
        let url = "";
        const f = async (u) => { url = u; return { ok: true, json: async () => ({ alerts: [] }) }; };
        await fetchVanDon({ url: "http://dash/api/talpha/tracking", rangeDays: 60 }, TODAY, f, "SG");
        assert.match(url, /&market=SG$/);
    });

    await t("fetchVanDon hỏi đúng khoảng ngày và báo lỗi route", async () => {
        let url = "";
        const f = async (u) => { url = u; return { ok: true, json: async () => ({ alerts: [] }) }; };
        await fetchVanDon({ url: "http://dash/api/talpha/tracking", rangeDays: 60 }, TODAY, f);
        assert.strictEqual(url, "http://dash/api/talpha/tracking?from=2026-07-28&to=2026-09-26");
        const hong = async () => ({ ok: true, json: async () => ({ error: "Query lỗi" }) });
        await assert.rejects(fetchVanDon({ url: "x" }, TODAY, hong), /Query lỗi/);
    });

    console.log(`van_don: ${ok} phép thử — tất cả đạt.`);
})().catch((e) => { console.error(e.message); process.exit(1); });
