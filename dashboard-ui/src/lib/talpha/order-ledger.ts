/**
 * SỔ ĐƠN HÀNG — mỗi đơn MỘT DÒNG, kèm đủ vòng đời của tiền.
 *
 * Trước đây bốn nguồn nằm bốn chỗ và người là chất keo:
 *
 *   file đơn đối tác  → đơn là gì, khách là ai, phải thu bao nhiêu
 *   sao kê COD        → 3PL đã trả về bao nhiêu
 *   bảng phí          → đơn đó tốn bao nhiêu ship + thao tác
 *   bảng giá vốn      → hàng đó nhập bao nhiêu
 *
 * Ghép lại thì trả lời được câu mà không nguồn nào tự trả lời được:
 * **đơn này rốt cuộc còn lại bao nhiêu.**
 *
 * Hàm thuần — không đọc file, không gọi mạng.
 */
import { RULES, normPosMarketer, DISPLAY } from "./rules";

// ─────────────────────────────────────────────────────────────────────────
// Cấu hình
// ─────────────────────────────────────────────────────────────────────────
type Market = { currency?: string; rate_vnd?: number; pos_money_divisor?: number };
const TW: Market =
    (RULES as unknown as { markets?: Record<string, Market> }).markets?.Taiwan || {};

type Product = { name?: string; cost_price_rmb?: number; cost_price_vnd?: number };
const PRODUCTS: Record<string, Product> =
    (RULES as unknown as { products?: Record<string, Product> }).products || {};

/**
 * Giá vốn một cái, tính ra VND.
 *
 * Ưu tiên GIÁ TỆ: hàng nhập từ Trung Quốc, trả bằng tệ, nên tệ mới là con số
 * thật; VND chỉ là kết quả quy đổi tại một thời điểm.
 *
 * Quy đổi bằng ĐÚNG tỷ giá của kỳ sao kê đang xét, không phải tỷ giá hôm nay.
 * Doanh thu và giá vốn cùng đi qua một tỷ giá thì biên lãi không bị tỷ giá làm
 * méo — tỷ giá nhảy 2% giữa các kỳ mà chỉ một vế đổi theo là lãi tự nhiên
 * phình ra hoặc teo lại dù chẳng bán khác gì.
 */
function unitCostVnd(code: string, rateRmbVnd: number | null): number | null {
    const p = PRODUCTS[code];
    if (!p) return null;
    if (typeof p.cost_price_rmb === "number" && p.cost_price_rmb > 0) {
        return p.cost_price_rmb * (rateRmbVnd ?? FALLBACK_RMB_VND);
    }
    // CỐ Ý không lùi về cost_price_vnd. Giá VND cũ mang từ hệ thống GCC quy ra
    // 11–58 tệ, trong khi hàng mua thật ở Đài chỉ 1,3–39 tệ — khác thị trường,
    // khác nguồn hàng. Dùng nó thì 60 đơn bị tính giá vốn cao gấp mấy lần thật
    // (riêng mã 011: 145.000đ ≈ 37,6 tệ cho một vòng cổ, trong khi vòng thật
    // chỉ 7–9,5 tệ). Thà báo "chưa khai giá" còn hơn đưa ra con số sai.
    return null;
}

const CFG = (RULES as unknown as {
    cod_settlement?: {
        pending_alert_days?: number; amount_tolerance_local?: number; statement_cycle_days?: number;
    };
}).cod_settlement || {};

export const OVERDUE_DAYS = Number(CFG.pending_alert_days ?? 30);
export const TOLERANCE_TWD = Number(CFG.amount_tolerance_local ?? 1);
/** NAZA gửi sao kê đều đặn mỗi 7 ngày (đo trên 8 kỳ: 24/07 → 11/09/2026). */
export const CHU_KY_SAO_KE_NGAY = Number(CFG.statement_cycle_days ?? 7);

const NGAY = 86_400_000;
const LA_NGAY = (s?: string | null): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
const themNgay = (ngay: string, n: number) => new Date(Date.parse(`${ngay}T00:00:00Z`) + n * NGAY).toISOString().slice(0, 10);
const cachNgay = (a: string, b: string) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / NGAY);

/**
 * Tới kỳ sao kê mới mà chưa thấy file — sao kê là thứ DUY NHẤT phải tải lên bằng tay
 * (NAZA gửi file qua chat, máy không có chỗ nào tự lấy). Không ai nhắc thì cả tháng
 * không tải, và màn đối soát đứng im mà trông vẫn "sạch".
 *
 * `an` = số ngày ân hạn: NAZA gửi trễ một ngày là chuyện thường, kêu ngay thì nhàm.
 * Chưa có kỳ nào (mới dựng) → không kêu: không biết chu kỳ bắt đầu từ đâu.
 */
export function saoKeTreHan(
    ngayCacKy: (string | null | undefined)[],
    homNay: string,
    opts: { chuKy?: number; an?: number } = {},
): { tre: boolean; tre_ngay: number; ky_gan_nhat: string | null; du_kien: string | null } {
    const chuKy = opts.chuKy ?? CHU_KY_SAO_KE_NGAY;
    const an = opts.an ?? 1;
    const ngay = ngayCacKy.filter(LA_NGAY).sort();
    const ganNhat = ngay.length ? ngay[ngay.length - 1] : null;
    if (!ganNhat || !LA_NGAY(homNay)) return { tre: false, tre_ngay: 0, ky_gan_nhat: ganNhat, du_kien: null };

    const duKien = themNgay(ganNhat, chuKy);
    const treNgay = cachNgay(homNay, duKien);
    return { tre: treNgay > an, tre_ngay: Math.max(treNgay, 0), ky_gan_nhat: ganNhat, du_kien: duKien };
}
/** Tỷ giá dự phòng khi bản sao kê không nói tỷ giá của kỳ đó. */
export const FALLBACK_TWD_VND = Number(TW.rate_vnd ?? 800);
/** Tỷ giá RMB→VND dự phòng, chỉ dùng khi bản sao kê không nói tỷ giá kỳ đó — talpha_rules.json → cost_rate_rmb_vnd. */
export const FALLBACK_RMB_VND = Number((RULES as unknown as { cost_rate_rmb_vnd?: number }).cost_rate_rmb_vnd ?? 3860);

// ─────────────────────────────────────────────────────────────────────────
// Chuẩn hoá khoá — phải giống hệt cod-recon.ts, lệch một chữ là hai bên
// khoá khác nhau và không đơn nào ghép được.
// ─────────────────────────────────────────────────────────────────────────
export function trackKey(v?: string | null): string {
    const s = String(v ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    return /^\d+$/.test(s) ? s.replace(/^0+/, "") || s : s;
}

const STRIP = [/^TAIWAN[-\s]*/i, /[-\s]*Z$/i, /-\d+$/];
export function orderKey(v?: string | null): string {
    let s = String(v ?? "").trim().toUpperCase().replace(/\s*\([^)]*\)\s*/g, " ").trim();
    for (const re of STRIP) s = s.replace(re, "");
    return s.trim();
}

/**
 * Mã vận đơn GỐC của một ĐƠN GIAO LẠI (hàng hoàn gửi cho khách khác, 转寄).
 * Hai bên ghi hai kiểu, và mã gốc là thứ DUY NHẤT cả hai cùng ghi:
 *
 *   Sheet:  mã đơn "T1467 (7564042426-z)"  → mã gốc nằm trong ngoặc
 *   NAZA:   mã đơn "7564042426-Z"           → kèm mã vận đơn MỚI do NAZA cấp
 *
 * Mã vận đơn Sheet ghi cho loại đơn này thì không tin được: cả ba đơn giao lại
 * của kỳ 9.11 đều ghi sai, T1467 còn chép nhầm mã của T1465.
 */
export function maGocGiaoLai(orderNo?: string | null): string {
    const m = String(orderNo ?? "").match(/\(\s*([0-9A-Z]+)\s*-\s*Z\s*\)/i);
    return m ? trackKey(m[1]) : "";
}

/** Phía NAZA của cùng loại đơn: "7564042426-Z" → "7564042426". */
export function maGocNaza(orderNo?: string | null): string {
    const m = String(orderNo ?? "").trim().replace(/^TAIWAN[-\s]*/i, "").match(/^([0-9A-Z]+)\s*-\s*Z$/i);
    return m ? trackKey(m[1]) : "";
}

/** Mã sản phẩm trong chuỗi SKU. Một đơn có thể GHÉP nhiều mã:
 *  "042 - BLACK + 043 - COFFEE" là hai sản phẩm, phải cộng cả hai giá vốn. */
export function productCodes(sku?: string | null): string[] {
    return [...new Set(String(sku ?? "").match(/\b\d{3}\b/g) || [])];
}

/** Tên marketer về đúng MỘT cách gọi cho cả hệ thống.
 *
 *  File đối tác ghi "Lâm", mọi báo cáo khác gọi "Lộc" — cùng một người. Để
 *  nguyên thì Sổ đơn hàng và bảng chi tiêu quảng cáo nói về hai người khác
 *  nhau, và không ai nối được doanh thu với chi phí của chính người đó.
 *  normPosMarketer đã nắm sẵn bảng bí danh trong talpha_rules.json. */
function canonMarketer(raw?: string | null): string {
    const s = String(raw ?? "").trim();
    if (!s) return "";
    const key = normPosMarketer(s);
    return key ? (DISPLAY[key] || key) : s;
}

const daysBetween = (from?: string | null, to?: string | null): number | null => {
    if (!from) return null;
    const a = Date.parse(from), b = to ? Date.parse(to) : Date.now();
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    return Math.floor((b - a) / 86_400_000);
};

// ─────────────────────────────────────────────────────────────────────────
// Kiểu dữ liệu vào
// ─────────────────────────────────────────────────────────────────────────
export type OrderSource = {
    order_no: string;
    tracking: string;
    track17_code?: string | null;
    return_order_no?: string | null;
    order_date?: string | null;
    ship_date?: string | null;
    ship_method?: string;
    sku?: string;
    quantity?: string | number;
    contact_name?: string;
    phone?: string;
    cod_twd: number;
    status?: string | null;        // mã trạng thái chuẩn (Delivered, InTransit…)
    status_raw?: string;           // chữ đối tác ghi
    recon_manual?: string;         // cột "Đối soát" người gõ tay
    marketer?: string;
};

export type PaidLine = {
    tracking: string;
    order_no: string;
    amount_twd: number;
    paid_date?: string;
    period?: string;               // tên bản sao kê
    rate_twd_rmb?: number | null;
    rate_rmb_vnd?: number | null;
};

export type FeeLine = {
    tracking: string;
    order_no: string;
    ship_fee_rmb: number;
    op_fee_rmb: number;
    expected_ship_fee?: number | null;
    period?: string;
    rate_rmb_vnd?: number | null;
};

// ─────────────────────────────────────────────────────────────────────────
// Kiểu dữ liệu ra
// ─────────────────────────────────────────────────────────────────────────
export type Light = "xanh" | "vang" | "do" | "xam";

export type Tick = {
    doi_soat: boolean;
    tru_van_chuyen: boolean;
    tru_tien_hang: boolean;
};

export type LedgerRow = {
    // định danh
    order_no: string;
    tracking: string;
    track17_code: string;
    return_order_no: string;
    // thời gian
    order_date: string;
    ship_date: string;
    age_days: number | null;
    /** Số kỳ sao kê đã chốt SAU ngày đơn này giao. >= 2 mà chưa có tiền là quá hạn. */
    ky_da_qua: number;
    // hàng & khách
    ship_method: string;
    sku: string;
    product_codes: string[];
    quantity: number;
    contact_name: string;
    phone: string;
    marketer: string;
    // trạng thái
    status: string;
    status_raw: string;
    recon_manual: string;
    // tiền vào
    cod_twd: number;
    paid_twd: number | null;
    paid_date: string;
    paid_period: string;
    matched_by: "tracking" | "order_id_giao_lai" | null;
    diff_twd: number | null;
    // tiền ra
    ship_fee_rmb: number | null;
    op_fee_rmb: number | null;
    fee_wrong: boolean;
    cogs_vnd: number | null;
    cogs_missing: string[];        // mã sản phẩm chưa khai giá vốn
    // kết quả
    gross_vnd: number | null;      // tiền 3PL trả, quy ra VND
    fee_vnd: number | null;
    net_vnd: number | null;
    /** true khi CHƯA trừ được giá vốn — con số "còn lại" mới là tạm. */
    net_before_cogs: boolean;
    // ô tích & đèn
    tick: Tick;
    light: Light;
    light_note: string;
};

// ─────────────────────────────────────────────────────────────────────────
// Ghép
// ─────────────────────────────────────────────────────────────────────────

/**
 * Ghép bốn nguồn thành sổ đơn hàng.
 *
 * KHOÁ BA TẦNG, thứ tự không đảo được: mã gốc của đơn giao lại, rồi mã vận đơn,
 * rồi mã đơn — vì đơn GIAO LẠI đổi mã vận đơn nhưng giữ mã đơn. Bỏ tầng mã đơn
 * là 6 đơn thật bị báo nhầm thành mất tiền; thiếu tầng mã gốc là T1467 bị báo
 * thiếu 650 NT$ trong khi đã về đủ.
 */
export function buildLedger(
    orders: OrderSource[],
    paid: PaidLine[],
    fees: FeeLine[],
    opts: { asOf?: string; overdueDays?: number; periodDates?: string[] } = {},
): { rows: LedgerRow[]; extra: PaidLine[] } {
    const overdue = Number(opts.overdueDays ?? OVERDUE_DAYS);

    // NGÀY CHỐT CỦA TỪNG KỲ SAO KÊ, sắp tăng dần.
    //
    // "Quá hạn" đếm theo SỐ KỲ ĐÃ TRÔI QUA, không đếm ngày — đây là luật Sỹ Anh
    // chốt: "đơn đã giao mà qua hai kỳ sao kê liền vẫn không thấy". Đếm ngày là
    // sai bản chất: NAZA trả theo kỳ chứ không trả theo ngày, nên một đơn giao
    // sát trước kỳ và một đơn giao ngay sau kỳ có cùng số ngày chờ nhưng khác
    // hẳn nhau về mức đáng lo.
    const periodEnds = (opts.periodDates || []).filter(Boolean).sort();

    const paidByTrack = new Map<string, PaidLine>();
    const paidByOrder = new Map<string, PaidLine>();
    const paidByMaGoc = new Map<string, PaidLine>();
    for (const p of paid) {
        const t = trackKey(p.tracking);
        if (t && !paidByTrack.has(t)) paidByTrack.set(t, p);
        const o = orderKey(p.order_no);
        if (o && !paidByOrder.has(o)) paidByOrder.set(o, p);
        const g = maGocNaza(p.order_no);
        if (g && !paidByMaGoc.has(g)) paidByMaGoc.set(g, p);
    }
    const feeByTrack = new Map<string, FeeLine>();
    const feeByOrder = new Map<string, FeeLine>();
    const feeByMaGoc = new Map<string, FeeLine>();
    for (const f of fees) {
        const t = trackKey(f.tracking);
        if (t && !feeByTrack.has(t)) feeByTrack.set(t, f);
        const o = orderKey(f.order_no);
        if (o && !feeByOrder.has(o)) feeByOrder.set(o, f);
        const g = maGocNaza(f.order_no);
        if (g && !feeByMaGoc.has(g)) feeByMaGoc.set(g, f);
    }

    const tks = orders.map((o) => trackKey(o.tracking));
    const oks = orders.map((o) => orderKey(o.order_no));
    // Mã vận đơn mà nhiều đơn trong sổ cùng mang — Sheet gõ nhầm mã của đơn bên
    // cạnh. Với những mã này, mã vận đơn một mình không nói được tiền của đơn nào.
    const soDonMang = new Map<string, number>();
    for (const t of tks) if (t) soDonMang.set(t, (soDonMang.get(t) || 0) + 1);
    const maChung = (t: string) => (soDonMang.get(t) || 0) > 1;

    // GHÉP BA LƯỢT, không phải một vòng lặp.
    //
    // Lượt 0 ghép ĐƠN GIAO LẠI bằng mã gốc, trước cả mã vận đơn: T1467 mang mã
    // vận đơn của T1465 nên lượt mã vận đơn ăn nhầm 749 NT$ của T1465 rồi báo
    // "thiếu 650", trong khi 1.399 của chính nó nằm ở "3PL trả cho đơn mình không có".
    //
    // Lượt 1 nhận hết các cặp khớp bằng MÃ VẬN ĐƠN. Lượt 2 mới lấy phần còn dư
    // để khớp bằng mã đơn.
    //
    // Làm một lượt thì thứ tự dòng quyết định kết quả: một đơn đứng trước khớp
    // được bằng mã đơn sẽ CƯỚP mất khoản thanh toán mà đơn đứng sau lẽ ra khớp
    // đúng bằng mã vận đơn — và mã vận đơn mới là khoá chắc chắn. Kết quả là
    // hai đơn cùng sai một lúc, mà không có dấu hiệu nào.
    const claimed = new Set<PaidLine>();
    const matched = new Map<number, { line: PaidLine; how: LedgerRow["matched_by"] }>();

    orders.forEach((o, i) => {
        const g = maGocGiaoLai(o.order_no);
        const p = g ? paidByMaGoc.get(g) : undefined;
        if (p && !claimed.has(p)) { claimed.add(p); matched.set(i, { line: p, how: "order_id_giao_lai" }); }
    });
    orders.forEach((o, i) => {
        if (matched.has(i)) return;
        const p = tks[i] ? paidByTrack.get(tks[i]) : undefined;
        if (!p || claimed.has(p)) return;
        // Mã nhiều đơn cùng mang thì mã đơn NAZA ghi chỉ ra đơn nào đúng. Không
        // đơn nào trùng mã đơn thì giữ lối cũ: đơn đứng trước nhận.
        let j = i;
        if (maChung(tks[i])) {
            const k = orderKey(p.order_no);
            const dung = orders.findIndex((_, x) => !matched.has(x) && tks[x] === tks[i] && oks[x] === k);
            if (dung >= 0) j = dung;
        }
        claimed.add(p); matched.set(j, { line: p, how: "tracking" });
    });
    orders.forEach((o, i) => {
        if (matched.has(i)) return;
        const k = oks[i];
        const p = k ? paidByOrder.get(k) : undefined;
        if (p && !claimed.has(p)) { claimed.add(p); matched.set(i, { line: p, how: "order_id_giao_lai" }); }
    });

    const rows: LedgerRow[] = [];

    orders.forEach((o, idx) => {
        const tk = tks[idx];
        const ok = oks[idx];

        // ── tiền vào ───────────────────────────────────────────────────
        const m = matched.get(idx);
        const hit = m?.line;
        const how: LedgerRow["matched_by"] = m?.how ?? null;

        // ── tiền ra ────────────────────────────────────────────────────
        // Cùng thứ tự như tiền vào: đơn giao lại tìm theo mã gốc trước. Mã vận
        // đơn nhiều đơn cùng mang thì dòng phí phải đúng mã đơn mới nhận — không
        // thì một khoản phí bị cộng cho cả hai đơn.
        const g = maGocGiaoLai(o.order_no);
        const feeTk = tk ? feeByTrack.get(tk) : undefined;
        const fee = (g ? feeByMaGoc.get(g) : undefined)
            || (feeTk && (!maChung(tk) || orderKey(feeTk.order_no) === ok) ? feeTk : undefined)
            || (ok ? feeByOrder.get(ok) : undefined);

        // ── quy đổi ────────────────────────────────────────────────────
        // Tính tỷ giá TRƯỚC giá vốn: giá vốn ghi bằng tệ nên cũng cần tỷ giá,
        // và phải là ĐÚNG tỷ giá của kỳ đã trả tiền cho đơn này.
        const rTwdRmb = hit?.rate_twd_rmb ?? null;
        const rRmbVnd = hit?.rate_rmb_vnd ?? fee?.rate_rmb_vnd ?? null;

        // ── giá vốn ────────────────────────────────────────────────────
        const codes = productCodes(o.sku);
        const qty = Math.max(1, Number(o.quantity) || 1);
        const missing: string[] = [];
        let cogs: number | null = 0;
        for (const c of codes) {
            const cost = unitCostVnd(c, rRmbVnd);
            if (cost !== null) cogs = (cogs ?? 0) + cost * qty;
            else missing.push(c);
        }
        // Thiếu bất kỳ mã nào là KHÔNG tính giá vốn cả đơn. Cộng nửa vời ra con
        // số thấp hơn thật, mà thấp hơn thật thì lãi trông đẹp hơn thật — sai
        // theo hướng nguy hiểm nhất.
        if (!codes.length || missing.length) cogs = null;

        const twdToVnd = (twd: number): number =>
            rTwdRmb && rRmbVnd ? twd * rTwdRmb * rRmbVnd : twd * FALLBACK_TWD_VND;

        const gross = hit ? twdToVnd(hit.amount_twd) : null;
        const feeRmb = fee ? fee.ship_fee_rmb + fee.op_fee_rmb : null;
        const feeVnd = feeRmb === null ? null : feeRmb * (rRmbVnd ?? FALLBACK_RMB_VND);

        let net: number | null = null;
        if (gross !== null) net = gross - (feeVnd ?? 0) - (cogs ?? 0);

        // ── ô tích ─────────────────────────────────────────────────────
        const tick: Tick = {
            doi_soat: !!hit,
            tru_van_chuyen: fee !== undefined,
            tru_tien_hang: cogs !== null,
        };

        // ── đèn ────────────────────────────────────────────────────────
        const age = daysBetween(o.order_date || o.ship_date, opts.asOf);
        // Bao nhiêu kỳ sao kê đã chốt SAU khi đơn này giao xong.
        const dGiao = o.ship_date || o.order_date || "";
        const kyDaQua = dGiao ? periodEnds.filter((d) => d > dGiao).length : 0;
        const diff = hit ? hit.amount_twd - o.cod_twd : null;
        const delivered = o.status === "Delivered";
        // Ba đường chết: hoàn về kho, huỷ đơn, và hàng hoàn quá 30 ngày bị tiêu huỷ.
        const dead = o.status === "Returned" || o.status === "Cancelled" || o.status === "Destroyed";

        let light: Light = "xam";
        let note = "Chưa giao xong — 3PL chưa có lý do trả tiền.";
        if (dead) {
            light = "xam";
            note = o.status === "Returned" ? "Hàng đã hoàn về kho."
                : o.status === "Destroyed" ? "Hàng hoàn quá 30 ngày, 3PL đã tiêu huỷ — tiền không về nữa."
                    : "Đơn đã huỷ.";
        } else if (hit && diff !== null && Math.abs(diff) > TOLERANCE_TWD) {
            light = "do";
            note = `Lệch ${diff > 0 ? "+" : ""}${Math.round(diff)} TWD so với số ghi trên đơn.`;
        } else if (hit) {
            light = "xanh";
            note = tick.tru_tien_hang
                ? "Xong sạch — tiền đã về, đã trừ phí và giá vốn."
                : "Tiền đã về và khớp. Chưa trừ được giá vốn vì thiếu khai giá.";
        } else if (delivered && kyDaQua >= 2) {
            light = "do";
            note = `Đã qua ${kyDaQua} kỳ sao kê mà đơn này vẫn chưa được trả tiền — phải đòi.`;
        } else if (delivered && !periodEnds.length && age !== null && age > overdue) {
            // Chưa tải bản sao kê nào thì không đếm kỳ được — lùi về đếm ngày.
            light = "do";
            note = `Đã giao ${age} ngày mà tiền chưa về. (Chưa có sao kê nào để đếm kỳ.)`;
        } else if (delivered) {
            light = "vang";
            note = kyDaQua === 1
                ? "Đã qua 1 kỳ sao kê chưa thấy — theo dõi, kỳ sau chưa có thì đòi."
                : "Đã giao, tiền chưa về — còn trong nhịp thanh toán bình thường.";
        }

        rows.push({
            order_no: o.order_no,
            tracking: o.tracking,
            track17_code: o.track17_code || "",
            return_order_no: o.return_order_no || "",
            order_date: o.order_date || "",
            ship_date: o.ship_date || "",
            age_days: age,
            ky_da_qua: kyDaQua,
            ship_method: o.ship_method || "",
            sku: o.sku || "",
            product_codes: codes,
            quantity: qty,
            contact_name: o.contact_name || "",
            phone: o.phone || "",
            marketer: canonMarketer(o.marketer),
            status: o.status || "",
            status_raw: o.status_raw || "",
            recon_manual: o.recon_manual || "",
            cod_twd: o.cod_twd,
            paid_twd: hit ? hit.amount_twd : null,
            paid_date: hit?.paid_date || "",
            paid_period: hit?.period || "",
            matched_by: how,
            diff_twd: diff,
            ship_fee_rmb: fee ? fee.ship_fee_rmb : null,
            op_fee_rmb: fee ? fee.op_fee_rmb : null,
            fee_wrong: !!fee && fee.expected_ship_fee != null
                && Math.abs(fee.ship_fee_rmb - fee.expected_ship_fee) > 0.01,
            cogs_vnd: cogs,
            cogs_missing: missing,
            gross_vnd: gross,
            fee_vnd: feeVnd,
            net_vnd: net,
            net_before_cogs: net !== null && cogs === null,
            tick,
            light,
            light_note: note,
        });
    });

    // Dòng sao kê không ghép được vào đơn nào = 3PL trả cho đơn mình không có.
    const extra = paid.filter((p) => !claimed.has(p));
    return { rows, extra };
}

// ─────────────────────────────────────────────────────────────────────────
// Tổng hợp
// ─────────────────────────────────────────────────────────────────────────
export type LedgerSummary = {
    total: number;
    by_light: Record<Light, number>;
    cod_total_twd: number;
    paid_total_twd: number;
    pending_twd: number;        // đã giao, tiền chưa về
    overdue_twd: number;
    fee_total_rmb: number;
    cogs_known: number;         // số đơn tính được giá vốn
    cogs_missing_orders: number;
    net_total_vnd: number;      // chỉ cộng đơn tính đủ (đã trừ giá vốn)
    net_partial_vnd: number;    // đơn mới trừ được phí, chưa trừ giá vốn
    extra_lines: number;
};

export function summarise(rows: LedgerRow[], extra: PaidLine[] = []): LedgerSummary {
    const by_light: Record<Light, number> = { xanh: 0, vang: 0, do: 0, xam: 0 };
    let cod = 0, paid = 0, pending = 0, over = 0, fee = 0;
    let cogsKnown = 0, cogsMiss = 0, net = 0, netPartial = 0;

    for (const r of rows) {
        by_light[r.light]++;
        cod += r.cod_twd;
        if (r.paid_twd !== null) paid += r.paid_twd;
        if (r.light === "vang") pending += r.cod_twd;
        if (r.light === "do" && r.paid_twd === null) { pending += r.cod_twd; over += r.cod_twd; }
        fee += (r.ship_fee_rmb ?? 0) + (r.op_fee_rmb ?? 0);
        if (r.cogs_vnd !== null) cogsKnown++; else cogsMiss++;
        if (r.net_vnd !== null) {
            if (r.net_before_cogs) netPartial += r.net_vnd;
            else net += r.net_vnd;
        }
    }

    return {
        total: rows.length,
        by_light,
        cod_total_twd: cod,
        paid_total_twd: paid,
        pending_twd: pending,
        overdue_twd: over,
        fee_total_rmb: fee,
        cogs_known: cogsKnown,
        cogs_missing_orders: cogsMiss,
        net_total_vnd: net,
        net_partial_vnd: netPartial,
        extra_lines: extra.length,
    };
}
