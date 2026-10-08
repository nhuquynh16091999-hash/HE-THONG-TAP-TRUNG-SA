/**
 * SAO KÊ COD CÁC NƯỚC NGOÀI ĐÀI (Singapore, UAE…) — bước 2 của đối soát COD nước khác.
 *
 * 08/10/2026 Sỹ Anh yêu cầu màn Tiền COD về của Singapore, UAE có chỗ tải sao kê như Đài. Lúc
 * đó CHƯA có file mẫu của nước nào, nên bộ đọc nhận hai kiểu:
 *
 *   • SAO KÊ NAZA (.xlsx ba sheet) — NAZA giao Singapore. Kỳ gộp 24/09/2026 cho thấy đơn Sing ghi
 *     国家名称 = 新加坡, kênh 'S新加坡CODJT专线', mã vận đơn JT…; đọc bằng chính parseNazaStatement
 *     của Đài, chỉ lấy dòng của nước đang mở. Có sheet TỔNG thì lấy luôn số "phải nhận" VND.
 *   • BẢNG BẤT KỲ (.xlsx / .csv) có cột mã vận đơn (hoặc mã đơn) và cột tiền COD — dò tên cột
 *     theo danh sách COT dưới đây; đối tác đặt tên lạ thì khai thêm ở
 *     talpha_rules.json → cod_settlement.column_map (cùng khoá tracking / order_id / amount…).
 *
 * Kho riêng từng nước (cod_statements_sg, cod_statements_ae…) — KHÔNG đụng kho Đài: kho Đài đọc
 * tiền như TWD và coi "cùng ngày trên tên file là cùng kỳ", file nước khác vào đó là đè mất kỳ Đài.
 *
 * Hàm thuần — không đọc file, không gọi mạng — để test được.
 */
import { RULES } from "./rules";
import { reconcile, parseAmount, parseDelimited, type PosOrder, type StatementRow } from "./cod-recon";
import { laFileSing, matchChannel, normTracking, toIsoDate, type NazaStatement } from "./naza-statement";
import type { DonCod } from "./cod-market";

// ─────────────────────────────────────────────────────────────────────────
// Dò cột của bảng sao kê
// ─────────────────────────────────────────────────────────────────────────

/** Tên cột: bỏ dấu, chữ thường, ký tự lạ thành dấu cách — giữ chữ Hán (转单号…). */
export function chuanTenCot(s: string): string {
    return String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
        .replace(/đ/g, "d").replace(/[^a-z0-9㐀-鿿]+/g, " ").trim();
}

type Truong = "tracking" | "order_id" | "amount" | "fee" | "paid_date" | "status";
const THU_TU: Truong[] = ["tracking", "order_id", "amount", "fee", "paid_date", "status"];

/** Tên cột hay gặp ở sao kê COD (Anh · Việt · Trung). Viết sẵn ở dạng chuanTenCot. */
const COT: Record<Truong, string[]> = {
    tracking: ["tracking", "tracking no", "tracking number", "tracking id", "tracking code", "awb", "awb no",
        "awb number", "hawb", "waybill", "waybill no", "waybill number", "airway bill", "shipment no",
        "shipment number", "consignment no", "consignment number", "ma van don", "van don", "mvd", "ma tracking",
        "转单号", "运单号", "跟踪号", "物流单号"],
    order_id: ["order id", "order no", "order number", "order code", "order", "ma don", "ma don hang",
        "ma don he thong", "ma don khach hang", "reference", "reference no", "ref", "ref no",
        "customer reference", "原单号", "客户单号", "客户的订单号", "订单号"],
    amount: ["cod", "cod amount", "cod value", "cod collected", "collected", "collected amount", "collect amount",
        "amount collected", "total cod", "amount", "tien cod", "so tien", "thu ho", "tien thu ho",
        "cod金额", "代收金额", "代收货款", "回款金额"],
    fee: ["fee", "fees", "shipping fee", "delivery fee", "cod fee", "service fee", "phi", "phi ship",
        "phi van chuyen", "运费"],
    paid_date: ["date", "delivered date", "delivery date", "delivered at", "remit date", "remittance date",
        "payment date", "paid date", "ngay", "ngay giao", "收货日期", "签收日期", "日期"],
    status: ["status", "trang thai", "状态"],
};

const COT_THEM: Record<string, string[]> =
    (RULES as unknown as { cod_settlement?: { column_map?: Record<string, string[]> } }).cod_settlement?.column_map || {};

const tenCot = (f: Truong) => [...(COT_THEM[f] || []).map(chuanTenCot), ...COT[f]].filter(Boolean);
const coHan = (s: string) => /[㐀-鿿]/.test(s);
/** Cột phí cũng hay có chữ "cod" ("COD fee") — đừng để nó thành cột tiền COD. */
const LA_PHI = /\b(fee|fees|phi|charge|charges)\b|运费|手续费/;

export type CotSaoKe = Partial<Record<Truong, number>>;

/**
 * Cột nào là cột gì. Hai lượt: khớp NGUYÊN tên trước (chắc nhất), rồi mới tới tên cột BẮT ĐẦU
 * bằng tên quen ("Tracking No." · "转单号 Mã vận đơn" — NAZA ghi hai thứ tiếng trong một ô).
 * Mỗi cột chỉ được nhận một nghĩa.
 */
export function timCotSaoKe(header: string[]): CotSaoKe {
    const h = header.map(chuanTenCot);
    const out: CotSaoKe = {};
    const daLay = new Set<number>();
    const nhan = (f: Truong, i: number) => { if (i >= 0) { out[f] = i; daLay.add(i); } };
    for (const f of THU_TU) {
        const ten = tenCot(f);
        nhan(f, h.findIndex((x, i) => !daLay.has(i) && x && ten.includes(x)));
    }
    for (const f of THU_TU) {
        if (out[f] !== undefined) continue;
        const ten = tenCot(f);
        nhan(f, h.findIndex((x, i) => {
            if (daLay.has(i) || !x) return false;
            if (f === "amount" && LA_PHI.test(x)) return false;
            return ten.some((t) => coHan(t) ? x.includes(t) : x === t || x.startsWith(`${t} `));
        }));
    }
    return out;
}

/**
 * Tiền SGD / AED có số lẻ, và file kiểu châu Âu ghi "45,90". parseAmount (của Đài — tiền TWD
 * nguyên, dấu phẩy luôn là ngăn nghìn) đọc thành 4.590. Nên: MỘT dấu phẩy, sau nó 1–2 chữ số,
 * không có dấu chấm → phẩy thập phân. "1,399" (3 chữ số sau phẩy) vẫn là ngăn nghìn.
 */
export function soTienSaoKe(raw: string): number {
    const s = String(raw ?? "").trim();
    const so = s.replace(/[^\d.,()-]/g, "");
    return parseAmount(/^\(?-?\d+,\d{1,2}\)?$/.test(so) ? s.replace(",", ".") : s);
}

const DONG_TONG = /^(total|tong|tong cong|grand total|sum|合计|总计|小计)\b/i;

/**
 * Một bảng (CSV đã tách, hoặc một sheet .xlsx) → dòng sao kê. Dòng tiêu đề có thể nằm dưới vài
 * dòng tên công ty / ngày — dò 12 dòng đầu, lấy dòng đầu tiên có cột mã (vận đơn hoặc đơn) VÀ
 * cột tiền. Bỏ dòng "Tổng".
 */
export function docBangSaoKe(table: string[][]): { rows: StatementRow[]; cot: CotSaoKe; header: string[] } | null {
    for (let r = 0; r < Math.min(12, table.length); r++) {
        const header = (table[r] || []).map((c) => String(c ?? "").trim());
        const cot = timCotSaoKe(header);
        if ((cot.tracking === undefined && cot.order_id === undefined) || cot.amount === undefined) continue;
        const o = (row: string[], i?: number) => (i === undefined ? "" : String(row[i] ?? "").trim());
        const rows: StatementRow[] = [];
        for (const row of table.slice(r + 1)) {
            const tracking = o(row, cot.tracking), order_id = o(row, cot.order_id);
            if (!tracking && !order_id) continue;
            if (DONG_TONG.test(chuanTenCot(tracking || order_id))) continue;
            const ngay = o(row, cot.paid_date);
            rows.push({
                tracking, order_id,
                amount: soTienSaoKe(o(row, cot.amount)),
                fee: soTienSaoKe(o(row, cot.fee)),
                paid_date: toIsoDate(ngay) || ngay,
                status: o(row, cot.status),
            });
        }
        return { rows, cot, header };
    }
    return null;
}

/** File .csv / .tsv / .txt → dòng sao kê. */
export function docCsvSaoKe(text: string) {
    return docBangSaoKe(parseDelimited(text));
}

/** Nhiều sheet .xlsx → lấy sheet đọc được NHIỀU dòng nhất (sheet tóm tắt thường ít dòng). */
export function chonSheetSaoKe(sheets: { name: string; rows: string[][] }[]) {
    let best: (ReturnType<typeof docBangSaoKe> & { sheet: string }) | null = null;
    for (const s of sheets) {
        const d = docBangSaoKe(s.rows);
        if (d && d.rows.length && (!best || d.rows.length > best.rows.length)) best = { ...d, sheet: s.name };
    }
    return best;
}

// ─────────────────────────────────────────────────────────────────────────
// Sao kê kiểu NAZA — chỉ lấy dòng của nước đang mở
// ─────────────────────────────────────────────────────────────────────────

const TEN_DAI = /TAIWAN|ĐÀI LOAN|台湾/;
/** Dòng có dấu hiệu Đài: kênh 'STWCOD专线-711', hoặc kênh có trong bảng giá Đài. */
const dongDai = (channel: string) => /台湾|STW|TAIWAN/i.test(channel) || matchChannel(channel) !== null;

export type NazaNuoc = {
    cod_local: number | null;       // 本期回款金额 — tiền nước đó
    ty_gia_rmb: number | null;      // tiền nước → tệ
    ty_gia_vnd: number | null;      // tệ → VND
    phi_rmb: number | null;         // phí ship + thao tác NAZA trừ
    phai_nhan_vnd: number | null;   // 本期应退金额VND
    sheets: NazaStatement["sheets"];
};

/**
 * Sao kê NAZA tải ở màn một nước ngoài Đài → dòng COD của nước đó, hoặc lỗi nói rõ phải tải ở đâu.
 *   • Singapore: lấy dòng 国家名称 = 新加坡. File Sing mà từng dòng không ghi nước thì tin tên file.
 *   • Nước khác: NAZA không giao — file có dòng Đài hay Sing là tải nhầm màn.
 */
export function chonDongNaza(naza: NazaStatement, code: string, filename: string):
    { rows: StatementRow[]; bo_qua: number; tong: NazaNuoc } | { loi: string } {
    const lines = naza.cod_lines;
    const sg = lines.filter((l) => l.market === "SG");
    const ten = filename.normalize("NFC").toUpperCase();
    let chon = lines;
    if (code === "SG") {
        if (sg.length) chon = sg;
        else if (lines.length && (laFileSing(filename, null) && !TEN_DAI.test(ten))) chon = lines;
        else return { loi: "File này là sao kê ĐÀI LOAN (không có dòng COD nào của Singapore). Bấm nút Đài Loan rồi tải lại ở đó." };
    } else {
        if (sg.length) return { loi: "File này là sao kê SINGAPORE. Bấm nút Singapore rồi tải lại ở đó." };
        if (TEN_DAI.test(ten) || (lines.length && lines.filter((l) => dongDai(l.channel)).length * 2 >= lines.length)) {
            return { loi: "File này là sao kê ĐÀI LOAN. Bấm nút Đài Loan rồi tải lại ở đó." };
        }
    }
    const s = naza.summary;
    const phi = s.ship_fee_rmb == null && s.op_fee_rmb == null ? null
        : Math.abs(s.ship_fee_rmb ?? 0) + Math.abs(s.op_fee_rmb ?? 0);
    return {
        rows: chon.map((l) => ({
            tracking: l.tracking, order_id: l.order_id, amount: l.cod_twd,
            fee: 0, paid_date: l.recv_date || "", status: "paid",
        })),
        bo_qua: lines.length - chon.length,
        tong: {
            // File gộp (có cả dòng nước khác) thì số ở sheet TỔNG không riêng của nước này.
            cod_local: chon.length === lines.length ? s.cod_twd ?? null : null,
            ty_gia_rmb: s.rate_twd_rmb ?? null,
            ty_gia_vnd: s.rate_rmb_vnd ?? null,
            phi_rmb: chon.length === lines.length ? phi : null,
            phai_nhan_vnd: chon.length === lines.length ? s.payable_vnd ?? null : null,
            sheets: naza.sheets,
        },
    };
}

// ─────────────────────────────────────────────────────────────────────────
// Kho sao kê một nước
// ─────────────────────────────────────────────────────────────────────────

export type SaoKeNuoc = {
    id: string;
    filename: string;
    uploaded_at: string;
    kieu: "naza" | "bang";
    /** Ngày của kỳ: theo tên file, không có thì ngày trả muộn nhất trong file. */
    ngay: string | null;
    rows: StatementRow[];
    /** Tên cột đã nhận ra (kiểu bảng) — để người dùng soát máy đọc đúng cột chưa. */
    cot?: Partial<Record<Truong, string>>;
    naza?: NazaNuoc;
    canh_bao: string[];
};

export const tenKhoSaoKe = (code: string) => `cod_statements_${code.toLowerCase().replace(/[^a-z0-9]/g, "")}`;

const tenFile = (s: string) => s.normalize("NFC").trim().toLowerCase();
const khoaDong = (r: StatementRow) => normTracking(r.tracking) || `#${String(r.order_id).trim().toUpperCase()}`;

/**
 * Tải lại CÙNG MỘT KỲ thì THAY, không cộng thêm — một đơn chỉ được trả một lần, để hai bản
 * cùng kỳ nằm cạnh nhau là mọi dòng bị đếm hai lượt (bài học kho Đài 13/09/2026).
 *
 * Cùng kỳ = cùng tên file, HOẶC trùng từ một nửa số đơn trở lên (bản sửa thường đổi tên file).
 * Không dùng luật "cùng ngày trên tên file" như Đài: chưa biết đối tác các nước gửi mấy file một
 * ngày, mà thay nhầm là mất cả một kỳ.
 */
export function thayKyCu(list: SaoKeNuoc[], moi: SaoKeNuoc): { list: SaoKeNuoc[]; thay: string[] } {
    const keyMoi = new Set(moi.rows.map(khoaDong));
    const thay: string[] = [];
    const giu = list.filter((s) => {
        if (tenFile(s.filename) === tenFile(moi.filename)) { thay.push(s.filename); return false; }
        const ks = new Set(s.rows.map(khoaDong));
        let chung = 0;
        for (const k of ks) if (keyMoi.has(k)) chung++;
        const it = Math.min(ks.size, keyMoi.size);
        if (it > 0 && chung * 2 >= it) { thay.push(s.filename); return false; }
        return true;
    });
    return { list: [...giu, moi].slice(-30), thay };
}

export function ngayKy(filename: string, rows: StatementRow[], ngayTen: (f: string) => string | null): string | null {
    const theoTen = ngayTen(filename);
    if (theoTen) return theoTen;
    const ngay = rows.map((r) => r.paid_date).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
    return ngay.length ? ngay[ngay.length - 1] : null;
}

// ─────────────────────────────────────────────────────────────────────────
// Khớp sao kê với đơn của nước đó
// ─────────────────────────────────────────────────────────────────────────

export type KyNuoc = {
    id: string; filename: string; uploaded_at: string; kieu: SaoKeNuoc["kieu"]; ngay: string | null;
    so_dong: number; cod_local: number;
    phai_nhan_vnd: number | null;   // theo sao kê (NAZA có sheet TỔNG)
    uoc_vnd: number | null;         // không có thì ước = tiền COD × tỷ giá, CHƯA trừ phí
    khop: number; lech: number; khong_co_don: number;
    cot?: SaoKeNuoc["cot"]; canh_bao: string[];
};
export type DonDaTra = DonCod & { da_tra?: { ky: string; so_tien: number } };
export type KetQuaKhop = {
    ky: KyNuoc[];
    don: DonDaTra[];
    lech: { order_id: string; tracking: string; cod_don: number; tra: number; ky: string }[];
    khong_co_don: { order_id: string; tracking: string; so_tien: number; ky: string }[];
    tra_hai_lan: { order_id: string; tracking: string; ky: string[] }[];
    da_gui_ve: { vnd: number; co_uoc: boolean; cod_local: number; so_ky: number };
    da_tra: { so_don: number; cod_local: number };
};

/**
 * Khớp từng kỳ với MỌI đơn của nước đó (đã giao, chưa giao, cả hoàn/huỷ): trạng thái giao
 * thường chậm hơn tiền — đối tác đã trả mà bảng mình còn ghi "đang giao" thì vẫn phải nhận ra
 * là đã trả, không thì đơn đó bị đếm vào "chưa giao" lẫn "trả cho đơn mình không có".
 *
 * Khoá như Đài (reconcile): mã vận đơn trước, mã đơn sau. Mỗi kỳ khớp riêng nên một đơn được
 * hai kỳ trả là bắt được (tra_hai_lan).
 */
export function khopSaoKeNuoc(don: DonCod[], kho: SaoKeNuoc[], rateVnd: number): KetQuaKhop {
    const uid = (i: number) => `D${i}`;
    const pos: PosOrder[] = don.map((d, i) => ({
        order_uid: uid(i), order_id: d.order_id, tracking: d.tracking || null,
        order_date: d.order_date || "", status_category: d.nhom, status_name: d.trang_thai,
        cod_local: Number(d.cod_local) || 0, marketer: "", sale: "",
    }));
    const traO = new Map<string, { ky: string; so_tien: number }[]>();
    const out: KetQuaKhop = {
        ky: [], don: [], lech: [], khong_co_don: [], tra_hai_lan: [],
        da_gui_ve: { vnd: 0, co_uoc: false, cod_local: 0, so_ky: kho.length },
        da_tra: { so_don: 0, cod_local: 0 },
    };

    for (const s of kho) {
        const r = reconcile(pos, s.rows);
        let khop = 0, lech = 0, khong = 0;
        for (const l of r.lines) {
            if (l.verdict === "thua_o_sao_ke") {
                khong++;
                out.khong_co_don.push({ order_id: l.order_id, tracking: l.tracking, so_tien: l.stm_amount, ky: s.filename });
                continue;
            }
            if (l.verdict !== "khop" && l.verdict !== "lech_tien") continue;
            if (l.verdict === "khop") khop++;
            else {
                lech++;
                out.lech.push({ order_id: l.order_id, tracking: l.tracking, cod_don: l.pos_amount, tra: l.stm_amount, ky: s.filename });
            }
            const k = l.order_uid!;
            traO.set(k, [...(traO.get(k) || []), { ky: s.filename, so_tien: l.stm_amount }]);
        }
        const cod = s.rows.reduce((t, x) => t + (Number(x.amount) || 0), 0);
        const phai = s.naza?.phai_nhan_vnd ?? null;
        const uoc = phai == null && rateVnd > 0 ? Math.round(cod * rateVnd) : null;
        out.ky.push({
            id: s.id, filename: s.filename, uploaded_at: s.uploaded_at, kieu: s.kieu, ngay: s.ngay,
            so_dong: s.rows.length, cod_local: Math.round(cod * 100) / 100,
            phai_nhan_vnd: phai, uoc_vnd: uoc,
            khop, lech, khong_co_don: khong, cot: s.cot, canh_bao: s.canh_bao || [],
        });
        out.da_gui_ve.cod_local += cod;
        if (phai != null) out.da_gui_ve.vnd += phai;
        else if (uoc != null) { out.da_gui_ve.vnd += uoc; out.da_gui_ve.co_uoc = true; }
    }
    out.da_gui_ve.cod_local = Math.round(out.da_gui_ve.cod_local * 100) / 100;

    out.don = don.map((d, i) => {
        const t = traO.get(uid(i));
        if (!t) return d;
        if (t.length > 1) out.tra_hai_lan.push({ order_id: d.order_id, tracking: d.tracking, ky: t.map((x) => x.ky) });
        out.da_tra.so_don++;
        out.da_tra.cod_local += Number(d.cod_local) || 0;
        return { ...d, da_tra: { ky: t[0].ky, so_tien: t.reduce((n, x) => n + x.so_tien, 0) } };
    });
    out.da_tra.cod_local = Math.round(out.da_tra.cod_local * 100) / 100;
    // Kỳ mới nhất lên đầu, như bảng các kỳ của Đài.
    out.ky.sort((a, b) => (b.ngay || b.uploaded_at).localeCompare(a.ngay || a.uploaded_at));
    return out;
}
