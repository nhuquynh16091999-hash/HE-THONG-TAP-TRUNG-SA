// ═══════════════════════════════════════════════════════════════════
// TALPHA — PHÂN QUYỀN theo team / thị trường (Sỹ Anh chốt 05/10/2026).
//
// Ba thị trường là ba team riêng, không liên quan nhau: leader team nào chỉ thấy
// số của nước team đó. Luật khai ở config/talpha_rules.json → access (teams, roles);
// file này chỉ ĐỌC luật đó và trả lời ba câu: người này thấy nước nào, thấy tab nào,
// gọi API này được không. Cố ý THUẦN — không đụng next-auth, không đọc danh sách
// người dùng — để test được (tests/access.test.cjs) và để proxy.ts lẫn từng route
// dùng chung MỘT cách hiểu. Hai nơi tự hiểu luật là sớm muộn một nơi hở.
// ═══════════════════════════════════════════════════════════════════
import { RULES, PRIMARY_MARKET, CAMP_MARKETS } from "./rules";

/** Mọi tab của dashboard-shell.tsx. Thêm tab mới thì thêm ở đây và ở access.roles. */
export const ALL_TABS = [
    "overview", "pnl", "product-pnl",
    "order-ledger", "cod-recon", "tracking",
    "products", "marketing",
    "ad-spend", "ads-command", "ad-health",
    "ads-recon",
    "customers", "market-intel",
] as const;

/**
 * Tab mà route phía sau CHƯA lọc theo nước — người chỉ được xem một phần số
 * thì không thấy tab, kẻo tab hiện nguyên số của team khác. Thêm tab mới mà route
 * chưa kịp lọc thì khai vào đây; lọc xong thì gỡ ra. (ad-spend, ads-command đã lọc
 * từ 05/10/2026 — nay rỗng.)
 */
export const CHUA_LOC_THEO_NUOC = new Set<string>();

/** Tab chỉ giám đốc: soát tiền ra của thẻ trả TKQC chung cả công ty. */
export const CHI_GIAM_DOC = new Set(["ads-recon"]);

type TeamCfg = { name: string; markets: string[]; leader?: string };
type RoleCfg = { label: string; desc?: string; full?: boolean; tabs?: string[] };
type AccessCfg = { teams?: Record<string, TeamCfg | string>; roles?: Record<string, RoleCfg | string> };

const CFG: AccessCfg = (RULES as unknown as { access?: AccessCfg }).access || {};
const laKhoa = (k: string) => !k.startsWith("_");

export const TEAMS: Record<string, TeamCfg> = Object.fromEntries(
    Object.entries(CFG.teams || {}).filter(([k, v]) => laKhoa(k) && v && typeof v === "object"),
) as Record<string, TeamCfg>;
export const ROLES: Record<string, RoleCfg> = Object.fromEntries(
    Object.entries(CFG.roles || {}).filter(([k, v]) => laKhoa(k) && v && typeof v === "object"),
) as Record<string, RoleCfg>;

// ── Tên nước (khoá trong `markets`: Taiwan…) ↔ mã shop (TW…) ──
const MARKETS = Object.entries(RULES.markets as Record<string, { shop_label?: string; shop_id?: string } | string>)
    .filter(([k, v]) => laKhoa(k) && v && typeof v === "object" && (v as { shop_label?: string }).shop_label) as
    [string, { shop_label: string; shop_id?: string }][];
export const MARKET_CODE: Record<string, string> = Object.fromEntries(MARKETS.map(([k, v]) => [k, v.shop_label.toUpperCase()]));
export const MARKET_KEY: Record<string, string> = Object.fromEntries(MARKETS.map(([k, v]) => [v.shop_label.toUpperCase(), k]));
export const ALL_MARKET_KEYS: string[] = MARKETS.map(([k]) => k);

export type UserLike = {
    id?: string | null; name?: string | null; email?: string | null;
    role?: string | null; teams?: string[] | null; status?: string | null;
};

export type Access = {
    /** user = người đăng nhập · internal = bot/việc nền trên máy chủ · public = DASHBOARD_PUBLIC bật. */
    kind: "user" | "internal" | "public";
    id: string | null;
    name: string;
    email: string | null;
    role: string;
    roleLabel: string;
    /** Xem hết mọi nước, mọi tab, vào được /admin. */
    full: boolean;
    /** Khoá nước được xem ("Taiwan"…). */
    markets: string[];
    /** Mã shop tương ứng ("TW"…). */
    codes: string[];
    tabs: string[];
    teams: { key: string; name: string; markets: string[] }[];
};

const danhSachTeam = (keys: string[]) =>
    keys.map((key) => ({ key, name: TEAMS[key].name, markets: TEAMS[key].markets.filter((m) => MARKET_CODE[m]) }));

export function fullAccess(kind: Access["kind"], name: string, extra: Partial<Access> = {}): Access {
    return {
        kind, id: null, name, email: null, role: "director", roleLabel: ROLES.director?.label || "Giám đốc",
        full: true,
        markets: [...ALL_MARKET_KEYS],
        codes: ALL_MARKET_KEYS.map((k) => MARKET_CODE[k]),
        tabs: [...ALL_TABS],
        teams: danhSachTeam(Object.keys(TEAMS)),
        ...extra,
    };
}

/**
 * Tài khoản → quyền. Vai trò lạ, không có team, team đã xoá → KHÔNG thấy gì (mặc định
 * đóng): khai thiếu thì người đó báo "không thấy gì", chứ không lặng lẽ thấy hết.
 */
export function accessForUser(u: UserLike): Access {
    const role = String(u.role || "");
    const rc = ROLES[role];
    const base = { kind: "user" as const, id: u.id ?? null, name: String(u.name || u.email || ""), email: u.email ?? null };
    if (rc?.full) return fullAccess("user", base.name, { ...base, role, roleLabel: rc.label });

    const ds = u.teams || [];
    const teamKeys = ds.includes("*") ? Object.keys(TEAMS) : ds.filter((k) => TEAMS[k]);
    const markets = [...new Set(teamKeys.flatMap((k) => TEAMS[k].markets))].filter((m) => MARKET_CODE[m]);
    const duNuoc = ALL_MARKET_KEYS.length > 0 && ALL_MARKET_KEYS.every((m) => markets.includes(m));
    const tabs = markets.length === 0 ? [] : (rc?.tabs || []).filter((t) =>
        (ALL_TABS as readonly string[]).includes(t) && !CHI_GIAM_DOC.has(t) && (duNuoc || !CHUA_LOC_THEO_NUOC.has(t)));
    return {
        ...base, role, roleLabel: rc?.label || role,
        full: false,
        markets,
        codes: markets.map((m) => MARKET_CODE[m]),
        tabs,
        teams: danhSachTeam(teamKeys),
    };
}

/** `m` là khoá nước ("UAE") hoặc mã shop ("AE"), không phân biệt hoa thường với mã. */
export function canMarket(a: Access, m?: string | null): boolean {
    if (a.full) return true;
    const s = String(m || "");
    return a.markets.includes(s) || a.codes.includes(s.toUpperCase());
}

export function canTab(a: Access, tab: string): boolean {
    return a.full || a.tabs.includes(tab);
}

/** Xem đủ mọi nước — route khỏi cần lọc gì (giám đốc, bot, hoặc người được giao cả ba team). */
export function seesAllMarkets(a: Access): boolean {
    return a.full || ALL_MARKET_KEYS.every((m) => a.markets.includes(m));
}

// ═══════════════════════════════════════════════════════════════════
// API nào ai gọi được. Khớp TIỀN TỐ DÀI NHẤT; đường không khai = chỉ giám đốc
// (mặc định đóng — thêm route mới mà quên khai thì leader bị chặn, không bị hở).
//
//   tabs   — gọi được khi thấy ÍT NHẤT MỘT tab trong danh sách ("*" = ai đăng nhập cũng được)
//   full   — chỉ người xem hết (giám đốc, bot)
//   market — route chỉ phục vụ MỘT nước: "TW" cố định · "param" theo ?market= ·
//            "tracking" theo ?market= với luật của trackMarket (mã lạ = Đài Loan)
//   Route gộp nhiều nước (sheet-report, query…) tự lọc bên trong theo Access.
// ═══════════════════════════════════════════════════════════════════
export type ApiRule = { tabs?: string[] | "*"; full?: boolean; market?: "TW" | "param" | "tracking" };

export const API_RULES: Record<string, ApiRule> = {
    "/api/talpha/me": { tabs: "*" },
    "/api/talpha/markets": { tabs: "*" },
    "/api/talpha/report-config": { tabs: "*" },
    "/api/talpha/sync-health": { tabs: "*" },

    "/api/talpha/sheet-report": { tabs: ["overview", "pnl", "marketing"] },
    "/api/talpha/pnl-costs": { tabs: ["overview", "pnl"] },
    "/api/talpha/targets": { tabs: ["overview", "marketing"] },
    "/api/talpha/product-pnl": { tabs: ["product-pnl"] },
    "/api/talpha/product-costs": { tabs: ["product-pnl"] },
    "/api/talpha/inventory": { tabs: ["products", "overview"] },
    "/api/talpha/marketer-perf": { tabs: ["marketing"] },
    "/api/query": { tabs: ["marketing", "ad-health", "customers", "market-intel"] },

    // Sổ đơn / đối soát / vận đơn — mỗi lượt gọi là MỘT nước.
    "/api/talpha/order-ledger": { tabs: ["order-ledger", "cod-recon"], market: "TW" },
    "/api/talpha/order-ledger/market": { tabs: ["order-ledger"], market: "param" },
    "/api/talpha/cod-recon": { tabs: ["cod-recon"], market: "TW" },
    "/api/talpha/cod-recon/market": { tabs: ["cod-recon"], market: "param" },
    "/api/talpha/cod-actions": { tabs: ["order-ledger", "cod-recon"], market: "TW" },
    "/api/talpha/tracking": { tabs: ["tracking"], market: "tracking" },
    "/api/talpha/tracking/import": { tabs: ["tracking"], market: "TW" },

    // Chi tiêu Meta theo campaign — route tự lọc theo nước ở tên campaign.
    "/api/talpha/ad-spend": { tabs: ["ad-spend"] },
    "/api/talpha/realtime": { tabs: ["ads-command"] },

    // Chỉ bot gọi (cảnh báo spend cả công ty, chưa tách nước) — không tab nào dùng.
    "/api/talpha/ads-alerts": { full: true },
    "/api/talpha/ads-recon": { full: true },
    "/api/talpha/billing": { full: true },
    "/api/talpha/ceo-ask": { full: true },
    "/api/talpha/export-report": { full: true },
    "/api/talpha/sync-inventory": { full: true },
    "/api/ad-accounts": { full: true },
    "/api/users": { full: true },
};

export function apiRule(pathname: string): ApiRule | null {
    let best: string | null = null;
    for (const k of Object.keys(API_RULES)) {
        if ((pathname === k || pathname.startsWith(k + "/")) && (!best || k.length > best.length)) best = k;
    }
    return best ? API_RULES[best] : null;
}

/**
 * Người này gọi được API này không. `trackCode` đổi ?market= ra mã nước theo đúng luật
 * route vận đơn (lib/talpha/tracking.ts → trackMarket) — truyền vào thay vì import để
 * file này không kéo theo cả thư viện vận đơn.
 */
export function checkApi(
    a: Access, pathname: string, search: URLSearchParams,
    trackCode: (m: string | null) => string = (m) => String(m || "TW").toUpperCase(),
): { ok: true } | { ok: false; error: string } {
    if (a.full) return { ok: true };
    const rule = apiRule(pathname);
    if (!rule || rule.full) return { ok: false, error: "Chỉ giám đốc xem được mục này" };
    const tabs = rule.tabs || [];
    if (tabs !== "*" && !tabs.some((t) => a.tabs.includes(t))) {
        return { ok: false, error: "Tài khoản không có quyền xem mục này" };
    }
    if (rule.market) {
        const code = rule.market === "TW" ? "TW"
            : rule.market === "tracking" ? trackCode(search.get("market"))
            : String(search.get("market") || "").toUpperCase();
        if (!code || !canMarket(a, code)) {
            const ten = MARKET_KEY[code] || code || "(không ghi nước)";
            return { ok: false, error: `Tài khoản không được xem thị trường ${ten}` };
        }
    }
    return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════
// /api/query — cổng SQL chung của 4 tab (Marketing, Sức khoẻ QC, Khách hàng, Market Intel).
// Câu SQL dựng ở trình duyệt nên KHÔNG tin được: với người chỉ xem một phần nước, mỗi
// bảng trong câu bị thay bằng một câu con đã lọc sẵn theo nước; bảng không lọc được
// (vw_attribution_quality gộp mọi nước theo ngày…) thì từ chối cả câu. Sau khi thay,
// câu còn bất cứ đường nào khác tới dữ liệu (dấu `, tên dataset, bảng dự án khác,
// INFORMATION_SCHEMA) cũng từ chối — thà tab trống một ô còn hơn lộ số team khác.
// ═══════════════════════════════════════════════════════════════════

const sqlStr = (s: string) => `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
const sqlList = (xs: string[]) => (xs.length ? xs.map(sqlStr).join(", ") : "NULL");

/**
 * Nước (khoá "Taiwan"…) của một dòng chi tiêu theo tên campaign — CÙNG luật với
 * campaignMarket() ở rules.ts: ô (tách bằng "/") đầu tiên là mã nước thắng; không ô
 * nào là nước → primary_market.
 */
export function sqlCampaignMarketKey(col = "campaign_name"): string {
    const pairs = Object.entries(CAMP_MARKETS).filter(([, m]) => m);
    const mac = sqlStr(PRIMARY_MARKET || "");
    if (!pairs.length) return mac;
    return `COALESCE((
        SELECT CASE UPPER(TRIM(seg)) ${pairs.map(([t, m]) => `WHEN ${sqlStr(t.toUpperCase())} THEN ${sqlStr(m)}`).join(" ")} END
        FROM UNNEST(SPLIT(IFNULL(${col}, ''), '/')) AS seg WITH OFFSET AS vi_tri
        WHERE UPPER(TRIM(seg)) IN (${pairs.map(([t]) => sqlStr(t.toUpperCase())).join(", ")})
        ORDER BY vi_tri LIMIT 1
    ), ${mac})`;
}

/** Bảng → điều kiện lọc theo nước. Bảng không có ở đây = người xem một phần không được đụng. */
function dieuKien(bang: string, a: Access, goc: (t: string) => string): string | null {
    const codes = sqlList(a.codes);
    switch (bang) {
        case "vw_orders_std": return `market IN (${codes})`;
        case "sale_order": return `UPPER(shop_label) IN (${codes})`;
        case "order_items":
            return `CAST(shop_id AS STRING) IN (SELECT DISTINCT CAST(shop_id AS STRING) FROM ${goc("sale_order")} WHERE UPPER(shop_label) IN (${codes}))`;
        case "vw_fb_ads_std":
        case "vw_ad_windows":
            return `${sqlCampaignMarketKey("campaign_name")} IN (${sqlList(a.markets)})`;
        default: return null;
    }
}

/**
 * Che chuỗi và chú thích bằng ký hiệu \u0000N\u0000 để việc thay bảng và soát câu chỉ chạy
 * trên phần CODE (chuỗi có thể chứa chữ trùng tên bảng). Tên trong dấu ` giữ nguyên — nó là
 * code, và nằm trong một khớp riêng nên dấu nháy bên trong không mở nhầm một chuỗi.
 * Trả null khi câu có thứ máy tách không chắc bằng BigQuery: ký tự thoát "\\", chú thích
 * "#", dấu nháy không đóng. Tách lệch BigQuery là kẽ hở: một đoạn code BigQuery chạy thật
 * mà máy tưởng là chuỗi thì không bị soát.
 */
function cheChuoi(sql: string): { code: string; chuoi: string[] } | null {
    if (/[\\#\u0000]/.test(sql)) return null;
    const chuoi: string[] = [];
    const code = sql.replace(
        /`[^`]*`|'''[\s\S]*?'''|"""[\s\S]*?"""|'[^'\n]*'|"[^"\n]*"|--[^\n]*|\/\*[\s\S]*?\*\//g,
        (m) => {
            if (m.startsWith("`")) return m;
            chuoi.push(m);
            return ` \u0000${chuoi.length - 1}\u0000 `;
        });
    if (/['"]|\/\*/.test(code)) return null;     // nháy hoặc /* không đóng
    return { code, chuoi };
}

/**
 * `datasetsKhac`: các dataset KHÁC trong dự án (route lấy danh sách lúc chạy) — `ds.bang`
 * hai phần trỏ thẳng về dự án đang chạy, không cần ghi tên dự án.
 */
export function scopeQuery(
    sql: string, a: Access, project: string, dataset: string, datasetsKhac: string[] = [],
): { ok: true; sql: string } | { ok: false; error: string } {
    if (seesAllMarkets(a)) return { ok: true, sql };
    const tuChoi = (ly: string) => ({ ok: false as const, error: `Câu truy vấn có ${ly} — không cho phép với tài khoản xem một phần nước` });
    if (/__T\d+__/.test(sql)) return tuChoi("ký hiệu __T…__");
    const che = cheChuoi(sql);
    if (!che) return tuChoi("ký tự thoát, chú thích # hoặc dấu nháy không đóng");

    const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&");
    const goc = (t: string) => `\`${project}.${dataset}.${t}\``;
    // `proj.ds.bang` · `proj.ds`.bang · `proj`.`ds`.`bang` · proj.ds.bang — mọi kiểu đặt dấu `.
    const re = new RegExp(`\`?${esc(project)}\`?\\s*\\.\\s*\`?${esc(dataset)}\`?\\s*\\.\\s*\`?([A-Za-z_][A-Za-z0-9_]*)\`?`, "gi");

    const thay: string[] = [];
    let loi: string | null = null;
    const coCho = che.code.replace(re, (_m, bang: string) => {
        const dk = dieuKien(bang, a, goc);
        if (!dk) { loi = loi || `Bảng ${bang} gộp số mọi nước — tài khoản chỉ xem một phần nước không đọc được`; return " "; }
        thay.push(`(SELECT * FROM ${goc(bang)} WHERE ${dk})`);
        return ` __T${thay.length - 1}__ `;
    });
    if (loi) return { ok: false, error: loi };
    if (!thay.length) return { ok: false, error: "Câu truy vấn không đọc bảng nào của dashboard" };

    // Phần code còn lại không được có đường nào khác tới dữ liệu.
    const cam: [RegExp, string][] = [
        [/`/, "dấu ` ngoài tên bảng"],
        [new RegExp(esc(dataset), "i"), `tên dataset ${dataset}`],
        [new RegExp(esc(project), "i"), `tên dự án ${project}`],
        [/INFORMATION_SCHEMA/i, "INFORMATION_SCHEMA"],
        // a.b.c không theo sau bởi "(" — bảng của dự án/dataset khác.
        [/\b[A-Za-z_][\w-]*\s*\.\s*[A-Za-z_][\w-]*\s*\.\s*[A-Za-z_]\w*\b(?!\s*\()/, "đường dẫn bảng 3 phần"],
        ...datasetsKhac.filter(Boolean).map((ds): [RegExp, string] => [new RegExp(`\\b${esc(ds)}\\s*\\.`, "i"), `dataset ${ds}`]),
        // Bảng dashboard gọi trần (không qua dự án.dataset) — chỉ chạy được khi có dataset mặc định, chặn luôn cho chắc.
        [/\b(vw_orders_std|sale_order|order_items|vw_fb_ads_std|vw_ad_windows|vw_attribution_quality|fb_ads_data|fb_adset_data)\b/i, "tên bảng không ghi đủ dự án.dataset"],
    ];
    for (const [r, ten] of cam) if (r.test(coCho)) return tuChoi(ten);

    const ra = coCho
        .replace(/ __T(\d+)__ /g, (_m, i: string) => ` ${thay[Number(i)]} `)
        .replace(/ \u0000(\d+)\u0000 /g, (_m, i: string) => che.chuoi[Number(i)]);
    return { ok: true, sql: ra };
}
