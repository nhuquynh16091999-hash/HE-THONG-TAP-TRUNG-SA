// node nhom_nuoc.test.js   (không gọi mạng, không cần cài zca-js)
// Mỗi nước một nhóm "ADS + VẬN ĐƠN <nước>" (Sỹ Anh chốt 08/10/2026). Số dưới đây là số DỰNG.
const assert = require("assert");
const { buildBaoCaoNuoc, buildCanhBaoNuoc } = require("./daily_report");
const { nuocTuTenNhom, chonNhomTheoTen, NUOC } = require("./rules");
const { huongDanNuoc } = require("./commands");
const { toZalo } = require("./zalo_text");

let ok = 0;
const t = async (ten, fn) => {
    try { await fn(); ok++; }
    catch (e) { console.error(`✗ ${ten}`); throw e; }
};
const tron = (s) => toZalo(s).msg;

const CFG = { realtimeUrl: "http://dash/api/talpha/realtime", sheetReportUrl: "http://dash/api/talpha/sheet-report", recWasteSpend: 300000 };
const NGAY = "2026-10-07";
// Bảng format_all.py ghi: data/bao_cao_nuoc/2026-10.json
const BAN = {
    thang: "2026-10", ghi_luc: "2026-10-08T01:21:00Z", khong_gan: "(không gán)",
    nuoc: {
        Taiwan: {
            "2026-10-06": { Thuong: { ads: 1000000, mess: 40, don: 5, doanh_so: 3000000, ds_giao_tc: 0 } },
            [NGAY]: {
                Thuong: { ads: 1500000, mess: 60, don: 9, doanh_so: 6000000, ds_giao_tc: 0 },
                Loc: { ads: 900000, mess: 30, don: 3, doanh_so: 2000000, ds_giao_tc: 0 },
                "(không gán)": { ads: 0, mess: 0, don: 1, doanh_so: 640000, ds_giao_tc: 0 },
            },
        },
        Singapore: { [NGAY]: { Thai: { ads: 4000000, mess: 120, don: 2, doanh_so: 3600000, ds_giao_tc: 0 } } },
        Japan: { [NGAY]: { Thang: { ads: 300000, mess: 12, don: 0, doanh_so: 0, ds_giao_tc: 0 }, Thuong: { ads: 200000, mess: 4, don: 0, doanh_so: 0, ds_giao_tc: 0 } } },
    },
};
const CAMPS = [
    { campaign_name: "TW/THƯƠNG/PHI/057 - SET12/Golden Fortune Energy Necklace TW/4-10", spend_vnd: 1500000, messages: 60, orders: 6, revenue_vnd: 4000000 },
    { campaign_name: "TW/LỘC/PHI/042/Japan Prime Leather/26-9", spend_vnd: 900000, messages: 30, orders: 0, revenue_vnd: 0 },
    { campaign_name: "SGP/THÁI/PHI/011/Lucky Silver Philippines/05-10", spend_vnd: 4000000, messages: 120, orders: 2, revenue_vnd: 3600000 },
    { campaign_name: "JP/THANG/PHI/002-ATTL/Lucky Charm JP/08-10", spend_vnd: 300000, messages: 12, orders: 0, revenue_vnd: 0 },
    { campaign_name: "JP/THƯƠNG/PHI/011/Lucky Silver JP/08-10", spend_vnd: 200000, messages: 4, orders: 0, revenue_vnd: 0 },
];
const rt = async () => ({ campaigns: CAMPS });
const khongGoiMang = async (url) => { throw new Error(`không được gọi mạng: ${url}`); };

(async () => {
    await t("tên nhóm → nước: đúng mẫu 'ADS + VẬN ĐƠN <nước>' mới nhận", () => {
        assert.strictEqual(nuocTuTenNhom("ADS + VẬN ĐƠN TAIWAN"), "TW");
        assert.strictEqual(nuocTuTenNhom("ADS + VẬN ĐƠN SGP"), "SG");
        assert.strictEqual(nuocTuTenNhom("ADS + VẬN ĐƠN UAE"), "AE");
        assert.strictEqual(nuocTuTenNhom("ADS + VẬN ĐƠN JAPAN"), "JP");
        assert.strictEqual(nuocTuTenNhom("ads+van don nhật bản"), "JP");
        // Nhóm cũ và nhóm lạ: KHÔNG nhận — tin vận đơn có SĐT khách.
        for (const x of ["VẬN ĐƠN SGP", "BÁO CÁO ADS", "ADS + VẬN ĐƠN KOREA", "ADS + VẬN ĐƠN SGP cũ", "Nhóm ADS + VẬN ĐƠN TAIWAN"]) {
            assert.strictEqual(nuocTuTenNhom(x), null, x);
        }
    });

    await t("chọn nhóm theo tên: một nước hai nhóm thì không đoán", () => {
        const ds = [
            { id: "1", name: "ADS + VẬN ĐƠN TAIWAN" }, { id: "2", name: "ADS + VẬN ĐƠN SGP" },
            { id: "3", name: "ADS + VẬN ĐƠN UAE" }, { id: "4", name: "ADS + VẬN ĐƠN UAE" }, { id: "5", name: "VẬN ĐƠN TW" },
        ];
        const r = chonNhomTheoTen(ds, ["TW", "SG", "AE", "JP"]);
        assert.deepStrictEqual(Object.keys(r.chon).sort(), ["SG", "TW"]);
        assert.strictEqual(r.chon.TW.id, "1");
        assert.deepStrictEqual(r.trung.AE.map((g) => g.id), ["3", "4"]);
        assert.deepStrictEqual(r.thieu, ["JP"]);
    });

    await t("tin Đài: chỉ số + camp của Đài, xếp hạng người trong nước, ô không gán để riêng", async () => {
        const r = await buildBaoCaoNuoc(CFG, NGAY, { nuoc: "TW", docBan: () => BAN, layRealtime: rt, fetch: khongGoiMang, tieuDe: "☀️ ADS 🇹🇼 ĐÀI LOAN · SÁNG 08/10 · KẾT QUẢ 07/10" });
        const c = tron(r.tinGop);
        assert.ok(c.includes("💰 Ads 2.400.000đ · DS 8.000.000đ · %ads 30,0%"), c);
        assert.ok(c.includes("🛒 12 đơn · 90 mess · chốt 13,3%"), "không tính ô (không gán) vào số đầu tin");
        assert.ok(c.includes("🏆 Thương 6tr · 9 đơn · ads 1,5tr · %ads 25%"));
        assert.ok(c.includes("    Lộc 2tr · 3 đơn · ads 900k · %ads 45%"));
        assert.ok(c.includes("📍 Chưa gán cho ai: 640k · 1 đơn"));
        assert.ok(c.includes("TW/THƯƠNG/PHI/057 - SET12/Golden Fortune Energy Necklace TW/4-10"));
        assert.ok(!c.includes("SGP/THÁI") && !c.includes("JP/THANG"), "camp nước khác không được lọt vào nhóm Đài");
        assert.ok(!c.includes("Thái"), "người chỉ chạy nước khác không có trong bảng Đài");
        assert.deepStrictEqual(r.so, { ads: 2400000, don: 12, mess: 90, doanh_so: 8000000 });
        assert.deepStrictEqual(r.nguoi, ["Thương", "Lộc"]);
    });

    await t("tin Nhật (chưa có shop POS): chỉ tiền ads + tin nhắn, không %ads, không chấm 🔴 camp", async () => {
        const r = await buildBaoCaoNuoc(CFG, NGAY, { nuoc: "JP", docBan: () => BAN, layRealtime: rt, fetch: khongGoiMang });
        const c = tron(r.tinGop);
        assert.ok(c.includes("📊 ADS 🇯🇵 NHẬT BẢN"));
        assert.ok(c.includes("💰 Ads 500.000đ · 16 mess · 31k/mess"), c);
        assert.ok(c.includes("Nhật Bản chưa nối shop POS — chưa có đơn, doanh số."));
        assert.ok(c.includes("🏆 Thắng ads 300k · 12 mess"));
        assert.ok(c.includes("JP/THANG/PHI/002-ATTL/Lucky Charm JP/08-10") && c.includes("JP/THƯƠNG/PHI/011/Lucky Silver JP/08-10"));
        assert.ok(!c.includes("🔴") && !c.includes("%ads"), "Nhật chưa có đơn — không gắn đốt tiền, không %ads");
        assert.ok(!c.includes("TW/"), "camp Đài không lọt vào nhóm Nhật");
    });

    await t("tối: ▲▼ so cả ngày hôm qua CỦA CHÍNH NƯỚC ĐÓ", async () => {
        const r = await buildBaoCaoNuoc(CFG, NGAY, { nuoc: "TW", docBan: () => BAN, layRealtime: rt, fetch: khongGoiMang, intraday: true });
        const c = tron(r.tinGop);
        assert.ok(c.includes("💰 Ads 2.400.000đ ▲140% · DS 8.000.000đ ▲167%"), c);
        assert.ok(c.includes("🛒 12 đơn ▲7 · 90 mess ▲50"));
        assert.ok(c.includes("▲▼ so với cả ngày hôm qua"));
    });

    await t("trưa: so CÙNG MỐC hôm qua bot đã nhớ, không so cả ngày", async () => {
        const r = await buildBaoCaoNuoc(CFG, NGAY, { nuoc: "SG", docBan: () => BAN, layRealtime: rt, fetch: khongGoiMang, intraday: true,
            khongSoCaNgay: true, soCungGio: { so: { ads: 2000000, don: 1, mess: 100, doanh_so: 1800000 }, nhan: "13:00 hôm qua" } });
        const c = tron(r.tinGop);
        assert.ok(c.includes("💰 Ads 4.000.000đ ▲100%"), c);
        assert.ok(c.includes("▲▼ so với 13:00 hôm qua"));
    });

    await t("chưa có bảng nước × người: lấy tab nước của file TỔNG TEAM, báo thiếu xếp hạng", async () => {
        const goi = [];
        const f = async (url) => {
            goi.push(url);
            return { ok: true, status: 200, json: async () => ({ team: { ads: 1 }, marketers: [
                { tab: "Đài Loan", ads: 2400000, mess: 90, don: 12, doanh_so: 8000000, ds_giao_tc: 0 },
                { tab: "Thuong", ads: 9, mess: 9, don: 9, doanh_so: 9, ds_giao_tc: 0 } ] }) };
        };
        const r = await buildBaoCaoNuoc(CFG, NGAY, { nuoc: "TW", docBan: () => null, layRealtime: rt, fetch: f });
        const c = tron(r.tinGop);
        assert.ok(goi[0].startsWith(CFG.sheetReportUrl));
        assert.ok(c.includes("💰 Ads 2.400.000đ · DS 8.000.000đ"));
        assert.ok(c.includes("(chưa có xếp hạng theo người — đang đọc tab nước của file TỔNG TEAM)"));
    });

    await t("bảng cũ hơn vòng ghi Sheet OK gần nhất quá 45' → không tin bảng, đọc Sheet", async () => {
        let goiSheet = false;
        const f = async () => { goiSheet = true; return { ok: true, status: 200, json: async () => ({ team: {}, marketers: [] }) }; };
        const stale = { okAge: 10, limit: 120, lastOkTs: Date.parse("2026-10-08T03:21:00Z"), loi: null };
        await buildBaoCaoNuoc(CFG, NGAY, { nuoc: "TW", docBan: () => BAN, layRealtime: rt, fetch: f, stale });
        assert.ok(goiSheet);
    });

    await t("/baocao <tên> trong nhóm nước: chỉ camp của người đó ở nước đó", async () => {
        const r = await buildBaoCaoNuoc(CFG, NGAY, { nuoc: "JP", docBan: () => BAN, layRealtime: rt, fetch: khongGoiMang });
        const c = tron(r.tinNguoi("Thương"));
        assert.ok(c.includes("Thương") && c.includes("JP/THƯƠNG/PHI/011/Lucky Silver JP/08-10"));
        assert.ok(!c.includes("JP/THANG") && !c.includes("TW/THƯƠNG"), c);
        assert.ok(tron(r.tinNguoi("Lộc")).includes("Lộc chưa có số ở 🇯🇵 Nhật Bản"));
        assert.ok(!tron(r.teamMessage).includes("CHI TIẾT CAMP"), "/baocao team không kèm camp");
    });

    await t("/canhbao nhóm nước: chỉ camp nước đó", () => {
        const camps = [...CAMPS, { campaign_name: "SGP/THÁI/PHI/SET 05/Master Jewelry Gold/05-10", spend_vnd: 450000, messages: 0 }];
        assert.ok(tron(buildCanhBaoNuoc(camps, CFG, "TW", NGAY)).startsWith("✅ ADS — chưa thấy gì bất thường"));
        const sg = tron(buildCanhBaoNuoc(camps, CFG, "SG", NGAY));
        assert.ok(sg.includes("450.000đ · 0 tin nhắn · Thái") && sg.includes("SGP/THÁI/PHI/SET 05/Master Jewelry Gold/05-10"), sg);
    });

    await t("tin hướng dẫn: nhóm Nhật nói rõ chưa có vận đơn", () => {
        const jp = tron(huongDanNuoc({ nuoc: NUOC.JP, at: "08:30", mocAds: "13:00 · 18:00 · 22:00", vanDon: null }));
        assert.ok(jp.includes("Vận đơn Nhật Bản chưa theo dõi") && !jp.includes("/vandon"));
        const tw = tron(huongDanNuoc({ nuoc: NUOC.TW, at: "08:30", vanDon: { at: "08:30", toi: "22:00" } }));
        assert.ok(tw.includes("/vandon") && tw.includes("xếp hạng từng người"));
    });

    console.log(`nhom_nuoc.test.js: ${ok}/${ok} PASS`);
})().catch((e) => { console.error(e); process.exit(1); });
