import { NextRequest, NextResponse } from "next/server";
import { bigquery } from "@/lib/bigquery";
import {
    DISPLAY, UNASSIGNED, SALE_DISPLAY, SALE_UNASSIGNED,
    attributeOrder, buildAdidOwner, resolveSale,
} from "@/lib/talpha/rules";
import { trackingFromLink } from "@/lib/talpha/cod-recon";

export const dynamic = "force-dynamic";

const BQ_PROJECT = process.env.NEXT_PUBLIC_BQ_PROJECT || "cty-507710";
const BQ_DATASET = process.env.DATASET || "TALPHA_Dataset";

// ═══════════════════════════════════════════════════════════════════
// DANH SÁCH ĐƠN HÀNG — nguồn cho tab "Đơn hàng".
//
// Tiền lấy THẲNG từ vw_orders_std.revenue_vnd (view đã áp số chia theo shop và
// tỷ giá). KHÔNG tự tính lại từ cột cod thô — đó chính là cách lỗi X13 xảy ra.
//
// Cột thô (tags, page_id, tracking_link, money_to_collect) không có trong view
// nên phải join ngược về sale_order. Khoá join là (shop_id, id): order_id KHÔNG
// duy nhất giữa các shop, dù hiện chỉ còn một shop thì vẫn giữ đúng khoá để mai
// sau thêm shop không âm thầm cộng nhầm đơn.
// ═══════════════════════════════════════════════════════════════════

const MAX_LIMIT = 500;

export async function GET(req: NextRequest) {
    const q = req.nextUrl.searchParams;
    const from = q.get("from") || "";
    const to = q.get("to") || "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
        return NextResponse.json({ error: "from/to phải dạng YYYY-MM-DD" }, { status: 400 });
    }

    const status = q.get("status") || "";           // GIAO_THANH_CONG | DON_HOAN | HUY | DON_THO
    const marketerFilter = q.get("marketer") || "";
    const saleFilter = q.get("sale") || "";
    const search = (q.get("q") || "").trim();
    const limit = Math.min(Number(q.get("limit") || 100) || 100, MAX_LIMIT);
    const offset = Math.max(Number(q.get("offset") || 0) || 0, 0);

    try {
        const [adRows] = await bigquery.query({
            query: `SELECT DISTINCT CAST(ad_id AS STRING) AS ad_id, campaign_name
                    FROM \`${BQ_PROJECT}.${BQ_DATASET}.fb_ads_data\`
                    WHERE ad_id IS NOT NULL AND campaign_name IS NOT NULL`,
        });
        const adidOwner = buildAdidOwner(adRows as { ad_id: string; campaign_name: string }[]);

        const where: string[] = ["v.order_date BETWEEN @from AND @to"];
        if (status) where.push("v.status_category = @status");
        if (search) where.push(`(
            LOWER(COALESCE(o.bill_full_name, '')) LIKE @search
            OR COALESCE(o.bill_phone_number, '') LIKE @search
            OR CAST(v.order_id AS STRING) LIKE @search
            OR LOWER(COALESCE(o.tracking_link, '')) LIKE @search
        )`);

        const params: Record<string, unknown> = { from, to, limit, offset };
        if (status) params.status = status;
        if (search) params.search = `%${search.toLowerCase()}%`;

        const [rows] = await bigquery.query({
            query: `
                SELECT
                    v.order_uid, v.order_id, v.order_date,
                    v.status_category, v.status_name,
                    v.revenue_vnd, v.cogs_vnd, v.cogs_coverage,
                    v.marketer_name, v.resolved_ad_id, v.attribution_method,
                    v.pos_money_divisor,
                    o.cod, o.money_to_collect, o.partner,
                    o.tracking_link, o.page_id, o.tags,
                    o.bill_full_name, o.bill_phone_number,
                    o.shipping_province, o.total_quantity
                FROM \`${BQ_PROJECT}.${BQ_DATASET}.vw_orders_std\` v
                LEFT JOIN \`${BQ_PROJECT}.${BQ_DATASET}.sale_order\` o
                       ON v.shop_id = o.shop_id AND v.order_id = o.id
                WHERE ${where.join(" AND ")}
                ORDER BY v.order_date DESC, v.order_id DESC
                LIMIT @limit OFFSET @offset`,
            params,
        });

        const [[counts]] = await bigquery.query({
            query: `
                SELECT
                    COUNT(*)                                                       AS total,
                    COUNTIF(status_category = 'GIAO_THANH_CONG')                   AS delivered,
                    COUNTIF(status_category = 'DON_HOAN')                          AS returned,
                    COUNTIF(status_category = 'HUY')                               AS cancelled,
                    SUM(IF(status_category = 'GIAO_THANH_CONG', revenue_vnd, 0))   AS delivered_revenue_vnd,
                    SUM(revenue_vnd)                                               AS all_revenue_vnd
                FROM \`${BQ_PROJECT}.${BQ_DATASET}.vw_orders_std\`
                WHERE order_date BETWEEN @from AND @to
                  ${status ? "AND status_category = @status" : ""}`,
            params: status ? { from, to, status } : { from, to },
        });

        type Row = Record<string, unknown>;
        let orders = (rows as Row[]).map((r) => {
            const divisor = Number(r.pos_money_divisor) || 1;
            const { key: mkKey, source } = attributeOrder(
                r.marketer_name as string | null,
                r.resolved_ad_id as string | null,
                adidOwner,
            );
            const saleKey = resolveSale({
                order_uid: r.order_uid as string,
                page_id: r.page_id as string | null,
                tags: r.tags as string | null,
            });
            return {
                order_uid: r.order_uid as string,
                order_id: String(r.order_id ?? ""),
                order_date: r.order_date && typeof r.order_date === "object"
                    ? (r.order_date as { value: string }).value
                    : (r.order_date as string),
                status_category: r.status_category as string,
                status_name: r.status_name as string,
                customer: (r.bill_full_name as string) || "",
                phone: (r.bill_phone_number as string) || "",
                province: (r.shipping_province as string) || "",
                quantity: Number(r.total_quantity) || 0,
                revenue_vnd: Number(r.revenue_vnd) || 0,
                cogs_vnd: Number(r.cogs_vnd) || 0,
                cogs_coverage: r.cogs_coverage === null ? null : Number(r.cogs_coverage),
                // COD theo tiền thật của shop (TWD) — chia đúng số chia của view.
                cod_local: (Number(r.cod) || 0) / divisor,
                money_to_collect_local: (Number(r.money_to_collect) || 0) / divisor,
                partner: (r.partner as string) || "",
                tracking: trackingFromLink(r.tracking_link as string | null),
                marketer_key: mkKey,
                marketer: mkKey === UNASSIGNED ? UNASSIGNED : (DISPLAY[mkKey] || mkKey),
                attribution: source,
                sale_key: saleKey,
                sale: saleKey ? (SALE_DISPLAY[saleKey] || saleKey) : SALE_UNASSIGNED,
                tags: (r.tags as string) || "",
            };
        });

        // Lọc theo người: làm ở đây chứ không ở SQL vì việc gán marketer/sale là
        // rule TypeScript (3 bậc), SQL không biết luật đó.
        if (marketerFilter) orders = orders.filter((o) => o.marketer_key === marketerFilter);
        if (saleFilter) {
            orders = saleFilter === SALE_UNASSIGNED
                ? orders.filter((o) => !o.sale_key)
                : orders.filter((o) => o.sale_key === saleFilter);
        }

        return NextResponse.json({
            from, to, limit, offset,
            rows: orders,
            page_count: orders.length,
            totals: {
                total: Number(counts.total) || 0,
                delivered: Number(counts.delivered) || 0,
                returned: Number(counts.returned) || 0,
                cancelled: Number(counts.cancelled) || 0,
                delivered_revenue_vnd: Number(counts.delivered_revenue_vnd) || 0,
                all_revenue_vnd: Number(counts.all_revenue_vnd) || 0,
            },
            note: (marketerFilter || saleFilter)
                ? "Bộ lọc người áp trên trang hiện tại; ô tổng phía trên tính trên toàn kỳ."
                : null,
        });
    } catch (e) {
        console.error("orders route lỗi:", e);
        return NextResponse.json({ error: "Query lỗi" }, { status: 500 });
    }
}
