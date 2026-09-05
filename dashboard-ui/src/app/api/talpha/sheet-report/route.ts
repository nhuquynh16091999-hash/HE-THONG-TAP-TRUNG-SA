// Đọc THẲNG số từ file Google Sheet "TỔNG TEAM THÁNG n" — cùng file CEO đang xem.
//
// Vì sao cần: bot từng tự tính lại số rồi gửi lên nhóm, và mỗi lần rule đổi là tin nhắn
// lệch với Sheet (01/09: lệch cả camp test lẫn cách gán đơn; rồi lệch tiếp vì hai bên
// gom ngày theo hai múi giờ khác nhau). Đọc thẳng ô trong Sheet thì không còn chỗ nào
// để lệch: Sheet nói gì bot đọc đúng thế.
import { NextRequest, NextResponse } from "next/server";
import { GoogleAuth } from "google-auth-library";
import fs from "fs";
import path from "path";
import { RULES } from "@/lib/talpha/rules";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SCOPES = ["https://www.googleapis.com/auth/spreadsheets.readonly"];

// "32.842.574" → 32842574 · "5,9%" → 5.9 · "" → 0. Sheet đang ở locale vi_VN nên
// dấu chấm là phân cách nghìn, dấu phẩy là thập phân — đọc nhầm là sai gấp nghìn lần.
function soVN(v: unknown): number {
    const s = String(v ?? "").replace(/[đ%\s]/g, "").trim();
    if (!s) return 0;
    const n = Number(s.replace(/\./g, "").replace(",", "."));
    return Number.isFinite(n) ? n : 0;
}

function auth() {
    const raw = process.env.GOOGLE_CREDENTIALS_JSON;
    if (raw) return new GoogleAuth({ credentials: JSON.parse(raw), scopes: SCOPES });
    const keyFile = path.join(process.cwd(), "../bigquery_key.json");
    if (fs.existsSync(keyFile)) return new GoogleAuth({ keyFile, scopes: SCOPES });
    return new GoogleAuth({ scopes: SCOPES });   // ADC
}

export async function GET(req: NextRequest) {
    const date = req.nextUrl.searchParams.get("date") || "";
    if (!DATE_RE.test(date)) {
        return NextResponse.json({ error: "date phải dạng YYYY-MM-DD" }, { status: 400 });
    }
    const thang = date.slice(0, 7);
    const sheetId = (RULES as any)?.report_sheets?.grand_by_month?.[thang];
    if (!sheetId) {
        return NextResponse.json(
            { error: `chưa khai id Sheet cho tháng ${thang} trong talpha_rules.report_sheets` },
            { status: 404 });
    }

    try {
        const client = await auth().getClient();
        const base = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}`;

        const meta: any = (await client.request({ url: `${base}?fields=sheets.properties.title` })).data;
        const titles: string[] = (meta.sheets || []).map((s: any) => s.properties.title);

        // FORMATTED_VALUE: cột Ngày là ô ngày thật, lấy thô sẽ ra số serial chứ không ra
        // "01/09/2026" để so.
        const q = titles.map((t) => `ranges=${encodeURIComponent(`'${t}'!A1:N40`)}`).join("&");
        const batch: any = (await client.request({
            url: `${base}/values:batchGet?${q}&valueRenderOption=FORMATTED_VALUE`,
        })).data;

        const [y, m, d] = date.split("-");
        const nhan = `${d}/${m}/${y}`;
        const out: Record<string, any> = {};
        (batch.valueRanges || []).forEach((vr: any, i: number) => {
            const rows: string[][] = vr.values || [];
            if (!rows.length) return;
            const head = rows[0].map((h) => String(h || "").trim());
            const r = rows.slice(1).find((x) => String(x?.[0] || "").trim() === nhan);
            if (!r) return;
            const g = (ten: string) => soVN(r[head.indexOf(ten)]);
            out[titles[i]] = {
                ads: g("TỔNG TIỀN ADS"), mess: g("SỐ TIN NHẮN"), don: g("Số đơn"),
                doanh_so: g("Doanh Số"), ds_giao_tc: g("DS Giao TC"),
                ty_le_chot: g("Tỷ lệ chốt"), phan_tram_ads: g("% Ads/DT"),
            };
        });

        const team = out["Tổng"] || null;
        const marketers = Object.entries(out)
            .filter(([t]) => t !== "Tổng")
            .map(([tab, v]) => ({ tab, ...v }))
            .sort((a, b) => b.doanh_so - a.doanh_so);

        return NextResponse.json({ date, sheet_id: sheetId, team, marketers });
    } catch (e: any) {
        console.error("sheet-report:", e?.message || e);
        return NextResponse.json({ error: `đọc Sheet lỗi: ${e?.message || e}` }, { status: 500 });
    }
}
