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
    | "chua_ve_tien"          // đã giao, sao kê chưa có, còn trong hạn chờ
    | "qua_han"               // đã giao quá lâu mà tiền vẫn chưa về — phải đi đòi
    | "thua_o_sao_ke";        // sao kê có mà không tìm ra đơn của mình

/** Đơn khớp bằng đường nào. Đơn GIAO LẠI đổi mã vận đơn nhưng giữ mã đơn, nên
 *  khớp được bằng mã đơn là dấu hiệu 3PL đã gửi lại lần hai. */
export type MatchedBy = "tracking" | "order_id_giao_lai";

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
    matched_by: MatchedBy | null;
    /** Mã vận đơn 3PL thật sự trả tiền — khác `tracking` khi đơn bị giao lại. */
    paid_tracking: string | null;
    /** Số ngày kể từ ngày xuất kho, dùng để tách "còn chờ" khỏi "quá hạn". */
    age_days: number | null;
};

export type ReconResult = {
    lines: ReconLine[];
    summary: {
        matched: number;
        mismatched: number;
        missing_in_statement: number;   // gồm cả chua_ve_tien lẫn qua_han
        extra_in_statement: number;
        overdue: number;                // số đơn quá hạn chờ — phải đi đòi
        overdue_amount: number;
        reshipped: number;              // số đơn khớp được nhờ tầng khoá thứ hai
        pos_total: number;
        stm_total: number;
        fee_total: number;
        diff_total: number;             // chỉ cộng phần LỆCH THẬT, không cộng đơn chưa về
        pending_amount: number;         // tiền đơn đã giao mà sao kê chưa trả
    };
    /** Vấn đề của CHÍNH DỮ LIỆU ĐƠN, không phải kết luận đối soát. Để riêng vì
     *  cách xử lý khác hẳn: sửa file nguồn, chứ không đi đòi 3PL. */
    data_issues: {
        duplicate_tracking: { tracking: string; orders: string[] }[];
        orders_without_tracking: number;
    };
    match_key: string;
    tolerance: number;
};

/** Mã vận đơn: bỏ dấu cách và gạch, viết hoa. Bỏ số 0 ở đầu CHỈ KHI toàn chữ số
 *  — cùng một đơn được ghi '06722405704' ở file này và '6722405704' ở file kia.
 *  Không được cắt luôn phần chữ: mã 17TRACK có dạng '73N17897055', và POS có thể
 *  lưu mã kiểu 'TW123'; cắt chữ đi thì hai đơn khác nhau hoá ra cùng một khoá. */
const trkKey = (v?: string | null) => {
    const s = String(v ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    return /^\d+$/.test(s) ? s.replace(/^0+/, "") || s : s;
};

const STRIP_RULES = ((CFG as { order_id_strip?: string[] }).order_id_strip || []).map(
    (p) => new RegExp(p, "i"),
);

const ordKey = (v?: string | null) => {
    let s = String(v ?? "").trim().toUpperCase();
    s = s.replace(/\s*\([^)]*\)\s*/g, " ").trim();   // 'T1467 (7564042426-z)' → 'T1467'
    for (const re of STRIP_RULES) s = s.replace(re, "");
    return s.trim();
};

const daysBetween = (from?: string | null, to?: string | null): number | null => {
    if (!from) return null;
    const a = Date.parse(from), b = to ? Date.parse(to) : Date.now();
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    return Math.floor((b - a) / 86_400_000);
};

/**
 * Đối chiếu. `posOrders` chỉ nên chứa đơn ĐÃ GIAO trong kỳ đang soát — đơn chưa
 * giao thì 3PL chưa có lý do trả tiền, đưa vào chỉ tạo báo động giả.
 *
 * KHOÁ ĐỐI CHIẾU HAI TẦNG, và thứ tự này không được đảo:
 *
 *   Tầng 1 — MÃ VẬN ĐƠN. Đo trên 784 dòng sao kê thật: duy nhất tuyệt đối,
 *            không một mã nào lặp. Đây là khoá chính.
 *   Tầng 2 — MÃ ĐƠN, chỉ khi tầng 1 trượt. Đơn giao lần đầu hỏng sẽ được gửi
 *            lại bằng MÃ VẬN ĐƠN MỚI trong khi mã đơn giữ nguyên; file của mình
 *            vẫn ghi mã vận đơn cũ. Bỏ tầng 2 thì 5 đơn thật bị kết luận nhầm
 *            là mất tiền, trong khi 3PL đã trả đủ trên mã vận đơn mới.
 *
 * Mã đơn KHÔNG được làm khoá chính: T1402 thật sự được dùng lại cho hai lần
 * giao khác nhau, hai mã vận đơn khác nhau, 1.500 và 749 TWD.
 */
export function reconcile(
    posOrders: PosOrder[],
    stmRows: StatementRow[],
    opts: { asOf?: string; overdueDays?: number } = {},
): ReconResult {
    const overdueDays = Number(
        opts.overdueDays ?? (CFG as { pending_alert_days?: number }).pending_alert_days ?? 30,
    );

    const byTrk = new Map<string, PosOrder>();
    const byOrd = new Map<string, PosOrder>();
    // Một mã vận đơn lẽ ra chỉ thuộc về một đơn. Khi không phải vậy, bảng khoá
    // chỉ giữ được đơn đầu tiên và đơn còn lại sẽ bị kết luận sai mà không kêu
    // tiếng nào. Thật: 6 mã trong file đối tác đang mang hai đơn khác nhau, có
    // cặp lệch tới 1.000 TWD. Nên phải đếm ra và trả về, không nuốt.
    const dupTracking: { tracking: string; orders: string[] }[] = [];
    let noTracking = 0;

    for (const o of posOrders) {
        const t = trkKey(o.tracking);
        if (!t) noTracking++;
        else if (byTrk.has(t)) {
            const hit = dupTracking.find((d) => d.tracking === t);
            if (hit) hit.orders.push(o.order_id);
            else dupTracking.push({ tracking: t, orders: [byTrk.get(t)!.order_id, o.order_id] });
        } else byTrk.set(t, o);

        const k = ordKey(o.order_id);
        if (k && !byOrd.has(k)) byOrd.set(k, o);
    }

    const lines: ReconLine[] = [];
    const claimed = new Set<string>();          // order_uid đã được sao kê nhận

    for (const s of stmRows) {
        const t = trkKey(s.tracking);
        let pos = t ? byTrk.get(t) : undefined;
        let how: MatchedBy | null = pos ? "tracking" : null;
        if (!pos) {
            const k = ordKey(s.order_id);
            const cand = k ? byOrd.get(k) : undefined;
            // Chỉ nhận tầng 2 khi đơn đó chưa bị dòng sao kê nào khác nhận, để
            // một mã đơn dùng lại không nuốt mất hai lần thanh toán khác nhau.
            if (cand && !claimed.has(cand.order_uid)) { pos = cand; how = "order_id_giao_lai"; }
        }
        if (pos) claimed.add(pos.order_uid);

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
            tracking: pos?.tracking || s.tracking || "",
            order_date: pos?.order_date ?? null,
            status_name: pos?.status_name ?? null,
            marketer: pos?.marketer ?? null,
            sale: pos?.sale ?? null,
            pos_amount: posAmt,
            stm_amount: s.amount,
            diff,
            fee: s.fee,
            paid_date: s.paid_date,
            matched_by: how,
            paid_tracking: s.tracking || null,
            age_days: daysBetween(pos?.order_date, opts.asOf),
        });
    }

    // Đơn đã giao nhưng không dòng sao kê nào nhận = tiền còn nằm ở 3PL.
    // Tách theo tuổi: mới thì là nhịp thanh toán bình thường, quá lâu là phải đi đòi.
    for (const o of posOrders) {
        if (claimed.has(o.order_uid)) continue;
        const age = daysBetween(o.order_date, opts.asOf);
        lines.push({
            verdict: age !== null && age > overdueDays ? "qua_han" : "chua_ve_tien",
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
            matched_by: null,
            paid_tracking: null,
            age_days: age,
        });
    }

    const by = (v: ReconVerdict) => lines.filter((l) => l.verdict === v);
    const sum = (xs: ReconLine[], f: (l: ReconLine) => number) => xs.reduce((s, l) => s + f(l), 0);
    const pending = [...by("chua_ve_tien"), ...by("qua_han")];

    return {
        lines,
        summary: {
            matched: by("khop").length,
            mismatched: by("lech_tien").length,
            missing_in_statement: pending.length,
            extra_in_statement: by("thua_o_sao_ke").length,
            overdue: by("qua_han").length,
            overdue_amount: sum(by("qua_han"), (l) => l.pos_amount),
            reshipped: lines.filter((l) => l.matched_by === "order_id_giao_lai").length,
            pos_total: sum(lines, (l) => l.pos_amount),
            stm_total: sum(lines, (l) => l.stm_amount),
            fee_total: sum(lines, (l) => l.fee),
            diff_total: sum(by("lech_tien"), (l) => l.diff),
            pending_amount: sum(pending, (l) => l.pos_amount),
        },
        data_issues: {
            duplicate_tracking: dupTracking,
            orders_without_tracking: noTracking,
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
