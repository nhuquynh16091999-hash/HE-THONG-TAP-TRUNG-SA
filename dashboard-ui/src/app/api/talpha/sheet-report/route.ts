// Đọc THẲNG số từ file Google Sheet "TỔNG TEAM THÁNG n" — cùng file CEO đang xem.
//
// Vì sao cần: bot từng tự tính lại số rồi gửi lên nhóm, và mỗi lần rule đổi là tin nhắn
// lệch với Sheet (01/09: lệch cả camp test lẫn cách gán đơn; rồi lệch tiếp vì hai bên
// gom ngày theo hai múi giờ khác nhau). Đọc thẳng ô trong Sheet thì không còn chỗ nào
// để lệch: Sheet nói gì bot đọc đúng thế.
//
// Hai chế độ:
//   ?date=YYYY-MM-DD          một ngày — bot Zalo (giữ nguyên dạng trả về).
//   ?from=YYYY-MM-DD&to=…     cộng cả khoảng — tab Tổng quan (25/09/2026: tab tự tính từ
//                             BigQuery theo luật riêng nên lệch Sheet; nay đọc cùng file).
import { NextRequest, NextResponse } from "next/server";
import { GoogleAuth } from "google-auth-library";
import fs from "fs";
import path from "path";
import { DISPLAY, GRAND_SHEET_BY_MONTH, MARKETS_PUBLIC, REPORT_START_DATE, UNASSIGNED } from "@/lib/talpha/rules";

export const dynamic = "force-dynamic";

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

type Tab = { title: string; head: string[]; rows: string[][] };

// Mỗi file đọc một lần batchGet cho mọi tab. Giữ 60 giây: tab Tổng quan gọi lại mỗi lần
// đổi ngày, còn Sheet chỉ đổi mỗi giờ một lần (vòng talpha-report phút :20).
const CACHE = new Map<string, { at: number; tabs: Tab[] }>();
const CACHE_MS = 60_000;

async function docFile(sheetId: string): Promise<Tab[]> {
    const hit = CACHE.get(sheetId);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.tabs;

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

    const tabs: Tab[] = [];
    (batch.valueRanges || []).forEach((vr: any, i: number) => {
        const rows: string[][] = vr.values || [];
        if (!rows.length) return;
        const head = rows[0].map((h) => String(h || "").trim());
        // Chỉ tab SỐ LIỆU (có cột tiền ads). Ai thêm tab ghi chú/danh sách vào file TỔNG TEAM
        // thì cũng không bị đọc nhầm thành một "marketer".
        if (!head.includes("TỔNG TIỀN ADS")) return;
        tabs.push({ title: titles[i], head, rows: rows.slice(1) });
    });
    CACHE.set(sheetId, { at: Date.now(), tabs });
    return tabs;
}

type So = { ads: number; mess: number; don: number; doanh_so: number; ds_giao_tc: number };
const soRong = (): So => ({ ads: 0, mess: 0, don: 0, doanh_so: 0, ds_giao_tc: 0 });
const cong = (a: So, b: So) => {
    a.ads += b.ads; a.mess += b.mess; a.don += b.don; a.doanh_so += b.doanh_so; a.ds_giao_tc += b.ds_giao_tc;
};
function docDong(head: string[], r: string[]): So {
    const g = (ten: string) => soVN(r[head.indexOf(ten)]);
    return { ads: g("TỔNG TIỀN ADS"), mess: g("SỐ TIN NHẮN"), don: g("Số đơn"), doanh_so: g("Doanh Số"), ds_giao_tc: g("DS Giao TC") };
}

// "15/09/2026" → "2026-09-15"; dòng "TỔNG" và dòng lạ → null.
function ngayISO(o: unknown): string | null {
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(o ?? "").trim());
    return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

function cacThang(from: string, to: string): string[] {
    const out: string[] = [];
    let [y, m] = from.slice(0, 7).split("-").map(Number);
    const [ty, tm] = to.slice(0, 7).split("-").map(Number);
    while (y < ty || (y === ty && m <= tm)) {
        out.push(`${y}-${String(m).padStart(2, "0")}`);
        m += 1; if (m > 12) { m = 1; y += 1; }
    }
    return out;
}

// Tab trong file TỔNG TEAM (format_all.py): "Tổng" = cả team · một tab mỗi marketer
// (cột 8 là "Tiền (local)") · "(không gán)" nếu có đơn chưa gán · một tab mỗi nước khi
// có từ hai nước có số trở lên (cột 8 là mã tiền địa phương, tên tab là tên nước).
function loaiTab(t: Tab): { loai: "team" | "unassigned" | "marketer" | "market"; code?: string } {
    if (t.title === "Tổng") return { loai: "team" };
    if (t.title === UNASSIGNED) return { loai: "unassigned" };
    if (t.head[7] === "Tiền (local)") return { loai: "marketer" };
    const nuoc = MARKETS_PUBLIC.markets.find((m) => m.display === t.title || m.key === t.title);
    return { loai: "market", code: nuoc?.code };
}

async function theoKhoang(fromIn: string, to: string) {
    // Không tính trước mốc gốc — kể cả khi ai đó gọi thẳng route với from sớm hơn.
    const from = REPORT_START_DATE && fromIn < REPORT_START_DATE ? REPORT_START_DATE : fromIn;
    const team = soRong();
    const unassigned = soRong();
    const nguoi = new Map<string, So>();
    const nuoc = new Map<string, { code?: string; so: So }>();
    const ngay = new Map<string, So>();
    const thieuThang: string[] = [];
    const sheets: Record<string, string> = {};

    if (from <= to) {
        for (const thang of cacThang(from, to)) {
            const id = GRAND_SHEET_BY_MONTH[thang];
            if (!id) { thieuThang.push(thang); continue; }
            sheets[thang] = id;
            for (const t of await docFile(id)) {
                const { loai, code } = loaiTab(t);
                for (const r of t.rows) {
                    const d = ngayISO(r?.[0]);
                    if (!d || d < from || d > to) continue;
                    const so = docDong(t.head, r);
                    if (loai === "team") {
                        cong(team, so);
                        const n = ngay.get(d) || soRong(); cong(n, so); ngay.set(d, n);
                    } else if (loai === "unassigned") {
                        cong(unassigned, so);
                    } else if (loai === "marketer") {
                        const n = nguoi.get(t.title) || soRong(); cong(n, so); nguoi.set(t.title, n);
                    } else {
                        const n = nuoc.get(t.title) || { code, so: soRong() }; cong(n.so, so); nuoc.set(t.title, n);
                    }
                }
            }
        }
    }

    const days = [...ngay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, so]) => ({ date, ...so }));
    const months = new Map<string, So>();
    for (const d of days) {
        const n = months.get(d.date.slice(0, 7)) || soRong(); cong(n, d); months.set(d.date.slice(0, 7), n);
    }

    return {
        from, to, start_date: REPORT_START_DATE, sheets,
        // Tháng trong khoảng mà chưa khai ID file ở talpha_rules.report_sheets — số tháng đó
        // KHÔNG có trong tổng. Giao diện phải báo ra, không được coi như tháng đó bằng 0.
        missing_months: thieuThang,
        team,
        marketers: [...nguoi.entries()]
            .map(([tab, so]) => ({ tab, display: DISPLAY[tab] || tab, ...so }))
            .sort((a, b) => b.doanh_so - a.doanh_so),
        unassigned: unassigned.ads || unassigned.don ? unassigned : null,
        markets: [...nuoc.entries()]
            .map(([tab, v]) => ({ tab, code: v.code || null, ...v.so }))
            .sort((a, b) => b.doanh_so - a.doanh_so),
        days,
        months: [...months.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, so]) => ({ month, ...so })),
    };
}

export async function GET(req: NextRequest) {
    const sp = req.nextUrl.searchParams;
    const from = sp.get("from") || "";
    const to = sp.get("to") || "";
    if (from || to) {
        if (!DATE_RE.test(from) || !DATE_RE.test(to)) {
            return NextResponse.json({ error: "from/to phải dạng YYYY-MM-DD" }, { status: 400 });
        }
        try {
            return NextResponse.json(await theoKhoang(from, to));
        } catch (e: any) {
            console.error("sheet-report (khoảng):", e?.message || e);
            return NextResponse.json({ error: `đọc Sheet lỗi: ${e?.message || e}` }, { status: 500 });
        }
    }

    const date = sp.get("date") || "";
    if (!DATE_RE.test(date)) {
        return NextResponse.json({ error: "date phải dạng YYYY-MM-DD" }, { status: 400 });
    }
    const thang = date.slice(0, 7);
    const sheetId = GRAND_SHEET_BY_MONTH[thang];
    if (!sheetId) {
        return NextResponse.json(
            { error: `chưa khai id Sheet cho tháng ${thang} trong talpha_rules.report_sheets` },
            { status: 404 });
    }

    try {
        const [y, m, d] = date.split("-");
        const nhan = `${d}/${m}/${y}`;
        const out: Record<string, any> = {};
        for (const t of await docFile(sheetId)) {
            const r = t.rows.find((x) => String(x?.[0] || "").trim() === nhan);
            if (!r) continue;
            const g = (ten: string) => soVN(r[t.head.indexOf(ten)]);
            out[t.title] = {
                ads: g("TỔNG TIỀN ADS"), mess: g("SỐ TIN NHẮN"), don: g("Số đơn"),
                doanh_so: g("Doanh Số"), ds_giao_tc: g("DS Giao TC"),
                ty_le_chot: g("Tỷ lệ chốt"), phan_tram_ads: g("% Ads/DT"),
            };
        }

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
