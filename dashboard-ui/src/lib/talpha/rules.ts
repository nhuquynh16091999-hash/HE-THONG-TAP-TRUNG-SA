// ═══════════════════════════════════════════════════════════════════
// TALPHA — loader rule chung phía TypeScript (server-side only).
// Nguồn data DUY NHẤT: config/talpha_rules.json (repo root; prebuild copy vào
// dashboard-ui/config/ cho Vercel). Sửa rule = sửa JSON, KHÔNG sửa file này.
// Golden-test 29/07: các hàm này ≡ format_all.py trên 502 campaign + 18 tên POS thật.
// ═══════════════════════════════════════════════════════════════════
import fs from "fs";
import path from "path";

type MarketInfo = { shop_label: string; rate_vnd: number; currency: string; pos_money_divisor: number };
type ScanRule = { key: string; substrings?: string[]; word_tokens?: string[]; regex?: string };
type ShipFee = { partner?: string; packing: number; delivery: number; cod_pct: number; cod_flat: number };
type Rules = {
    version: string;
    marketers: Record<string, { display: string; full: string; inactive?: boolean }>;
    camp_marketer_tokens: Record<string, string>;
    pos_marketer_rules: { contains: string; key: string }[];
    camp_scan_rules: ScanRule[];
    markets: Record<string, MarketInfo>;
    market_aliases: Record<string, string>;
    camp_market_tokens: string[];
    status: { gtc_category: string; gtc_status_names: string[] };
    test_campaign: { pattern: string; exempt_markets: string[] };
    shipping_fees: Record<string, ShipFee | string>;
    pos_timezone: string;
    page_id_pattern: string;
    products?: Record<string, ProductCost | string>;
    targets?: {
        monthly_revenue_vnd?: Record<string, number>;
        marketer_monthly_ship_vnd?: Record<string, Record<string, number> | string>;
    };
};
type ProductCost = { name: string; cost_price_vnd: number };

const CANDIDATES = [
    path.join(process.cwd(), "..", "config", "talpha_rules.json"), // chạy local (cwd = dashboard-ui)
    path.join(process.cwd(), "config", "talpha_rules.json"),       // Vercel (bản prebuild copy)
];
const RULES_PATH = CANDIDATES.find((p) => fs.existsSync(p));
if (!RULES_PATH) throw new Error("talpha_rules.json không tìm thấy — kiểm tra prebuild sync-config");
export const RULES: Rules = JSON.parse(fs.readFileSync(RULES_PATH, "utf-8"));

// ── Tỷ giá & thị trường ──
export const EXCHANGE_RATES: Record<string, number> = Object.fromEntries(
    Object.entries(RULES.markets).map(([m, v]) => [m, v.rate_vnd]));
export const SHOP2MKT: Record<string, string> = Object.fromEntries(
    Object.entries(RULES.markets).map(([m, v]) => [v.shop_label, m]));

// ── X13: số chia đưa tiền thô của POS về ĐƠN VỊ TIỀN THẬT của shop ──
// 6 shop GCC nhập giá kiểu minor units (cod=9900 ⇒ 99,00 SAR) → 100; shop Đài nhập
// NGUYÊN TWD (cod=950 ⇒ 950 TWD, verify bằng POS API 20/08) → 1. Trước 20/08 mọi chỗ
// gõ thẳng `/100` ⇒ tiền Đài tụt đúng 100 lần trên cả Sheet lẫn dashboard mà không có
// cảnh báo nào. Dùng posMoneyDivisor(), ĐỪNG gõ 100.
export const MONEY_DIV: Record<string, number> = Object.fromEntries(
    Object.entries(RULES.markets).flatMap(([m, v]) => [
        [m, v.pos_money_divisor] as [string, number],
        [v.shop_label, v.pos_money_divisor] as [string, number],
    ]));

/** Số chia tiền POS theo shop_label HOẶC tên market; shop lạ → 100 (mặc định minor units). */
export function posMoneyDivisor(marketOrShopLabel?: string | null): number {
    return MONEY_DIV[marketOrShopLabel || ""] || 100;
}
export const CAMP_MARKETS: Record<string, string> = Object.fromEntries(
    RULES.camp_market_tokens.map((t) => [t, RULES.market_aliases[t]]));
export const MARKET_CANON: Record<string, string> = Object.fromEntries(
    Object.entries(RULES.market_aliases).filter(([k]) => !k.startsWith("_")));
export const DISPLAY: Record<string, string> = Object.fromEntries(
    Object.entries(RULES.marketers).map(([k, v]) => [k, v.display]));

// ── KPI doanh số theo tháng ──
// Khoá "YYYY-MM" → VND. Nguồn: khối `targets` trong talpha_rules.json (chép từ
// KH_Q3Q4_2026_Team_Ads.xlsx, CEO chốt). Tháng không khai = không có KPI, phía
// dashboard phải ẩn thanh tiến độ chứ KHÔNG được suy ra từ tháng khác.
// ⚠ KPI đo trên DOANH SỐ SHIP, dashboard đo DS GIAO THÀNH CÔNG — xem _targets_note.
export const MONTHLY_REVENUE_TARGETS: Record<string, number> =
    RULES.targets?.monthly_revenue_vnd ?? {};

// KPI ship theo tháng của TỪNG NGƯỜI, key = TÊN HIỂN THỊ ("Lộc", "Chu Thuý"…) để
// client so thẳng với cột marketer của /api/talpha/marketer-perf. Người không có
// trong bảng KPI (S.Anh) không có khoá — tab phải ẩn thanh, không suy diễn.
export const MARKETER_MONTHLY_TARGETS: Record<string, Record<string, number>> =
    Object.fromEntries(
        Object.entries(RULES.targets?.marketer_monthly_ship_vnd ?? {})
            .filter(([k, v]) => !k.startsWith("_") && typeof v === "object")
            .map(([k, v]) => [DISPLAY[k] ?? k, v as Record<string, number>]),
    );

// ── Gán marketer: 3 hàm chuẩn (≡ Python talpha_rules) ──
const CAMP_TOKENS = Object.fromEntries(
    Object.entries(RULES.camp_marketer_tokens).filter(([k]) => !k.startsWith("_")));

/** Segment campaign NGAY SAU thị trường → key marketer (exact-token). */
export function normCampMarketer(s?: string | null): string | null {
    if (!s) return null;
    const u = s.trim().toUpperCase().replace(/\./g, "").replace(/ /g, "");
    return CAMP_TOKENS[u] || null;
}

/** Tên marketer tag trong POS ($.name) → key marketer; null = ngoài team. */
export function normPosMarketer(name?: string | null): string | null {
    if (!name) return null;
    const u = String(name).toUpperCase();
    for (const r of RULES.pos_marketer_rules) if (u.includes(r.contains)) return r.key;
    return null;
}

// ═══ SALE — hệ thống mới, POS KHÔNG có trường này ═══
// Đơn được gán cho sale theo 3 bậc, khai trong talpha_rules.json → sale_assignment:
//   (1) bảng gán tay `manual`, khoá là order_uid ('TW-<id>')
//   (2) page_id của đơn → `by_page`
//   (3) từ khoá trong ô tags của đơn → `by_tag`
// Trượt hết ⇒ SALE_UNASSIGNED. KHÔNG bỏ đơn lặng lẽ, giống rule marketer.
type SaleAssignment = {
    by_tag?: Record<string, string>;
    by_page?: Record<string, string>;
    manual?: Record<string, string>;
    unassigned_label?: string;
};
const SA: SaleAssignment =
    (RULES as unknown as { sale_assignment?: SaleAssignment }).sale_assignment || {};

export const SALES: Record<string, { display: string; full: string }> =
    (RULES as unknown as { sales?: Record<string, { display: string; full: string }> }).sales || {};
export const SALE_DISPLAY: Record<string, string> = Object.fromEntries(
    Object.entries(SALES).map(([k, v]) => [k, v.display || k]));
export const SALE_UNASSIGNED = SA.unassigned_label || "(chưa gán sale)";

/** Đơn → key sale. Trả null khi không gán được (caller dùng SALE_UNASSIGNED). */
export function resolveSale(o: { order_uid?: string | null; page_id?: string | null; tags?: string | null }): string | null {
    const manual = SA.manual || {};
    if (o.order_uid && manual[o.order_uid]) return manual[o.order_uid];

    const byPage = SA.by_page || {};
    if (o.page_id && byPage[String(o.page_id)]) return byPage[String(o.page_id)];

    const byTag = SA.by_tag || {};
    if (o.tags) {
        const u = String(o.tags).toUpperCase();
        for (const [tok, key] of Object.entries(byTag)) {
            if (u.includes(tok.toUpperCase())) return key;
        }
    }
    return null;
}

function hasWordToken(u: string, tok: string): boolean {
    return new RegExp(`(^|[^A-Z])${tok}([^A-Z]|$)`).test(u);
}

/** Quét CẢ TÊN campaign → key marketer (cho cảnh báo/bot — không cần parse segment). */
export function scanCampaignMarketer(name?: string | null): string | null {
    const u = String(name || "").toUpperCase();
    for (const r of RULES.camp_scan_rules) {
        for (const s of r.substrings || []) if (u.includes(s)) return r.key;
        for (const t of r.word_tokens || []) if (hasWordToken(u, t)) return r.key;
        if (r.regex && new RegExp(r.regex).test(u)) return r.key;
    }
    return null;
}

// ── Status GTC ──
export const GTC_CATEGORY = RULES.status.gtc_category;
const GTC_NAMES = new Set(RULES.status.gtc_status_names);
export function isDelivered(statusName?: string | null, statusCategory?: string | null): boolean {
    if (statusCategory) return String(statusCategory).toUpperCase() === GTC_CATEGORY;
    return GTC_NAMES.has(String(statusName || "").toLowerCase());
}

// ── Test campaign ──
const TEST_RE = new RegExp(RULES.test_campaign.pattern);
const NO_TEST = new Set(RULES.test_campaign.exempt_markets);
export function isTestCampaign(cn?: string | null, mkt?: string | null): boolean {
    if (mkt && NO_TEST.has(mkt)) return false;
    return TEST_RE.test(cn || "");
}

export const POS_TIMEZONE = RULES.pos_timezone;
export const PAGE_ID_RE = new RegExp(RULES.page_id_pattern);

// ── Phí ship 3PL (tệ địa phương, key = shop_label) ──
export const SHIPPING_FEES: Record<string, ShipFee> = Object.fromEntries(
    Object.entries(RULES.shipping_fees || {}).filter(([k]) => !k.startsWith("_"))) as Record<string, ShipFee>;

/** Phí ship ước tính (VND) từ số đơn GTC + doanh thu tệ địa phương. Thị trường chưa khai phí → 0. */
export function shippingVnd(shopLabel: string, orders: number, revenueLocal: number): number {
    const f = SHIPPING_FEES[(shopLabel || "").toUpperCase()];
    if (!f || orders <= 0) return 0;
    const local = orders * (f.packing + f.delivery + (f.cod_flat || 0)) + (revenueLocal || 0) * (f.cod_pct || 0);
    const mkt = SHOP2MKT[(shopLabel || "").toUpperCase()];
    return local * (EXCHANGE_RATES[mkt] || 0);
}

// ── Giá vốn theo SKU (E2) — VND/unit, key = product_catalog.sku ──
// POS không trả giá vốn (last_imported_price/avg_price = 0 mọi item) → JSON là nguồn duy nhất.
export const PRODUCT_COSTS: Record<string, ProductCost> = Object.fromEntries(
    Object.entries(RULES.products || {}).filter(([k]) => !k.startsWith("_"))) as Record<string, ProductCost>;

/** Giá vốn 1 unit theo SKU (VND); null = SKU chưa khai giá vốn — KHÔNG coi là 0. */
export function costPriceVnd(sku?: string | null): number | null {
    const e = PRODUCT_COSTS[String(sku || "").trim()];
    return e ? e.cost_price_vnd : null;
}

// ═══════════════════════════════════════════════════════════════════
// GÁN MARKETER — RULE CEO 3 BẬC (≡ talpha_rules.py attribute_order)
//   1. Tag marketer trong POS → 2. ad_id → chủ campaign → 3. "(không gán)"
// ═══════════════════════════════════════════════════════════════════
export const UNASSIGNED = "(không gán)";
export type AttrSource = "pos_tag" | "ad_id" | "unassigned";

/** campaign_name → [thị trường, key marketer]; quy ước '… / <Thị trường> / <Marketer> / …'. */
export function parseCampaign(cn?: string | null): [string | null, string | null] {
    const p = String(cn || "").split("/").map((x) => x.trim());
    const mi = p.findIndex((s) => s.toUpperCase() in CAMP_MARKETS);
    const market = mi >= 0 ? CAMP_MARKETS[p[mi].toUpperCase()] : null;

    // Ba cách tìm marketer, thử lần lượt. Đội đặt tên campaign theo hai quy ước
    // khác nhau qua các thời kỳ, và chỉ nhận một quy ước là mất hết số của quy
    // ước kia — đo trên dữ liệu thật: 40,1/45,6 triệu (88% chi tiêu) rơi vào ô
    // "không nhận ra chủ" chỉ vì luật cũ chỉ biết quy ước cũ.

    // 1. Quy ước CŨ: "… / Thị trường / Marketer / …" — marketer đứng SAU thị trường.
    if (mi >= 0 && mi + 1 < p.length) {
        const after = normCampMarketer(p[mi + 1]);
        if (after) return [market, after];
    }

    // 2. Quy ước MỚI (đang dùng): "Marketer / Thị trường / SP / Trang / Ngày"
    //    — marketer đứng ĐẦU.
    if (p.length) {
        const first = normCampMarketer(p[0]);
        if (first) return [market, first];
    }

    // 3. Không theo quy ước nào: quét cả tên. Thà bắt được người ở vị trí lạ còn
    //    hơn ném cả campaign vào ô "không nhận ra chủ".
    return [market, scanCampaignMarketer(cn)];
}

/** [{ad_id, campaign_name}] → {ad_id: key marketer} — bảng tra cho BẬC 2. */
export function buildAdidOwner(rows: { ad_id?: string | number | null; campaign_name?: string | null }[]): Record<string, string> {
    const out: Record<string, string> = {};
    for (const r of rows) {
        if (r.ad_id === null || r.ad_id === undefined || r.ad_id === "") continue;
        const [, nv] = parseCampaign(r.campaign_name);
        if (nv) out[String(r.ad_id)] = nv;
    }
    return out;
}

/** Gán 1 đơn về marketer theo rule CEO 3 bậc. */
export function attributeOrder(
    posMarketer?: string | null,
    adId?: string | number | null,
    adidOwner?: Record<string, string>,
): { key: string; source: AttrSource } {
    const tagged = normPosMarketer(posMarketer);
    // Tag POS là bằng chứng mạnh nhất — có tag thì KHÔNG rơi xuống bậc 2.
    if (tagged) return { key: tagged, source: "pos_tag" };
    if (adId !== null && adId !== undefined && adId !== "" && adidOwner) {
        const owner = adidOwner[String(adId)];
        if (owner) return { key: owner, source: "ad_id" };
    }
    return { key: UNASSIGNED, source: "unassigned" };
}
