import { NextResponse } from "next/server";
import { Readable } from "node:stream";
import { bigquery } from "@/lib/bigquery";
import { buildInventoryPayload } from "@/lib/talpha-inventory";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BQ_PROJECT = process.env.NEXT_PUBLIC_BQ_PROJECT || "cty-507710";
const BQ_DATASET = process.env.DATASET || "TALPHA_Dataset";

// Build payload tồn kho (POS Poscake, cùng nguồn với /api/talpha/inventory) → ghi 1
// snapshot vào BigQuery (inventory_snapshot). Snapshot này LÀ đường dự phòng của tab
// Kho khi POS chết, nên phải chạy đều: launchd com.talpha.snapshot-inventory mỗi 15'
// gọi qua ops/talpha_reports/snapshot_cron.sh (C2).
// Bảo vệ nhẹ: nếu set TALPHA_SYNC_TOKEN thì phải khớp header x-talpha-token
// (ưu tiên) hoặc ?token= (giữ tương thích bản cũ — URL lộ trong log/ps, đừng dùng nữa).
async function handler(req: Request) {
    const token = process.env.TALPHA_SYNC_TOKEN;
    if (token) {
        const got = req.headers.get("x-talpha-token") || new URL(req.url).searchParams.get("token");
        if (got !== token) {
            return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
        }
    }

    const start = Date.now();
    try {
        const payload = await buildInventoryPayload();

        // BQ free tier KHÔNG cho streaming insert lẫn DML → ghi bằng LOAD JOB
        // (giống talpha_sync.py). Append 1 dòng NDJSON vào inventory_snapshot.
        // source = nguồn THẬT của payload, không phải nhãn cố định. buildInventoryPayload()
        // throw khi POS không trả dữ liệu (không có đường rơi về Sheet), nên mọi dòng ghi
        // được ở đây đều là POS Poscake live. Nhãn "gsheet" là di sản thời còn đọc Google
        // Sheet thủ công — để nguyên thì bảng tự mô tả sai, mà inventory_snapshot lại nằm
        // trong danh sách bảng thô cho CEO-ask (ceo-ask-prompt.ts) → LLM đọc nhầm xuất xứ.
        const ndjson = JSON.stringify({
            snapshot_time: new Date().toISOString(),
            source: "pos-poscake",
            payload: JSON.stringify(payload),
        }) + "\n";

        await new Promise<void>((resolve, reject) => {
            const ws = bigquery
                .dataset(BQ_DATASET)
                .table("inventory_snapshot")
                .createWriteStream({
                    sourceFormat: "NEWLINE_DELIMITED_JSON",
                    writeDisposition: "WRITE_APPEND",
                    // PHẢI khai schema. Load job không schema chỉ chạy được khi bảng ĐÃ tồn
                    // tại (BQ suy từ bảng cũ); bảng chưa có thì lỗi "No schema specified on
                    // job or table" và job snapshot chết câm — đúng chuyện đã xảy ra: bảng
                    // inventory_snapshot biến mất khỏi dataset, route lỗi mỗi 15 phút mà
                    // không ai thấy vì tab Kho vẫn còn số cũ để hiện. Khai schema thì lần
                    // ghi đầu tự tạo lại bảng, mất bảng lần nữa cũng tự lành.
                    schema: {
                        fields: [
                            { name: "snapshot_time", type: "TIMESTAMP", mode: "REQUIRED" },
                            { name: "source", type: "STRING" },
                            { name: "payload", type: "STRING" },
                        ],
                    },
                    // Payload là JSON tồn kho đầy đủ, ghi 96 lần/ngày → phải có hạn xoá,
                    // nếu không bảng phình vô hạn. Giữ 60 ngày.
                    timePartitioning: { type: "DAY", field: "snapshot_time", expirationMs: "5184000000" },
                });
            ws.on("error", reject);
            ws.on("complete", () => resolve());
            Readable.from([Buffer.from(ndjson, "utf-8")]).pipe(ws);
        });

        return NextResponse.json({
            ok: true,
            table: `${BQ_PROJECT}.${BQ_DATASET}.inventory_snapshot`,
            skus: payload.skuMatrix.length,
            markets: payload.marketOverview.length,
            transfers: payload.transfers.length,
            restocks: payload.restocks.length,
            duration_ms: Date.now() - start,
        });
    } catch (e: any) {
        console.error("sync-inventory error:", e);
        return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
    }
}

export const GET = handler;
export const POST = handler;
