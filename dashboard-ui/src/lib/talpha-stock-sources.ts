/**
 * Đọc tồn kho từ 2 file gốc kho Saudi & UAE (Google Sheet, tự cập nhật mỗi ngày).
 * Từ 29/07 nguồn CHUẨN của tab Kho là POS Poscake (talpha-pos-images.ts) —
 * 2 parser này giữ làm nguồn ĐỐI CHIẾU, không còn nằm trong pipeline chính.
 *
 *  - UAE  : file dạng lưới ngày (mỗi cột = 1 ngày). Tồn hiện tại = cột ngày
 *           cuối có số. Mỗi tháng 1 tab → tự lấy tab cuối (mới nhất).
 *  - Saudi: "Stock Register" — mỗi sản phẩm là 1 khối ~7 cột nằm ngang
 *           (Date | Opening | Receipt[Origin,RTO] | Quantity Out | Balance in Store).
 *           Tồn hiện tại = "Balance in Store" của dòng cuối có số.
 *
 * Header tìm theo NỘI DUNG (không hardcode vị trí dòng/cột); không thấy header
 * → throw để lỗi nổ to, tránh "layout đổi là vỡ im lặng" trả số rỗng.
 */

import { fetchSheetCsv, parseCsvGrid, parseStock, listSheetTabs } from "@/lib/gsheets";

export const SAUDI_SHEET_ID = "1PpQD8sDy5N7SovUc6a1PtuoiuobZRf7E7YjRl170YqE";
export const SAUDI_REGISTER_GID = "1562286414"; // tab "Saudi_C3X"
export const UAE_SHEET_ID = "1HQY2_DiHuvtI_HKL16v1jPY8UzCcu2jyiOGrb4257no";
export const UAE_FALLBACK_GID = "29108099"; // tab "June 2" — fallback khi không liệt kê được tab

/**
 * Chuẩn hoá mã SKU để khớp giữa file gốc và sheet hợp nhất.
 * Ưu tiên tiền tố số (bỏ số 0 đầu): "015"→"15", "16-Green"→"16", "0100…"→"100".
 * Nếu không bắt đầu bằng số: lấy token đầu giữ nguyên ("X-A", "SPTEST").
 */
export function normCode(raw: string): string {
    const s = (raw ?? "").trim();
    const num = s.match(/^0*(\d+)/);
    if (num) return num[1];
    return s.split(/\s+/)[0].toUpperCase();
}

export interface SourceStock {
    byCode: Map<string, number>; // normCode → tồn hiện tại
    asOf: string | null;         // ngày/cột mới nhất ghi nhận
    total: number;               // tổng tồn của kho (theo file gốc)
    count: number;               // số SKU đọc được
}

// Parse "MM/DD/YYYY" → số ngày kể từ epoch (để so sánh). null nếu sai định dạng.
function mmddyyyy(s: string): number | null {
    const m = s.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!m) return null;
    const mo = +m[1], d = +m[2], y = +m[3];
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return Date.UTC(y, mo - 1, d) / 86400000;
}

// ─────────────────────────────── SAUDI ───────────────────────────────
// Sổ Saudi điền sẵn từng ngày (carry-forward cả ngày tương lai). Lấy số dư của
// dòng có NGÀY MỚI NHẤT ≤ HÔM NAY → miễn nhiễm với dòng tương lai/phiếu kế hoạch.
export async function fetchSaudiStock(today = new Date()): Promise<SourceStock> {
    const csv = await fetchSheetCsv(SAUDI_SHEET_ID, SAUDI_REGISTER_GID);
    const grid = parseCsvGrid(csv);
    const byCode = new Map<string, number>();
    let total = 0, count = 0, asOf: string | null = null;
    const todayNum = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()) / 86400000;

    // Tìm header theo nội dung trong ~12 dòng đầu: dòng chứa "Product SKU" (tên SP
    // nằm ở ô kế bên) rồi dòng vai trò cột bên dưới chứa "Balance in Store".
    let prIdx = -1, rrIdx = -1;
    for (let r = 0; r < Math.min(grid.length, 12); r++) {
        if (prIdx < 0) {
            if (grid[r].some((c) => /^product\s*sku$/i.test((c ?? "").trim()))) prIdx = r;
        } else if (grid[r].some((c) => /balance\s*in\s*store/i.test(c ?? ""))) {
            rrIdx = r;
            break;
        }
    }
    if (prIdx < 0 || rrIdx < 0) {
        throw new Error("Saudi Stock Register: không thấy header 'Product SKU'/'Balance in Store' — layout sheet đã đổi?");
    }
    const productRow = grid[prIdx];
    const roleRow = grid[rrIdx];

    for (let i = 0; i < productRow.length; i++) {
        if (!/^product\s*sku$/i.test((productRow[i] ?? "").trim())) continue;
        const name = (productRow[i + 1] ?? "").trim();
        if (!name) continue;

        // Tìm cột "Balance in Store" và "Date" trong khối (≤9 cột kể từ đầu khối)
        let balCol = -1, dateCol = -1;
        for (let j = i; j < Math.min(i + 9, roleRow.length); j++) {
            if (balCol < 0 && /balance\s*in\s*store/i.test(roleRow[j] ?? "")) balCol = j;
            if (dateCol < 0 && /^date$/i.test((roleRow[j] ?? "").trim())) dateCol = j;
        }
        if (balCol < 0) continue;

        // Số dư ở ngày mới nhất ≤ hôm nay; fallback = số dư cuối có giá trị.
        // Dòng dữ liệu = mọi dòng sau dòng vai trò cột (dòng phụ đề "Origin/RTO"
        // không có số ở cột Balance → parseStock trả null, tự bị bỏ qua).
        let curBal: number | null = null, curDateNum = -Infinity, curDateStr: string | null = null;
        let fallbackBal: number | null = null;
        for (let r = rrIdx + 1; r < grid.length; r++) {
            const row = grid[r];
            const v = parseStock((row[balCol] ?? "").trim());
            if (v === null) continue;
            fallbackBal = v;
            const dn = dateCol >= 0 ? mmddyyyy(row[dateCol] ?? "") : null;
            if (dn !== null && dn <= todayNum && dn >= curDateNum) {
                curDateNum = dn; curBal = v; curDateStr = (row[dateCol] ?? "").trim();
            }
        }
        const bal = curBal ?? fallbackBal;
        if (bal === null) continue;

        byCode.set(normCode(name), bal);
        total += bal;
        count++;
        if (curDateStr && (!asOf || curDateNum > (mmddyyyy(asOf) ?? -Infinity))) asOf = curDateStr;
    }

    return { byCode, asOf, total, count };
}

// ──────────────────────────────── UAE ────────────────────────────────
export async function fetchUaeStock(): Promise<SourceStock> {
    // Tự lấy tab tháng mới nhất (cuối danh sách); fallback gid cố định.
    let gid = UAE_FALLBACK_GID;
    try {
        const tabs = await listSheetTabs(UAE_SHEET_ID);
        if (tabs.length) gid = tabs[tabs.length - 1].gid;
    } catch { /* dùng fallback */ }

    const csv = await fetchSheetCsv(UAE_SHEET_ID, gid);
    const grid = parseCsvGrid(csv);
    const byCode = new Map<string, number>();
    let total = 0, count = 0, asOf: string | null = null;

    // Tìm dòng header chứa "SKU - Product Name" → xác định cột tên + cột ngày
    const dateRe = /^\d{1,2}\/\d{1,2}\/\d{2,4}$/;
    let headerRow = -1, nameCol = -1;
    for (let r = 0; r < Math.min(grid.length, 20); r++) {
        const idx = grid[r].findIndex(c => /SKU\s*[-–—]?\s*Product\s*Name/i.test(c ?? ""));
        if (idx >= 0) { headerRow = r; nameCol = idx; break; }
    }
    if (headerRow < 0) {
        throw new Error(`UAE stock (gid ${gid}): không thấy header 'SKU - Product Name' — layout sheet đã đổi?`);
    }

    const dateCols: number[] = [];
    grid[headerRow].forEach((c, idx) => {
        const t = (c ?? "").trim();
        if (!dateRe.test(t)) return;
        dateCols.push(idx);
        // asOf = ngày lớn nhất; so bằng số (so chuỗi sai với "9/5" vs "12/6")
        const tn = mmddyyyy(t), an = asOf ? mmddyyyy(asOf) : null;
        if (!asOf || (tn !== null && an !== null ? tn > an : t > asOf)) asOf = t;
    });
    if (!dateCols.length) {
        throw new Error(`UAE stock (gid ${gid}): header không có cột ngày nào dạng M/D/YYYY — layout sheet đã đổi?`);
    }

    for (let r = headerRow + 1; r < grid.length; r++) {
        const row = grid[r];
        const name = (row[nameCol] ?? "").trim();
        if (!name) continue;
        // Tồn hiện tại = giá trị số ở cột ngày cuối cùng có số (bỏ qua ô chữ "CLOSED"…)
        let cur: number | null = null;
        for (const dc of dateCols) {
            const v = parseStock(row[dc]);
            if (v !== null) cur = v;
        }
        if (cur === null) continue;
        byCode.set(normCode(name), cur);
        total += cur;
        count++;
    }

    return { byCode, asOf, total, count };
}
