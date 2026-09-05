import { NextResponse } from "next/server";
import * as fs from "fs";
import * as yaml from "js-yaml";
import * as path from "path";
import { bigquery } from "@/lib/bigquery";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// ═══ CONFIG ═══
// Local dev: đọc bản CHUẨN ở repo-root ../config. Trên Vercel, thư mục cha không được
// đóng gói → dùng bản sao dashboard-ui/config (prebuild tự đồng bộ từ bản chuẩn).
const YAML_CANDIDATES = [
    path.join(process.cwd(), "..", "config", "projects", "talpha.yaml"),
    path.join(process.cwd(), "config", "projects", "talpha.yaml"),
];
const YAML_PATH = YAML_CANDIDATES.find((p) => fs.existsSync(p)) || YAML_CANDIDATES[1];

// ═══ RULE CHUNG: import từ src/lib/talpha/rules.ts (data = config/talpha_rules.json).
// Golden-test 29/07 = 100% khớp bản inline cũ. Sửa rule → sửa JSON, KHÔNG thêm map ở đây.
import {
    EXCHANGE_RATES, posMoneyDivisor, MARKET_CANON, CAMP_MARKETS, PAGE_ID_RE,
    normCampMarketer, normPosMarketer, isDelivered,
} from "@/lib/talpha/rules";

function normalizeMarket(label?: string | null): string {
    const s = String(label || "").trim();
    if (!s) return "Unknown";
    return MARKET_CANON[s.toUpperCase()] || s;
}
// campaign_name → { mkt, nv, pageId } (mỗi field có thể null)
function parseCampaign(campaignName?: string | null): { mkt: string | null; nv: string | null; pageId: string | null } {
    const parts = String(campaignName || "").split("/").map((x) => x.trim());
    let mkt: string | null = null;
    let nv: string | null = null;
    const mi = parts.findIndex((s) => CAMP_MARKETS[s.toUpperCase()]);
    if (mi >= 0) {
        mkt = CAMP_MARKETS[parts[mi].toUpperCase()];
        nv = mi + 1 < parts.length ? normCampMarketer(parts[mi + 1]) : null;
    }
    let pageId: string | null = null;
    for (let i = 0; i < parts.length; i++) {
        const seg = parts[i].replace(/ /g, "");
        if (PAGE_ID_RE.test(seg) && i + 1 < parts.length && parts[i + 1].trim()) { pageId = seg; break; }
    }
    return { mkt, nv, pageId };
}
// khoá nối đơn↔campaign: marketer||market||page_id (cả 3 phải có)
function fallbackKey(nv?: string | null, mkt?: string | null, pageId?: string | null): string | null {
    if (!nv || !mkt || !pageId) return null;
    return `${nv}||${mkt}||${pageId}`;
}

// Timezone handling:
// - Each Meta ad account has its OWN timezone (Bangkok +7, Kuwait +3, Dubai +4,
//   Tokyo +9, LA -7, …). Meta insights are ALREADY bucketed per account tz.
// - Pancake/Poscake `inserted_at` is naive UTC (no offset, e.g. "2026-06-16T20:00:00").
//   To align a POS order with its ad's daily cutoff we MUST convert UTC → that
//   account's timezone before deciding which calendar day it belongs to.
const DEFAULT_POS_TZ = 'Asia/Ho_Chi_Minh'; // VN +7 — POS-native day (reset 00:00 VN), used for unmatched orders

// Parse a naive-UTC POS timestamp ("2026-06-16T20:00:00.000000" or "... 20:00:00") to epoch ms.
function posUtcMs(insertedAt: string): number {
    const s = insertedAt.includes('T') ? insertedAt : insertedAt.replace(' ', 'T');
    return Date.parse(s.endsWith('Z') ? s : s + 'Z');
}
// Calendar date (YYYY-MM-DD) of a POS order in a given IANA timezone.
function dateInTz(insertedAt: string, tz: string): string {
    const ms = posUtcMs(insertedAt);
    if (Number.isNaN(ms)) return String(insertedAt).slice(0, 10); // fallback: raw date
    return new Date(ms).toLocaleDateString('sv-SE', { timeZone: tz });
}
// Shift a YYYY-MM-DD string by n days (UTC-based, label arithmetic only).
function addDaysStr(date: string, n: number): string {
    const d = new Date(date + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
}

// account_id → IANA timezone name (Meta reports insights in the account's own tz).
// Cached across requests — an account's timezone is effectively static.
const accountTzCache: Record<string, string> = {};
async function fetchAccountTimezones(token: string, accountIds: string[]): Promise<Record<string, string>> {
    await Promise.all(accountIds.map(async (accId) => {
        if (accountTzCache[accId]) return;
        try {
            const url = `https://graph.facebook.com/v21.0/${accId}?fields=timezone_name&access_token=${token}`;
            const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
            if (!res.ok) { console.error(`Meta tz ${accId}: ${res.status}`); return; }
            const j = await res.json();
            if (j.timezone_name) accountTzCache[accId] = j.timezone_name;
        } catch (e: any) {
            console.error(`Meta tz ${accId} error:`, e.message);
        }
    }));
    return accountTzCache;
}

// TALPHA ad accounts use VND currency — Meta API 'spend' is already in VND
// No USD→VND conversion needed for ads data

interface YamlConfig {
    meta_ads: { access_token: string; ad_account_ids: string[]; ad_account_names?: Record<string, string> };
    poscake: { shops: Array<{ name: string; api_url: string; api_key: string; shop_id: string }> };
}

// Resolve ${ENV_VAR} placeholders in the YAML against process.env so secrets
// (Meta token, Poscake keys) stay in .env instead of being hard-coded in YAML.
function resolveEnvPlaceholders(raw: string): string {
    return raw.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, name) => {
        const val = process.env[name];
        if (val === undefined || val === "") {
            console.warn(`talpha.yaml: env var ${name} is not set`);
            return "";
        }
        return val;
    });
}

function loadConfig(): YamlConfig {
    const raw = fs.readFileSync(YAML_PATH, "utf-8");
    return yaml.load(resolveEnvPlaceholders(raw)) as YamlConfig;
}

// ═══ META API: Fetch insights per ad for date range (with pagination) ═══
async function fetchMetaAds(token: string, accountIds: string[], accountNames: Record<string, string>, activeOnly: boolean, fromDate: string, toDate: string, warnings: string[]) {
    const fields = "campaign_name,campaign_id,adset_name,ad_name,ad_id,spend,impressions,cpm,cpc,ctr,actions";
    const allAds: any[] = [];
    // Filter to ACTIVE campaigns only if requested
    const filtering = activeOnly
        ? `&filtering=${encodeURIComponent(JSON.stringify([{ "field": "campaign.effective_status", "operator": "IN", "value": ["ACTIVE"] }]))}`
        : '';
    // Use time_range for custom dates — NO time_increment=1 so Meta aggregates per ad_id
    const timeRange = `&time_range=${encodeURIComponent(JSON.stringify({ since: fromDate, until: toDate }))}`;

    await Promise.all(accountIds.map(async (accId) => {
        const accName = accountNames[accId] || accId;
        let realError = "";   // lỗi gọi Meta — khác HẲN "chạm cap phân trang"
        try {
            let url: string | null = `https://graph.facebook.com/v21.0/${accId}/insights?fields=${fields}&level=ad${timeRange}&limit=500${filtering}&access_token=${token}`;
            let pageCount = 0;
            const MAX_PAGES = 10; // safety limit: 10 pages × 500 = 5000 ads max per account

            while (url && pageCount < MAX_PAGES) {
                const res: Response = await fetch(url, { signal: AbortSignal.timeout(15000) });
                if (!res.ok) {
                    // Đọc lấy error.code/message của Meta rồi mới thoát. `break` trơn để lại
                    // `url` nguyên giá trị, và khối cảnh báo bên dưới hiểu nhầm thành "chạm cap".
                    realError = `HTTP ${res.status}`;
                    try {
                        const j: any = await res.json();
                        if (j?.error) realError = `code ${j.error.code}: ${String(j.error.message || "").slice(0, 130)}`;
                    } catch { /* body không phải JSON — giữ nguyên HTTP status */ }
                    break;
                }
                const data: any = await res.json();
                const rows = data.data || [];

                for (const row of rows) {
                    const actions = row.actions || [];
                    const messages = actions.find((a: any) => a.action_type === "onsite_conversion.messaging_conversation_started_7d")?.value || 0;
                    const purchases = actions.find((a: any) => a.action_type === "purchase" || a.action_type === "omni_purchase")?.value || 0;
                    allAds.push({
                        account_id: accId,
                        account_name: accountNames[accId] || accId,
                        campaign_id: row.campaign_id,
                        campaign_name: row.campaign_name,
                        adset_name: row.adset_name || "",
                        ad_name: row.ad_name || "",
                        ad_id: row.ad_id,
                        spend_vnd: parseFloat(row.spend || "0"), // Already VND (accounts are VND-billed)
                        impressions: parseInt(row.impressions || "0"),
                        cpm_vnd: parseFloat(row.cpm || "0"),
                        cpc_vnd: parseFloat(row.cpc || "0"),
                        ctr: parseFloat(row.ctr || "0"),
                        messages: parseInt(messages),
                        purchases: parseInt(purchases),
                        // Will be filled by mapping
                        orders: 0,
                        revenue_vnd: 0,
                        revenue_delivered_vnd: 0, // doanh số của đơn GIAO THÀNH CÔNG (GTC thật)
                        order_details: [] as any[],
                    });
                }

                // Follow pagination
                url = data.paging?.next || null;
                pageCount++;
            }
            if (pageCount > 1) console.log(`Meta ${accId}: fetched ${pageCount} pages`);
            // Cảnh báo phải nói ĐÚNG chuyện đã xảy ra. Trước đây lỗi HTTP `break` mà để
            // nguyên `url`, nên khối này báo "chạm cap 10 trang" cho một account chưa lấy
            // nổi MỘT trang. Token dashboard chết từ 02/09/2026 (code 190, session
            // invalidated) mà cả 15 account đều kêu "chạm cap" — lỗi thật chỉ nằm trong
            // console.error của server, không ai lần ra, báo cáo mất sạch phần campaign
            // suốt nhiều ngày mà nhìn vẫn như bình thường.
            if (realError) {
                const msg = `Meta ${accName}: KHÔNG lấy được số — ${realError}`;
                console.error(msg);
                warnings.push(msg);
            } else if (url) {
                // A3-P2: cap không được im lặng — còn trang sau MAX_PAGES nghĩa là spend bị đếm thiếu
                const msg = `Meta ${accName}: chạm cap ${MAX_PAGES} trang (${MAX_PAGES * 500} ads) — dữ liệu bị cắt, spend có thể thiếu`;
                console.warn(msg);
                warnings.push(msg);
            }
        } catch (e: any) {
            const msg = `Meta ${accName}: KHÔNG lấy được số — ${e.message}`;
            console.error(msg);
            warnings.push(msg);
        }
    }));

    return allAds;
}

// ═══ POS: HYBRID — BigQuery for history + Direct API for today ═══

const BQ_PROJECT = process.env.NEXT_PUBLIC_BQ_PROJECT || "cty-507710";
const BQ_DATASET = process.env.DATASET || "TALPHA_Dataset";

// Fetch historical orders from BigQuery (synced data — accurate)
async function fetchPOSFromBigQuery(fromDate: string, toDate: string) {
    const allOrders: any[] = [];
    try {
        const query = `
            SELECT
                id, shop_label AS shop_name, ad_id, page_id, total_price, cod,
                CAST(inserted_at AS STRING) AS inserted_at,
                JSON_EXTRACT_SCALAR(marketer, '$.name') AS marketer, status, status_name, status_category,
                bill_full_name AS customer_name
            FROM \`${BQ_PROJECT}.${BQ_DATASET}.sale_order\`
            WHERE DATE(inserted_at) >= @fromDate
              AND DATE(inserted_at) <= @toDate
            ORDER BY inserted_at DESC
        `;
        const [rows] = await bigquery.query({
            query,
            params: { fromDate, toDate },
        });
        for (const row of rows) {
            const shopName = normalizeMarket(row.shop_name); // shop_label code → POS full name
            const rate = EXCHANGE_RATES[shopName] || 6850;
            // X13: số chia tiền của POS khác nhau theo shop — GCC lưu minor units (÷100),
            // shop Đài lưu NGUYÊN TWD (÷1). Gõ thẳng /100 là làm tiền Đài tụt 100 lần.
            const priceLocal = (row.cod || row.total_price || 0) / posMoneyDivisor(shopName);
            allOrders.push({
                id: String(row.id || ''),
                shop_name: shopName,
                ad_id: row.ad_id ? String(row.ad_id) : null,
                page_id: row.page_id ? String(row.page_id) : null,
                marketer: String(row.marketer || ''),
                total_price_local: priceLocal,
                total_price_vnd: priceLocal * rate,
                status: String(row.status || ''),
                delivered: isDelivered(row.status_name, row.status_category),
                inserted_at: row.inserted_at,
                customer_name: String(row.customer_name || ''),
                source: 'bigquery',
            });
        }
        console.log(`BQ POS: ${allOrders.length} orders for ${fromDate}→${toDate}`);
    } catch (e: any) {
        console.error('BQ POS error:', e.message);
    }
    return allOrders;
}

// Fetch orders from direct POS API (realtime) within a UTC date window [startUtc, endUtc].
// Note: POS API ignores from_date/to_date params! We filter client-side.
// `inserted_at` is naive UTC, so we compare on its raw UTC date here; the precise
// per-account-timezone day bucketing happens later (after order↔ad matching).
// Results are sorted by -inserted_at (newest first), so we stop once we pass below startUtc.
async function fetchPOSFromDirectAPI(shops: YamlConfig["poscake"]["shops"], startUtc: string, endUtc: string, warnings: string[]) {
    const allOrders: any[] = [];

    await Promise.all(shops.map(async (shop) => {
        try {
            let page = 1;
            let reachedPast = false;
            while (!reachedPast && page <= 200) { // safety limit
                const url = `${shop.api_url}/shops/${shop.shop_id}/orders?api_key=${shop.api_key}&page=${page}&sort=-inserted_at`;
                const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
                if (!res.ok) { console.error(`POS ${shop.name}: ${res.status}`); break; }
                const data = await res.json();
                const orders = data.data || [];
                if (orders.length === 0) break;

                for (const o of orders) {
                    const insertedAt = String(o.inserted_at || '');
                    const utcDate = insertedAt.slice(0, 10); // raw UTC date

                    // Since sorted newest-first: skip future entries, stop once below the window
                    if (utcDate > endUtc) continue; // future relative to window? skip
                    if (utcDate < startUtc) {
                        reachedPast = true;
                        break; // all remaining are older, stop
                    }

                    // utcDate within [startUtc, endUtc] → include this order
                    const shopName = normalizeMarket(shop.name);
                    const rate = EXCHANGE_RATES[shopName] || 6850;
                    // X13 — số chia theo shop (GCC 100, Đài 1), xem fetchPOSFromBigQuery.
                    const priceLocal = (o.cod || o.total_price || 0) / posMoneyDivisor(shopName);
                    const mkRaw = o.marketer || o.pke_mkter || null;
                    const marketerName = mkRaw && typeof mkRaw === 'object' ? (mkRaw.name || '') : (mkRaw || '');
                    const custRaw = o.customer_name;
                    const customerName = custRaw && typeof custRaw === 'object' ? (custRaw.name || '') : (custRaw || '');
                    allOrders.push({
                        id: String(o.id || ''),
                        shop_name: shopName,
                        ad_id: o.ad_id ? String(o.ad_id) : null,
                        page_id: o.page_id ? String(o.page_id) : null,
                        marketer: marketerName,
                        total_price_local: priceLocal,
                        total_price_vnd: priceLocal * rate,
                        status: String(o.status || ''),
                        // POS API trả status_name thô (delivered/received_money/…) → suy ra GTC
                        delivered: isDelivered(o.status_name, null),
                        inserted_at: o.inserted_at,
                        customer_name: customerName,
                        source: 'direct_api',
                    });
                }

                page++;
            }
            // A3-P2: thoát vì hết 200 trang mà chưa chạm mốc ngày cũ = còn đơn chưa lấy
            if (!reachedPast && page > 200) {
                const msg = `POS ${shop.name}: chạm cap 200 trang mà chưa quét hết cửa sổ ${startUtc}→${endUtc} — đơn có thể thiếu`;
                console.warn(msg);
                warnings.push(msg);
            }
        } catch (e: any) {
            console.error(`POS ${shop.name} error:`, e.message);
        }
    }));

    console.log(`Direct POS: ${allOrders.length} orders for ${startUtc}→${endUtc} (UTC window)`);
    return allOrders;
}

// Hybrid: BQ for history (2+ days ago) + direct API for recent (today & yesterday).
// Why yesterday via API? BQ sync often hasn't run yet for yesterday's data.
// All bounds are UTC dates (the fetched window is padded ±1 day vs the requested
// range so no order is dropped before per-account-timezone bucketing downstream).
async function fetchPOSHybrid(shops: YamlConfig["poscake"]["shops"], fetchFrom: string, fetchTo: string, todayUtc: string, warnings: string[]) {
    const yesterday = addDaysStr(todayUtc, -1);
    const twoDaysAgo = addDaysStr(todayUtc, -2);

    const tasks: Promise<any[]>[] = [];

    // BQ for the older part of the window (fetchFrom → min(fetchTo, twoDaysAgo))
    if (fetchFrom <= twoDaysAgo) {
        const bqEnd = fetchTo <= twoDaysAgo ? fetchTo : twoDaysAgo;
        tasks.push(fetchPOSFromBigQuery(fetchFrom, bqEnd));
    }

    // Direct API for the recent part (yesterday → fetchTo), if any overlap
    const apiStart = fetchFrom > yesterday ? fetchFrom : yesterday;
    if (apiStart <= fetchTo) {
        tasks.push(fetchPOSFromDirectAPI(shops, apiStart, fetchTo, warnings));
    }

    const results = await Promise.all(tasks);
    return results.flat();
}

// ═══ MAIN: Map ads ↔ orders by ad_id ═══
export async function GET(request: Request) {
    const startTime = Date.now();
    const { searchParams } = new URL(request.url);
    // S1 — order↔ad matching pool: include PAUSED/all-status ads by default so an
    // order from an ad that was turned off (but still spent in the range) matches.
    // Meta `insights` only returns ads that actually spent in [from,to], so dropping
    // the active filter widens the match pool WITHOUT inflating period spend. Pass
    // ?active_only=true to restrict to active campaigns again.
    const activeOnly = searchParams.get('active_only') === 'true'; // default: false (match all spending ads)
    // The from/to labels are interpreted per-account: Meta returns each account's
    // insights in its own timezone, and POS orders are bucketed to match (below).
    const vnToday = new Date().toLocaleDateString('sv-SE', { timeZone: DEFAULT_POS_TZ });
    const fromDate = searchParams.get('from_date') || vnToday;
    const toDate = searchParams.get('to_date') || vnToday;
    // POS fetch window: pad ±1 UTC day so no order is dropped before per-account-tz
    // bucketing (account offsets span -7…+9h, all < 24h).
    const todayUtc = new Date().toISOString().slice(0, 10);
    const fetchFrom = addDaysStr(fromDate, -1);
    const fetchTo = addDaysStr(toDate, 1);

    try {
        const cfg = loadConfig();
        const token = cfg.meta_ads.access_token;
        const accountIds = cfg.meta_ads.ad_account_ids;
        // Tên TKQC đọc từ talpha.yaml (ad_account_names) — nguồn duy nhất, không hard-code.
        const accountNames = cfg.meta_ads.ad_account_names || {};
        for (const id of accountIds) {
            if (!accountNames[id]) console.warn(`talpha.yaml: TKQC ${id} chưa có tên trong ad_account_names — UI sẽ hiện raw id`);
        }
        const shops = cfg.poscake.shops;

        // A3-P2: gom cảnh báo cap phân trang (Meta 10 trang, POS 200 trang) trả về client
        const warnings: string[] = [];

        // Fetch in parallel (account timezones resolve alongside the main fetches)
        const [ads, orders, accountTz] = await Promise.all([
            fetchMetaAds(token, accountIds, accountNames, activeOnly, fromDate, toDate, warnings),
            fetchPOSHybrid(shops, fetchFrom, fetchTo, todayUtc, warnings),
            fetchAccountTimezones(token, accountIds),
        ]);

        // Build ad_id → ad index map for O(1) lookup
        const adIdMap = new Map<string, number>();
        ads.forEach((ad, idx) => {
            if (ad.ad_id) adIdMap.set(ad.ad_id, idx);
        });

        // Map orders to ads. An order counts toward [fromDate, toDate] only if its
        // day — computed in the matched ad account's timezone (so POS day = Meta day)
        // — falls in range. Unmatched orders use the POS-native VN day.
        const matchedOrders: any[] = [];        // khớp ad_id (gán vào ad cụ thể)
        const pendingOrders: any[] = [];        // trong cửa sổ ngày VN nhưng chưa khớp ad_id → thử fallback
        const unmatchedOrders: any[] = [];      // vẫn không nối được sau fallback
        // GTC thật (giao thành công) — gom song song với doanh thu 100%
        let unmatchedDeliveredVnd = 0;
        let deliveredOrderCount = 0;
        let fallbackMatchedCount = 0;
        let fallbackAmbiguousCount = 0; // đơn trùng ≥2 campaign — cố ý KHÔNG nối

        for (const order of orders) {
            if (order.ad_id && adIdMap.has(order.ad_id)) {
                const adIdx = adIdMap.get(order.ad_id)!;
                const tz = accountTz[ads[adIdx].account_id] || DEFAULT_POS_TZ;
                const bizDate = dateInTz(order.inserted_at, tz);
                if (bizDate < fromDate || bizDate > toDate) continue; // outside this account's day window
                ads[adIdx].orders += 1;
                ads[adIdx].revenue_vnd += order.total_price_vnd;
                if (order.delivered) { ads[adIdx].revenue_delivered_vnd += order.total_price_vnd; deliveredOrderCount += 1; }
                ads[adIdx].order_details.push({
                    id: order.id,
                    shop: order.shop_name,
                    price_vnd: order.total_price_vnd,
                    customer: order.customer_name,
                });
                matchedOrders.push(order);
            } else {
                const bizDate = dateInTz(order.inserted_at, DEFAULT_POS_TZ);
                if (bizDate < fromDate || bizDate > toDate) continue; // outside VN day window
                pendingOrders.push(order); // để lại cho bước fallback (marketer+market+page_id)
            }
        }

        // Group ads by campaign for summary
        const campaignMap = new Map<string, any>();
        for (const ad of ads) {
            const key = `${ad.account_id}__${ad.campaign_id}`;
            const existing = campaignMap.get(key);
            if (existing) {
                existing.spend_vnd += ad.spend_vnd;
                existing.impressions += ad.impressions;
                existing.messages += ad.messages;
                existing.purchases += ad.purchases;
                existing.orders += ad.orders;
                existing.revenue_vnd += ad.revenue_vnd;
                existing.revenue_delivered_vnd += ad.revenue_delivered_vnd;
                existing.ads.push(ad);
            } else {
                campaignMap.set(key, {
                    account_id: ad.account_id,
                    account_name: ad.account_name,
                    campaign_id: ad.campaign_id,
                    campaign_name: ad.campaign_name,
                    spend_vnd: ad.spend_vnd,
                    impressions: ad.impressions,
                    cpm_vnd: ad.cpm_vnd,
                    ctr: ad.ctr,
                    messages: ad.messages,
                    purchases: ad.purchases,
                    orders: ad.orders,
                    revenue_vnd: ad.revenue_vnd,
                    revenue_delivered_vnd: ad.revenue_delivered_vnd,
                    roas: 0,
                    ads: [ad],
                });
            }
        }

        // ─── Fallback: nối pendingOrders vào campaign theo marketer+market+page_id ───
        // (rule map của báo cáo Sheet). Gán ở cấp CAMPAIGN (không phải ad cụ thể) để
        // không phá attribution ad_id. NGUYÊN TẮC: chỉ nối khi khoá trỏ về ĐÚNG 1
        // campaign — KHÔNG đoán. Trùng ≥2 campaign / không khớp → để "chưa map" và ghi
        // lý do rõ ràng, không điền bậy vào campaign khác.
        const campByKey = new Map<string, any>();
        const ambiguousKeys = new Set<string>();
        for (const c of campaignMap.values()) {
            const { mkt, nv, pageId } = parseCampaign(c.campaign_name);
            const k = fallbackKey(nv, mkt, pageId);
            if (!k) continue;
            if (campByKey.has(k)) ambiguousKeys.add(k); // đã có campaign khác cùng khoá → nhập nhằng
            else campByKey.set(k, c);
        }
        for (const order of pendingOrders) {
            const nv = normPosMarketer(order.marketer);
            const k = fallbackKey(nv, order.shop_name, order.page_id);
            const camp = (k && !ambiguousKeys.has(k)) ? campByKey.get(k) : null;
            if (camp) {
                camp.orders += 1;
                camp.revenue_vnd += order.total_price_vnd;
                if (order.delivered) { camp.revenue_delivered_vnd += order.total_price_vnd; deliveredOrderCount += 1; }
                fallbackMatchedCount += 1;
            } else {
                // Không nối chắc chắn → báo cáo là "chưa map" kèm lý do (không đoán)
                let reason: string;
                if (k && ambiguousKeys.has(k)) { reason = 'trung_nhieu_campaign'; fallbackAmbiguousCount += 1; }
                else if (!nv) reason = 'marketer_ngoai_team';
                else if (!order.page_id) reason = 'thieu_page_id';
                else if (!order.shop_name || order.shop_name === 'Unknown') reason = 'thieu_thi_truong';
                else reason = 'khong_co_campaign_khop';
                order.unmatch_reason = reason;
                if (order.delivered) { unmatchedDeliveredVnd += order.total_price_vnd; deliveredOrderCount += 1; }
                unmatchedOrders.push(order);
            }
        }

        // Calculate ROAS per campaign
        const campaigns = Array.from(campaignMap.values()).map(c => ({
            ...c,
            roas: c.spend_vnd > 0 ? Math.round((c.revenue_vnd / c.spend_vnd) * 100) / 100 : 0,
            cpm_vnd: c.impressions > 0 ? (c.spend_vnd / c.impressions) * 1000 : 0,
            ads_count: c.ads.length,
            ads: c.ads.map((a: any) => ({
                ad_id: a.ad_id,
                ad_name: a.ad_name,
                adset_name: a.adset_name,
                spend_vnd: a.spend_vnd,
                impressions: a.impressions,
                cpm_vnd: a.cpm_vnd,
                cpc_vnd: a.cpc_vnd,
                ctr: a.ctr,
                messages: a.messages,
                purchases: a.purchases,
                orders: a.orders,
                revenue_vnd: a.revenue_vnd,
                roas: a.spend_vnd > 0 ? Math.round((a.revenue_vnd / a.spend_vnd) * 100) / 100 : 0,
            })),
        })).sort((a, b) => b.spend_vnd - a.spend_vnd);

        // Summary totals
        const totalSpendVnd = campaigns.reduce((s, c) => s + c.spend_vnd, 0);
        const matchedRevenueVnd = campaigns.reduce((s, c) => s + c.revenue_vnd, 0);
        const matchedDeliveredVnd = campaigns.reduce((s, c) => s + (c.revenue_delivered_vnd || 0), 0);
        const matchedOrderCount = campaigns.reduce((s, c) => s + c.orders, 0);
        const totalMessages = campaigns.reduce((s, c) => s + c.messages, 0);
        const totalPurchases = campaigns.reduce((s, c) => s + c.purchases, 0);

        // Unmatched revenue by shop + thống kê LÝ DO chưa map (để báo cáo, không đoán)
        const unmatchedByShop: Record<string, { count: number; revenue_vnd: number }> = {};
        const unmatchedByReason: Record<string, { count: number; revenue_vnd: number }> = {};
        let unmatchedRevenueVnd = 0;
        for (const o of unmatchedOrders) {
            const shop = o.shop_name || 'Unknown';
            if (!unmatchedByShop[shop]) unmatchedByShop[shop] = { count: 0, revenue_vnd: 0 };
            unmatchedByShop[shop].count += 1;
            unmatchedByShop[shop].revenue_vnd += o.total_price_vnd;
            const reason = o.unmatch_reason || 'khong_ad_id';
            if (!unmatchedByReason[reason]) unmatchedByReason[reason] = { count: 0, revenue_vnd: 0 };
            unmatchedByReason[reason].count += 1;
            unmatchedByReason[reason].revenue_vnd += o.total_price_vnd;
            unmatchedRevenueVnd += o.total_price_vnd;
        }

        // Total revenue = matched + unmatched
        const totalRevenueVnd = matchedRevenueVnd + unmatchedRevenueVnd;
        // GTC thật (giao thành công) — rule của báo cáo Sheet, thay ước lượng 65% cứng.
        // Với view "hôm nay/gần đây" số này thường thấp vì đơn mới chưa giao xong.
        const deliveredRevenueVnd = matchedDeliveredVnd + unmatchedDeliveredVnd;
        const deliveredRoas = totalSpendVnd > 0 ? Math.round((deliveredRevenueVnd / totalSpendVnd) * 100) / 100 : 0;

        // Determine POS source label
        const hasBQ = orders.some((o: any) => o.source === 'bigquery');
        const hasDirect = orders.some((o: any) => o.source === 'direct_api');
        const posSource = hasBQ && hasDirect ? 'BQ+API' : hasBQ ? 'BigQuery' : 'Direct API';

        return NextResponse.json({
            source: `META:Direct|POS:${posSource}`,
            fetched_at: new Date().toISOString(),
            duration_ms: Date.now() - startTime,
            // Cảnh báo cap phân trang — rỗng khi dữ liệu lấy trọn
            warnings,
            // Danh sách 14 TKQC từ talpha.yaml — client dùng làm dropdown + tên hiển thị
            accounts: accountIds.map((id) => ({ id, name: accountNames[id] || id })),
            summary: {
                total_spend_vnd: totalSpendVnd,
                total_revenue_vnd: totalRevenueVnd,
                matched_revenue_vnd: matchedRevenueVnd,
                unmatched_revenue_vnd: unmatchedRevenueVnd,
                delivered_revenue_vnd: deliveredRevenueVnd, // GTC thật (status GIAO_THANH_CONG)
                delivered_orders: deliveredOrderCount,
                delivered_roas: deliveredRoas,
                total_orders: matchedOrderCount,
                total_messages: totalMessages,
                matched_orders: matchedOrders.length + fallbackMatchedCount,
                matched_via_adid: matchedOrders.length,
                matched_via_fallback: fallbackMatchedCount,
                unmatched_orders: unmatchedOrders.length,
                unmatched_ambiguous: fallbackAmbiguousCount, // trùng ≥2 campaign, cố ý không nối
                total_pos_orders: matchedOrders.length + fallbackMatchedCount + unmatchedOrders.length,
                total_meta_purchases: totalPurchases,
                blended_roas: totalSpendVnd > 0 ? Math.round((totalRevenueVnd / totalSpendVnd) * 100) / 100 : 0,
                accounts_fetched: accountIds.length,
                shops_fetched: shops.length,
            },
            campaigns,
            unmatched_orders: unmatchedOrders.slice(0, 50).map(o => ({
                id: String(o.id || ''), shop: String(o.shop_name || ''), price_vnd: o.total_price_vnd,
                ad_id: o.ad_id ? String(o.ad_id) : 'none', page_id: o.page_id ? String(o.page_id) : 'none',
                marketer: String(o.marketer || ''), reason: String(o.unmatch_reason || 'khong_ad_id'),
            })),
            unmatched_by_shop: unmatchedByShop,
            unmatched_by_reason: unmatchedByReason,
        });
    } catch (error: any) {
        console.error("Realtime API error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
