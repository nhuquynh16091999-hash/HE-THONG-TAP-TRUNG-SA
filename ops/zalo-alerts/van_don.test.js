// node van_don.test.js   (không gọi mạng, không cần cài zca-js)
// Số liệu dưới đây là số DỰNG cho test, không phải đơn thật.
const assert = require("assert");
const { buildVanDonSang, buildVanDonToi, fetchVanDon, suKienNgay } = require("./van_don");
const { toZalo, chiaTin } = require("./zalo_text");

let ok = 0;
const t = async (ten, fn) => {
    try { await fn(); ok++; }
    catch (e) { console.error(`✗ ${ten}`); throw e; }
};
const tron = (s) => toZalo(s).msg;

const NOW = Date.parse("2026-09-26T01:30:00Z");          // 08:30 giờ VN
const TODAY = "2026-09-26";
const PHU_TRACH = { ten: "Thương", uid: "3346668495041864321" };
// Mốc trong ngày VN: "2026-09-25 10:00 VN" = 03:00Z.
const luc = (ngay, gio = "10:00") => new Date(Date.parse(`${ngay}T${gio}:00+07:00`)).toISOString();

const don = (o = {}) => ({
    tracking: "18024614", track17_code: "73N18024614", order_id: "T1466", customer: "Ghen", phone: "0975475359",
    store_name: "全家新城康樂店", store_code: "026205", cod_local: 1499, status: "AvailableForPickup",
    status_since: luc("2026-09-20"), source: "17track", ...o,
});
const canh = (code, o = {}, s = {}) => ({ level: "gap", code, title: "", detail: "", days: 3, ...o, shipment: don(s) });
const DATA = (o = {}) => ({
    market: { code: "TW", label: "Đài Loan", currency: "NT$" },
    has_api_key: true,
    last_sync: { at: "2026-09-25T23:05:00Z", ok: true, quota: { total: 600, used: 385, remain: 215 } },
    last_import: "2026-09-25T23:01:00Z",
    counts: { AvailableForPickup: 49 },
    totals: { at_store_value: 49711 },
    shipments: [],
    alerts: [],
    ...o,
});
const sang = (d, o = {}) => buildVanDonSang(d, { today: TODAY, nowTs: NOW, phuTrach: PHU_TRACH, ...o });

(async () => {
    // ── SÁNG · Đài Loan ──
    await t("đầu tin: tên nước, giờ 17TRACK, quota; hôm qua đếm theo ngày VN", () => {
        const shipments = [
            don({ tracking: "A", status: "Delivered", status_since: luc("2026-09-25"), cod_local: 999 }),
            don({ tracking: "B", status: "Delivered", status_since: luc("2026-09-25", "23:30"), cod_local: 1000 }),
            don({ tracking: "C", status: "Delivered", status_since: luc("2026-09-24"), cod_local: 5000 }),   // hôm kia
            don({ tracking: "D", status: "AvailableForPickup", status_since: luc("2026-09-25") }),
            don({ tracking: "E", status: "Exception", sub_status: "Exception_Returning", status_since: luc("2026-09-25"), cod_local: 799 }),
        ];
        const m = tron(sang(DATA({ shipments })).text);
        const dong = m.split("\n");
        assert.strictEqual(dong[0], "☀️ VẬN ĐƠN ĐÀI LOAN · SÁNG 26/09");
        assert.strictEqual(dong[1], "17TRACK 06:05 ✓ · quota còn 215/600");
        assert.ok(m.includes("📊 HÔM QUA 25/09\n✅ Khách đã lấy 2 đơn · 1.999 NT$"), m);
        assert.ok(m.includes("🏪 Mới tới cửa hàng 1 · ↩️ Bắt đầu hoàn 1 · 799 NT$"), m);
        assert.ok(m.includes("📦 Đang nằm cửa hàng 49 đơn · 49.711 NT$"));
    });

    await t("khách phải gọi: đủ mã · tiền · hạn, tên SĐT, cửa hàng + mã lấy hàng, tin tiếng Trung soạn sẵn", () => {
        const r = sang(DATA({ alerts: [
            canh("sap_bi_tra_ve", { days_left: 2 }, { order_id: "CON2", tracking: "K2" }),
            canh("sap_bi_tra_ve", { days_left: 0 }, { order_id: "T1577", tracking: "K0", customer: "Ana", phone: "0912345359", store_name: "觀月", store_code: "211114", cod_local: 1399 }),
        ] }));
        const m = tron(r.text);
        assert.ok(m.includes("☎️ @Thương · GỌI 2 KHÁCH SẮP BỊ TRẢ VỀ"), m);
        assert.ok(m.includes("1. T1577 · 1.399 NT$ · HẾT HẠN HÔM NAY\n👤 Ana · 0912345359\n🏪 觀月 · mã lấy hàng 211114\n"
            + "💬 您好 Ana，您的包裹已送達 觀月，取貨編號 211114。今天是最後取件日，逾期將退回。謝謝！"), m);
        assert.ok(m.includes("2. CON2 · 1.499 NT$ · còn 2 ngày"));
        assert.ok(m.includes("請於 2 天內領取，逾期將退回。"), "còn ngày thì tin ghi số ngày");
        assert.deepStrictEqual(r.goi, ["K0", "K2"], "bot lưu đúng khoá, đúng thứ tự gọi");
    });

    await t("@Thương là NHẮC TÊN thật: điện thoại Thương báo", () => {
        const z = toZalo(sang(DATA({ alerts: [canh("sap_bi_tra_ve", { days_left: 1 })] })).text);
        const m = z.mentions.find((x) => z.msg.slice(x.pos, x.pos + x.len) === "@Thương");
        assert.ok(m, "phải có mention @Thương");
        assert.strictEqual(m.uid, "3346668495041864321");
    });

    await t("khách MỚI TỚI: chỉ hàng tới hôm qua/hôm nay, mỗi khách kèm tin nhắn soạn sẵn", () => {
        const r = sang(DATA({ alerts: [
            canh("toi_cua_hang", { level: "nhac", days_left: 6 }, { order_id: "T1701", tracking: "M1", status_since: luc("2026-09-25"), customer: "Maria", phone: "0905123118", store_name: "全家台南金華店", store_code: "024301", cod_local: 999 }),
            canh("toi_cua_hang", { level: "nhac", days_left: 4 }, { order_id: "CU", tracking: "M2", status_since: luc("2026-09-22") }),
        ] }));
        const m = tron(r.text);
        assert.ok(m.includes("📬 @Thương · NHẮN 1 KHÁCH HÀNG MỚI TỚI"), m);
        assert.ok(m.includes("T1701 · 999 NT$ · còn 6 ngày\n👤 Maria · 0905123118 · 🏪 全家台南金華店 #024301\n💬 您好 Maria"), m);
        assert.ok(!m.includes("CU ·"), "hàng tới từ 22/09 đã nhắn rồi, không nhắn lại");
        assert.deepStrictEqual(r.moiToi, ["M1"]);
    });

    await t("không có khách phải gọi thì nói rõ", () => {
        const m = tron(sang(DATA()).text);
        assert.ok(m.includes("☎️ Không có khách nào phải gọi gấp hôm nay ✅"), m);
    });

    await t("hỏi đối tác + kiểm đơn lệch: mỗi loại một dòng mã", () => {
        const m = tron(sang(DATA({ alerts: [
            canh("sap_bi_tra_ve", { days_left: -1 }, { order_id: "Q1" }),
            canh("sap_bi_tra_ve", { days_left: -20 }, { order_id: "Q20" }),
            canh("giao_hong", { level: "canh_bao" }, { order_id: "H1", status: "Exception", sub_status: "Exception_Other" }),
            canh("giao_hong", { level: "canh_bao" }, { order_id: "HOAN", status: "Exception", sub_status: "Exception_Returning" }),
            canh("dung_im", { level: "canh_bao", days: 21 }, { order_id: "T1579" }),
            canh("dung_im", { level: "canh_bao", days: 9 }, { order_id: "T1750", track17_code: null }),
            canh("lech_trang_thai", { level: "canh_bao", detail: "Đối tác ghi ĐÃ GIAO, 17TRACK ghi hàng đang/đã HOÀN — tiền COD có thể không về." }, { order_id: "T1652" }),
        ] })).text);
        assert.ok(m.includes("🔎 HỎI ĐỐI TÁC\n• 2 đơn quá hạn còn giữ không: Q1 (1n) · Q20 (20n)"), m);
        assert.ok(m.includes("• 1 đơn giao hỏng/sự cố: H1 (sự cố)"), m);
        assert.ok(!m.includes("HOAN"), "hàng đang hoàn không cần hỏi");
        assert.ok(m.includes("• 1 đơn không nhúc nhích: T1579 (21n)"));
        assert.ok(m.includes("• 1 đơn chưa gửi hàng: T1750 (9n)"));
        assert.ok(m.includes("💰 KIỂM 1 ĐƠN LỆCH trước đối soát COD\n• T1652: Đối tác ghi ĐÃ GIAO, 17TRACK ghi hàng đang/đã HOÀN"), m);
    });

    await t("17TRACK lỗi / hết quota → cảnh báo ngay dưới đầu tin", () => {
        const loi = tron(sang(DATA({ last_sync: { at: "2026-09-25T23:05:00Z", ok: false, error: "sai khoá" } })).text);
        assert.ok(loi.includes("⚠️ 17TRACK lỗi 06:05 26/09: sai khoá"), loi);
        const het = tron(sang(DATA({ last_sync: { at: "2026-09-25T23:05:00Z", ok: true, quota_out: true, over_cap: 7, quota: { total: 600, remain: 0 } } })).text);
        assert.ok(het.includes("⚠️ HẾT QUOTA 17TRACK — 7 đơn chưa được theo dõi: thêm khoá mới hoặc chờ ngày 1"), het);
    });

    await t("/vandon gõ tay: cùng khuôn, đổi dòng đầu", () => {
        const m = tron(sang(DATA(), { tieuDe: "📦 VẬN ĐƠN ĐÀI LOAN · 14:05 26/09" }).text);
        assert.strictEqual(m.split("\n")[0], "📦 VẬN ĐƠN ĐÀI LOAN · 14:05 26/09");
    });

    await t("ngày đông khách: tin tự chia, mỗi phần ≤ 1800 ký tự Zalo", () => {
        const alerts = Array.from({ length: 15 }, (_, i) => canh("sap_bi_tra_ve", { days_left: 1 }, { order_id: `X${i}`, tracking: `K${i}` }));
        const phan = chiaTin(toZalo(sang(DATA({ alerts })).text), 1800);
        assert.ok(phan.length >= 2 && phan.every((p) => p.msg.length <= 1800));
    });

    // ── SÁNG · Singapore ──
    const SG = (o = {}) => DATA({ market: { code: "SG", label: "Singapore", currency: "SGD" },
        counts: { InTransit: 30, InfoReceived: 7, OutForDelivery: 1 }, totals: { at_store_value: 0 }, ...o });
    await t("SG: tiêu đề nước, hôm qua giao thành công, đang đi giao / trên đường", () => {
        const m = tron(sang(SG({ shipments: [don({ status: "Delivered", status_since: luc("2026-09-25"), cod_local: 99 })] })).text);
        assert.ok(m.startsWith("☀️ VẬN ĐƠN SINGAPORE · SÁNG 26/09"), m);
        assert.ok(m.includes("✅ Giao thành công 1 đơn · 99 SGD"), m);
        assert.ok(m.includes("🚚 Đang đi giao 1 đơn · 📦 Đang trên đường 37 đơn"), m);
        assert.ok(!m.includes("cửa hàng"));
    });
    await t("SG: gọi = giao hỏng / hẹn lại, kèm khu vực, ghi chú đối tác, tin tiếng Anh", () => {
        const r = sang(SG({ alerts: [
            canh("giao_hong", { level: "canh_bao" }, { order_id: "S1011", tracking: "JT2026092201", track17_code: "JT2026092201",
                customer: "Joy", phone: "81234567", city: "Tampines", store_name: "", store_code: "", cod_local: 69,
                source: "doi_tac", status: "DeliveryFailure", raw_status: "Khách hẹn lúc khác giao", note: "Giao lại vào 28" }),
            canh("giao_hong", { level: "canh_bao" }, { order_id: "S1013", status: "Exception", sub_status: "Exception_Returning" }),
        ] }));
        const m = tron(r.text);
        assert.ok(m.includes("☎️ @Thương · GỌI 1 KHÁCH GIAO HỎNG / HẸN LẠI"), m);
        assert.ok(m.includes("1. S1011 · 69 SGD · khách hẹn giao lại\n👤 Joy · 81234567 · Tampines\n📝 Đối tác ghi: \"Giao lại vào 28\"\n"
            + "💬 Hi Joy, J&T could not deliver your parcel JT2026092201."), m);
        assert.ok(!m.includes("S1013"), "hàng đang hoàn không lên danh sách gọi");
        assert.ok(!m.includes("📬"), "Singapore không có mục khách mới tới cửa hàng");
        assert.deepStrictEqual(r.goi, ["JT2026092201"]);
    });

    // ── TỐI ──
    const TOI_NOW = Date.parse("2026-09-26T15:00:00Z");       // 22:00 giờ VN
    const toi = (d, o = {}) => tron(buildVanDonToi(d, { today: TODAY, nowTs: TOI_NOW, ...o }));
    await t("tối: chấm danh sách sáng — đã lấy (cứu tiền), chưa lấy MAI HẾT HẠN, bị trả về", () => {
        const shipments = [
            don({ tracking: "K1", order_id: "T1", status: "Delivered", status_since: luc(TODAY, "15:00"), cod_local: 1399 }),
            don({ tracking: "K2", order_id: "T2", status: "AvailableForPickup" }),
            don({ tracking: "K3", order_id: "T3", status: "Exception", sub_status: "Exception_Returned", status_since: luc(TODAY, "12:00"), cod_local: 799 }),
            don({ tracking: "M1", order_id: "T9", status: "Delivered", status_since: luc(TODAY, "18:00"), cod_local: 999 }),
            don({ tracking: "M2", order_id: "T8", status: "AvailableForPickup", status_since: luc("2026-09-25") }),
        ];
        const alerts = [canh("sap_bi_tra_ve", { days_left: 1 }, { tracking: "K2", order_id: "T2" })];
        const m = toi(DATA({ shipments, alerts, last_sync: { at: "2026-09-26T14:30:00Z", ok: true } }),
            { sangNay: { ngay: TODAY, goi: ["K1", "K2", "K3"], moiToi: ["M1", "M2"] } });
        const dong = m.split("\n");
        assert.strictEqual(dong[0], "🌙 VẬN ĐƠN ĐÀI LOAN · TỐI 26/09 · HÔM NAY LÀM ĐƯỢC GÌ");
        assert.strictEqual(dong[1], "17TRACK cập nhật 21:30 ✓");
        assert.ok(m.includes("☎️ 3 KHÁCH PHẢI GỌI SÁNG NAY\n✅ 1 đã lấy · cứu 1.399 NT$\n⏳ 1 chưa lấy, MAI HẾT HẠN: T2\n❌ 1 bị trả về: T3 · 799 NT$"), m);
        assert.ok(m.includes("📬 2 KHÁCH HÀNG MỚI TỚI → 1 đã lấy · 1 còn chờ"), m);
        assert.ok(m.includes("📊 CẢ NGÀY 26/09\n✅ Khách đã lấy 2 đơn · 2.398 NT$"), m);
        assert.ok(m.includes("🏪 Mới tới cửa hàng 0 · ↩️ Bắt đầu hoàn 1 · 799 NT$"), m);
        assert.ok(m.includes("Sáng mai 08:30: 1 khách còn treo ở trên đứng đầu danh sách gọi."));
    });
    await t("tối: không có danh sách sáng (bot vừa bật lại) → chỉ báo số cả ngày", () => {
        const m = toi(DATA());
        assert.ok(!m.includes("☎️"), m);
        assert.ok(m.includes("📊 CẢ NGÀY 26/09"));
    });
    await t("tối SG: 'đã giao' thay cho 'đã lấy'", () => {
        const m = toi(SG({ shipments: [don({ tracking: "J1", order_id: "S1", status: "Delivered", status_since: luc(TODAY, "16:00"), cod_local: 69 })] }),
            { sangNay: { ngay: TODAY, goi: ["J1"], moiToi: [] } });
        assert.ok(m.startsWith("🌙 VẬN ĐƠN SINGAPORE · TỐI 26/09"), m);
        assert.ok(m.includes("☎️ 1 KHÁCH GIAO HỎNG / HẸN LẠI SÁNG NAY\n✅ 1 đã giao · cứu 69 SGD"), m);
        assert.ok(m.includes("✅ Giao thành công 1 đơn · 69 SGD"));
    });

    await t("suKienNgay tính theo NGÀY VIỆT NAM (23:30 VN vẫn là hôm đó)", () => {
        const kq = suKienNgay([don({ status: "Delivered", status_since: "2026-09-25T16:30:00Z" })], "2026-09-25");
        assert.strictEqual(kq.daLay.length, 1);
    });

    await t("fetchVanDon hỏi đúng khoảng ngày, gắn market, báo lỗi route", async () => {
        let url = "";
        const f = async (u) => { url = u; return { ok: true, json: async () => ({ alerts: [] }) }; };
        await fetchVanDon({ url: "http://dash/api/talpha/tracking", rangeDays: 60 }, TODAY, f, "SG");
        assert.strictEqual(url, "http://dash/api/talpha/tracking?from=2026-07-28&to=2026-09-26&market=SG");
        const hong = async () => ({ ok: true, json: async () => ({ error: "Query lỗi" }) });
        await assert.rejects(fetchVanDon({ url: "x" }, TODAY, hong), /Query lỗi/);
    });

    console.log(`van_don: ${ok} phép thử — tất cả đạt.`);
})().catch((e) => { console.error(e.message); process.exit(1); });
