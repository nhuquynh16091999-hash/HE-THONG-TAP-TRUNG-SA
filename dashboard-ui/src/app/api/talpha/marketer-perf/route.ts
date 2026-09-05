import { NextRequest, NextResponse } from "next/server";
import { bigquery } from "@/lib/bigquery";
import {
    RULES, DISPLAY, UNASSIGNED, EXTERNAL_DISPLAY, EXTERNAL_FULL,
    attributeOrder, buildAdidOwner, normPosMarketer, normPosExternal,
    parseCampaignAny, isTestCampaign,
} from "@/lib/talpha/rules";

export const dynamic = "force-dynamic";

const BQ_PROJECT = process.env.NEXT_PUBLIC_BQ_PROJECT || "talpha-faos-2026";
const BQ_DATASET = process.env.DATASET || "TALPHA_Dataset";

// ═══════════════════════════════════════════════════════════════════
// X7 — Hiệu suất marketer cho tab "Marketing & Ads".
//
// Tab trước đây GROUP BY thẳng `vw_orders_std.marketer_name` (tag POS thô) nên:
//   • 1 người ra nhiều dòng ("Trần Thế" / "N. Thế" / "Thế"; "Thục Mai" / "Mai Mai")
//   • người NGOÀI team lọt vào bảng như nhân sự của team
//   • người trong team không có tag GTC thì biến mất khỏi bảng
//   • đơn `unknown` bị filter câm ở client → mất đơn khỏi báo cáo
//
// Route này gán đơn theo RULE CEO 3 BẬC (docs/TALPHA_METRIC_RULES.md §4), dùng
// đúng module chung `lib/talpha/rules.ts` — KHÔNG chép lại logic mapping (bẫy #3).
//   bậc 1: tag POS → normPosMarketer
//   bậc 2: không tag / ngoài team → ad_id → chủ campaign
//   bậc 3: vẫn không → "(không gán)" — KHÔNG bỏ đơn lặng lẽ
// ═══════════════════════════════════════════════════════════════════

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// `orders`/`revenue` = đơn ĐÃ GIAO THÀNH CÔNG (giữ nguyên nghĩa cũ — dashboard đang đọc).
// `shipOrders`/`ship` = đơn ĐÃ ĐẨY ĐI, gồm cả phần chưa giao xong và phần bị hoàn.
// Bot báo cáo sáng cần cả hai: KPI đo phần đã giao, còn việc làm trong ngày đo phần đã ship.
type Bucket = { orders: number; revenue: number; spend: number; viaTag: number; viaAdId: number; shipOrders: number; ship: number; mess: number };
const emptyBucket = (): Bucket => ({ orders: 0, revenue: 0, spend: 0, viaTag: 0, viaAdId: 0, shipOrders: 0, ship: 0, mess: 0 });

export async function GET(req: NextRequest) {
    const from = req.nextUrl.searchParams.get("from") || "";
    const to = req.nextUrl.searchParams.get("to") || "";
    if (!DATE_RE.test(from) || !DATE_RE.test(to)) {
        return NextResponse.json({ error: "from/to phải dạng YYYY-MM-DD" }, { status: 400 });
    }

    try {
        // Q0 — đơn GTC gom theo (tag POS thô, ad_id). Dedupe theo `order_uid` (= shop-id)
        // chứ KHÔNG phải `order_id`: POS đánh số đơn riêng từng shop nên id 18 tồn tại ở
        // cả 7 shop — gom theo order_id là nhập các đơn khác nhau làm một.
        const [orderRows] = await bigquery.query({
            query: `
                WITH o AS (
                    SELECT
                        order_uid,
                        ANY_VALUE(marketer_name)   AS marketer_name,
                        ANY_VALUE(resolved_ad_id)  AS resolved_ad_id,
                        ANY_VALUE(revenue_vnd)     AS revenue_vnd,
                        ANY_VALUE(is_confirmed)    AS is_confirmed
                    FROM \`${BQ_PROJECT}.${BQ_DATASET}.vw_orders_std\`
                    WHERE order_date BETWEEN @from AND @to AND is_valid
                    GROUP BY order_uid
                )
                -- Lọc nới ra is_valid để lấy THÊM phần ship, nhưng orders/revenue vẫn
                -- đếm đúng đơn đã giao như trước → mọi số dashboard đang hiện không đổi.
                SELECT marketer_name, resolved_ad_id,
                       COUNTIF(is_confirmed)                        AS orders,
                       SUM(IF(is_confirmed, revenue_vnd, 0))        AS revenue_vnd,
                       COUNT(*)                                     AS ship_orders,
                       SUM(revenue_vnd)                             AS ship_revenue_vnd
                FROM o GROUP BY 1, 2`,
            params: { from, to },
        });

        // Q1 — bảng tra BẬC 2: id trên đơn → chủ campaign. Không lọc ngày: đơn hôm nay
        // có thể đến từ ad chạy hôm trước.
        //
        // X9: POS KHÔNG phải lúc nào cũng ghi ad_id vào ô `ad_id` — đo 06/08 thấy 999
        // đơn (9,4%) mang ADSET id ở ô đó. Vì vậy tra cả hai bảng vào chung một map:
        // fb_ads_data (ad_id) + fb_adset_data (adset_id). Id nào cũng chỉ về campaign
        // của nó nên không có chuyện gán nhầm người; trượt cả hai thì mới "(không gán)".
        const [adRows, adsetRows] = await Promise.all([
            bigquery.query({
                query: `
                    SELECT CAST(ad_id AS STRING) AS ad_id, ANY_VALUE(campaign_name) AS campaign_name
                    FROM \`${BQ_PROJECT}.${BQ_DATASET}.fb_ads_data\`
                    WHERE ad_id IS NOT NULL GROUP BY 1`,
            }).then(r => r[0]),
            bigquery.query({
                query: `
                    SELECT CAST(adset_id AS STRING) AS ad_id, ANY_VALUE(campaign_name) AS campaign_name
                    FROM \`${BQ_PROJECT}.${BQ_DATASET}.fb_adset_data\`
                    WHERE adset_id IS NOT NULL GROUP BY 1`,
            }).then(r => r[0]),
        ]);
        // ad_id tra trước — nếu một id vừa là ad vừa là adset thì bản ad chính xác hơn.
        const adidOwner = { ...buildAdidOwner(adsetRows as any[]), ...buildAdidOwner(adRows as any[]) };

        // Rule CEO #7: campaign TEST phải tách khỏi MỌI báo cáo doanh số. File Sheet làm
        // đúng từ lâu (đẩy sang file "[Test] Ads - <tên>"), dashboard thì chưa — 134 đơn
        // / 98,1tr tiền test đang nằm trong bảng marketer (đo 10/08). Nay lọc cho khớp.
        const testIds = new Set<string>();
        for (const r of [...(adRows as any[]), ...(adsetRows as any[])]) {
            if (r.ad_id && isTestCampaign(r.campaign_name)) testIds.add(String(r.ad_id));
        }

        // Q2 — chi ads theo campaign, để chia tiền cho từng người. Người ngoài team CHẠY
        // CHUNG 14 TKQC của TALPHA nên tiền của họ nằm sẵn trong fb_ads_data: phải tách
        // ra chứ không được cộng vào team, cũng không được giấu đi.
        const [campRows] = await bigquery.query({
            query: `
                SELECT campaign_name, SUM(spend) AS spend, SUM(messages) AS messages
                FROM \`${BQ_PROJECT}.${BQ_DATASET}.vw_fb_ads_std\`
                WHERE date BETWEEN @from AND @to AND spend > 0
                GROUP BY 1`,
            params: { from, to },
        });

        const agg = new Map<string, Bucket>();       // key team
        const ext = new Map<string, Bucket>();       // key ngoài team
        let spendChuaNhanRa = 0;

        for (const r of campRows as any[]) {
            const name = String(r.campaign_name || "");
            if (isTestCampaign(name)) continue;
            const [, key, laNgoai] = parseCampaignAny(name);
            if (!key) { spendChuaNhanRa += Number(r.spend || 0); continue; }
            const m = laNgoai ? ext : agg;
            const b = m.get(key) || emptyBucket();
            b.spend += Number(r.spend || 0);
            b.mess += Number(r.messages || 0);
            m.set(key, b);
        }

        let donTest = 0, doanhThuTest = 0;
        for (const r of orderRows as any[]) {
            const raw = String(r.marketer_name || "").trim();
            const tagged = raw && raw.toLowerCase() !== "unknown" ? raw : null;
            const orders = Number(r.orders || 0);
            const revenue = Number(r.revenue_vnd || 0);
            const shipOrders = Number(r.ship_orders || 0);
            const ship = Number(r.ship_revenue_vnd || 0);

            // Đơn sinh ra từ campaign test — đếm riêng để giải trình, không vào bảng.
            if (r.resolved_ad_id && testIds.has(String(r.resolved_ad_id))) {
                donTest += shipOrders; doanhThuTest += ship;
                continue;
            }

            // Người NGOÀI TEAM được nhận diện TRƯỚC bậc 2: đơn họ tự tag là của họ,
            // đừng để fallback ad_id đẩy sang người trong team.
            const extKey = tagged && !normPosMarketer(tagged) ? normPosExternal(tagged) : null;
            if (extKey) {
                const b = ext.get(extKey) || emptyBucket();
                b.orders += orders; b.revenue += revenue; b.viaTag += orders;
                b.shipOrders += shipOrders; b.ship += ship;
                ext.set(extKey, b);
                continue;
            }

            const { key, source } = attributeOrder(tagged, r.resolved_ad_id, adidOwner);
            const b = agg.get(key) || emptyBucket();
            b.orders += orders;
            b.revenue += revenue;
            b.shipOrders += shipOrders;
            b.ship += ship;
            if (source === "pos_tag") b.viaTag += orders;
            else if (source === "ad_id") b.viaAdId += orders;
            agg.set(key, b);
        }

        // Bảng = ĐÚNG danh sách team trong config/talpha_rules.json (kể cả người 0 đơn —
        // vắng mặt cũng là thông tin). NV cũ (inactive) chỉ hiện khi còn phát sinh đơn.
        const rows = Object.entries(RULES.marketers)
            .filter(([key, m]) => !m.inactive || (agg.get(key)?.orders || 0) > 0)
            .map(([key, m]) => {
                const b = agg.get(key) || emptyBucket();
                return {
                    key,
                    marketer: DISPLAY[key] || key,
                    full_name: m.full,
                    inactive: !!m.inactive,
                    orders: b.orders,
                    revenue_vnd: b.revenue,
                    ship_orders: b.shipOrders,
                    ship_revenue_vnd: b.ship,
                    spend_vnd: b.spend,
                    messages: b.mess,
                    via_tag: b.viaTag,
                    via_ad_id: b.viaAdId,
                };
            })
            .sort((a, b) => b.revenue_vnd - a.revenue_vnd);

        const externalRows = Array.from(ext.entries())
            .map(([key, b]) => ({
                key,
                marketer: EXTERNAL_DISPLAY[key] || key,
                full_name: EXTERNAL_FULL[key] || key,
                orders: b.orders,
                revenue_vnd: b.revenue,
                ship_orders: b.shipOrders,
                ship_revenue_vnd: b.ship,
                spend_vnd: b.spend,
                messages: b.mess,
            }))
            .filter(r => r.orders > 0 || r.spend_vnd > 0)
            .sort((a, b) => b.spend_vnd - a.spend_vnd);

        const un = agg.get(UNASSIGNED) || emptyBucket();
        const sum = (xs: { orders: number; revenue_vnd: number; spend_vnd: number; ship_revenue_vnd?: number; ship_orders?: number; messages?: number }[]) => ({
            orders: xs.reduce((s, x) => s + x.orders, 0),
            revenue_vnd: xs.reduce((s, x) => s + x.revenue_vnd, 0),
            ship_orders: xs.reduce((s, x) => s + (x.ship_orders || 0), 0),
            ship_revenue_vnd: xs.reduce((s, x) => s + (x.ship_revenue_vnd || 0), 0),
            spend_vnd: xs.reduce((s, x) => s + x.spend_vnd, 0),
            messages: xs.reduce((s, x) => s + (x.messages || 0), 0),
        });

        return NextResponse.json({
            from, to,
            rows,
            unassigned: { marketer: UNASSIGNED, orders: un.orders, revenue_vnd: un.revenue, ship_orders: un.shipOrders, ship_revenue_vnd: un.ship },
            external_rows: externalRows,
            totals: {
                team: sum(rows),
                external: sum(externalRows),
                spend_chua_nhan_ra: spendChuaNhanRa,
                // Campaign test — tách khỏi báo cáo doanh số (rule CEO #7), báo ra để
                // không ai tưởng bị mất đơn.
                test: { orders: donTest, revenue_vnd: doanhThuTest },
            },
            team_size: rows.length,
        });
    } catch (e: any) {
        console.error("marketer-perf:", e?.message || e);
        return NextResponse.json({ error: "Query lỗi" }, { status: 500 });
    }
}
