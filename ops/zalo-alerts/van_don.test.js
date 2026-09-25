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

(async () => {
    await t("không có việc thì nói rõ, không im", () => {
        const m = dung(DATA());
        assert.match(m, /VẬN ĐƠN CẦN XỬ LÝ — 26\/09/);
        assert.match(m, /Không có đơn nào cần xử lý/);
    });

    await t("đầu tin: đếm theo mức + tiền đang chờ ở cửa hàng", () => {
        const m = dung(DATA({ alerts: [
            canh("sap_bi_tra_ve", { days_left: 1 }),
            canh("giao_hong", { level: "canh_bao" }, { order_id: "T1552", last_event: "Khách từ chối nhận hàng" }),
            canh("toi_cua_hang", { level: "nhac", days_left: 5 }),
        ] }));
        assert.match(m, /Gấp 1 · 🟠 Cảnh báo 1 · 🔔 Nhắc 1/);
        assert.match(m, /51 đơn đang nằm ở cửa hàng · 53\.699 NT\$/);
        assert.match(m, /17TRACK cập nhật 06:05 26\/09 · còn 9\.600 quota/);
    });

    await t("dòng đơn có đủ thứ để gọi khách: mã, tiền, tên, SĐT, cửa hàng, mã lấy hàng", () => {
        const m = dung(DATA({ alerts: [canh("sap_bi_tra_ve", { days_left: 1 })] }));
        assert.match(m, /1\. T1466 · 1\.499 NT\$ · còn 1 ngày\n {3}Ghen · 0975475359 · 全家新城康樂店 \(mã 026205\)/);
    });

    await t("còn hạn lên trước, gần hết hạn nhất lên đầu; quá hạn ÍT nhất lên đầu", () => {
        const m = dung(DATA({ alerts: [
            canh("sap_bi_tra_ve", { days_left: -20 }, { order_id: "QUA20" }),
            canh("sap_bi_tra_ve", { days_left: 2 }, { order_id: "CON2" }),
            canh("sap_bi_tra_ve", { days_left: -1 }, { order_id: "QUA1" }),
            canh("sap_bi_tra_ve", { days_left: 0 }, { order_id: "CON0" }),
        ] }));
        const thuTu = ["CON0", "CON2", "QUA1", "QUA20"].map((x) => m.indexOf(x));
        assert.deepStrictEqual([...thuTu].sort((a, b) => a - b), thuTu);
        assert.match(m, /CON0 · 1\.499 NT\$ · HẾT HẠN HÔM NAY/);
        assert.match(m, /QUA1 · 1\.499 NT\$ · quá 1 ngày/);
        assert.match(m, /SẮP BỊ TRẢ VỀ — gọi khách ngay \(2\)/);
        assert.match(m, /ĐÃ QUÁ HẠN LẤY \(2\)/);
    });

    await t("in có trần, phần thừa nói rõ còn bao nhiêu + chỗ xem đủ", () => {
        const nhieu = Array.from({ length: 40 }, (_, i) => canh("sap_bi_tra_ve", { days_left: -i - 1 }, { order_id: `Q${i}` }));
        const m = dung(DATA({ alerts: nhieu }), { maxGap: 15 });
        assert.ok(m.includes("Q14") && !m.includes("Q15 "), "in đúng 15 đơn");
        assert.match(m, /Còn 25 đơn không in ở đây\. Xem đủ, chép tin nhắn khách: http:\/\/dash\/talpha/);
    });

    await t("giao hỏng hiện lý do, đứng im hiện số ngày", () => {
        const m = dung(DATA({ alerts: [
            canh("giao_hong", { level: "canh_bao" }, { order_id: "T1552", last_event: "Khách từ chối nhận hàng" }),
            canh("dung_im", { level: "canh_bao", days: 25 }, { order_id: "T1300" }),
        ] }));
        assert.match(m, /GIAO HỎNG · SỰ CỐ \(1\)\n• T1552 · 1\.499 NT\$ · Khách từ chối nhận hàng/);
        assert.match(m, /ĐỨNG IM \(1\)[^\n]*\n• T1300 · 1\.499 NT\$ · 25 ngày không nhúc nhích/);
    });

    await t("hết chỗ in thì mục sau chỉ còn một dòng đếm, không in tiêu đề rỗng", () => {
        const hong = Array.from({ length: 3 }, (_, i) => canh("giao_hong", { level: "canh_bao" }, { order_id: `H${i}` }));
        const m = dung(DATA({ alerts: [...hong, canh("dung_im", { level: "canh_bao", days: 25 }, { order_id: "T1300" })] }), { maxCanhBao: 3 });
        assert.ok(!m.includes("ĐỨNG IM ("), "không in tiêu đề mục rỗng");
        assert.match(m, /1 đơn đứng im — hỏi lại hãng vận chuyển, xem ở dashboard/);
        assert.match(m, /Còn 1 đơn không in ở đây/);
    });

    await t("lệch đối tác ↔ 17TRACK có mục riêng, tính vào Cảnh báo", () => {
        const m = dung(DATA({ alerts: [
            canh("lech_trang_thai", { level: "canh_bao", detail: "Đối tác ghi ĐÃ GIAO, 17TRACK ghi hàng đang/đã HOÀN — tiền COD có thể không về." }, { order_id: "T1400" }),
        ] }));
        assert.match(m, /Cảnh báo 1/);
        assert.match(m, /LỆCH ĐỐI TÁC ↔ 17TRACK \(1\)/);
        assert.match(m, /• T1400 · 1\.499 NT\$ · Đối tác ghi ĐÃ GIAO/);
    });

    await t("17TRACK lỗi thì tin TỰ TỐ, không gửi số cũ như số mới", () => {
        const m = dung(DATA({
            last_sync: { at: "2026-09-25T23:05:00Z", ok: false, error: "17TRACK báo lỗi -18010001 — sai khoá" },
            alerts: [canh("sap_bi_tra_ve", { days_left: 1 })],
        }));
        assert.match(m, /⚠️ 17TRACK lỗi lúc 06:05 26\/09: 17TRACK báo lỗi -18010001 — sai khoá/);
    });

    await t("17TRACK không chạy sáng nay (lần cuối quá 26 giờ) → cảnh báo", () => {
        const m = dung(DATA({ last_sync: { at: "2026-09-23T23:05:00Z", ok: true }, alerts: [canh("sap_bi_tra_ve", { days_left: 1 })] }));
        assert.match(m, /17TRACK chưa đồng bộ từ 06:05 24\/09/);
    });

    await t("hết quota → nói rõ bao nhiêu đơn đang mù và bao giờ có lại", () => {
        const het = dung(DATA({ last_sync: { at: "2026-09-25T23:05:00Z", ok: true, quota_out: true, over_cap: 7, quota: { total: 200, remain: 0 } } }));
        assert.match(het, /HẾT QUOTA 17TRACK — 7 đơn chưa được theo dõi/);
        assert.match(het, /Thêm khoá mới, hoặc chờ quota miễn phí về lại ngày 1/);
    });

    await t("sắp hết quota: ngưỡng theo cỡ gói, gói miễn phí không kêu mỗi ngày", () => {
        const ls = (total, remain) => ({ last_sync: { at: "2026-09-25T23:05:00Z", ok: true, quota: { total, remain } } });
        assert.match(dung(DATA(ls(5000, 150))), /Quota 17TRACK sắp hết — còn 150\/5\.000/);
        assert.ok(!/sắp hết/.test(dung(DATA(ls(200, 150)))), "gói 200 còn 150 là bình thường");
        assert.match(dung(DATA(ls(200, 20))), /Quota 17TRACK sắp hết — còn 20\/200/);
    });

    await t("nhiều khoá: quota cộng, nêu số khoá; khoá hỏng thì nêu đích danh", () => {
        const m = dung(DATA({ last_sync: { at: "2026-09-25T23:05:00Z", ok: true, quota: { total: 400, remain: 300 },
            keys: [{ label: "khoá 1", ok: true }, { label: "khoá 2", ok: false, error: "17TRACK báo lỗi -18010002 ở khoá 2" }] } }));
        assert.match(m, /còn 300 quota \(2 khoá\)/);
        assert.match(m, /17TRACK khoá 2 lỗi: 17TRACK báo lỗi -18010002 ở khoá 2 — mã của khoá này không cập nhật được/);
        assert.ok(!m.includes("khoá 1 lỗi"));
    });

    await t("mã thuộc khoá đã gỡ → cảnh báo", () => {
        const m = dung(DATA({ last_sync: { at: "2026-09-25T23:05:00Z", ok: true, orphaned: 12 } }));
        assert.match(m, /12 mã thuộc khoá 17TRACK đã gỡ khỏi \.env/);
    });

    await t("hết quota: chỉ đếm đơn cần xử lý, không đếm đơn thường để lượt sau", () => {
        const m = dung(DATA({ last_sync: { at: "2026-09-25T23:05:00Z", ok: true, quota_out: true, over_cap: 40, deferred: 35, quota: { total: 400, remain: 0 } } }));
        assert.match(m, /HẾT QUOTA 17TRACK — 5 đơn chưa được theo dõi/);
    });

    await t("chưa có khoá 17TRACK → nói rõ đang chạy bằng bảng đối tác", () => {
        const m = dung(DATA({ has_api_key: false, last_sync: null }));
        assert.match(m, /Nguồn: bảng đối tác \(trễ ~2 ngày\) — chưa bật 17TRACK/);
    });

    await t("bảng đối tác không nạp sáng nay → cảnh báo", () => {
        const m = dung(DATA({ last_import: "2026-09-23T23:01:00Z" }));
        assert.match(m, /Bảng đối tác chưa nạp từ 06:01 24\/09/);
    });

    await t("thiếu tên / SĐT / cửa hàng thì không in dòng trống", () => {
        const m = dung(DATA({ alerts: [canh("sap_bi_tra_ve", { days_left: 1 }, { customer: "", phone: "", store_name: "", cod_local: 0 })] }));
        assert.match(m, /1\. T1466 · còn 1 ngày(\n\n|$)/);
    });

    await t("tin dài vẫn chia được theo khung 1800 ký tự của Zalo", () => {
        const nhieu = Array.from({ length: 30 }, (_, i) => canh("sap_bi_tra_ve", { days_left: -i - 1 }, { order_id: `Q${i}` }));
        const phan = chiaTin(toZalo(buildTinVanDon(DATA({ alerts: nhieu }), { today: TODAY, nowTs: NOW })), 1800);
        assert.ok(phan.every((p) => p.msg.length <= 1800));
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
})().catch(() => process.exit(1));
