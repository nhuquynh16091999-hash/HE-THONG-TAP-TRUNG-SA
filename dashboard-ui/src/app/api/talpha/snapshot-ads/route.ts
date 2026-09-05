import { NextResponse } from "next/server";
import { Readable } from "node:stream";
import { bigquery } from "@/lib/bigquery";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BQ_PROJECT = process.env.NEXT_PUBLIC_BQ_PROJECT || "talpha-faos-2026";
const BQ_DATASET = process.env.DATASET || "TALPHA_Dataset";

// Snapshot chỉ số live của Ads Command Center (theo campaign) vào BQ.
// Tái dùng nguyên logic của /api/talpha/realtime (gọi nội bộ cùng server) để
// không phải duplicate code matching POS↔ads. Append-only (load job, free tier).
// Gọi định kỳ mỗi 30' bởi launchd com.talpha.snapshot-ads qua
// ops/talpha_reports/snapshot_cron.sh (C2). Mặc định snapshot period = hôm nay (giờ VN).
// Token: ưu tiên header x-talpha-token, còn ?token= giữ cho tương thích bản cũ
// (URL lộ trong log/ps, đừng dùng nữa).
async function handler(req: Request) {
    const url = new URL(req.url);
    const token = process.env.TALPHA_SYNC_TOKEN;
    if (token) {
        const got = req.headers.get("x-talpha-token") || url.searchParams.get("token");
        if (got !== token) {
            return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
        }
    }

    const start = Date.now();
    const vnToday = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Ho_Chi_Minh" });
    const from = url.searchParams.get("from_date") || vnToday;
    const to = url.searchParams.get("to_date") || vnToday;

    try {
        const rt = await fetch(
            `${url.origin}/api/talpha/realtime?from_date=${from}&to_date=${to}&active_only=false`,
            { signal: AbortSignal.timeout(58000) },
        );
        if (!rt.ok) throw new Error(`realtime trả ${rt.status}`);
        const data = await rt.json();
        const campaigns: any[] = data.campaigns || [];
        // realtime trả warnings[] khi 1 TKQC/shop fetch fail → dòng snapshot ghi ra là số
        // THIẾU. Bảng ads_command_snapshot không có cột nào để đánh dấu (SCHEMA_FROZEN,
        // không alter) nên trả về đây để snapshot_cron.sh ghi cảnh báo vào log.
        const warnings: string[] = data.warnings || [];
        if (!campaigns.length) {
            // 0 campaign + có warnings = fetch hỏng, KHÁC hẳn "hôm nay thật sự chưa chạy ads"
            return NextResponse.json({
                ok: true, rows: 0, period: `${from}..${to}`,
                warnings: warnings.length, warning_detail: warnings.slice(0, 3),
                note: warnings.length ? "không có campaign — nhưng có nguồn lỗi, nghi fetch hỏng" : "không có campaign",
            });
        }

        const nowIso = new Date().toISOString();
        const ndjson = campaigns.map((c) => JSON.stringify({
            snapshot_time: nowIso,
            period_from: from,
            period_to: to,
            account_id: String(c.account_id ?? ""),
            account_name: String(c.account_name ?? ""),
            campaign_id: String(c.campaign_id ?? ""),
            campaign_name: String(c.campaign_name ?? ""),
            spend_vnd: Number(c.spend_vnd ?? 0),
            impressions: Math.round(Number(c.impressions ?? 0)),
            messages: Math.round(Number(c.messages ?? 0)),
            purchases: Math.round(Number(c.purchases ?? 0)),
            orders: Math.round(Number(c.orders ?? 0)),
            revenue_vnd: Number(c.revenue_vnd ?? 0),
            roas: Number(c.roas ?? 0),
        })).join("\n") + "\n";

        await new Promise<void>((resolve, reject) => {
            const ws = bigquery
                .dataset(BQ_DATASET)
                .table("ads_command_snapshot")
                .createWriteStream({
                    sourceFormat: "NEWLINE_DELIMITED_JSON",
                    writeDisposition: "WRITE_APPEND",
                });
            ws.on("error", reject);
            ws.on("complete", () => resolve());
            Readable.from([Buffer.from(ndjson, "utf-8")]).pipe(ws);
        });

        return NextResponse.json({
            ok: true,
            table: `${BQ_PROJECT}.${BQ_DATASET}.ads_command_snapshot`,
            rows: campaigns.length,
            period: `${from}..${to}`,
            warnings: warnings.length,
            warning_detail: warnings.slice(0, 3),
            total_spend_vnd: data.summary?.total_spend_vnd,
            total_orders: data.summary?.total_orders,
            duration_ms: Date.now() - start,
        });
    } catch (e: any) {
        console.error("snapshot-ads error:", e);
        return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
    }
}

export const GET = handler;
export const POST = handler;
