/**
 * ĐỐI SOÁT COD — khớp file sao kê của đơn vị vận chuyển với đơn trong POS.
 *
 * Vì sao cần: POS nói đơn "đã giao", nhưng tiền COD chỉ thật sự về khi 3PL
 * chuyển khoản. Hai mốc đó lệch nhau hàng tuần, và phần lệch chính là tiền
 * đang treo ngoài. Không đối soát thì không ai biết 3PL đang giữ bao nhiêu,
 * hay đơn nào giao rồi mà không bao giờ thấy tiền.
 *
 * Toàn bộ hàm ở đây là hàm thuần — không đọc file, không gọi mạng — để test
 * được và để route API chỉ còn việc lấy dữ liệu rồi gọi vào.
 */
import { RULES } from "./rules";

// ─────────────────────────────────────────────────────────────────────────
// Cấu hình đọc từ talpha_rules.json → cod_settlement
// ─────────────────────────────────────────────────────────────────────────
type CodSettlementConfig = {
    match_key?: "tracking" | "order_id";
    amount_tolerance_local?: number;
    column_map?: Record<string, string[]>;
};

const CFG: CodSettlementConfig =
    (RULES as unknown as { cod_settlement?: CodSettlementConfig }).cod_settlement || {};

export const MATCH_KEY = CFG.match_key === "order_id" ? "order_id" : "tracking";
export const TOLERANCE = Number(CFG.amount_tolerance_local ?? 1);

const COLUMN_MAP: Record<string, string[]> = CFG.column_map || {};

// ─────────────────────────────────────────────────────────────────────────
// Đọc file sao kê
// ─────────────────────────────────────────────────────────────────────────

/**
 * Tách CSV/TSV có hỗ trợ ô bọc dấu nháy kép và dấu nháy escape kiểu "".
 * Tự đoán dấu phân cách theo dòng đầu — file 3PL hay xuất TSV hoặc CSV chấm phẩy.
 */
export function parseDelimited(text: string): string[][] {
    const clean = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
    const firstLine = clean.slice(0, clean.indexOf("\n") === -1 ? undefined : clean.indexOf("\n"));
    const delim = [
        ["\t", (firstLine.match(/\t/g) || []).length],
        [";", (firstLine.match(/;/g) || []).length],
        [",", (firstLine.match(/,/g) || []).length],
    ].sort((a, b) => (b[1] as number) - (a[1] as number))[0][0] as string;

    const rows: string[][] = [];
    let row: string[] = [];
    let cell = "";
    let inQuotes = false;

    for (let i = 0; i < clean.length; i++) {
        const ch = clean[i];
        if (inQuotes) {
            if (ch === '"') {
                if (clean[i + 1] === '"') { cell += '"'; i++; }
                else inQuotes = false;
            } else cell += ch;
            continue;
        }
        if (ch === '"') { inQuotes = true; continue; }
        if (ch === delim) { row.push(cell); cell = ""; continue; }
        if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; continue; }
        cell += ch;
    }
    if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
    return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

/** Chuẩn hoá tên cột: bỏ dấu, bỏ khoảng trắng thừa, về chữ thường. */
function normHeader(s: string): string {
    return s
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/đ/gi, "d")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
}

export type ColumnMapping = Partial<Record<"tracking" | "order_id" | "amount" | "fee" | "paid_date" | "status", number>>;

/**
 * Dò xem cột nào trong file là cột gì, dựa trên bảng tên khai ở
 * talpha_rules.json → cod_settlement.column_map. Trả về vị trí cột.
 */
export function detectColumns(header: string[]): ColumnMapping {
    const norm = header.map(normHeader);
    const out: ColumnMapping = {};
    for (const [field, aliases] of Object.entries(COLUMN_MAP)) {
        const wanted = (aliases || []).map(normHeader);
        const idx = norm.findIndex((h) => wanted.includes(h));
        if (idx >= 0) out[field as keyof ColumnMapping] = idx;
    }
    return out;
}

/** Đưa chuỗi tiền của file sao kê về số: bỏ ký hiệu tiền, dấu ngăn nghìn, ngoặc âm. */
export function parseAmount(raw: string): number {
    if (!raw) return 0;
    let s = String(raw).trim();
    const negative = /^\(.*\)$/.test(s) || s.startsWith("-");
    s = s.replace(/[()]/g, "").replace(/[^0-9.,-]/g, "");
    // "1.234,56" (kiểu châu Âu) vs "1,234.56" (kiểu Anh–Mỹ)
    if (/,\d{1,2}$/.test(s) && s.includes(".")) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
    const n = Math.abs(parseFloat(s) || 0);
    return negative ? -n : n;
}

export type StatementRow = {
    tracking: string;
    order_id: string;
    amount: number;
    fee: number;
    paid_date: string;
    status: string;
};

/** File sao kê thô → danh sách dòng đã chuẩn hoá. */
export function parseStatement(text: string): { rows: StatementRow[]; mapping: ColumnMapping; header: string[] } {
    const table = parseDelimited(text);
    if (!table.length) return { rows: [], mapping: {}, header: [] };
    const header = table[0].map((h) => h.trim());
    const mapping = detectColumns(header);
    const at = (r: string[], i?: number) => (i === undefined ? "" : (r[i] ?? "").trim());

    const rows = table.slice(1).map((r) => ({
        tracking: at(r, mapping.tracking),
        order_id: at(r, mapping.order_id),
        amount: parseAmount(at(r, mapping.amount)),
        fee: parseAmount(at(r, mapping.fee)),
        paid_date: at(r, mapping.paid_date),
        status: at(r, mapping.status),
    })).filter((r) => r.tracking || r.order_id);

    return { rows, mapping, header };
}

// ─────────────────────────────────────────────────────────────────────────
// Khớp sao kê với đơn POS
// ─────────────────────────────────────────────────────────────────────────

export type PosOrder = {
    order_uid: string;
    order_id: string;
    tracking: string | null;
    order_date: string;
    status_category: string;
    status_name: string;
    cod_local: number;        // tiền COD theo TWD (đã chia pos_money_divisor)
    marketer: string;
    sale: string;
};

export type ReconVerdict =
    | "khop"                  // sao kê và POS khớp cả mã lẫn tiền
    | "lech_tien"             // khớp mã, lệch số tiền quá ngưỡng
    | "chua_ve_tien"          // POS đã giao nhưng sao kê chưa có
    | "thua_o_sao_ke";        // sao kê có mà POS không tìm ra đơn

export type ReconLine = {
    verdict: ReconVerdict;
    order_uid: string | null;
    order_id: string;
    tracking: string;
    order_date: string | null;
    status_name: string | null;
    marketer: string | null;
    sale: string | null;
    pos_amount: number;       // TWD theo POS
    stm_amount: number;       // TWD theo sao kê
    diff: number;             // sao kê − POS
    fee: number;
    paid_date: string;
};

export type ReconResult = {
    lines: ReconLine[];
    summary: {
        matched: number;
        mismatched: number;
        missing_in_statement: number;
        extra_in_statement: number;
        pos_total: number;
        stm_total: number;
        fee_total: number;
        diff_total: number;
        pending_amount: number;   // tiền đơn đã giao mà sao kê chưa trả
    };
    match_key: string;
    tolerance: number;
};

const keyOf = (o: { tracking?: string | null; order_id?: string | null }) =>
    (MATCH_KEY === "tracking" ? o.tracking : o.order_id)?.toString().trim().toUpperCase() || "";

/**
 * Đối chiếu. `posOrders` chỉ nên chứa đơn ĐÃ GIAO trong kỳ đang soát — đơn chưa
 * giao thì 3PL chưa có lý do trả tiền, đưa vào chỉ tạo báo động giả.
 */
export function reconcile(posOrders: PosOrder[], stmRows: StatementRow[]): ReconResult {
    const posByKey = new Map<string, PosOrder>();
    for (const o of posOrders) {
        const k = keyOf(o);
        if (k) posByKey.set(k, o);
    }

    const lines: ReconLine[] = [];
    const seen = new Set<string>();

    for (const s of stmRows) {
        const k = keyOf(s);
        const pos = k ? posByKey.get(k) : undefined;
        if (pos) seen.add(k);

        const posAmt = pos ? pos.cod_local : 0;
        const diff = s.amount - posAmt;
        const verdict: ReconVerdict = !pos
            ? "thua_o_sao_ke"
            : Math.abs(diff) > TOLERANCE
                ? "lech_tien"
                : "khop";

        lines.push({
            verdict,
            order_uid: pos?.order_uid ?? null,
            order_id: pos?.order_id || s.order_id,
            tracking: s.tracking || pos?.tracking || "",
            order_date: pos?.order_date ?? null,
            status_name: pos?.status_name ?? null,
            marketer: pos?.marketer ?? null,
            sale: pos?.sale ?? null,
            pos_amount: posAmt,
            stm_amount: s.amount,
            diff,
            fee: s.fee,
            paid_date: s.paid_date,
        });
    }

    // Đơn đã giao nhưng sao kê chưa nhắc tới = tiền còn treo ở 3PL.
    for (const o of posOrders) {
        const k = keyOf(o);
        if (k && seen.has(k)) continue;
        lines.push({
            verdict: "chua_ve_tien",
            order_uid: o.order_uid,
            order_id: o.order_id,
            tracking: o.tracking || "",
            order_date: o.order_date,
            status_name: o.status_name,
            marketer: o.marketer,
            sale: o.sale,
            pos_amount: o.cod_local,
            stm_amount: 0,
            diff: -o.cod_local,
            fee: 0,
            paid_date: "",
        });
    }

    const by = (v: ReconVerdict) => lines.filter((l) => l.verdict === v);
    const sum = (xs: ReconLine[], f: (l: ReconLine) => number) => xs.reduce((s, l) => s + f(l), 0);

    return {
        lines,
        summary: {
            matched: by("khop").length,
            mismatched: by("lech_tien").length,
            missing_in_statement: by("chua_ve_tien").length,
            extra_in_statement: by("thua_o_sao_ke").length,
            pos_total: sum(lines, (l) => l.pos_amount),
            stm_total: sum(lines, (l) => l.stm_amount),
            fee_total: sum(lines, (l) => l.fee),
            diff_total: sum(lines, (l) => l.diff),
            pending_amount: sum(by("chua_ve_tien"), (l) => l.pos_amount),
        },
        match_key: MATCH_KEY,
        tolerance: TOLERANCE,
    };
}

/** Mã vận đơn thường nằm trong tracking_link của POS — bóc phần đuôi ra. */
export function trackingFromLink(link?: string | null): string | null {
    if (!link) return null;
    const s = String(link).trim();
    if (!s) return null;
    if (!/^https?:\/\//i.test(s)) return s;                 // POS lưu thẳng mã
    const tail = s.split(/[?#]/)[0].split("/").filter(Boolean).pop() || "";
    const q = s.match(/[?&](?:no|code|tracking|waybill|nums?)=([^&]+)/i);
    return (q ? decodeURIComponent(q[1]) : tail) || null;
}
