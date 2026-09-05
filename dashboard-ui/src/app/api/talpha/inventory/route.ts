import { NextResponse } from "next/server";
import { bigquery } from "@/lib/bigquery";
import { buildInventoryPayload } from "@/lib/talpha-inventory";

export const dynamic = "force-dynamic";

const BQ_PROJECT = process.env.NEXT_PUBLIC_BQ_PROJECT || "talpha-faos-2026";
const BQ_DATASET = process.env.DATASET || "TALPHA_Dataset";

// Tồn kho bám THẲNG POS Poscake (actual_remain_quantity, 7 shop) — realtime mỗi lần load.
// Snapshot BQ (do /api/talpha/sync-inventory ghi) chỉ dùng DỰ PHÒNG khi POS lỗi/timeout,
// để trang không trắng. Trước đây ưu tiên snapshot → hay kẹt số cũ; giờ đảo lại.
// Test đường dự phòng không cần ngắt POS thật: /api/talpha/inventory?force=fallback
// (UI: tab Kho với ?inv=fallback trên URL trang).
export async function GET(req: Request) {
    const forceFallback = new URL(req.url).searchParams.get("force") === "fallback";

    // 1) Nguồn chính: build live từ POS Poscake
    if (!forceFallback) {
        try {
            const payload = await buildInventoryPayload();
            return NextResponse.json({ ...payload, _source: "pos-live" });
        } catch (err: any) {
            console.error("inventory: POS live lỗi → thử snapshot BQ dự phòng:", err?.message || err);
        }
    }

    // 2) Dự phòng: snapshot mới nhất trong BQ (có thể cũ)
    try {
        const [rows] = await bigquery.query({
            query: `
                SELECT payload, CAST(snapshot_time AS STRING) AS snapshot_time
                FROM \`${BQ_PROJECT}.${BQ_DATASET}.inventory_snapshot\`
                ORDER BY snapshot_time DESC
                LIMIT 1
            `,
        });
        if (rows.length && rows[0].payload) {
            const payload = JSON.parse(rows[0].payload);
            const snap = String(rows[0].snapshot_time);
            const d = new Date(snap);
            const snapLabel = isNaN(d.getTime()) ? snap : d.toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
            // Ghi đè asOf để MỌI consumer (tab Kho, CEO insights…) thấy rõ đây là dữ liệu dự phòng
            payload.asOf = {
                label: `⚠️ Dự phòng — snapshot BigQuery ${snapLabel}`,
                note: "POS Poscake không phản hồi — số liệu là snapshot cũ, KHÔNG realtime",
            };
            return NextResponse.json({ ...payload, _source: "bigquery-fallback", _snapshotTime: snap });
        }
    } catch (e: any) {
        console.error("inventory: snapshot BQ dự phòng cũng lỗi:", e?.message || e);
    }

    return NextResponse.json(
        { error: "Không đọc được tồn kho POS (và không có snapshot dự phòng)" },
        { status: 500 },
    );
}
