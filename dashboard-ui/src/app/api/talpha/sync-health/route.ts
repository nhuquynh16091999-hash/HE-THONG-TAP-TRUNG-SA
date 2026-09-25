import { NextResponse } from "next/server";
import { bigquery } from "@/lib/bigquery";

export const dynamic = "force-dynamic";

const BQ_PROJECT = process.env.NEXT_PUBLIC_BQ_PROJECT || "cty-507710";
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

// Tên TKQC / shop đọc lỗi trong vòng chạy — daily_guarded.sh đặt đầu `detail` theo nhãn
// "TKQC_LOI=a; b || SHOP_LOI=… || MAT_QUYEN=…". Không có nhãn = vòng đó không mục nào lỗi.
function docLoiFetch(detail: unknown) {
    const s = String(detail || "");
    const lay = (nhan: string) => {
        const m = new RegExp(`${nhan}=([^|]*)`).exec(s);
        return m ? m[1].split(";").map((x) => x.trim()).filter(Boolean) : [];
    };
    return { tkqc: lay("TKQC_LOI"), shops: lay("SHOP_LOI"), mat_quyen: lay("MAT_QUYEN") };
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
                ORDER BY ts DESC LIMIT 200`,
        });
        if (!rows?.length) return NextResponse.json({ status: "no-data", accounts });
        const last = rows[0];
        // LIMIT 200 (≈8 ngày chạy mỗi giờ), KHÔNG phải 5: route chỉ dùng dòng mới nhất và
        // dòng OK gần nhất, nhưng với 5 dòng thì sau 5 vòng hỏng liên tiếp lastOk thành
        // undefined → last_ok_age_minutes = null → bot Zalo coi như "không biết tuổi số"
        // và BỎ LUÔN dòng cảnh báo "SỐ CHƯA ĐỦ", đúng lúc số sai nhất. Dính thật 22/09/2026:
        // 3 TKQC mất quyền ads_read từ đêm → mỗi vòng SKIP format_all, Sheet đứng 13 giờ.
        const lastOk = rows.find((r: any) => r.ok);
        // 23/09/2026: TKQC mất quyền ads_read vẫn còn dòng cũ nên accountHealth() báo "ok" —
        // lấy tên thẳng từ log vòng chạy rồi gộp vào danh sách lỗi để bot báo đích danh.
        const fetch_errors = docLoiFetch(last.detail);
        const loiFetch = [
            ...fetch_errors.tkqc.map((name) => ({
                kind: "ads", name, rows: null, prev_rows: null,
                status: fetch_errors.mat_quyen.includes(name) ? "mat_quyen" : "khong_doc_duoc",
            })),
            ...fetch_errors.shops.map((name) => ({ kind: "orders", name, rows: null, prev_rows: null, status: "khong_doc_duoc" })),
        ];
        const accountsOut = accounts || loiFetch.length
            ? { ...(accounts || { run_ts: null, checked: 0 }), failing: [...loiFetch, ...(accounts?.failing || [])] }
            : null;
        return NextResponse.json({
            status: last.ok ? "ok" : "fail",
            accounts: accountsOut,
            fetch_errors,
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
