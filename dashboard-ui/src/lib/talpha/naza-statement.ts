/**
 * ĐỌC SAO KÊ NAZA供应链 — file .xlsx đối tác gửi hằng tuần.
 *
 * Mỗi file có ĐÚNG BA sheet, và cả ba đều cần:
 *
 *   1. TỔNG   — phép quyết toán của kỳ: COD thu × tỷ giá − phí = tiền phải trả
 *   2. COD    — từng đơn ĐÃ THU ĐƯỢC TIỀN trong kỳ
 *   3. PHÍ    — từng đơn ĐÃ XUẤT KHO trong kỳ, kèm phí vận chuyển + thao tác
 *
 * Hai sheet 2 và 3 là HAI TẬP ĐƠN KHÁC NHAU, không phải hai cột của cùng một
 * bảng: đơn xuất kho tuần này thường mãi tuần sau mới thu được tiền. Chính chỗ
 * lệch giữa hai tập đó là tiền đang treo ở 3PL.
 *
 * Tên sheet và tên cột đổi gần như mỗi file ('汇总 TỔNG', 'TỔNG', '汇总',
 * ' ĐỐI SOÁT COD' có dấu cách ở đầu). Thứ KHÔNG đổi là mã tiếng Trung, nên
 * mọi thứ ở đây neo vào mã tiếng Trung chứ không so tên tiếng Việt.
 *
 * Hàm thuần, nhận Buffer — không đọc đường dẫn, không gọi mạng.
 */
import ExcelJS from "exceljs";
import { RULES } from "./rules";

// ─────────────────────────────────────────────────────────────────────────
// Cấu hình
// ─────────────────────────────────────────────────────────────────────────
type Channel = { code: string; name: string; first_kg: number; tokens: string[] };
type FeeTable = {
    partner?: string;
    currency?: string;
    declared?: boolean;
    channels?: Channel[];
    extra_kg?: { under_3kg?: number; over_3kg?: number };
    op_fee_per_parcel?: number;
};
type SettlementCfg = {
    statement_sheets?: { summary?: string[]; cod?: string[]; fee?: string[] };
    header_anchors?: Record<string, string[]>;
    order_id_strip?: string[];
    amount_tolerance_local?: number;
    pending_alert_days?: number;
};

const CFG: SettlementCfg =
    (RULES as unknown as { cod_settlement?: SettlementCfg }).cod_settlement || {};
const FEES: FeeTable =
    (RULES as unknown as { shipping_fees?: Record<string, FeeTable> }).shipping_fees?.TW || {};

const SHEETS = CFG.statement_sheets || {};
const ANCHORS = CFG.header_anchors || {};

export const FEE_TABLE_DECLARED = FEES.declared === true;
export const OP_FEE_PER_PARCEL = Number(FEES.op_fee_per_parcel ?? 0);
export const PENDING_ALERT_DAYS = Number(CFG.pending_alert_days ?? 30);

// ─────────────────────────────────────────────────────────────────────────
// Chuẩn hoá
// ─────────────────────────────────────────────────────────────────────────

/** Mã vận đơn: bỏ dấu cách và gạch, viết hoa. Bỏ số 0 ở đầu CHỈ KHI toàn chữ số
 *  — cùng một đơn được ghi '06722405704' ở file này và '6722405704' ở file kia.
 *  Giữ nguyên phần chữ vì mã 17TRACK có dạng '73N17897055'. Phải giống hệt
 *  `trkKey` trong cod-recon.ts, nếu không hai bên khoá lệch nhau. */
export function normTracking(v: unknown): string {
    const s = String(v ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    return /^\d+$/.test(s) ? s.replace(/^0+/, "") || s : s;
}

const STRIP_RULES = (CFG.order_id_strip || []).map((p) => new RegExp(p, "i"));

/** Mã đơn: bỏ tiền tố TAIWAN-, hậu tố -Z (chuyển tiếp) và -1 (lần giao lại).
 *  Mã đơn KHÔNG duy nhất — chỉ dùng làm khoá phụ, không bao giờ làm khoá chính. */
export function normOrderId(v: unknown): string {
    let s = String(v ?? "").trim().toUpperCase();
    // Mã kiểu 'T1467 (7564042426-z)' — phần trong ngoặc là mã lần giao trước.
    s = s.replace(/\s*\([^)]*\)\s*/g, " ").trim();
    for (const re of STRIP_RULES) s = s.replace(re, "");
    return s.trim();
}

/** Ô tiền/số có thể là number, hoặc chuỗi '1,499', hoặc công thức đã tính sẵn. */
export function toNumber(v: unknown): number | null {
    if (v === null || v === undefined || v === "") return null;
    if (typeof v === "number") return Number.isFinite(v) ? v : null;
    if (typeof v === "object") {
        const o = v as { result?: unknown; text?: unknown };
        if ("result" in o) return toNumber(o.result);
        if ("text" in o) return toNumber(o.text);
        return null;
    }
    const s = String(v).replace(/[^\d.,-]/g, "").replace(/,/g, "");
    if (!s || s === "-") return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
}

function cellText(v: unknown): string {
    if (v === null || v === undefined) return "";
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if (typeof v === "object") {
        const o = v as { result?: unknown; text?: unknown; richText?: { text: string }[] };
        if (Array.isArray(o.richText)) return o.richText.map((r) => r.text).join("");
        if ("text" in o) return String(o.text ?? "");
        if ("result" in o) return String(o.result ?? "");
        return "";
    }
    return String(v).trim();
}

/** Ngày: ExcelJS trả Date cho ô định dạng ngày, còn lại là chuỗi kiểu
 *  '2026-08-25 10:58:27' hoặc '25/08/2026'. Trả về ISO yyyy-mm-dd. */
export function toIsoDate(v: unknown): string | null {
    if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
    const s = cellText(v);
    if (!s) return null;
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
    m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/);
    if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    return null;
}

// ─────────────────────────────────────────────────────────────────────────
// Tìm sheet và dòng tiêu đề
// ─────────────────────────────────────────────────────────────────────────
type Grid = unknown[][];

function sheetMatches(title: string, tokens: string[]): boolean {
    const t = title.toUpperCase();
    return tokens.some((k) => t.includes(k.toUpperCase()));
}

/** Dò sheet PHÍ trước sheet COD: tên sheet COD ('COD账单') là chuỗi ngắn dễ
 *  lọt vào tên sheet phí, còn chiều ngược lại thì không. */
function pickSheets(book: { name: string; grid: Grid }[]) {
    const feeTok = SHEETS.fee || ["运费", "VẬN CHUYỂN"];
    const codTok = SHEETS.cod || ["COD"];
    const sumTok = SHEETS.summary || ["汇总", "TỔNG", "TOTAL"];
    const fee = book.find((s) => sheetMatches(s.name, feeTok));
    const cod = book.find((s) => s !== fee && sheetMatches(s.name, codTok));
    const summary = book.find((s) => s !== fee && s !== cod && sheetMatches(s.name, sumTok)) || book[0];
    return { summary, cod, fee };
}

/** Dòng tiêu đề nằm ở r1, r3 hoặc r5 tuỳ file — dò 8 dòng đầu tìm neo 原单号. */
function findHeader(grid: Grid, anchors: string[]): { row: number; cols: string[] } | null {
    for (let i = 0; i < Math.min(8, grid.length); i++) {
        const cells = (grid[i] || []).map(cellText);
        const joined = cells.join(" ");
        if (anchors.every((a) => joined.includes(a))) return { row: i, cols: cells };
    }
    return null;
}

function colIndex(cols: string[], anchorKey: string): number {
    const toks = ANCHORS[anchorKey] || [];
    for (const tok of toks) {
        const i = cols.findIndex((c) => c.includes(tok));
        if (i >= 0) return i;
    }
    return -1;
}

// ─────────────────────────────────────────────────────────────────────────
// Kiểu dữ liệu
// ─────────────────────────────────────────────────────────────────────────
export type NazaCodLine = {
    recv_date: string | null;   // 收货日期 — ngày khách nhận hàng & trả tiền
    order_id: string;           // 原单号 — mã đơn của mình (KHÔNG duy nhất)
    tracking: string;           // 转单号 — mã vận đơn (khoá chính)
    channel: string;            // 产品名称
    cod_twd: number;            // COD金额
};

export type NazaFeeLine = {
    ship_date: string | null;   // 出货日期
    order_id: string;
    tracking: string;
    channel: string;            // 运输方式
    chargeable_kg: number | null; // 计费重
    ship_fee: number;           // 速递运费 (RMB)
    op_fee: number;             // 操作费 (RMB)
    /** Phí đúng theo bảng giá; null khi không nhận ra kênh giao hàng. */
    expected_ship_fee: number | null;
    channel_code: string | null;
};

export type NazaSummary = {
    cod_twd: number | null;         // 本期回款金额
    refund_twd: number | null;      // 退款手续费 / 客诉退款
    rate_twd_rmb: number | null;    // 汇率
    ship_fee_rmb: number | null;    // 速递运费
    op_fee_rmb: number | null;      // 操作费
    net_rmb: number | null;         // 本期应退金额RMB
    rate_rmb_vnd: number | null;
    purchase_vnd: number | null;    // 采购费 — phí mua hàng, trừ thẳng vào tiền về
    payable_vnd: number | null;     // 本期应退金额VND
    /** Có file gộp '速递运费 + 操作费' vào MỘT dòng. Khi đó ship_fee_rmb đã
     *  gồm cả phí thao tác và op_fee_rmb là 0 — không được cộng thêm lần nữa. */
    fees_combined: boolean;
};

export type NazaStatement = {
    file: string;
    sheets: { summary: string | null; cod: string | null; fee: string | null };
    summary: NazaSummary;
    cod_lines: NazaCodLine[];
    fee_lines: NazaFeeLine[];
    /** Kiểm chéo NỘI BỘ file: chi tiết có cộng ra đúng con số ở sheet TỔNG không. */
    checks: {
        cod_detail_total: number;
        cod_summary_total: number | null;
        cod_gap: number | null;
        ship_fee_detail_total: number;
        ship_fee_summary_total: number | null;
        op_fee_detail_total: number;
        op_fee_summary_total: number | null;
        /** Phép quyết toán TWD→RMB→VND có tự khớp không. */
        math_ok: boolean | null;
        math_note: string;
    };
    /** Soát phí thật với bảng giá 3PL. */
    fee_audit: {
        checked: number;
        ok: number;
        wrong: number;
        unknown_channel: number;
        overcharge_rmb: number;
        lines: { tracking: string; order_id: string; channel: string; kg: number | null; expected: number; charged: number; diff: number }[];
        /** Một mã vận đơn bị tính phí HAI LẦN trở lên trong cùng kỳ. */
        duplicates: { tracking: string; order_ids: string[]; times: number; extra_rmb: number }[];
        duplicate_extra_rmb: number;
        /** Phí thao tác khác mức đã khai (3¥/đơn). */
        op_wrong: { tracking: string; order_id: string; charged: number; expected: number }[];
        op_expected: number;
    };
};

// ─────────────────────────────────────────────────────────────────────────
// Bảng giá
// ─────────────────────────────────────────────────────────────────────────

/** Nhận kênh giao hàng từ chuỗi tự do. Mỗi file gọi một kiểu:
 *  'STWCOD专线-711', '7 ELEVEN', 'Family mart', 'STWCOD专线-新竹', 'GIAO TẠI NHÀ'. */
export function matchChannel(raw: string): Channel | null {
    const s = String(raw || "").toUpperCase();
    if (!s) return null;
    for (const ch of FEES.channels || []) {
        if ((ch.tokens || []).some((t) => s.includes(t.toUpperCase()))) return ch;
    }
    return null;
}

/** Phí đúng theo bảng giá: kg đầu theo kênh, phần dôi tính theo bậc kg. */
export function expectedShipFee(channel: Channel | null, kg: number | null): number | null {
    if (!channel) return null;
    const w = kg ?? 0;
    if (w <= 1) return channel.first_kg;
    const extraKg = Math.ceil(w - 1);
    const rate = w < 3 ? Number(FEES.extra_kg?.under_3kg ?? 0) : Number(FEES.extra_kg?.over_3kg ?? 0);
    return channel.first_kg + extraKg * rate;
}

// ─────────────────────────────────────────────────────────────────────────
// Đọc file
// ─────────────────────────────────────────────────────────────────────────

async function toGrids(buf: Buffer): Promise<{ name: string; grid: Grid }[]> {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    return wb.worksheets.map((ws) => {
        const grid: Grid = [];
        ws.eachRow({ includeEmpty: true }, (row, n) => {
            const vals = row.values as unknown[];
            // ExcelJS đánh số cột từ 1 — bỏ phần tử 0 để về mảng 0-based.
            grid[n - 1] = Array.isArray(vals) ? vals.slice(1) : [];
        });
        for (let i = 0; i < grid.length; i++) if (!grid[i]) grid[i] = [];
        return { name: ws.name, grid };
    });
}

/** Sheet TỔNG là bảng hai cột nhãn + một cột số. Đọc bằng nhãn tiếng Trung ở
 *  cột A, vì cột B (tiếng Việt) đổi cách gọi gần như mỗi kỳ. */
function readSummary(grid: Grid): NazaSummary {
    const pick = (...keys: string[]): number | null => {
        for (const row of grid) {
            const label = cellText((row || [])[0]);
            if (!label) continue;
            if (keys.some((k) => label.includes(k))) {
                const v = toNumber((row || [])[2]);
                if (v !== null) return v;
            }
        }
        return null;
    };
    // 汇率 xuất hiện HAI lần: lần đầu là TWD→RMB (số nhỏ ~0.2), lần sau là
    // RMB→VND (~3900). Phân biệt bằng độ lớn chứ không bằng nhãn.
    const rates: number[] = [];
    for (const row of grid) {
        const label = cellText((row || [])[0]);
        if (!label) continue;
        if (label.includes("汇率") || label.includes("人民币折越南盾") || label.includes("人民币换成越南盾")) {
            const v = toNumber((row || [])[2]);
            if (v !== null) rates.push(v);
        }
    }
    // Có kỳ gộp hai loại phí vào một dòng '速递运费 + 操作费 RMB'. Nhãn đó chứa
    // CẢ HAI mã, nên nếu cứ dò riêng từng mã thì cùng một con số bị trừ hai lần
    // và phép quyết toán lệch đúng bằng phần phí thao tác. Đã dính thật ở kỳ
    // 24/07: tính ra −1.098,29 RMB trong khi file ghi −163,29 RMB.
    const combined = grid.some((row) => {
        const label = cellText((row || [])[0]);
        return label.includes("速递运费") && label.includes("操作费");
    });

    return {
        cod_twd: pick("本期回款金额"),
        refund_twd: pick("退款手续费", "客诉退款"),
        rate_twd_rmb: rates.find((r) => r > 0 && r < 2) ?? null,
        ship_fee_rmb: pick("速递运费"),
        op_fee_rmb: combined ? 0 : pick("操作费"),
        net_rmb: pick("本期应退金额RMB"),
        rate_rmb_vnd: rates.find((r) => r >= 100) ?? null,
        purchase_vnd: pick("采购费"),
        payable_vnd: pick("本期应退金额VND"),
        fees_combined: combined,
    };
}

export async function parseNazaStatement(buf: Buffer, fileName = ""): Promise<NazaStatement> {
    const book = await toGrids(buf);
    const { summary: sSum, cod: sCod, fee: sFee } = pickSheets(book);

    const summary = sSum ? readSummary(sSum.grid) : ({} as NazaSummary);

    // ── Sheet COD ────────────────────────────────────────────────────────
    const cod_lines: NazaCodLine[] = [];
    if (sCod) {
        const h = findHeader(sCod.grid, ["原单号"]) || findHeader(sCod.grid, ["MÃ ĐƠN"]);
        if (h) {
            const iOrd = colIndex(h.cols, "order_id");
            const iTrk = colIndex(h.cols, "tracking");
            const iAmt = colIndex(h.cols, "cod_amount");
            const iRcv = colIndex(h.cols, "recv_date");
            const iCh = colIndex(h.cols, "channel");
            for (let r = h.row + 1; r < sCod.grid.length; r++) {
                const row = sCod.grid[r] || [];
                const amt = iAmt >= 0 ? toNumber(row[iAmt]) : null;
                const ord = iOrd >= 0 ? cellText(row[iOrd]) : "";
                if (amt === null || !ord) continue;
                cod_lines.push({
                    recv_date: iRcv >= 0 ? toIsoDate(row[iRcv]) : null,
                    order_id: ord,
                    tracking: iTrk >= 0 ? cellText(row[iTrk]) : "",
                    channel: iCh >= 0 ? cellText(row[iCh]) : "",
                    cod_twd: amt,
                });
            }
        }
    }

    // ── Sheet PHÍ ────────────────────────────────────────────────────────
    const fee_lines: NazaFeeLine[] = [];
    if (sFee) {
        const h = findHeader(sFee.grid, ["原单号"]) || findHeader(sFee.grid, ["MÃ ĐƠN"]);
        if (h) {
            const iOrd = colIndex(h.cols, "order_id");
            const iTrk = colIndex(h.cols, "tracking");
            const iShp = colIndex(h.cols, "ship_date");
            const iKg = colIndex(h.cols, "chargeable_kg");
            const iFee = colIndex(h.cols, "ship_fee");
            const iCh = h.cols.findIndex((c) => c.includes("运输方式"));
            // Cột 操作费 có file ghi nhầm thành 快递运费 — bắt cả hai, và nếu
            // vẫn không thấy thì lấy cột ngay sau cột phí vận chuyển.
            let iOp = colIndex(h.cols, "op_fee");
            if (iOp < 0 || iOp === iFee) iOp = iFee >= 0 ? iFee + 1 : -1;
            for (let r = h.row + 1; r < sFee.grid.length; r++) {
                const row = sFee.grid[r] || [];
                const ord = iOrd >= 0 ? cellText(row[iOrd]) : "";
                const fee = iFee >= 0 ? toNumber(row[iFee]) : null;
                if (!ord || fee === null) continue;
                const channel = iCh >= 0 ? cellText(row[iCh]) : "";
                const kg = iKg >= 0 ? toNumber(row[iKg]) : null;
                const ch = matchChannel(channel);
                fee_lines.push({
                    ship_date: iShp >= 0 ? toIsoDate(row[iShp]) : null,
                    order_id: ord,
                    tracking: iTrk >= 0 ? cellText(row[iTrk]) : "",
                    channel,
                    chargeable_kg: kg,
                    ship_fee: fee,
                    op_fee: iOp >= 0 ? toNumber(row[iOp]) ?? 0 : 0,
                    expected_ship_fee: expectedShipFee(ch, kg),
                    channel_code: ch?.code ?? null,
                });
            }
        }
    }

    // ── Kiểm chéo nội bộ file ────────────────────────────────────────────
    const codDetail = cod_lines.reduce((s, l) => s + l.cod_twd, 0);
    const shipDetail = fee_lines.reduce((s, l) => s + l.ship_fee, 0);
    const opDetail = fee_lines.reduce((s, l) => s + l.op_fee, 0);
    const abs = (n: number | null) => (n === null ? null : Math.abs(n));

    let mathOk: boolean | null = null;
    let mathNote = "Thiếu số ở sheet TỔNG, không kiểm được phép quyết toán.";
    const s = summary;
    if (s.cod_twd !== null && s.rate_twd_rmb !== null && s.net_rmb !== null) {
        const twd = s.cod_twd - (s.refund_twd ?? 0);
        const expNet = twd * s.rate_twd_rmb - Math.abs(s.ship_fee_rmb ?? 0) - Math.abs(s.op_fee_rmb ?? 0);
        const gap = Math.abs(expNet - s.net_rmb);
        mathOk = gap < 0.5;
        mathNote = mathOk
            ? `Phép quyết toán tự khớp (lệch ${gap.toFixed(2)} RMB).`
            : `Phép quyết toán KHÔNG khớp: tính ra ${expNet.toFixed(2)} RMB, file ghi ${s.net_rmb.toFixed(2)} RMB.`;
    }

    // ── Soát phí với bảng giá ────────────────────────────────────────────
    const auditLines: NazaStatement["fee_audit"]["lines"] = [];
    let ok = 0, unknown = 0;
    for (const l of fee_lines) {
        if (l.expected_ship_fee === null) { unknown++; continue; }
        const diff = l.ship_fee - l.expected_ship_fee;
        if (Math.abs(diff) < 0.01) { ok++; continue; }
        auditLines.push({
            tracking: l.tracking, order_id: l.order_id, channel: l.channel,
            kg: l.chargeable_kg, expected: l.expected_ship_fee, charged: l.ship_fee, diff,
        });
    }

    // ── THU HAI LẦN PHÍ TRÊN MỘT ĐƠN ─────────────────────────────────────
    //
    // Một mã vận đơn chỉ được tính phí một lần trong một kỳ. Trùng nghĩa là
    // trả thừa, và không ai bắt được bằng mắt vì bảng phí dài cả trăm dòng và
    // hai dòng trùng thường nằm cách xa nhau.
    //
    // Cẩn thận với đơn GIAO LẠI: mã vận đơn khác nhau thì là hai lần gửi thật,
    // có thu phí hai lần cũng đúng. Nên đối chiếu bằng MÃ VẬN ĐƠN, không phải
    // mã đơn — mã đơn giữ nguyên khi gửi lại.
    const byTrack = new Map<string, NazaFeeLine[]>();
    for (const l of fee_lines) {
        const k = normTracking(l.tracking);
        if (!k) continue;
        (byTrack.get(k) || byTrack.set(k, []).get(k)!).push(l);
    }
    const duplicates: NazaStatement["fee_audit"]["duplicates"] = [];
    for (const [tracking, ls] of byTrack) {
        if (ls.length < 2) continue;
        const each = ls.map((l) => l.ship_fee + l.op_fee);
        duplicates.push({
            tracking,
            order_ids: [...new Set(ls.map((l) => l.order_id))],
            times: ls.length,
            extra_rmb: each.reduce((a, b) => a + b, 0) - each[0],
        });
    }

    // ── PHÍ THAO TÁC ─────────────────────────────────────────────────────
    // Mức đã khai là 3¥/đơn. Khác mức đó thì phải hỏi, dù chỉ lệch 1¥ — trên
    // vài trăm đơn mỗi kỳ thì 1¥ lệch cũng thành tiền thật.
    const opExpected = OP_FEE_PER_PARCEL;
    const opWrong = opExpected > 0
        ? fee_lines.filter((l) => Math.abs(l.op_fee - opExpected) > 0.01)
            .map((l) => ({ tracking: l.tracking, order_id: l.order_id, charged: l.op_fee, expected: opExpected }))
        : [];

    return {
        file: fileName,
        sheets: { summary: sSum?.name ?? null, cod: sCod?.name ?? null, fee: sFee?.name ?? null },
        summary,
        cod_lines,
        fee_lines,
        checks: {
            cod_detail_total: codDetail,
            cod_summary_total: s.cod_twd,
            cod_gap: s.cod_twd === null ? null : codDetail - s.cod_twd,
            // Kỳ gộp phí thì con số ở sheet TỔNG là ship+op, phải so với tổng
            // của cả hai cột chi tiết chứ không riêng cột phí vận chuyển.
            ship_fee_detail_total: s.fees_combined ? shipDetail + opDetail : shipDetail,
            ship_fee_summary_total: abs(s.ship_fee_rmb),
            op_fee_detail_total: opDetail,
            op_fee_summary_total: s.fees_combined ? 0 : abs(s.op_fee_rmb),
            math_ok: mathOk,
            math_note: mathNote,
        },
        fee_audit: {
            checked: fee_lines.length,
            ok,
            wrong: auditLines.length,
            unknown_channel: unknown,
            overcharge_rmb: auditLines.reduce((t, l) => t + l.diff, 0),
            lines: auditLines,
            duplicates,
            duplicate_extra_rmb: duplicates.reduce((t, d) => t + d.extra_rmb, 0),
            op_wrong: opWrong,
            op_expected: opExpected,
        },
    };
}
