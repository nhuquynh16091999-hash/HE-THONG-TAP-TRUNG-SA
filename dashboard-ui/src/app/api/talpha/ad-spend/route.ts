import { NextRequest, NextResponse } from "next/server";
import { bigquery } from "@/lib/bigquery";
import { DISPLAY, parseCampaign, isTestCampaign, parseAudience, AUDIENCE_DISPLAY } from "@/lib/talpha/rules";

export const dynamic = "force-dynamic";

const BQ_PROJECT = process.env.NEXT_PUBLIC_BQ_PROJECT || "cty-507710";
const BQ_DATASET = process.env.DATASET || "TALPHA_Dataset";

// ═══════════════════════════════════════════════════════════════════
// CHI PHÍ QUẢNG CÁO — nguồn cho tab "Chi phí quảng cáo".
//
// Rule #3: spend từ Meta ĐÃ LÀ VND (tài khoản bill bằng VND). Không nhân tỷ giá,
// không chia 100. Cột ngày là `date`, KHÔNG phải `date_start`.
//
// Ba cách bổ: theo ngày · theo tài khoản quảng cáo · theo marketer (suy từ tên
// campaign). Campaign có từ "test" đứng riêng được tách ra một ô riêng chứ không
// trộn vào chi phí bán hàng — nhưng vẫn báo ra, vì đó là tiền thật đã tiêu.
// ═══════════════════════════════════════════════════════════════════

export async function GET(req: NextRequest) {
    const from = req.nextUrl.searchParams.get("from") || "";
    const to = req.nextUrl.searchParams.get("to") || "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
        return NextResponse.json({ error: "from/to phải dạng YYYY-MM-DD" }, { status: 400 });
    }

    try {
        const [dayRows] = await bigquery.query({
            query: `
                SELECT date, SUM(spend) AS spend, SUM(impressions) AS impressions,
                       SUM(clicks) AS clicks,
                       SUM(messaging_conversations_started) AS messages
                FROM \`${BQ_PROJECT}.${BQ_DATASET}.fb_ads_data\`
                WHERE date BETWEEN @from AND @to
                GROUP BY date ORDER BY date`,
            params: { from, to },
        });

        const [accRows] = await bigquery.query({
            query: `
                SELECT account_id, ANY_VALUE(account_name) AS account_name,
                       SUM(spend) AS spend,
                       SUM(messaging_conversations_started) AS messages
                FROM \`${BQ_PROJECT}.${BQ_DATASET}.fb_ads_data\`
                WHERE date BETWEEN @from AND @to
                GROUP BY account_id`,
            params: { from, to },
        });

        const [campRows] = await bigquery.query({
            query: `
                SELECT campaign_name, ANY_VALUE(account_name) AS account_name,
                       SUM(spend) AS spend, SUM(clicks) AS clicks,
                       SUM(impressions) AS impressions,
                       SUM(messaging_conversations_started) AS messages
                FROM \`${BQ_PROJECT}.${BQ_DATASET}.fb_ads_data\`
                WHERE date BETWEEN @from AND @to AND spend > 0
                GROUP BY campaign_name`,
            params: { from, to },
        });

        const dayValue = (d: unknown) =>
            d && typeof d === "object" ? (d as { value: string }).value : String(d ?? "");

        // ── Bổ theo marketer ──
        type Bucket = { spend: number; messages: number; clicks: number; impressions: number; campaigns: number };
        const empty = (): Bucket => ({ spend: 0, messages: 0, clicks: 0, impressions: 0, campaigns: 0 });
        const byMarketer = new Map<string, Bucket>();
        // Tệp khách = cộng đồng ở Đài mà quảng cáo nhắm tới (Philippines,
        // Indonesia, Việt, người Đài). KHÔNG phải thị trường — hàng vẫn giao ở
        // Đài hết. Đây là chiều để biết tệp nào ra tin nhắn rẻ nhất.
        const byAudience = new Map<string, Bucket>();
        let audienceUnknown = 0;
        let testSpend = 0, testCampaigns = 0;
        let unknownSpend = 0;
        const unknownNames: string[] = [];

        for (const r of campRows as Record<string, unknown>[]) {
            const name = String(r.campaign_name || "");
            const spend = Number(r.spend) || 0;

            // Đếm tệp khách TRƯỚC mọi lệnh continue. Đặt sau thì campaign test và
            // campaign chưa nhận ra marketer bị bỏ luôn khỏi bảng tệp — đã dính:
            // bảng tệp chỉ hiện 20,7/45,6 triệu mà nhìn vào không thấy thiếu.
            const aud = parseAudience(name);
            if (aud) {
                const ab = byAudience.get(aud) || empty();
                ab.spend += spend;
                ab.messages += Number(r.messages) || 0;
                ab.clicks += Number(r.clicks) || 0;
                ab.impressions += Number(r.impressions) || 0;
                ab.campaigns += 1;
                byAudience.set(aud, ab);
            } else {
                audienceUnknown += spend;
            }

            if (isTestCampaign(name)) { testSpend += spend; testCampaigns++; continue; }

            const [, key] = parseCampaign(name);
            if (!key) {
                unknownSpend += spend;
                if (unknownNames.length < 20) unknownNames.push(name);
                continue;
            }
            const b = byMarketer.get(key) || empty();
            b.spend += spend;
            b.messages += Number(r.messages) || 0;
            b.clicks += Number(r.clicks) || 0;
            b.impressions += Number(r.impressions) || 0;
            b.campaigns += 1;
            byMarketer.set(key, b);
        }

        const marketers = Array.from(byMarketer.entries())
            .map(([key, b]) => ({
                key,
                marketer: DISPLAY[key] || key,
                spend_vnd: b.spend,
                messages: b.messages,
                clicks: b.clicks,
                impressions: b.impressions,
                campaigns: b.campaigns,
                cost_per_message: b.messages > 0 ? b.spend / b.messages : null,
            }))
            .sort((a, b) => b.spend_vnd - a.spend_vnd);

        const audiences = Array.from(byAudience.entries())
            .map(([key, b]) => ({
                key,
                audience: AUDIENCE_DISPLAY[key] || key,
                spend_vnd: b.spend,
                messages: b.messages,
                clicks: b.clicks,
                campaigns: b.campaigns,
                cost_per_message: b.messages > 0 ? b.spend / b.messages : null,
            }))
            .sort((a, b) => b.spend_vnd - a.spend_vnd);

        const campaigns = (campRows as Record<string, unknown>[])
            .map((r) => {
                const name = String(r.campaign_name || "");
                const [, key] = parseCampaign(name);
                return {
                    campaign_name: name,
                    account_name: String(r.account_name || ""),
                    marketer: key ? (DISPLAY[key] || key) : null,
                    audience: (() => { const a = parseAudience(name); return a ? (AUDIENCE_DISPLAY[a] || a) : null; })(),
                    is_test: isTestCampaign(name),
                    spend_vnd: Number(r.spend) || 0,
                    clicks: Number(r.clicks) || 0,
                    impressions: Number(r.impressions) || 0,
                    messages: Number(r.messages) || 0,
                };
            })
            .sort((a, b) => b.spend_vnd - a.spend_vnd);

        const daily = (dayRows as Record<string, unknown>[]).map((r) => ({
            date: dayValue(r.date),
            spend_vnd: Number(r.spend) || 0,
            impressions: Number(r.impressions) || 0,
            clicks: Number(r.clicks) || 0,
            messages: Number(r.messages) || 0,
        }));

        const accounts = (accRows as Record<string, unknown>[])
            .map((r) => ({
                account_id: String(r.account_id || ""),
                account_name: String(r.account_name || r.account_id || ""),
                spend_vnd: Number(r.spend) || 0,
                messages: Number(r.messages) || 0,
            }))
            .filter((a) => a.spend_vnd > 0)
            .sort((a, b) => b.spend_vnd - a.spend_vnd);

        const totalSpend = daily.reduce((s, d) => s + d.spend_vnd, 0);

        return NextResponse.json({
            from, to,
            daily, accounts, marketers, audiences, campaigns,
            totals: {
                spend_vnd: totalSpend,
                messages: daily.reduce((s, d) => s + d.messages, 0),
                clicks: daily.reduce((s, d) => s + d.clicks, 0),
                impressions: daily.reduce((s, d) => s + d.impressions, 0),
                // Tách riêng chứ không giấu: đây vẫn là tiền đã tiêu.
                test_spend_vnd: testSpend,
                test_campaigns: testCampaigns,
                // Campaign không đọc ra được marketer — nêu thẳng thay vì im lặng
                // nuốt mất, vì đó là dấu hiệu tên campaign đặt sai quy ước.
                unattributed_spend_vnd: unknownSpend,
                unattributed_samples: unknownNames,
                audience_unknown_spend_vnd: audienceUnknown,
            },
        });
    } catch (e) {
        console.error("ad-spend route lỗi:", e);
        return NextResponse.json({ error: "Query lỗi" }, { status: 500 });
    }
}
