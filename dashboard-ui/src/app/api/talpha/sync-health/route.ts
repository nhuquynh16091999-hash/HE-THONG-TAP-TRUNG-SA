import { NextResponse } from "next/server";
import { bigquery } from "@/lib/bigquery";

export const dynamic = "force-dynamic";

const BQ_PROJECT = process.env.NEXT_PUBLIC_BQ_PROJECT || "talpha-faos-2026";
const BQ_DATASET = process.env.DATASET || "TALPHA_Dataset";

// B5 — trạng thái theo TỪNG TKQC/shop của vòng chạy mới nhất. Bảng do
// ops/talpha_reports/report_account_health.py ghi. Chỉ trả về mục CÓ VẤN ĐỀ
// ("empty" = mất sạch dòng, "drop" = tụt bất thường) — "stale" là mục thật sự
// không phát sinh (camp tạm dừng), KHÔNG phải lỗi sync nên không đưa vào cảnh báo.
async function accountHealth() {
    try {
        const [rows] = await bigquery.query({
            query: `
                SELECT run_ts, kind, entity_name, rows_total, prev_rows_total, status
                FROM \`${BQ_PROJECT}.${BQ_DATASET}.sync_health_accounts\`
                WHERE run_ts = (SELECT MAX(run_ts) FROM \`${BQ_PROJECT}.${BQ_DATASET}.sync_health_accounts\`)
                ORDER BY rows_total DESC`,
        });
        if (!rows?.length) return null;
        const bad = rows.filter((r: any) => r.status === "empty" || r.status === "drop");
        return {
            run_ts: rows[0].run_ts?.value || rows[0].run_ts,
            checked: rows.length,
            failing: bad.map((r: any) => ({
                kind: r.kind,
                name: r.entity_name,
                rows: Number(r.rows_total),
                prev_rows: r.prev_rows_total == null ? null : Number(r.prev_rows_total),
                status: r.status,
            })),
        };
    } catch {
        // Chưa có bảng (chưa vòng nào ghi) → coi như chưa bật, KHÔNG làm hỏng route gốc.
        return null;
    }
}

// Trạng thái chuỗi sync Sheet (Mac, launchd mỗi giờ). Bot WhatsApp poll route này
// để cảnh báo khi sync FAIL hoặc IM LẶNG quá lâu (chống sự cố "chết câm" 22-29/6).
export async function GET() {
    try {
        const accounts = await accountHealth();
        const [rows] = await bigquery.query({
            query: `
                SELECT ts, host, ok, sync_rc, format_rc, detail,
                       TIMESTAMP_DIFF(CURRENT_TIMESTAMP(), ts, MINUTE) AS age_min
                FROM \`${BQ_PROJECT}.${BQ_DATASET}.sync_health\`
                ORDER BY ts DESC LIMIT 5`,
        });
        if (!rows?.length) return NextResponse.json({ status: "no-data", accounts });
        const last = rows[0];
        const lastOk = rows.find((r: any) => r.ok);
        return NextResponse.json({
            status: last.ok ? "ok" : "fail",
            accounts,
            last_run_ts: last.ts?.value || last.ts,
            age_minutes: Number(last.age_min),
            last_ok_age_minutes: lastOk ? Number(lastOk.age_min) : null,
            sync_rc: last.sync_rc, format_rc: last.format_rc,
            detail: last.detail,
        });
    } catch (e: any) {
        // bảng chưa tồn tại (chưa có run nào ghi) → coi như no-data, không phải lỗi
        if (/Not found: Table/.test(String(e?.message))) return NextResponse.json({ status: "no-data" });
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
