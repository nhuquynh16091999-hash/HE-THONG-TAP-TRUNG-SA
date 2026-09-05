/**
 * Google Sheets helpers — đọc LIVE từ sheet công khai (link share "anyone with link").
 * Dùng endpoint export CSV, không cần service account / API key.
 *
 * Lưu ý: chỉ hoạt động với sheet đã bật chia sẻ "Bất kỳ ai có liên kết → Người xem".
 * Nếu sheet đổi sang private, cần chuyển sang Sheets API + service account.
 */

/** URL export 1 tab (gid) của 1 spreadsheet ra CSV. */
export function csvExportUrl(sheetId: string, gid: string): string {
    return `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;
}

/**
 * Tải CSV của 1 tab. Cache phía server `revalidate` giây để giảm tải lên Google.
 * Tự follow redirect (Google trả 307 sang host googleusercontent).
 */
export async function fetchSheetCsv(
    sheetId: string,
    gid: string,
    revalidate = 300,
): Promise<string> {
    const res = await fetch(csvExportUrl(sheetId, gid), {
        redirect: "follow",
        next: { revalidate },
    });
    if (!res.ok) {
        throw new Error(`Google Sheet ${sheetId}#${gid} → HTTP ${res.status}`);
    }
    return res.text();
}

/**
 * Liệt kê các tab (gid + tên) của 1 spreadsheet, theo đúng thứ tự tab.
 * Đọc từ trang htmlview (không cần API key). Trả [] nếu không parse được.
 */
export async function listSheetTabs(
    sheetId: string,
    revalidate = 600,
): Promise<{ gid: string; name: string }[]> {
    const res = await fetch(
        `https://docs.google.com/spreadsheets/d/${sheetId}/htmlview`,
        { redirect: "follow", next: { revalidate } },
    );
    if (!res.ok) return [];
    const html = await res.text();
    const tabs: { gid: string; name: string }[] = [];
    const seen = new Set<string>();
    const re = /\{"?name"?:\s*"((?:[^"\\]|\\.)*)"[^}]*?(\d{6,})/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html))) {
        const gid = m[2];
        if (seen.has(gid)) continue;
        seen.add(gid);
        tabs.push({ gid, name: m[1] });
    }
    return tabs;
}

/** Tách CSV thành các dòng logic, tôn trọng field nhiều dòng trong dấu "". */
export function splitCsvRows(csv: string): string[] {
    const rows: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < csv.length; i++) {
        const ch = csv[i];
        if (ch === '"') {
            if (inQuotes && csv[i + 1] === '"') {
                current += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
            current += ch;
        } else if (ch === "\n" && !inQuotes) {
            rows.push(current);
            current = "";
        } else if (ch === "\r") {
            // bỏ CR
        } else {
            current += ch;
        }
    }
    if (current.length) rows.push(current);
    return rows;
}

/** Tách 1 dòng CSV thành các ô, bóc dấu "" bao quanh. */
export function parseCsvLine(line: string): string[] {
    const result: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
            if (inQuotes && line[i + 1] === '"') {
                current += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (ch === "," && !inQuotes) {
            result.push(current);
            current = "";
        } else {
            current += ch;
        }
    }
    result.push(current);
    return result;
}

/** Parse toàn bộ CSV thành mảng 2 chiều các ô. */
export function parseCsvGrid(csv: string): string[][] {
    return splitCsvRows(csv).map(parseCsvLine);
}

/**
 * Parse 1 ô tồn kho → number | null.
 *   ""           → null  (kho không phân phối SKU)
 *   "·"          → 0     (hết tại kho đó)
 *   "(29)"       → -29   (tồn âm / lỗi sổ)
 *   "−690"/"-690"→ -690
 *   "1,134"      → 1134
 */
export function parseStock(raw: string | undefined): number | null {
    if (raw == null) return null;
    let s = raw.trim();
    if (s === "" || s === "—") return null;
    if (s === "·") return 0;
    let neg = false;
    if (s.startsWith("(") && s.endsWith(")")) {
        neg = true;
        s = s.slice(1, -1);
    }
    s = s.replace(/−/g, "-").replace(/,/g, "").trim();
    if (s.startsWith("-")) {
        neg = true;
        s = s.slice(1);
    }
    if (s === "") return null;
    const n = Number(s);
    if (isNaN(n)) return null;
    return neg ? -n : n;
}

/**
 * Parse số thực (bán/ngày, số ngày). Hỗ trợ "Chưa đo được" → null.
 *   "17.8" → 17.8 · "1,069" → 1069 · "" / "Chưa đo được" → null
 */
export function parseNum(raw: string | undefined): number | null {
    if (raw == null) return null;
    const s = raw.trim();
    if (s === "" || s === "—" || /chưa đo/i.test(s)) return null;
    const n = parseStock(s);
    return n;
}
