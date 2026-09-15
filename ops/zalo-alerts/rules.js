// TALPHA — đọc rule chung cho bot Zalo (CommonJS).
// Nguồn DUY NHẤT: config/talpha_rules.json (repo root — máy chủ: /opt/talpha/config/).
// Cùng luật với lib/talpha/rules.ts và ops/talpha_reports/talpha_rules.py.
//
// KHÔNG có bảng dự phòng: bản WhatsApp giữ sẵn một bảng tên marketer thời GCC để dùng
// khi thiếu file, nghĩa là thiếu file thì bot vẫn chạy — với danh sách người đã nghỉ.
// Thiếu file ở đây là dừng luôn, không gửi số gán sai người vào nhóm.
const fs = require("fs");
const path = require("path");

const RULES_FILE = path.join(__dirname, "..", "..", "config", "talpha_rules.json");
const RULES = JSON.parse(fs.readFileSync(RULES_FILE, "utf8"));

const khongGhiChu = (o) => Object.fromEntries(Object.entries(o || {}).filter(([k]) => !k.startsWith("_")));

// Key marketer → tên hiển thị, ĐÚNG thứ tự khai trong JSON — cũng là thứ tự tin riêng.
const MARKETERS = khongGhiChu(RULES.marketers);
const DISPLAY = Object.fromEntries(Object.entries(MARKETERS).map(([k, v]) => [k, v.display || k]));
const THU_TU = Object.keys(MARKETERS).map((k) => DISPLAY[k]);
// Người đã nghỉ: không có tin riêng, không vào bảng xếp hạng (khối unassign_marketers).
const UNASSIGN = new Set(RULES.unassign_marketers || []);

// File TỔNG TEAM có thêm tab theo NƯỚC từ 15/09/2026 ("Đài Loan", "Singapore"…), nằm lẫn
// với tab marketer. Tab nào trùng tên hiển thị (hoặc key) của một nước là tab nước.
const TAB_NUOC = new Set(Object.entries(khongGhiChu(RULES.markets)).flatMap(([key, v]) => [key, v.display || key]));

const CAMP_TOKENS = khongGhiChu(RULES.camp_marketer_tokens);
const CAMP_MARKETS = Object.fromEntries((RULES.camp_market_tokens || []).map((t) => [t, RULES.market_aliases[t]]));
const PRIMARY_MARKET = RULES.primary_market || null;

/** Một ô tên campaign → key marketer theo mã (LOC, THUONG, SANH…); null nếu không phải ô marketer. */
function normCampMarketer(s) {
    if (!s) return null;
    return CAMP_TOKENS[String(s).trim().toUpperCase().replace(/\./g, "").replace(/ /g, "")] || null;
}

/**
 * Chủ của campaign — ĐÚNG luật Sheet dùng (ops/talpha_reports/format_all.py → parse_camp),
 * vì số đầu bài của mọi tin là số Sheet:
 *   - có ô nước → marketer là ô NGAY SAU ô nước;
 *   - không ô nước (tên cũ) → marketer là ô đầu hoặc ô hai;
 *   - không khớp → null. KHÔNG quét cả tên.
 * Bot WhatsApp quét cả tên (scanCampaignMarketer) và gán sai người: 14/09/2026 camp
 * "TW/THUONG/VN/TEST/Trang Sức Vàng Thái/…" vào tin của Thái vì tên trang có chữ "Thái",
 * trong khi Sheet tính cho Thương.
 */
function chuCamp(cn) {
    const p = String(cn || "").split("/").map((x) => x.trim());
    const mi = p.findIndex((s) => s.toUpperCase() in CAMP_MARKETS);
    if (mi >= 0) return mi + 1 < p.length ? normCampMarketer(p[mi + 1]) : null;
    const o = p.slice(0, 2).find((s) => normCampMarketer(s));
    return o ? normCampMarketer(o) : null;
}

/**
 * Tên campaign → { market, source }. ≡ campaignMarket() bên rules.ts:
 * 'o_dau' ô đầu là nước · 'o_khac' nước ở ô khác · 'mac_dinh' không ghi nước → primary_market.
 */
function campaignMarket(cn) {
    const p = String(cn || "").split("/").map((x) => x.trim());
    for (let i = 0; i < p.length; i++) {
        const m = CAMP_MARKETS[p[i].toUpperCase()];
        if (m) return { market: m, source: i === 0 ? "o_dau" : "o_khac" };
    }
    return { market: PRIMARY_MARKET, source: "mac_dinh" };
}

/** Campaign test sản phẩm — tách khỏi báo cáo doanh số, trừ nước được miễn. ≡ rules.ts */
function isTestCampaign(cn) {
    const tc = RULES.test_campaign || {};
    if (!tc.pattern) return false;
    if ((tc.exempt_markets || []).includes(campaignMarket(cn).market)) return false;
    try { return new RegExp(tc.pattern).test(String(cn || "")); }
    catch { return false; }
}

/**
 * Tên ngắn của campaign cho dòng chi tiết: mã sản phẩm, kèm cờ nếu không phải nước chính.
 *
 * Mã sản phẩm đứng SAU ô tệp khách, mà ô tệp khách đứng sau ô marketer — nên tìm ô
 * marketer rồi đếm tiếp, thay vì lấy cứng ô thứ ba như bản WhatsApp. Lấy cứng thì tên
 * chuẩn mới `TW/LOC/PHI/072-DENTAL/…` ra "PHI" (tệp khách) cho mọi dòng.
 *   Lộc/Philippine/042 - BLACK/…          → 042 - BLACK      (tên cũ, marketer ở ô 1)
 *   TW/LOC/PHI/072 - DENTAL/…             → 072 - DENTAL
 *   SG/LOC/PHI/075 - SETTS01/…            → 🇸🇬 075 - SETTS01
 *   TW/THUONG/VN/TEST/BaloDaGiaTot/0709   → TEST · BaloDaGiaTot
 */
function tenNganCamp(name) {
    const p = String(name || "").split("/").map((s) => s.trim()).filter(Boolean);
    const mi = p.findIndex((s) => normCampMarketer(s) !== null);
    let sp = mi >= 0 ? p[mi + 2] : undefined;
    let trang = mi >= 0 ? p[mi + 3] : undefined;
    if (!sp) { sp = p[2] || p[1] || p[0] || String(name || ""); trang = undefined; }
    if (/^test$/i.test(sp) && trang) sp = `TEST · ${trang}`;

    const { market, source } = campaignMarket(name);
    const co = source !== "mac_dinh" && market !== PRIMARY_MARKET ? (RULES.markets[market] || {}).flag : "";
    const ngan = sp.length > 38 ? sp.slice(0, 38) + "…" : sp;
    return co ? `${co} ${ngan}` : ngan;
}

module.exports = {
    RULES, MARKETERS, DISPLAY, THU_TU, UNASSIGN, PRIMARY_MARKET, TAB_NUOC,
    chuCamp, normCampMarketer, campaignMarket, isTestCampaign, tenNganCamp,
};
