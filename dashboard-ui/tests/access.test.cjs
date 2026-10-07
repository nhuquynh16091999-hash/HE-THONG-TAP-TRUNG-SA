/**
 * Phân quyền theo team (Sỹ Anh chốt 05/10/2026): Trung Đông (UAE — Lộc), Đông Nam Á
 * (Singapore — Thái), Đông Á (Đài Loan — tạm Sỹ Anh). Thương: vận đơn + sale cả ba.
 * Sỹ Anh: giám đốc, thấy hết.
 *
 * Chỗ sai là lộ số thật: leader team này đọc được doanh số, đơn, khách của team kia —
 * đúng điều Sỹ Anh dặn "không liên quan đến nhau". Test bằng luật đang khai trong
 * talpha_rules.json → access, không dựng luật giả.
 */
const assert = require("assert");
const A = require("../.test-build/access-rules.js");

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log("  ✓", name); };

const loc = A.accessForUser({ id: "1", name: "Lộc", role: "leader", teams: ["trung_dong"] });
const thai = A.accessForUser({ id: "2", name: "Thái", role: "leader", teams: ["dong_nam_a"] });
const thuong = A.accessForUser({ id: "3", name: "Thương", role: "sale", teams: ["*"] });
const sanh = A.accessForUser({ id: "4", name: "Sỹ Anh", role: "director", teams: [] });
const q = (s) => new URLSearchParams(s);
const track = (m) => (["SG", "AE"].includes(String(m || "").toUpperCase()) ? String(m).toUpperCase() : "TW");

console.log("── Luật khai ở talpha_rules.json ──");
t("ba team, mỗi team một nước, đủ ba nước đang bán", () => {
    assert.deepStrictEqual(A.TEAMS.trung_dong.markets, ["UAE"]);
    assert.deepStrictEqual(A.TEAMS.dong_nam_a.markets, ["Singapore"]);
    assert.deepStrictEqual(A.TEAMS.dong_a.markets, ["Taiwan"]);
    assert.deepStrictEqual([...A.ALL_MARKET_KEYS].sort(), ["Singapore", "Taiwan", "UAE"]);
});
t("mọi tab khai trong access.roles đều là tab có thật của shell", () => {
    for (const [k, r] of Object.entries(A.ROLES)) {
        for (const tab of r.tabs || []) assert.ok(A.ALL_TABS.includes(tab), `${k}: tab lạ ${tab}`);
    }
});

console.log("── Ai thấy nước nào ──");
t("Lộc chỉ thấy UAE", () => {
    assert.deepStrictEqual(loc.codes, ["AE"]);
    assert.ok(A.canMarket(loc, "AE") && A.canMarket(loc, "UAE"));
    assert.ok(!A.canMarket(loc, "TW") && !A.canMarket(loc, "SG") && !A.canMarket(loc, "Singapore"));
    assert.strictEqual(loc.full, false);
});
t("Thái chỉ thấy Singapore", () => {
    assert.deepStrictEqual(thai.codes, ["SG"]);
    assert.ok(!A.canMarket(thai, "AE") && !A.canMarket(thai, "TW"));
});
t("Thương (sale, mọi team) thấy cả ba nước nhưng không phải giám đốc", () => {
    assert.deepStrictEqual([...thuong.codes].sort(), ["AE", "SG", "TW"]);
    assert.strictEqual(thuong.full, false);
    assert.ok(A.seesAllMarkets(thuong));
});
t("giám đốc thấy hết, kể cả team rỗng", () => {
    assert.ok(sanh.full && A.seesAllMarkets(sanh));
    assert.ok(A.canTab(sanh, "ads-recon"));
});
t("mặc định ĐÓNG: vai lạ / team lạ / thiếu team → không thấy gì", () => {
    for (const u of [
        { role: "leader" }, { role: "leader", teams: [] }, { role: "leader", teams: ["khong_co"] },
        { role: "giam_doc_gia", teams: ["*"] }, { role: "", teams: ["*"] },
    ]) {
        const a = A.accessForUser(u);
        assert.strictEqual(a.full, false);
        assert.deepStrictEqual(a.tabs, [], JSON.stringify(u));
    }
});

console.log("── Ai thấy tab nào ──");
t("leader thấy báo cáo, đơn, vận đơn, kho, khách của team", () => {
    for (const tab of ["overview", "pnl", "product-pnl", "order-ledger", "cod-recon", "tracking", "products", "marketing", "ad-spend", "ads-command", "ad-health", "customers", "market-intel"]) {
        assert.ok(A.canTab(loc, tab), tab);
    }
});
t("leader KHÔNG thấy đối soát chi phí QC (thẻ trả TKQC chung công ty)", () => {
    assert.ok(!A.canTab(loc, "ads-recon"));
});
t("leader thấy Chi phí quảng cáo + Ads Command Center (route đã tự lọc theo nước)", () => {
    assert.ok(A.canTab(loc, "ad-spend") && A.canTab(loc, "ads-command"));
    assert.ok(A.checkApi(thai, "/api/talpha/ad-spend", q("from=2026-10-01&to=2026-10-05")).ok);
    assert.ok(A.checkApi(thai, "/api/talpha/realtime", q("")).ok);
});
t("Thương chỉ thấy đơn, vận đơn, kho, khách — không báo cáo, không quảng cáo, không Kế toán", () => {
    assert.deepStrictEqual([...thuong.tabs].sort(), ["customers", "order-ledger", "products", "tracking"]);
});
// Mục Kế toán (Sỹ Anh chốt 07/10/2026): Tiền COD về do leader nước đó + giám đốc kiểm soát chung.
t("Kế toán: leader thấy Tiền COD về của nước mình, không thấy Thanh toán quảng cáo", () => {
    assert.ok(A.canTab(loc, "cod-recon") && A.canTab(thai, "cod-recon"));
    assert.ok(!A.canTab(loc, "ads-recon") && !A.canTab(thai, "ads-recon"));
    assert.ok(!A.canTab(thuong, "cod-recon"));
});
t("Kế toán: chỉ leader + giám đốc tải sao kê; Thương không gọi được route sao kê", () => {
    assert.ok(!A.checkApi(thuong, "/api/talpha/cod-recon", q("")).ok);
    assert.ok(!A.checkApi(thuong, "/api/talpha/cod-recon/market", q("market=sg")).ok);
    assert.ok(A.checkApi(thuong, "/api/talpha/order-ledger", q("")).ok);       // Sổ đơn Đài vẫn mở
});
t("cod-actions: Thương ghi được 'đã nhắn NAZA', không ghi được tiền về / hỏi / bỏ qua / huỷ", () => {
    assert.ok(A.checkApi(thuong, "/api/talpha/cod-actions", q("")).ok);       // cửa mở cho Sổ đơn
    assert.ok(A.ghiCodDuoc(thuong, "done", "da_doi"));
    for (const [k, v] of [["bank"], ["done", "da_hoi"], ["done", "bo_qua"], ["xoa"]]) {
        assert.ok(!A.ghiCodDuoc(thuong, k, v), `${k}/${v}`);
        assert.ok(A.ghiCodDuoc(sanh, k, v), `${k}/${v}`);
    }
    const leaderDai = A.accessForUser({ id: "5", name: "Leader Đài", role: "leader", teams: ["dong_a"] });
    assert.ok(A.ghiCodDuoc(leaderDai, "bank") && A.ghiCodDuoc(leaderDai, "done", "bo_qua"));
    assert.ok(A.checkApi(leaderDai, "/api/talpha/cod-recon", q("")).ok);
    assert.ok(!A.checkApi(loc, "/api/talpha/cod-actions", q("")).ok);          // Lộc vẫn không đụng sổ Đài
});

console.log("── API ──");
t("Lộc không mở được Sổ đơn / Đối soát / Vận đơn của Đài, Singapore", () => {
    assert.ok(!A.checkApi(loc, "/api/talpha/order-ledger", q("")).ok);           // sổ Đài
    assert.ok(!A.checkApi(loc, "/api/talpha/cod-recon", q("")).ok);
    assert.ok(!A.checkApi(loc, "/api/talpha/cod-actions", q("")).ok);
    assert.ok(!A.checkApi(loc, "/api/talpha/order-ledger/market", q("market=SG")).ok);
    assert.ok(!A.checkApi(loc, "/api/talpha/cod-recon/market", q("market=sg")).ok);
    assert.ok(!A.checkApi(loc, "/api/talpha/tracking", q("market=SG"), track).ok);
    assert.ok(!A.checkApi(loc, "/api/talpha/tracking", q(""), track).ok);           // không ghi nước = Đài
    assert.ok(!A.checkApi(loc, "/api/talpha/tracking", q("market=XX"), track).ok);  // mã lạ = Đài
    assert.ok(!A.checkApi(loc, "/api/talpha/tracking/import", q("")).ok);
});
t("Lộc mở được của UAE", () => {
    assert.ok(A.checkApi(loc, "/api/talpha/order-ledger/market", q("market=AE")).ok);
    assert.ok(A.checkApi(loc, "/api/talpha/cod-recon/market", q("market=ae")).ok);
    assert.ok(A.checkApi(loc, "/api/talpha/tracking", q("market=AE"), track).ok);
});
t("route một nước không ghi nước → từ chối người xem một phần", () => {
    assert.ok(!A.checkApi(loc, "/api/talpha/order-ledger/market", q("")).ok);
});
t("route chỉ giám đốc: ads-recon, billing, ceo-ask, export, users, ad-accounts, ads-alerts", () => {
    for (const p of ["/api/talpha/ads-recon", "/api/talpha/billing", "/api/talpha/ceo-ask", "/api/talpha/export-report",
        "/api/users", "/api/ad-accounts", "/api/talpha/sync-inventory", "/api/talpha/ads-alerts"]) {
        assert.ok(!A.checkApi(thuong, p, q("")).ok, p);
        assert.ok(A.checkApi(sanh, p, q("")).ok, p);
    }
});
t("route chưa khai = chỉ giám đốc (thêm route mới mà quên khai thì chặn, không hở)", () => {
    assert.ok(!A.checkApi(loc, "/api/talpha/route-moi-chua-khai", q("")).ok);
    assert.ok(A.checkApi(sanh, "/api/talpha/route-moi-chua-khai", q("")).ok);
});
t("tiền tố dài nhất thắng: order-ledger/market khác order-ledger", () => {
    assert.deepStrictEqual(A.apiRule("/api/talpha/order-ledger/market").market, "param");
    assert.deepStrictEqual(A.apiRule("/api/talpha/order-ledger").market, "TW");
    assert.strictEqual(A.apiRule("/api/talpha/order-ledgerX"), null);
});
t("Thương: đơn mọi nước được, báo cáo + SQL chung không", () => {
    assert.ok(A.checkApi(thuong, "/api/talpha/order-ledger", q("")).ok);
    assert.ok(A.checkApi(thuong, "/api/talpha/tracking", q("market=SG"), track).ok);
    assert.ok(!A.checkApi(thuong, "/api/talpha/sheet-report", q("from=2026-10-01&to=2026-10-05")).ok);
    assert.ok(A.checkApi(thuong, "/api/query", q("")).ok);   // tab Khách hàng
    assert.ok(!A.checkApi(thuong, "/api/talpha/realtime", q("")).ok);
});
t("ai đăng nhập cũng đọc được markets, me, report-config", () => {
    for (const p of ["/api/talpha/markets", "/api/talpha/me", "/api/talpha/report-config"]) assert.ok(A.checkApi(thai, p, q("")).ok);
});

console.log("── /api/query: câu SQL dựng ở trình duyệt ──");
const P = "cty-507710", D = "TALPHA_Dataset";
const sc = (sql, a = loc, ds = []) => A.scopeQuery(sql, a, P, D, ds);
t("giám đốc và người xem đủ ba nước: câu giữ nguyên", () => {
    const s = "SELECT 1 FROM `cty-507710.TALPHA_Dataset.vw_orders_std`";
    assert.deepStrictEqual(sc(s, sanh), { ok: true, sql: s });
    assert.deepStrictEqual(sc(s, thuong), { ok: true, sql: s });
});
t("đơn: lọc theo cột market; mọi kiểu đặt dấu ` đều bị thay", () => {
    for (const ref of ["`cty-507710.TALPHA_Dataset.vw_orders_std`", "`cty-507710.TALPHA_Dataset`.vw_orders_std",
        "`cty-507710`.`TALPHA_Dataset`.`vw_orders_std`", "cty-507710.TALPHA_Dataset.vw_orders_std"]) {
        const r = sc(`SELECT v.market, SUM(v.revenue_vnd) FROM ${ref} v GROUP BY 1`);
        assert.ok(r.ok, ref + " " + r.error);
        assert.ok(r.sql.includes("WHERE market IN ('AE')"), r.sql);
        assert.ok(!/FROM\s+`cty-507710\.TALPHA_Dataset\.vw_orders_std`\s+v/.test(r.sql), "còn bảng trần: " + r.sql);
    }
});
t("sale_order, order_items lọc theo shop; chi tiêu Meta lọc theo nước ở tên campaign", () => {
    const r = sc("SELECT o.id FROM `cty-507710.TALPHA_Dataset.sale_order` o JOIN `cty-507710.TALPHA_Dataset.order_items` i ON i.order_id = CAST(o.id AS STRING)");
    assert.ok(r.ok && r.sql.includes("UPPER(shop_label) IN ('AE')") && r.sql.includes("CAST(shop_id AS STRING) IN (SELECT DISTINCT"), r.sql);
    const m = sc("SELECT SUM(spend) FROM `cty-507710.TALPHA_Dataset`.vw_ad_windows WHERE NOT is_test_campaign", thai);
    assert.ok(m.ok && m.sql.includes("IN ('Singapore')") && m.sql.includes("SPLIT(IFNULL(campaign_name, ''), '/')"), m.sql);
});
t("bảng gộp mọi nước (vw_attribution_quality) và bảng lạ → từ chối", () => {
    assert.ok(!sc("SELECT * FROM `cty-507710.TALPHA_Dataset`.vw_attribution_quality").ok);
    assert.ok(!sc("SELECT * FROM `cty-507710.TALPHA_Dataset.fb_ads_data`").ok);
});
t("đường vòng tới dữ liệu đều bị chặn", () => {
    const xau = [
        "SELECT * FROM TALPHA_Dataset.sale_order",                                         // 2 phần, dự án mặc định
        "SELECT * FROM `cty-507710.TALPHA_Dataset.vw_orders_std` v, `other-proj.ds.t` x",   // dự án khác có dấu `
        "SELECT * FROM `cty-507710.TALPHA_Dataset.vw_orders_std` v JOIN other-proj.ds.t x ON TRUE",
        "SELECT * FROM `cty-507710.TALPHA_Dataset.vw_orders_std` v, region-us.INFORMATION_SCHEMA.JOBS j",
        "SELECT * FROM `cty-507710.TALPHA_Dataset.vw_orders_std` v WHERE v.x IN (SELECT 1 FROM sale_order)",
        "SELECT __T0__ FROM `cty-507710.TALPHA_Dataset.vw_orders_std`",
        "SELECT 1",                                                                         // không đọc bảng dashboard
        "SELECT * FROM `cty-507710.TALPHA_Dataset.vw_orders_st\\x64`",                     // thoát ký tự trong tên
        // giấu code sau chú thích # — máy tưởng là chuỗi, BigQuery chạy thật
        "SELECT * FROM `cty-507710.TALPHA_Dataset.vw_orders_std` v # '\n, other.ds.t x -- '",
        "SELECT r'\\' , (SELECT 1 FROM other.ds.t) , '\\' FROM `cty-507710.TALPHA_Dataset.vw_orders_std`",
        "SELECT 'chưa đóng FROM `cty-507710.TALPHA_Dataset.vw_orders_std`",
    ];
    for (const s of xau) assert.ok(!sc(s).ok, s);
    // dataset khác trong cùng dự án (danh sách route lấy lúc chạy)
    assert.ok(!sc("SELECT * FROM `cty-507710.TALPHA_Dataset.vw_orders_std` v, OldGCC.sale_order g", loc, ["TALPHA_Dataset", "OldGCC"]).ok);
});
t("chữ trùng tên bảng nằm TRONG chuỗi hoặc chú thích không làm hỏng câu", () => {
    const r = sc("SELECT 'cty-507710.TALPHA_Dataset.x' AS s, \"sale_order\" AS k -- vw_orders_std\nFROM `cty-507710.TALPHA_Dataset.vw_orders_std`");
    assert.ok(r.ok, r.error);
});
t("câu thật của 4 tab chạy được với leader", () => {
    const T = "`cty-507710.TALPHA_Dataset`";
    const cau = [
        `SELECT account_name, ROUND(SUM(spend), 0) as spend FROM \`cty-507710.TALPHA_Dataset.vw_fb_ads_std\` WHERE date BETWEEN '2026-09-15' AND '2026-10-05' AND spend > 0 GROUP BY 1 ORDER BY spend DESC`,
        `SELECT ad_id, campaign_name FROM ${T}.vw_ad_windows WHERE NOT is_test_campaign AND health_severity >= 3 ORDER BY health_severity DESC, spend_7d DESC LIMIT 50`,
        `WITH o AS (SELECT id, ANY_VALUE(customer_phone) phone FROM \`cty-507710.TALPHA_Dataset.sale_order\` GROUP BY id)
         SELECT v.market, COUNT(DISTINCT o.phone) c, STRING_AGG(DISTINCT v.market, ', ') s
         FROM \`cty-507710.TALPHA_Dataset.vw_orders_std\` v JOIN o ON o.id = v.order_id GROUP BY 1`,
        `SELECT v.market, SUM(oi.quantity) OVER (PARTITION BY oi.shop_id, oi.order_id) q
         FROM \`cty-507710.TALPHA_Dataset.order_items\` oi
         JOIN \`cty-507710.TALPHA_Dataset.vw_orders_std\` v ON oi.shop_id = CAST(v.shop_id AS STRING) AND oi.order_id = CAST(v.order_id AS STRING)`,
    ];
    for (const s of cau) { const r = sc(s); assert.ok(r.ok, r.error + "\n" + s); }
});
t("biểu thức nước theo tên campaign khớp luật campaignMarket (ô đầu tiên là nước thắng, không có → Đài)", () => {
    const e = A.sqlCampaignMarketKey("campaign_name");
    assert.ok(e.includes("WHEN 'SGP' THEN 'Singapore'") && e.includes("WHEN 'AE' THEN 'UAE'") && e.includes("WHEN 'TW' THEN 'Taiwan'"));
    assert.ok(/ORDER BY vi_tri LIMIT 1\s*\), 'Taiwan'\)$/.test(e.trim()), e);
});

console.log(`\n${pass} phép thử phân quyền qua.`);
