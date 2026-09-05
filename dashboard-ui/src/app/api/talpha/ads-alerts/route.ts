import { NextResponse } from "next/server";
import { bigquery } from "@/lib/bigquery";

export const dynamic = "force-dynamic";

const BQ_PROJECT = process.env.NEXT_PUBLIC_BQ_PROJECT || "talpha-faos-2026";
const BQ_DATASET = process.env.DATASET || "TALPHA_Dataset";

// Marketer từ tên campaign — RULE CHUNG (config/talpha_rules.json qua rules.ts).
// Trả tên hiển thị ("Lộc", "Chu Thuý"…) như trước; "" nếu không gán được.
import { scanCampaignMarketer, DISPLAY } from "@/lib/talpha/rules";
function marketerOf(name: string): string {
    const key = scanCampaignMarketer(name);
    return key ? DISPLAY[key] || key : "";
}

// Dữ liệu để bot bắn cảnh báo ads. "Hôm nay" = ngày mới nhất có trong bảng (né lệch tz).
// Trả: tổng spend hôm nay vs TB 7 ngày trước; campaign đốt tiền mà 0 tin nhắn (loại test).
export async function GET() {
    try {
        const [[meta]] = await bigquery.query({
            query: `SELECT CAST(MAX(DATE(date)) AS STRING) d FROM \`${BQ_PROJECT}.${BQ_DATASET}.fb_ads_data\``,
        });
        const day = meta?.d;
        if (!day) return NextResponse.json({ error: "fb_ads_data rỗng" }, { status: 500 });

        const [totRows] = await bigquery.query({
            query: `
                WITH daily AS (
                    SELECT DATE(date) d, SUM(spend) s
                    FROM \`${BQ_PROJECT}.${BQ_DATASET}.fb_ads_data\`
                    WHERE DATE(date) BETWEEN DATE_SUB(DATE('${day}'), INTERVAL 7 DAY) AND DATE('${day}')
                    GROUP BY 1
                )
                SELECT
                    (SELECT s FROM daily WHERE d = DATE('${day}')) AS today,
                    (SELECT AVG(s) FROM daily WHERE d < DATE('${day}')) AS avg7d`,
        });
        const totalSpend = Number(totRows?.[0]?.today || 0);
        const avg7d = Number(totRows?.[0]?.avg7d || 0);

        // Campaign đốt tiền không ra tin nhắn (loại camp test), spend ≥ 100k để lọc nhiễu.
        const [waste] = await bigquery.query({
            query: `
                SELECT campaign_name, ANY_VALUE(account_name) account_name,
                       ROUND(SUM(spend)) spend,
                       SUM(messaging_conversations_started) msgs,
                       SUM(purchases) purchases
                FROM \`${BQ_PROJECT}.${BQ_DATASET}.fb_ads_data\`
                WHERE DATE(date) = DATE('${day}')
                  AND NOT REGEXP_CONTAINS(LOWER(campaign_name), 'test')
                GROUP BY campaign_name
                HAVING spend >= 100000 AND msgs = 0
                ORDER BY spend DESC
                LIMIT 20`,
        });

        const wasteful = (waste as any[]).map(r => ({
            campaign: r.campaign_name,
            account: r.account_name,
            marketer: marketerOf(r.campaign_name),
            spend: Number(r.spend || 0),
            msgs: Number(r.msgs || 0),
            purchases: Number(r.purchases || 0),
        }));

        return NextResponse.json({
            day,
            totalSpend,
            avg7d: Math.round(avg7d),
            spikeRatio: avg7d > 0 ? Math.round((totalSpend / avg7d) * 100) / 100 : null,
            wasteful,
            fetchedAt: new Date().toISOString(),
        });
    } catch (e: any) {
        console.error("ads-alerts error:", e?.message || e);
        return NextResponse.json({ error: e?.message || "lỗi ads-alerts" }, { status: 500 });
    }
}
