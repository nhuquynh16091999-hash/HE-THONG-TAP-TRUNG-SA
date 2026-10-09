// node tin_gio.test.js — tin MỖI GIỜ + số mess Pancake (Nhật, Sỹ Anh yêu cầu 09/10/2026).
// Số dưới đây là số DỰNG theo đúng dạng /api/talpha/pancake-nuoc và /api/talpha/realtime trả về.
const assert = require("assert");
const { ghepTheoTrang, messThayTuPancake, buildTinGio } = require("./tin_gio");
const { buildBaoCaoNuoc } = require("./daily_report");
const { NUOC } = require("./rules");
const { toZalo } = require("./zalo_text");

let ok = 0;
const t = async (ten, fn) => { try { await fn(); ok++; } catch (e) { console.error(`✗ ${ten}`); throw e; } };
const tron = (s) => toZalo(s).msg;

const PK = {
    market: "JP", key: "Japan", date: "2026-10-09", currency: "JPY", symbol: "¥", rate_vnd: 160,
    pancake: { ok: true, het_han: "2027-01-02T07:58:53.000Z", loi: "" },
    pages: [
        { page_id: "1412119901976089", name: "Lucky Charm JP", nv: "Thắng", camps: [], inbox_moi: 4, comment_moi: 1, co_sdt: 1 },
        { page_id: "1357521110781458", name: "Lucky Silver JP", nv: "Thương", camps: [], inbox_moi: 0, comment_moi: 0, co_sdt: 0 },
        { page_id: "1242537838942885", name: "Kreain Nature - Skin Soothing Cream JP", nv: null, camps: [], inbox_moi: 0, comment_moi: 0, co_sdt: 0 },
    ],
    don: [
        { page_name: "Lucky Charm JP", page_id: "1412119901976089", tag: null, don: 1, ds_local: 8999, ds_vnd: 1439840 },
        { page_name: "", page_id: null, tag: "Thắng", don: 1, ds_local: 5000, ds_vnd: 800000 },
    ],
};
const CAMPS = [
    { campaign_name: "JP/THANG/PHI/002-ATTL/Lucky Charm JP/08-10", spend_vnd: 72985, messages: 0, orders: 0, revenue_vnd: 0 },
    { campaign_name: "TW/THƯƠNG/PHI/042/𝑱𝒂𝒑𝒂𝒏 𝑷𝒓𝒊𝒎𝒆 𝑳𝒆𝒂𝒕𝒉𝒆𝒓/6-10", spend_vnd: 169634, messages: 9, orders: 1, revenue_vnd: 760000 },
    { campaign_name: "SGP/THÁI/PHI/011/Lucky Silver Philippines/07-10", spend_vnd: 92876, messages: 4, orders: 0, revenue_vnd: 0 },
];

(async () => {
    await t("ghép theo page: chỉ camp của nước đó; page không có số thì bỏ; đơn không ghi page để riêng", () => {
        const { trang, tong, khongRo } = ghepTheoTrang(PK, CAMPS);
        assert.deepStrictEqual(trang.map((x) => x.ten), ["Lucky Charm JP"]);
        assert.strictEqual(trang[0].nv, "Thắng");
        assert.strictEqual(trang[0].ads, 72985);
        assert.deepStrictEqual({ mess: tong.mess, cmt: tong.cmt, don: tong.don, dsLocal: tong.dsLocal }, { mess: 4, cmt: 1, don: 2, dsLocal: 13999 });
        assert.strictEqual(tong.ads, 72985, "camp Đài trang 'Japan Prime Leather' KHÔNG được tính vào Nhật");
        assert.deepStrictEqual(khongRo, { don: 1, dsLocal: 5000, dsVnd: 800000 });
    });

    await t("số mess Pancake cho bản tin thường: tổng, theo người, dồn cho camp tiêu nhiều nhất trên page", () => {
        const mt = messThayTuPancake(PK, CAMPS);
        assert.deepStrictEqual(mt, { tong: 4, theoNguoi: { "Thắng": 4 }, theoCamp: { "JP/THANG/PHI/002-ATTL/Lucky Charm JP/08-10": 4 } });
        assert.strictEqual(messThayTuPancake({ ...PK, pancake: { ok: false } }, CAMPS), null, "Pancake hỏng → không thay");
    });

    await t("tin mỗi giờ: tổng + giá mess + đơn ¥ ≈ đ + theo page + thêm trong giờ qua", () => {
        const r = buildTinGio({ n: NUOC.JP, ngay: "2026-10-09", gio: "15:05", pk: PK, camps: CAMPS,
            truoc: { ngay: "2026-10-09", tong: { mess: 3, don: 1 } } });
        const c = tron(r.text);
        assert.ok(c.startsWith("⏰ 🇯🇵 NHẬT BẢN · 15:05 · HÔM NAY 09/10"), c);
        assert.ok(c.includes("💰 Ads 72.985đ · 💬 4 mess (+1) · 18k/mess · 1 bình luận"), c);
        assert.ok(c.includes("🛒 2 đơn (+1) · DS 13.999¥ ≈ 2,2tr · 36k/đơn · chốt 50,0% · %ads 3,3%"), c);
        assert.ok(c.includes("📞 1 khách mới đã để SĐT"));
        assert.ok(c.includes("Lucky Charm JP — Thắng") && c.includes("ads 73k · 4 mess · 18k/mess · 1 bình luận · 1 SĐT · 1 đơn · 8.999¥ ≈ 1,4tr"), c);
        assert.ok(c.includes("📍 Đơn không ghi page: 1 đơn · 5.000¥ ≈ 800k"));
        assert.ok(!c.includes("Japan Prime") && !c.includes("Lucky Silver Philippines"));
        assert.deepStrictEqual({ mess: r.tong.mess, don: r.tong.don }, { mess: 4, don: 2 });
    });

    await t("tin mỗi giờ khi Pancake hỏng: vẫn gửi, nói rõ số mess chưa đủ; token sắp hết hạn thì nhắc", () => {
        const c = tron(buildTinGio({ n: NUOC.JP, ngay: "2026-10-09", gio: "16:05", pk: null, camps: CAMPS }).text);
        assert.ok(c.includes("⚠️ chưa lấy được số Pancake + đơn lúc này"), c);
        const sap = new Date(Date.now() + 5 * 86400_000).toISOString();
        const c2 = tron(buildTinGio({ n: NUOC.JP, ngay: "2026-10-09", gio: "16:05", pk: { ...PK, pancake: { ok: true, het_han: sap } }, camps: CAMPS }).text);
        assert.ok(c2.includes("Token Pancake hết hạn"), c2);
    });

    await t("bản tin thường nhóm Nhật dùng mess Pancake: đầu tin, từng người, từng camp", async () => {
        const BAN = { thang: "2026-10", ghi_luc: "2026-10-09T08:40:24Z", khong_gan: "(không gán)", nuoc: { Japan: {
            "2026-10-09": { Thang: { ads: 72985, mess: 0, don: 1, doanh_so: 1439840, ds_giao_tc: 0 } } } } };
        const r = await buildBaoCaoNuoc({}, "2026-10-09", { nuoc: "JP", docBan: () => BAN, layRealtime: async () => ({ campaigns: CAMPS }),
            messThay: messThayTuPancake(PK, CAMPS), fetch: async () => { throw new Error("không gọi mạng"); } });
        const c = tron(r.tinGop);
        assert.ok(c.includes("🛒 1 đơn · 4 mess · chốt 25,0%"), c);
        assert.ok(c.includes("72k · 4 mess · 0 đơn") || c.includes("73k · 4 mess"), c);
        assert.strictEqual(r.so.mess, 4);
    });

    console.log(`tin_gio.test.js: ${ok}/${ok} PASS`);
})().catch((e) => { console.error(e); process.exit(1); });
