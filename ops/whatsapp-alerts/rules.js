// TALPHA — loader rule chung cho bot (CommonJS).
// Nguồn data: config/talpha_rules.json (repo root — server: /opt/talpha/config/).
// Sửa rule = sửa JSON đó; file này chỉ là loader + fallback khi thiếu JSON.
const fs = require("fs");
const path = require("path");

const CANDIDATES = [
    path.join(__dirname, "..", "..", "config", "talpha_rules.json"), // repo/server layout
    path.join(__dirname, "talpha_rules.json"),                        // fallback copy cạnh bot
];
let RULES = null;
const found = CANDIDATES.find((p) => fs.existsSync(p));
if (found) {
    RULES = JSON.parse(fs.readFileSync(found, "utf8"));
} else {
    console.warn("[rules] talpha_rules.json KHÔNG tìm thấy — dùng fallback nội bộ (nên deploy config/ lên server!)");
}

// Fallback = đúng rule đang chạy trước 29/07 (chỉ dùng khi thiếu JSON)
const FALLBACK_SCAN = [
    { key: "Loc", substrings: ["LỘC"], word_tokens: ["LOC"] },
    { key: "Nhung", substrings: ["NHUNG"] },
    { key: "ChuThuy", substrings: ["THUÝ", "THUY"] },
    { key: "Chinh", substrings: ["CHÍNH"], word_tokens: ["CHINH"] },
    { key: "The", substrings: ["THẾ"], word_tokens: ["THE"] },
    { key: "Mai", substrings: ["MAI"] },
    { key: "SAnh", regex: "\\bS?\\.?\\s?ANH\\b" },
];
const FALLBACK_DISPLAY = { Loc: "Lộc", ChuThuy: "Chu Thuý", Nhung: "Nhung", The: "Thế", Mai: "Mai", Chinh: "Chính", SAnh: "S.Anh", Quan: "Quân" };

const FALLBACK_POS = [
    { contains: "LỘC", key: "Loc" }, { contains: "NHUNG", key: "Nhung" }, { contains: "THU", key: "ChuThuy" },
    { contains: "MAI", key: "Mai" }, { contains: "CHÍNH", key: "Chinh" }, { contains: "THẾ", key: "The" },
    { contains: "ANH", key: "SAnh" },
];
const FALLBACK_CAMP_TOKENS = {
    "CTHUÝ": "ChuThuy", "CTHUY": "ChuThuy", "LOC": "Loc", "LỘC": "Loc", "SLỘC": "Loc",
    "NTHE": "The", "NTHẾ": "The", "NHUNG": "Nhung", "MAI": "Mai", "CHÍNH": "Chinh",
    "CHINH": "Chinh", "QUÂN": "Quan", "QUAN": "Quan", "SANH": "SAnh", "SỸANH": "SAnh", "HỒSỸANH": "SAnh",
};
const FALLBACK_MARKETS = ["SAUDI", "SAUDIU", "UAE", "KUWAIT", "OMAN", "QATAR", "BAHRAIN", "TAIWAN"];

const SCAN = RULES ? RULES.camp_scan_rules : FALLBACK_SCAN;
const DISPLAY = RULES
    ? Object.fromEntries(Object.entries(RULES.marketers).map(([k, v]) => [k, v.display]))
    : FALLBACK_DISPLAY;
const POS_RULES = RULES ? RULES.pos_marketer_rules : FALLBACK_POS;
const CAMP_TOKENS = RULES
    ? Object.fromEntries(Object.entries(RULES.camp_marketer_tokens).filter(([k]) => !k.startsWith("_")))
    : FALLBACK_CAMP_TOKENS;
const CAMP_MARKETS = RULES
    ? Object.fromEntries(RULES.camp_market_tokens.map((t) => [t, RULES.market_aliases[t]]))
    : Object.fromEntries(FALLBACK_MARKETS.map((t) => [t, t]));

function hasWordToken(u, tok) {
    return new RegExp(`(^|[^A-Z])${tok}([^A-Z]|$)`).test(u);
}
/** Quét cả tên campaign → key marketer (Loc/ChuThuy/…); null nếu không gán được. */
function scanCampaignMarketer(name) {
    const u = String(name || "").toUpperCase();
    for (const r of SCAN) {
        for (const s of r.substrings || []) if (u.includes(s)) return r.key;
        for (const t of r.word_tokens || []) if (hasWordToken(u, t)) return r.key;
        if (r.regex && new RegExp(r.regex).test(u)) return r.key;
    }
    return null;
}

// ═══ GÁN MARKETER — RULE CEO 3 BẬC (≡ talpha_rules.py / rules.ts) ═══
//   1. Tag marketer trong POS → 2. ad_id → chủ campaign → 3. "(không gán)"
const UNASSIGNED = "(không gán)";

// ═══ NGƯỜI ĐÃ NGHỈ — dồn hết về "(không gán)", không có tin WhatsApp ═══
// Khối `unassign_marketers` trong talpha_rules.json (Mai + Thế, CEO chốt 02/09).
// CỐ Ý vẫn giữ họ trong pos_marketer_rules / camp_marketer_tokens để campaign của họ
// còn parse được; chỉ đổi Ô ĐÍCH. ≡ talpha_rules.py bucket_nv().
const UNASSIGN = new Set((RULES && RULES.unassign_marketers) || []);

/** Tên marketer tag trong POS ($.name) → key marketer; null = ngoài team. */
function normPosMarketer(name) {
    if (!name) return null;
    const u = String(name).toUpperCase();
    for (const r of POS_RULES) if (u.includes(r.contains)) return r.key;
    return null;
}

/** Segment campaign NGAY SAU thị trường → key marketer (exact-token). */
function normCampMarketer(s) {
    if (!s) return null;
    return CAMP_TOKENS[String(s).trim().toUpperCase().replace(/\./g, "").replace(/ /g, "")] || null;
}

/** campaign_name → [thị trường, key marketer]. */
function parseCampaign(cn) {
    const p = String(cn || "").split("/").map((x) => x.trim());
    const mi = p.findIndex((s) => s.toUpperCase() in CAMP_MARKETS);
    if (mi < 0) return [null, null];
    return [CAMP_MARKETS[p[mi].toUpperCase()], mi + 1 < p.length ? normCampMarketer(p[mi + 1]) : null];
}

/**
 * Campaign TEST sản phẩm — rule CEO #7: tách khỏi MỌI báo cáo doanh số.
 * Sheet và endpoint marketer-perf đều đã lọc; bot trước đây thì không, nên tin sáng
 * cộng thêm tiền camp test và lệch với Sheet (đo 01/09: S.Anh lệch 93.773đ + 2 mess).
 * Thị trường trong exempt_markets (Taiwan) miễn rule vì cả market đang là test.
 */
function isTestCampaign(cn, market) {
    const cfg = (RULES && RULES.test_campaign) || {};
    if (!cfg.pattern) return false;
    const mkt = market !== undefined ? market : parseCampaign(cn)[0];
    if (mkt && (cfg.exempt_markets || []).includes(mkt)) return false;
    try { return new RegExp(cfg.pattern).test(String(cn || "")); }
    catch { return false; }
}

/** [{ad_id, campaign_name}] → {ad_id: key marketer} — bảng tra cho BẬC 2. */
function buildAdidOwner(rows) {
    const out = {};
    for (const r of rows || []) {
        if (r.ad_id === null || r.ad_id === undefined || r.ad_id === "") continue;
        const nv = parseCampaign(r.campaign_name)[1];
        // Người đã nghỉ không vào bảng tra — nếu không, đơn không tag lại theo ad_id
        // chui ngược vào ô của họ.
        if (nv && !UNASSIGN.has(nv)) out[String(r.ad_id)] = nv;
    }
    return out;
}

/** Gán 1 đơn về marketer theo rule CEO 3 bậc → {key, source}. */
function attributeOrder(posMarketer, adId, adidOwner) {
    const tagged = normPosMarketer(posMarketer);
    // Đã nghỉ → "(không gán)" NGAY, không rơi xuống bậc 2: tag POS là bằng chứng đơn
    // này của họ, để fallback ad_id đẩy sang người khác là gán sai người.
    if (tagged) return UNASSIGN.has(tagged)
        ? { key: UNASSIGNED, source: "unassigned" }
        : { key: tagged, source: "pos_tag" };
    if (adId !== null && adId !== undefined && adId !== "" && adidOwner) {
        const owner = adidOwner[String(adId)];
        if (owner) return { key: owner, source: "ad_id" };
    }
    return { key: UNASSIGNED, source: "unassigned" };
}

module.exports = {
    RULES, DISPLAY, scanCampaignMarketer, UNASSIGNED, UNASSIGN, isTestCampaign,
    normPosMarketer, normCampMarketer, parseCampaign, buildAdidOwner, attributeOrder,
};
