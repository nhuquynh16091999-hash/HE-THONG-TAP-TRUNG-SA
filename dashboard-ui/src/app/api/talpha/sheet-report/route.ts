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
import { DISPLAY, GRAND_SHEET_BY_MONTH, MARKETS_PUBLIC, REPORT_START_DATE, RULES, UNASSIGNED } from "@/lib/talpha/rules";
import { getAccess } from "@/lib/talpha/access";
import { canMarket, seesAllMarkets, type Access } from "@/lib/talpha/access-rules";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// drive.readonly: tìm file TỔNG TEAM trong thư mục "Tháng N" (fileTheoThang bên dưới).
const SCOPES = ["https://www.googleapis.com/auth/spreadsheets.readonly", "https://www.googleapis.com/auth/drive.readonly"];

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

// ── File TỔNG TEAM của một tháng (Sỹ Anh chốt 01/10/2026: MỖI THÁNG MỘT THƯ MỤC) ──
// Khai tay ở talpha_rules.report_sheets.grand_by_month thì dùng ID đó (tháng 9/2026). Không có
// thì tìm trong thư mục gốc report_drive.root_folder_id → thư mục "Tháng N" → Google Sheet tên
// có "TỔNG TEAM" nằm ngay trong đó — cùng cách format_all.py (ops/talpha_reports/report_files.py)
// chọn file để ghi, nên chỗ ghi và chỗ đọc luôn là một file. Không thấy → null (route báo thiếu
// tháng), KHÔNG lùi về file tháng khác.
const DRIVE = "https://www.googleapis.com/drive/v3/files";
const ROOT_FOLDER: string = (RULES as unknown as { report_drive?: { root_folder_id?: string } }).report_drive?.root_folder_id || "";
const boDau = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[đĐ]/g, "D").toUpperCase();
const FILE_THANG = new Map<string, { at: number; id: string | null }>();

async function dsCon(fid: string, mime?: string): Promise<{ id: string; name: string; mimeType: string }[]> {
    const client = await auth().getClient();
    const q = `'${fid}' in parents and trashed = false${mime ? ` and mimeType = '${mime}'` : ""}`;
    const url = `${DRIVE}?q=${encodeURIComponent(q)}&fields=files(id,name,mimeType)&pageSize=200&supportsAllDrives=true&includeItemsFromAllDrives=true`;
    return ((await client.request({ url })).data as any).files || [];
}

async function fileTheoThang(thang: string): Promise<string | null> {
    if (GRAND_SHEET_BY_MONTH[thang]) return GRAND_SHEET_BY_MONTH[thang];
    if (!ROOT_FOLDER) return null;
    const hit = FILE_THANG.get(thang);
    // Có rồi thì giữ 10 phút; chưa có thì 2 phút — người vừa tạo file là vòng sau thấy ngay.
    if (hit && Date.now() - hit.at < (hit.id ? 600_000 : 120_000)) return hit.id;
    const [y, m] = thang.split("-").map(Number);
    let id: string | null = null;
    try {
        const thuMuc = (await dsCon(ROOT_FOLDER, "application/vnd.google-apps.folder")).filter((f) => {
            const t = boDau(f.name).split(/[^A-Z0-9]+/).filter(Boolean);
            if (t[0] !== "THANG" || Number(t[1]) !== m) return false;
            const nam = t.slice(2).find((x) => /^\d{4}$/.test(x));
            return !nam || Number(nam) === y;
        });
        for (const f of thuMuc) {
            const tong = (await dsCon(f.id, "application/vnd.google-apps.spreadsheet"))
                .filter((s) => boDau(s.name).replace(/[^A-Z0-9]+/g, " ").includes("TONG TEAM"));
            if (tong.length) { id = tong[0].id; break; }
        }
    } catch (e: any) {
        console.error(`sheet-report: tìm file tháng ${thang} trên Drive lỗi:`, e?.message || e);
        if (hit) return hit.id;               // Drive chập chờn: dùng kết quả cũ của CHÍNH tháng đó
    }
    FILE_THANG.set(thang, { at: Date.now(), id });
    return id;
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

async function theoKhoang(fromIn: string, to: string, a: Access | null) {
    // Không tính trước mốc gốc — kể cả khi ai đó gọi thẳng route với from sớm hơn.
    const from = REPORT_START_DATE && fromIn < REPORT_START_DATE ? REPORT_START_DATE : fromIn;
    const team = soRong();
    const unassigned = soRong();
    const nguoi = new Map<string, So>();
    const nuoc = new Map<string, { code?: string; so: So }>();
    const ngay = new Map<string, So>();
    // Từng ngày của từng tab NƯỚC — để dựng lại "cả team" cho người chỉ xem một phần nước.
    const ngayNuoc = new Map<string, Map<string, So>>();
    const thieuThang: string[] = [];
    const sheets: Record<string, string> = {};

    if (from <= to) {
        for (const thang of cacThang(from, to)) {
            const id = await fileTheoThang(thang);
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
                        if (code) {
                            const m = ngayNuoc.get(code) || new Map<string, So>();
                            const x = m.get(d) || soRong(); cong(x, so); m.set(d, x); ngayNuoc.set(code, m);
                        }
                    }
                }
            }
        }
    }

    // ── Phân quyền theo team (05/10/2026) ──
    // Người chỉ xem một phần nước: "cả team" của họ = cộng các tab NƯỚC họ được xem, theo
    // từng ngày. Tab marketer gộp mọi nước của người đó (Sheet không tách) nên KHÔNG trả —
    // trả là lộ số team khác. "(không gán)" cũng vậy. Tháng nào file chỉ có một nước có số
    // thì format_all.py không dựng tab nước → tháng đó người xem một phần thấy 0.
    const hep = !!a && !seesAllMarkets(a);
    if (hep) {
        ngay.clear();
        for (const [code, m] of ngayNuoc) {
            if (!canMarket(a!, code)) continue;
            for (const [d, so] of m) { const n = ngay.get(d) || soRong(); cong(n, so); ngay.set(d, n); }
        }
    }

    const days = [...ngay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, so]) => ({ date, ...so }));
    const months = new Map<string, So>();
    for (const d of days) {
        const n = months.get(d.date.slice(0, 7)) || soRong(); cong(n, d); months.set(d.date.slice(0, 7), n);
    }
    const teamTraVe = hep ? days.reduce((s, d) => { cong(s, d); return s; }, soRong()) : team;

    return {
        from, to, start_date: REPORT_START_DATE, sheets,
        // Tháng trong khoảng mà chưa khai ID file ở talpha_rules.report_sheets — số tháng đó
        // KHÔNG có trong tổng. Giao diện phải báo ra, không được coi như tháng đó bằng 0.
        missing_months: thieuThang,
        team: teamTraVe,
        // true = số đã cắt theo team của người xem (giao diện ẩn bảng marketer, KPI cả công ty).
        scoped: hep,
        marketers: hep ? [] : [...nguoi.entries()]
            .map(([tab, so]) => ({ tab, display: DISPLAY[tab] || tab, ...so }))
            .sort((a, b) => b.doanh_so - a.doanh_so),
        unassigned: !hep && (unassigned.ads || unassigned.don) ? unassigned : null,
        markets: [...nuoc.entries()]
            .filter(([, v]) => !hep || (!!v.code && canMarket(a!, v.code)))
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
    const a = await getAccess(req);
    if (from || to) {
        if (!DATE_RE.test(from) || !DATE_RE.test(to)) {
            return NextResponse.json({ error: "from/to phải dạng YYYY-MM-DD" }, { status: 400 });
        }
        try {
            return NextResponse.json(await theoKhoang(from, to, a));
        } catch (e: any) {
            console.error("sheet-report (khoảng):", e?.message || e);
            return NextResponse.json({ error: `đọc Sheet lỗi: ${e?.message || e}` }, { status: 500 });
        }
    }

    // Chế độ một ngày là của bot Zalo: trả nguyên mọi tab (cả tab marketer gộp mọi nước).
    // Người chỉ xem một phần nước dùng chế độ khoảng ở trên, đã cắt theo team.
    if (!a || !seesAllMarkets(a)) {
        return NextResponse.json({ error: "Chế độ ?date= chỉ dành cho bot — dùng ?from=&to=" }, { status: 403 });
    }
    const date = sp.get("date") || "";
    if (!DATE_RE.test(date)) {
        return NextResponse.json({ error: "date phải dạng YYYY-MM-DD" }, { status: 400 });
    }
    const thang = date.slice(0, 7);
    const sheetId = await fileTheoThang(thang);
    if (!sheetId) {
        return NextResponse.json(
            { error: `chưa có file 'TỔNG TEAM THÁNG ${Number(thang.slice(5))}' trong thư mục 'Tháng ${Number(thang.slice(5))}' (hoặc thư mục gốc chưa share cho service account)` },
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
