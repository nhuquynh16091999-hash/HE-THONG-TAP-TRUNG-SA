// node daily_report.test.js   (không gọi mạng, không cần cài zca-js)
// Số liệu dưới đây là số DỰNG cho test, không phải số thật của ngày nào.
const assert = require("assert");
const { buildMarketerReports, buildTinDinhChinh, dongLech } = require("./daily_report");
const { buildAdsAlert, buildAdsStatus } = require("./ads_alerts");
const { tenNganCamp, chuCamp, THU_TU, DISPLAY } = require("./rules");
const { toZalo, chiaTin } = require("./zalo_text");

let ok = 0;
const t = async (ten, fn) => {
    try { await fn(); ok++; }
    catch (e) { console.error(`✗ ${ten}`); throw e; }
};
const tron = (s) => toZalo(s).msg;                         // chữ người đọc thấy
const dam = (s) => { const r = toZalo(s); return r.styles.filter((x) => x.st === "b").map((x) => r.msg.slice(x.start, x.start + x.len)); };

const CFG = {
    realtimeUrl: "http://dash/api/talpha/realtime",
    sheetReportUrl: "http://dash/api/talpha/sheet-report",
    topCampaigns: 8, recWasteSpend: 300000, recLowClosePct: 5, recHighAdsPct: 30, recGoodAdsPct: 20,
};
const SHEET = {
    date: "2026-09-14",
    team: { ads: 3000000, mess: 180, don: 10, doanh_so: 6000000, ds_giao_tc: 0, ty_le_chot: 5.56, phan_tram_ads: 50 },
    // Route trả tab NƯỚC lẫn trong mảng marketers (file TỔNG TEAM có tab nước từ 15/09/2026).
    marketers: [
        { tab: "Đài Loan", ads: 3000000, mess: 180, don: 8, doanh_so: 5200000, ds_giao_tc: 0, ty_le_chot: 4.44, phan_tram_ads: 57.69 },
        { tab: "Thuong", ads: 1000000, mess: 50, don: 3, doanh_so: 1800000, ds_giao_tc: 0, ty_le_chot: 6, phan_tram_ads: 55.56 },
        { tab: "Singapore", ads: 0, mess: 0, don: 2, doanh_so: 800000, ds_giao_tc: 0, ty_le_chot: 0, phan_tram_ads: 0 },
        { tab: "UAE", ads: 0, mess: 0, don: 0, doanh_so: 0, ds_giao_tc: 0, ty_le_chot: 0, phan_tram_ads: 0 },
        { tab: "Loc", ads: 1900000, mess: 128, don: 6, doanh_so: 3400000, ds_giao_tc: 0, ty_le_chot: 4.69, phan_tram_ads: 55.88 },
        { tab: "Thang", ads: 0, mess: 0, don: 1, doanh_so: 800000, ds_giao_tc: 0, ty_le_chot: 0, phan_tram_ads: 0 },
        { tab: "SAnh", ads: 0, mess: 0, don: 0, doanh_so: 0, ds_giao_tc: 0, ty_le_chot: 0, phan_tram_ads: 0 },
        { tab: "Thai", ads: 100000, mess: 2, don: 0, doanh_so: 0, ds_giao_tc: 0, ty_le_chot: 0, phan_tram_ads: 0 },
        { tab: "(không gán)", ads: 0, mess: 0, don: 2, doanh_so: 900000, ds_giao_tc: 0, ty_le_chot: 0, phan_tram_ads: 0 },
    ],
};
const CAMPS = [
    { campaign_name: "Lộc/Philippine/042 - BLACK/Trang Da/28-8", spend_vnd: 480000, messages: 13, orders: 5, revenue_vnd: 2500000 },
    { campaign_name: "TW/LOC/PHI/072 - DENTAL/DOC Tooth ARMOR TW/8-9", spend_vnd: 330000, messages: 10, orders: 0, revenue_vnd: 0 },
    { campaign_name: "SG/LOC/PHI/075 - SETTS01/Lucky Silver/1309", spend_vnd: 370000, messages: 69, orders: 3, revenue_vnd: 0 },
    { campaign_name: "TW/THUONG/VN/TEST/BaloDaGiaTot/0709", spend_vnd: 200000, messages: 12, orders: 0, revenue_vnd: 0 },
    { campaign_name: "TW/THUONG/PHI/TEST/Trang Sức Vàng Thái/1409", spend_vnd: 160000, messages: 13, orders: 0, revenue_vnd: 0 },
    { campaign_name: "Thainx/INDO/SET 16/Master Gold - 05/09", spend_vnd: 100000, messages: 2, orders: 0, revenue_vnd: 0 },
    { campaign_name: "Ai do/khong ro/xyz", spend_vnd: 50000, messages: 1, orders: 0, revenue_vnd: 0 },
    { campaign_name: "TW/LOC/PHI/080 - OFF/Trang/0109", spend_vnd: 0, messages: 0, orders: 0, revenue_vnd: 0 },
];

// fetch giả: trả JSON theo đường dẫn, hoặc lỗi HTTP khi được dặn.
function fakeFetch({ sheet = SHEET, camps = CAMPS, realtimeStatus = 200, sheetStatus = 200 } = {}) {
    const goi = [];
    const f = async (url) => {
        goi.push(url);
        const res = (status, body) => ({ ok: status < 400, status, json: async () => body });
        if (url.startsWith(CFG.sheetReportUrl)) return res(sheetStatus, sheet);
        if (url.startsWith(CFG.realtimeUrl)) return res(realtimeStatus, { campaigns: camps });
        return res(404, {});
    };
    f.goi = goi;
    return f;
}

(async () => {
    await t("tên ngắn campaign theo chuẩn cũ lẫn mới", () => {
        assert.strictEqual(tenNganCamp("Lộc/Philippine/042 - BLACK/Trang Da/28-8"), "042 - BLACK");
        assert.strictEqual(tenNganCamp("TW/LOC/PHI/072 - DENTAL/DOC Tooth ARMOR TW/8-9"), "072 - DENTAL");
        assert.strictEqual(tenNganCamp("TW/SANH/TW/BONGTAI-TRON/LuckyClover/2808/TEST"), "BONGTAI-TRON");
        assert.strictEqual(tenNganCamp("SG/LOC/PHI/075 - SETTS01/Lucky Silver/1309"), "🇸🇬 075 - SETTS01");
        assert.strictEqual(tenNganCamp("AE/THAI/PHI/040-VONGVANG1/LumoraJewelry/1509"), "🇦🇪 040-VONGVANG1");
        assert.strictEqual(tenNganCamp("TW/THUONG/VN/TEST/BaloDaGiaTot/0709"), "TEST · BaloDaGiaTot");
        assert.strictEqual(tenNganCamp("Thainx/INDO/SET 16/Master Gold - 05/09"), "SET 16");
        // "SGP" là mã Singapore đội đang dùng (khai trong camp_market_tokens 15/09/2026).
        assert.strictEqual(tenNganCamp("SGP/LOC/PHI/075 - SETTS01/Lucky Silver/1309"), "🇸🇬 075 - SETTS01");
        // Nước lạ không có trong luật → tính về Đài → không gắn cờ.
        assert.strictEqual(tenNganCamp("MY/LOC/PHI/075 - SETTS01/Lucky Silver/1309"), "075 - SETTS01");
    });

    await t("chủ campaign theo luật Sheet (ô sau ô nước), không quét cả tên", () => {
        // 14/09/2026: quét cả tên gán camp này cho Thái vì tên trang có chữ "Thái".
        assert.strictEqual(chuCamp("TW/THUONG/PHI/TEST/Trang Sức Vàng Thái/1409"), "Thuong");
        assert.strictEqual(chuCamp("TW/LOC/PHI/072 - DENTAL/DOC Tooth ARMOR TW/8-9"), "Loc");
        assert.strictEqual(chuCamp("Lộc/Philippine/042 - BLACK/Trang Da/28-8"), "Loc");       // tên cũ, ô đầu
        assert.strictEqual(chuCamp("Thainx/INDO/SET 16/Master Gold - 05/09"), "Thai");
        assert.strictEqual(chuCamp("SGP/LOC/PHI/075 - SETTS01/Lucky Silver/1309"), "Loc");  // ô sau ô nước
        assert.strictEqual(chuCamp("MY/LOC/PHI/075 - SETTS01/Lucky Silver/1309"), "Loc");   // nước lạ: ô hai
        assert.strictEqual(chuCamp("TW/Lucky Charm Thái/PHI/1409"), null, "sau ô nước không phải mã marketer → không đoán");
        assert.strictEqual(chuCamp("Ai do/khong ro/Thái"), null);
    });

    await t("thứ tự tin riêng lấy từ khối marketers của rules", () => {
        assert.deepStrictEqual(THU_TU, Object.keys(require("./rules").RULES.marketers).map((k) => DISPLAY[k]));
    });

    await t("báo cáo 8h30: tin TỔNG TEAM + tin riêng đúng người, đúng thứ tự", async () => {
        const f = fakeFetch();
        const r = await buildMarketerReports(CFG, "2026-09-14", { fetch: f });
        assert.strictEqual(f.goi.filter((u) => u.startsWith(CFG.realtimeUrl)).length, 1, "realtime chỉ được gọi 1 lần");

        const team = tron(r.teamMessage);
        assert.ok(team.startsWith("🏆 TỔNG TEAM — 14/09\n"), team);
        assert.ok(team.includes("Tiền ads: 3.000.000đ"));
        assert.ok(team.includes("👑 Top 1 ngày 14/09: Lộc — 3.400.000đ"));
        assert.ok(team.includes("📍 Chưa gán được cho ai: 900.000đ · 2 đơn"));
        assert.ok(!/[-*]/.test(team), "còn sót ký tự cờ hoặc dấu *");
        assert.ok(dam(r.teamMessage).includes("3.000.000đ"));
        // Xếp hạng theo doanh số, không theo thứ tự route trả về; người 0 ads 0 đơn không có dòng.
        const hang = team.split("Xếp hạng theo doanh số:")[1].split("\n")
            .filter((l) => /^(👑|\d+\.) /.test(l)).map((l) => l.split(" — ")[0]);
        assert.deepStrictEqual(hang, ["👑 Lộc", "2. Thương", "3. Thắng", "4. Thái"]);

        // Tin riêng: người có ads HOẶC đơn; S.Anh (0 và 0), "(không gán)" và tab NƯỚC không có tin.
        const nguoi = r.messages.map((m) => tron(m).split("\n")[0].split(" — ")[1]);
        const mong = THU_TU.filter((x) => ["Lộc", "Thương", "Thắng", "Thái"].includes(x));
        assert.deepStrictEqual(nguoi, mong);
        assert.deepStrictEqual(r.nguoi, mong, "nguoi[i] phải là chủ của messages[i] — lệnh /baocao <tên> dựa vào đây");

        // Tab nước (Đài Loan, Singapore, UAE) KHÔNG phải người: không tin riêng, không vào
        // bảng xếp hạng, và tin không in số theo nước (Sỹ Anh chốt 15/09/2026).
        for (const nuoc of ["Đài Loan", "Singapore", "UAE"]) {
            assert.ok(!team.includes(nuoc), `tin TỔNG TEAM có "${nuoc}"`);
            assert.ok(!r.messages.some((m) => tron(m).includes(nuoc)), `có tin riêng "${nuoc}"`);
        }
    });

    await t("tab lạ bị bỏ và có log; tab nước bỏ lặng lẽ", async () => {
        const sheet = { ...SHEET, marketers: [
            ...SHEET.marketers,
            { tab: "Nháp của CEO", ads: 999, mess: 0, don: 0, doanh_so: 999, ds_giao_tc: 0, ty_le_chot: 0, phan_tram_ads: 0 },
        ] };
        const nhat = [];
        const r = await buildMarketerReports(CFG, "2026-09-14", { fetch: fakeFetch({ sheet }), log: (x) => nhat.push(x) });
        assert.ok(!tron(r.teamMessage).includes("Nháp của CEO"));
        assert.ok(!r.messages.some((m) => tron(m).includes("Nháp của CEO")));
        assert.deepStrictEqual(nhat, ["Sheet có tab lạ, bỏ qua: Nháp của CEO"]);
    });

    await t("tin riêng: số đầu bài từ Sheet, chi tiết campaign đúng người, bỏ camp 0đ", async () => {
        const r = await buildMarketerReports(CFG, "2026-09-14", { fetch: fakeFetch() });
        const loc = tron(r.messages.find((m) => tron(m).includes("— Lộc")));
        assert.ok(loc.includes("Tiền ads: 1.900.000đ  ·  Doanh số: 3.400.000đ  ·  %ads: 55,9%"), loc);
        assert.ok(loc.includes("✅ Chốt: 4,7%"));
        assert.ok(loc.includes("• 042 - BLACK") && loc.includes("• 072 - DENTAL") && loc.includes("• 🇸🇬 075 - SETTS01"));
        assert.ok(!loc.includes("080 - OFF"), "camp 0đ không được vào tin");
        assert.ok(!loc.includes("• PHI"), "lấy nhầm ô tệp khách làm tên sản phẩm");
        assert.ok(loc.includes("Tắt / đổi sản phẩm 1 camp đốt tiền không ra đơn: 072 - DENTAL"));
        const thang = tron(r.messages.find((m) => tron(m).includes("— Thắng")));
        assert.ok(thang.includes("(không có campaign nào tiêu tiền)"));
        assert.ok(thang.includes("✅ Chốt: —"), "0 mess mà 1 đơn thì tỷ lệ chốt phải là —");
        const thuong = tron(r.messages.find((m) => tron(m).includes("— Thương")));
        const thai = tron(r.messages.find((m) => tron(m).includes("— Thái")));
        assert.ok(thuong.includes("TEST · Trang Sức Vàng Thái"), "camp của Thương phải nằm trong tin Thương");
        assert.ok(!thai.includes("Trang Sức Vàng Thái"), "tên trang có chữ Thái không làm camp thành của Thái");
    });

    await t("tin GỘP: đúng MỘT tin, có đủ người, có camp đáng xử, không kèm chi tiết từng camp", async () => {
        const r = await buildMarketerReports(CFG, "2026-09-14", { fetch: fakeFetch() });
        const g = tron(r.tinGop);

        // Lý do cả thay đổi này tồn tại: 1 tin tổng + 4 tin riêng = 5 tin liền trong nhóm.
        assert.strictEqual(chiaTin(toZalo(r.tinGop), 1800).length, 1,
            `tin gộp bị chia thành nhiều tin (${g.length} ký tự) — mất đúng mục đích gộp`);

        assert.ok(g.startsWith("🏆 TỔNG TEAM — 14/09\n"), g);
        assert.ok(g.includes("Tiền ads: 3.000.000đ"));
        for (const mk of ["Lộc", "Thương", "Thắng", "Thái"]) {
            assert.ok(g.includes(mk), `tin gộp thiếu ${mk} — gộp không được phép làm mất ai`);
        }
        assert.ok(g.includes("📍 Chưa gán được cho ai: 900.000đ"));
        // Camp đáng làm gì đó: chỉ tên + tiền gọn + chủ, một dòng mỗi loại.
        assert.ok(g.includes("🔥 Đốt tiền không ra đơn (1): 072 - DENTAL 330k (Lộc)"), g);
        assert.ok(g.includes("💡 Đang ngon: 042 - BLACK 5 đơn · %ads 19% (Lộc)"), g);
        // Chú thích nguồn số phải ở CUỐI, không kẹp giữa tin.
        const cuoi = g.trim().split("\n").pop();
        assert.ok(cuoi.includes("số lấy thẳng từ file TỔNG TEAM THÁNG 9"), cuoi);
        assert.ok(cuoi.includes("/baocao <tên>"), "phải chỉ đường lấy chi tiết");
        // Chi tiết từng campaign của từng người CỐ Ý không nằm trong tin gộp.
        assert.ok(!g.includes("Theo campaign:"), "gộp cả chi tiết vào là tin dài quá khung Zalo");
        assert.ok(!g.includes("Tắt / đổi sản phẩm"), "khối Đề xuất dài chỉ dành cho tin riêng");
        // Dấu * là cách WhatsApp in đậm — Zalo in ra nguyên chữ *, phải không còn.
        // (Dấu "-" thì hợp lệ: tên camp có sẵn, ví dụ "072 - DENTAL".)
        assert.ok(!/[*-]/.test(g), "còn sót ký tự cờ hoặc dấu *");
        // Tin riêng vẫn dựng đủ để /baocao <tên> trả về được.
        assert.strictEqual(r.messages.length, 4);
    });

    await t("tin GỘP: không có camp nào đáng xử thì bỏ hẳn dòng, không in dòng rỗng", async () => {
        const r = await buildMarketerReports(CFG, "2026-09-14", { fetch: fakeFetch({ camps: [] }) });
        const g = tron(r.tinGop);
        assert.ok(!g.includes("🔥") && !g.includes("💡 Đang ngon"), g);
        assert.ok(!/\n\n\n/.test(g), "có dòng trống thừa");
        assert.ok(g.includes("Xếp hạng theo doanh số:"), "số Sheet vẫn phải còn");
    });

    await t("tin GỘP: realtime lỗi thì vẫn gửi, nói rõ thiếu phần campaign", async () => {
        const r = await buildMarketerReports(CFG, "2026-09-14", { fetch: fakeFetch({ realtimeStatus: 502 }) });
        const g = tron(r.tinGop);
        assert.ok(g.includes("Tiền ads: 3.000.000đ"), "số đầu bài từ Sheet vẫn phải đủ");
        assert.ok(g.includes("chưa lấy được danh sách campaign lúc này"), g);
    });

    await t("tin GỘP giữa ngày: vẫn một tin, vẫn nói số chưa chốt", async () => {
        const r = await buildMarketerReports(CFG, "2026-09-15",
            { fetch: fakeFetch(), intraday: true, label: "HÔM NAY 15/09 · 13:30" });
        const g = tron(r.tinGop);
        assert.strictEqual(chiaTin(toZalo(r.tinGop), 1800).length, 1);
        assert.ok(g.startsWith("🏆 TỔNG TEAM — HÔM NAY 15/09 · 13:30"));
        assert.ok(g.includes("(đơn hôm nay gần như chưa giao xong"));
    });

    await t("realtime lỗi vẫn gửi đủ tin, chỉ thiếu phần campaign", async () => {
        const nhat = [];
        const r = await buildMarketerReports(CFG, "2026-09-14", { fetch: fakeFetch({ realtimeStatus: 502 }), log: (x) => nhat.push(x) });
        assert.strictEqual(r.messages.length, 4);
        assert.ok(tron(r.messages[0]).includes("chưa lấy được chi tiết campaign lúc này"));
        assert.ok(nhat.some((x) => x.includes("realtime HTTP 502")));
    });

    await t("Sheet lỗi hoặc chưa có dòng ngày đó → ném lỗi, KHÔNG gửi tin rỗng", async () => {
        await assert.rejects(buildMarketerReports(CFG, "2026-09-14", { fetch: fakeFetch({ sheetStatus: 500 }) }), /sheet-report HTTP 500/);
        await assert.rejects(buildMarketerReports(CFG, "2026-09-14", { fetch: fakeFetch({ sheet: { date: "2026-09-14" } }) }), /Sheet chưa có dòng/);
    });

    await t("báo cáo giữa ngày: nhãn giờ + dòng nhắc số chưa chốt", async () => {
        const r = await buildMarketerReports(CFG, "2026-09-15", { fetch: fakeFetch(), intraday: true, label: "HÔM NAY 15/09 · 13:30" });
        const team = tron(r.teamMessage);
        assert.ok(team.startsWith("🏆 TỔNG TEAM — HÔM NAY 15/09 · 13:30"));
        assert.ok(team.includes("👑 Top 1 hôm nay: Lộc"));
        assert.ok(team.includes("(đơn hôm nay gần như chưa giao xong"));
        assert.ok(tron(r.messages[0]).includes("số đang chạy trong ngày — chưa chốt, còn lên tiếp"));
    });

    await t("số cũ: giữa ngày kêu khi sync đứng quá ngưỡng; 8h30 kêu khi chưa có vòng sau nửa đêm", async () => {
        const giua = await buildMarketerReports(CFG, "2026-09-15",
            { fetch: fakeFetch(), intraday: true, stale: { okAge: 190, limit: 120, lastOkTs: 0 } });
        assert.ok(tron(giua.teamMessage).startsWith("⚠️ SỐ CHƯA ĐỦ — sync đứng 3 giờ 10 phút."));
        const xanh = await buildMarketerReports(CFG, "2026-09-15",
            { fetch: fakeFetch(), intraday: true, stale: { okAge: 30, limit: 120, lastOkTs: 0 } });
        assert.ok(!tron(xanh.teamMessage).includes("SỐ CHƯA ĐỦ"));

        const syncChieuHomTruoc = Date.parse("2026-09-14T14:27:00+07:00");
        const sang = await buildMarketerReports(CFG, "2026-09-14",
            { fetch: fakeFetch(), stale: { okAge: 1080, limit: 120, lastOkTs: syncChieuHomTruoc } });
        assert.ok(tron(sang.teamMessage).startsWith("⚠️ SỐ CHƯA ĐỦ — chưa có vòng sync nào chạy sau khi hết ngày 14/09."));
        assert.ok(tron(sang.teamMessage).includes("chốt lúc 14:27 ngày 14/09"));
    });

    await t("số cũ: có tên TKQC đọc lỗi thì tin nói đích danh", async () => {
        const loi = { tkqc: ["TK BM Thuyên ngu 02", "TK BM Thuyên 01"], shops: [], mat_quyen: ["TK BM Thuyên 01", "TK BM Thuyên ngu 02"] };
        const r = await buildMarketerReports(CFG, "2026-09-15",
            { fetch: fakeFetch(), intraday: true, stale: { okAge: 760, limit: 120, lastOkTs: 0, loi } });
        const tin = tron(r.teamMessage);
        assert.ok(tin.startsWith("⚠️ SỐ CHƯA ĐỦ — sync đứng 12 giờ 40 phút."));
        assert.ok(tin.includes("TKQC không đọc được: TK BM Thuyên ngu 02, TK BM Thuyên 01 — Meta báo mất quyền đọc"));
        // Không có lỗi fetch (sync đứng vì máy chủ chết) → không bịa lý do.
        const khong = await buildMarketerReports(CFG, "2026-09-15",
            { fetch: fakeFetch(), intraday: true, stale: { okAge: 760, limit: 120, lastOkTs: 0, loi: { tkqc: [], shops: [], mat_quyen: [] } } });
        assert.ok(!tron(khong.teamMessage).includes("không đọc được"));
        // Shop POS lỗi, không phải mất quyền Meta.
        const shop = await buildMarketerReports(CFG, "2026-09-15",
            { fetch: fakeFetch(), intraday: true, stale: { okAge: 190, limit: 120, lastOkTs: 0, loi: { tkqc: [], shops: ["TW"], mat_quyen: [] } } });
        assert.ok(tron(shop.teamMessage).includes("Shop POS không đọc được: TW."));
    });

    await t("cờ chuaDu + số đầu bài trả ra cho bot xếp lịch đính chính", async () => {
        const syncChieuHomTruoc = Date.parse("2026-09-14T14:27:00+07:00");
        const thieu = await buildMarketerReports(CFG, "2026-09-14",
            { fetch: fakeFetch(), stale: { okAge: 1080, limit: 120, lastOkTs: syncChieuHomTruoc } });
        assert.strictEqual(thieu.chuaDu, true);
        assert.deepStrictEqual(thieu.so, { ads: 3000000, don: 10, mess: 180, doanh_so: 6000000 });
        assert.strictEqual(thieu.label, "14/09");

        // Cờ phải khớp ĐÚNG chữ in trong tin — chuaDu=false mà tin vẫn kêu là hỏng cả vòng
        // đính chính (bot tưởng số đủ, không ai đính chính).
        const du = await buildMarketerReports(CFG, "2026-09-14", { fetch: fakeFetch(), stale: null });
        assert.strictEqual(du.chuaDu, false);
        assert.ok(!tron(du.tinGop).includes("SỐ CHƯA ĐỦ"));
        for (const r of [thieu, du]) {
            assert.strictEqual(tron(r.tinGop).includes("SỐ CHƯA ĐỦ"), r.chuaDu, "cờ chuaDu lệch với chữ trong tin");
            assert.strictEqual(tron(r.messages[0]).includes("SỐ CHƯA ĐỦ"), r.chuaDu);
        }
    });

    await t("tin đính chính: nêu đúng chỗ lệch rồi đính bản đủ số", async () => {
        const r = await buildMarketerReports(CFG, "2026-09-14", { fetch: fakeFetch(), stale: null });
        const tin = buildTinDinhChinh({
            tin: r.tinGop, soCu: { ads: 2091476, don: 11, mess: 127, doanh_so: 12495200 }, soMoi: r.so,
            label: "21/09", luc: Date.parse("2026-09-22T08:31:00+07:00"), intraday: false,
        });
        const chu = tron(tin);
        assert.ok(chu.startsWith("🔄 ĐÍNH CHÍNH — 21/09\n"), chu.slice(0, 80));
        assert.ok(chu.includes("Tin lúc 08:31 ngày 22/09 gửi khi sync còn đứng"));
        assert.ok(chu.includes("dưới đây là số cả ngày"));
        assert.ok(chu.includes("Tiền ads: 2.091.476đ → 3.000.000đ  (+908.524đ)"), chu);
        assert.ok(chu.includes("Đơn: 11 → 10  (−1)"), "số tụt phải ghi dấu trừ");
        assert.ok(chu.includes("Doanh số: 12.495.200đ → 6.000.000đ  (−6.495.200đ)"));
        assert.ok(chu.includes("Mess: 127 → 180  (+53)"));
        assert.ok(chu.includes("🏆 TỔNG TEAM — 14/09"), "phải đính kèm cả bản báo cáo đủ số");
        assert.ok(!chu.includes("SỐ CHƯA ĐỦ"), "tin đính chính không được mang lại cảnh báo cũ");
        // Chữ đậm: tên tin, nhãn khối lệch, rồi SỐ ĐÚNG của từng khoản (số cũ để thường).
        assert.deepStrictEqual(dam(tin).slice(0, 4),
            ["ĐÍNH CHÍNH — 21/09", "Lệch so với tin cũ:", "3.000.000đ", "10"]);

        // Số không đổi → chỉ mấy dòng đầu, KHÔNG lặp lại cả bản báo cáo.
        const khongDoi = tron(buildTinDinhChinh({
            tin: r.tinGop, soCu: r.so, soMoi: r.so, label: "HÔM NAY 22/09 · 20:00",
            luc: Date.parse("2026-09-22T20:00:00+07:00"), intraday: true,
        }));
        assert.ok(khongDoi.includes("số dưới đây đủ tới lúc này"));
        assert.ok(khongDoi.includes("✅ Số không đổi — tin cũ đã đúng"));
        assert.ok(!khongDoi.includes("TỔNG TEAM"), "không đổi thì đừng gửi lại cả bản báo cáo");
        assert.deepStrictEqual(dongLech(r.so, r.so), []);
    });

    await t("mọi tin chia vừa khung Zalo, không còn ký tự cờ", async () => {
        const nhieu = Array.from({ length: 12 }, (_, i) => ({
            campaign_name: `TW/LOC/PHI/0${10 + i} - SAN PHAM RAT DAI SO ${i}/Trang ban hang ${i}/0109`,
            spend_vnd: 400000 + i, messages: 30, orders: 1, revenue_vnd: 900000,
        }));
        const r = await buildMarketerReports(CFG, "2026-09-14", { fetch: fakeFetch({ camps: nhieu }) });
        for (const m of [r.teamMessage, ...r.messages]) {
            for (const p of chiaTin(toZalo(m), 1800)) {
                assert.ok(p.msg.length <= 1800);
                assert.ok(!/[-]/.test(p.msg));
            }
        }
    });

    await t("cảnh báo ads: báo camp đốt tiền một lần mỗi ngày, sang ngày mới báo lại", () => {
        const cfg = { adsWasteSpend: 300000, adsSpikeRatio: 1.5, adsMinTotalForSpike: 3000000 };
        const a = {
            day: "2026-09-15", totalSpend: 2000000, avg7d: 2900000, spikeRatio: 0.69,
            wasteful: [
                { campaign: "TW/LOC/PHI/072 - DENTAL/Trang/8-9", marketer: "Lộc", spend: 350000 },
                { campaign: "TW/THAI/PHI/010 - NHO/Trang/8-9", marketer: "Thái", spend: 150000 },
                // route quét cả tên nên ghi "Thái"; chủ thật (theo Sheet) là Thương
                { campaign: "TW/THUONG/PHI/TEST/Trang Sức Vàng Thái/1409", marketer: "Thái", spend: 320000 },
            ],
        };
        const r1 = buildAdsAlert(a, {}, cfg);
        const chu = tron(r1.text);
        assert.ok(chu.startsWith("🚨 CẢNH BÁO ADS — TALPHA\nngày 15/09"));
        assert.ok(chu.includes("Campaign ĐỐT TIỀN KHÔNG RA TIN NHẮN (2)") && chu.includes("350.000đ · 0 tin nhắn · Lộc"));
        assert.ok(chu.includes("320.000đ · 0 tin nhắn · Thương"), "chủ camp tính lại theo luật Sheet");
        assert.ok(!chu.includes("CAO BẤT THƯỜNG"), "0,69 lần trung bình không phải bất thường");
        assert.ok(!chu.includes("010 - NHO"), "dưới ngưỡng 300k không báo");

        const r2 = buildAdsAlert(a, r1.state, cfg);
        assert.strictEqual(r2.text, null, "vòng sau cùng ngày không nhắc lại camp đã báo");

        const r3 = buildAdsAlert({ ...a, day: "2026-09-16" }, r2.state, cfg);
        assert.ok(r3.text && tron(r3.text).includes("350.000đ"), "sang ngày mới phải báo lại");
    });

    await t("cảnh báo ads: chi tiêu cao bất thường chỉ khi đủ cả tỷ lệ lẫn mức sàn, mỗi ngày 1 lần", () => {
        const cfg = { adsWasteSpend: 300000, adsSpikeRatio: 1.5, adsMinTotalForSpike: 3000000 };
        const cao = { day: "2026-09-15", totalSpend: 4500000, avg7d: 2900000, spikeRatio: 1.55, wasteful: [] };
        const r1 = buildAdsAlert(cao, undefined, cfg);
        assert.ok(tron(r1.text).includes("Hôm nay: 4.500.000đ · TB 7 ngày: 2.900.000đ (×1,55)"));
        assert.strictEqual(buildAdsAlert(cao, r1.state, cfg).text, null);
        const nho = { ...cao, totalSpend: 2000000, avg7d: 1000000, spikeRatio: 2 };
        assert.strictEqual(buildAdsAlert(nho, undefined, cfg).text, null, "dưới mức sàn 3tr thì không kêu");
    });

    await t("lệnh /canhbao: yên ổn vẫn trả lời kèm chi tiêu; có camp đốt tiền thì báo đủ, không nhớ state", () => {
        const cfg = { adsWasteSpend: 300000, adsSpikeRatio: 1.5, adsMinTotalForSpike: 3000000 };
        const yen = { day: "2026-09-15", totalSpend: 1562185, avg7d: 2940522, spikeRatio: 0.53, wasteful: [] };
        const chu = tron(buildAdsStatus(yen, cfg));
        assert.ok(chu.startsWith("✅ ADS — chưa thấy gì bất thường\nngày 15/09"));
        assert.ok(chu.includes("Chi tiêu hôm nay: 1.562.185đ · TB 7 ngày: 2.940.522đ (×0,53)"));
        const dot = { ...yen, wasteful: [{ campaign: "TW/LOC/PHI/072 - DENTAL/Trang/8-9", spend: 350000 }] };
        assert.ok(tron(buildAdsStatus(dot, cfg)).includes("350.000đ · 0 tin nhắn · Lộc"));
        assert.ok(tron(buildAdsStatus(dot, cfg)).includes("350.000đ"), "hỏi lần hai vẫn báo — không dùng state");
    });

    console.log(`daily_report.test.js: ${ok}/${ok} PASS`);
})().catch((e) => { console.error(e); process.exit(1); });
