import { NextResponse } from "next/server";
import { bigquery } from "@/lib/bigquery";
import { RULES, SHOP2MKT, campaignMarket } from "@/lib/talpha/rules";
import { timShopDung } from "@/lib/talpha/shop-dung";

export const dynamic = "force-dynamic";

const BQ_PROJECT = process.env.NEXT_PUBLIC_BQ_PROJECT || "cty-507710";
const BQ_DATASET = process.env.DATASET || "TALPHA_Dataset";
// Ngưỡng cảnh báo hệ thống — config/talpha_rules.json → thresholds (12/11/2026).
const NGUONG = (RULES as unknown as { thresholds?: Record<string, unknown> }).thresholds || {};
const soNguong = (k: string, macDinh: number) => (Number(NGUONG[k]) > 0 ? Number(NGUONG[k]) : macDinh);

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
        const runTs = rows[0].run_ts?.value || rows[0].run_ts;
        const tuoi = Math.round((Date.now() - Date.parse(String(runTs))) / 60000);
        return {
            run_ts: runTs,
            // Tuổi lượt soát gần nhất. Bộ soát hỏng thì bảng đứng ở lượt cuối và route cứ trả
            // "0 mục lỗi" mãi — 30/09→12/11/2026 hỏng 6 tuần không ai biết. Bot kêu khi quá ngưỡng.
            age_minutes: Number.isFinite(tuoi) ? tuoi : null,
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

// BigQuery sandbox (chưa bật billing) tự xoá bảng/view 60 ngày sau lúc tạo — 03/11/2026 suýt mất
// fb_ads_data. Sync tự làm mới khi còn dưới 10 ngày (sync/core/gia_han_bq.py); còn dưới `ngay`
// ngày nghĩa là bước đó đã hỏng nhiều vòng liền → trả tên để bot Zalo cảnh báo trước khi mất thật.
// Bỏ bảng cũ đã thay (…__cu_<ngày>, cố ý để tự hết hạn) và bảng tạm (…__moi).
async function bangSapHetHan(ngay = 5) {
    const han = Date.now() + ngay * 86400000;
    const out: { ten: string; con_ngay: number }[] = [];
    for (const ds of [BQ_DATASET, "TALPHA_SaoLuu"]) {
        try {
            const [tables] = await bigquery.dataset(ds).getTables();
            for (const t of tables) {
                const id = String(t.id || "");
                const het = Number(t.metadata?.expirationTime);
                if (!het || het > han || id.includes("__cu_") || id.endsWith("__moi")) continue;
                out.push({ ten: `${ds}.${id}`, con_ngay: Math.max(0, Math.floor((het - Date.now()) / 86400000)) });
            }
        } catch {
            // Không đọc được dataset thì bỏ — cảnh báo phụ, không được làm hỏng route gốc.
        }
    }
    return out;
}

// Shop đứng im: ads của nước còn tiêu mà shop POS nước đó không có đơn mới nhiều ngày — xem
// lib/talpha/shop-dung.ts. Hỏng thì trả [] (cảnh báo phụ, không được làm hỏng route gốc).
async function shopDung() {
    const ngay = soNguong("shop_dung_ngay", 3);
    try {
        const [[don], [ads]] = await Promise.all([
            bigquery.query({ query: `
                SELECT shop_label, MAX(SUBSTR(inserted_at, 1, 10)) AS ngay_cuoi
                FROM \`${BQ_PROJECT}.${BQ_DATASET}.sale_order\` GROUP BY 1` }),
            bigquery.query({ query: `
                SELECT campaign_name, SUM(spend) AS spend
                FROM \`${BQ_PROJECT}.${BQ_DATASET}.fb_ads_data\`
                WHERE date >= DATE_SUB(CURRENT_DATE("Asia/Ho_Chi_Minh"), INTERVAL ${ngay} DAY)
                  AND date < CURRENT_DATE("Asia/Ho_Chi_Minh")
                GROUP BY 1` }),
        ]);
        const MKT2SHOP = Object.fromEntries(Object.entries(SHOP2MKT).map(([shop, mkt]) => [mkt, shop]));
        const adsTheoShop: Record<string, number> = {};
        for (const r of ads as any[]) {
            const shop = MKT2SHOP[campaignMarket(r.campaign_name).market || ""];
            if (shop) adsTheoShop[shop] = (adsTheoShop[shop] || 0) + Number(r.spend || 0);
        }
        const donCuoi = Object.fromEntries((don as any[]).map((r) => [r.shop_label, r.ngay_cuoi]));
        const shops = Object.values(RULES.markets)
            .filter((v: any) => v && typeof v === "object" && v.shop_label && v.status === "dang_ban")
            .map((v: any) => String(v.shop_label));
        const homNay = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Ho_Chi_Minh" });
        return timShopDung(shops, donCuoi, adsTheoShop, homNay, { ngay, adsMin: soNguong("shop_dung_ads_min_vnd", 500000) });
    } catch {
        return [];
    }
}

// Tên TKQC / shop đọc lỗi trong vòng chạy — daily_guarded.sh đặt đầu `detail` theo nhãn
// "TKQC_LOI=a; b || SHOP_LOI=… || MAT_QUYEN=… || TKQC_BO_QUA=…". Không có nhãn = vòng đó
// không mục nào lỗi. bo_qua (28/10/2026): TK đọc lỗi mà vẫn còn TK khác đọc được — sync bỏ qua,
// vòng vẫn OK và vẫn ghi Sheet; chỉ trả tên ra để bot nhắc gỡ TK chết.
function docLoiFetch(detail: unknown) {
    const s = String(detail || "");
    const lay = (nhan: string) => {
        const m = new RegExp(`${nhan}=([^|]*)`).exec(s);
        return m ? m[1].split(";").map((x) => x.trim()).filter(Boolean) : [];
    };
    return { tkqc: lay("TKQC_LOI"), shops: lay("SHOP_LOI"), mat_quyen: lay("MAT_QUYEN"), bo_qua: lay("TKQC_BO_QUA") };
}

// Trạng thái chuỗi sync Sheet (Mac, launchd mỗi giờ). Bot WhatsApp poll route này
// để cảnh báo khi sync FAIL hoặc IM LẶNG quá lâu (chống sự cố "chết câm" 22-29/6).
export async function GET() {
    try {
        const [accounts, bang_sap_het_han, shop_dung] = await Promise.all([accountHealth(), bangSapHetHan(), shopDung()]);
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
            bang_sap_het_han,
            shop_dung,
            soat_cham_phut: soNguong("soat_cham_phut", 180),
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
