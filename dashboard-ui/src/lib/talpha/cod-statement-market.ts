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
    /** Tổng tiền COD (tiền nước đó) của các dòng đã chọn. */
    cod_local: number | null;
    ty_gia_rmb: number | null;      // tiền nước → tệ (mẫu Sing ghi theo từng đơn)
    ty_gia_vnd: number | null;      // tệ → VND
    /** Phí NAZA tính trên các đơn của nước này ở sheet PHÍ (ship + chặng đầu + đóng gói), tệ. */
    phi_rmb: number | null;
    /** Số đơn có dòng phí — kỳ chưa thu được COD vẫn có phí đơn đã gửi đi. */
    don_phi?: number;
    /** Tiền hàng NAZA trừ trong kỳ (新加坡本期采购费…), VND. */
    tien_hang_vnd?: number | null;
    phai_nhan_vnd: number | null;   // 本期应退金额VND — có thể ÂM (kỳ chỉ có phí)
    sheets: NazaStatement["sheets"];
};

/**
 * Sao kê NAZA tải ở màn một nước ngoài Đài → dòng COD của nước đó, hoặc lỗi nói rõ phải tải ở đâu.
 *   • Singapore: lấy dòng 国家名称 = 新加坡. File Sing mà từng dòng không ghi nước thì tin tên file.
 *     Kỳ CHƯA THU được COD nào (file chỉ có sheet TỔNG + PHÍ — thật: "ĐỐI SOÁT COD SINGAPORE
 *     2026.09.24", phải nhận −3.600.206đ) vẫn nhận: không có đơn để khớp, nhưng có phí + tiền hàng.
 *   • Nước khác: NAZA không giao — file có dòng Đài hay Sing là tải nhầm màn.
 *
 * Mẫu Sing (thật, kỳ 05/10/2026) KHÁC mẫu Đài ở sheet TỔNG: 本期回款金额 là TỆ sau phí thu hộ
 * (cột 回款金额（RMB) cộng lại), không phải tiền SGD. Đem so với tổng COD SGD là báo lệch giả.
 */
export function chonDongNaza(naza: NazaStatement, code: string, filename: string):
    { rows: StatementRow[]; bo_qua: number; tong: NazaNuoc; canh_bao: string[] } | { loi: string } {
    const lines = naza.cod_lines;
    const fees = naza.fee_lines || [];
    const sgCod = lines.filter((l) => l.market === "SG");
    const sgFee = fees.filter((l) => l.market === "SG");
    const ten = filename.normalize("NFC").toUpperCase();
    const tenSing = laFileSing(filename, null) && !TEN_DAI.test(ten);
    let chon = lines, phi = fees;
    if (code === "SG") {
        if (sgCod.length) { chon = sgCod; phi = sgFee; }
        else if (lines.length && tenSing) chon = lines;
        else if (!lines.length && (sgFee.length || tenSing)) { chon = []; phi = sgFee.length ? sgFee : fees; }
        else return { loi: "File này là sao kê ĐÀI LOAN (không có dòng COD nào của Singapore). Bấm nút Đài Loan rồi tải lại ở đó." };
    } else {
        if (sgCod.length || sgFee.length) return { loi: "File này là sao kê SINGAPORE. Bấm nút Singapore rồi tải lại ở đó." };
        const dai = [...lines.map((l) => l.channel), ...fees.map((l) => l.channel)];
        if (TEN_DAI.test(ten) || (dai.length && dai.filter(dongDai).length * 2 >= dai.length)) {
            return { loi: "File này là sao kê ĐÀI LOAN. Bấm nút Đài Loan rồi tải lại ở đó." };
        }
    }
    // Số ở sheet TỔNG chỉ là của nước này khi cả file là của nước này (file gộp thì không).
    const caFile = chon.length === lines.length && phi.length === fees.length;
    const s = naza.summary;
    const so = (n: number) => (Math.round(n * 100) / 100).toLocaleString("vi-VN");
    const canh_bao: string[] = [];
    if (lines.length - chon.length) canh_bao.push(`Bỏ ${lines.length - chon.length} dòng COD của nước khác trong file.`);

    const cod = chon.reduce((t, l) => t + (Number(l.cod_twd) || 0), 0);
    const coVe = chon.some((l) => l.ve_rmb != null);
    if (caFile && s.cod_twd != null && chon.length) {
        // Mẫu Sing: so tiền về (tệ) từng đơn với sheet TỔNG. Mẫu Đài: so tiền COD.
        const chiTiet = coVe ? chon.reduce((t, l) => t + (Number(l.ve_rmb) || 0), 0) : cod;
        if (Math.abs(chiTiet - s.cod_twd) > 0.5) {
            canh_bao.push(`Chi tiết COD cộng ra ${so(chiTiet)}${coVe ? "¥" : ""} nhưng sheet TỔNG ghi ${so(s.cod_twd)}${coVe ? "¥" : ""} — hỏi lại bên giao hàng.`);
        }
    }
    const tyGia = chon.find((l) => l.ty_gia_rmb != null)?.ty_gia_rmb ?? null;
    return {
        rows: chon.map((l) => ({
            tracking: l.tracking, order_id: l.order_id, amount: l.cod_twd,
            fee: 0, paid_date: l.recv_date || "", status: "paid",
        })),
        bo_qua: lines.length - chon.length,
        canh_bao,
        tong: {
            cod_local: Math.round(cod * 100) / 100,
            // Tỷ giá ở sheet TỔNG của file Sing có lúc là số Đài chép sang (kỳ 24/09 ghi 0,2021) —
            // chỉ tin tỷ giá ghi trên từng đơn.
            ty_gia_rmb: code === "SG" ? tyGia : tyGia ?? s.rate_twd_rmb ?? null,
            ty_gia_vnd: s.rate_rmb_vnd ?? null,
            phi_rmb: Math.round(phi.reduce((t, l) => t + l.ship_fee + l.op_fee + (l.first_leg_fee ?? 0), 0) * 100) / 100,
            don_phi: phi.length,
            tien_hang_vnd: caFile ? (code === "SG" ? s.purchase_sg_vnd ?? s.purchase_vnd : s.purchase_vnd) ?? null : null,
            phai_nhan_vnd: caFile ? s.payable_vnd ?? null : null,
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
 * Cùng kỳ = cùng tên file, HOẶC trùng từ một nửa số đơn trở lên (bản sửa thường đổi tên file),
 * HOẶC hai file NAZA cùng ngày (NAZA gửi mỗi kỳ một file mỗi nước; kỳ chỉ có phí thì không có
 * đơn nào để so trùng). Bảng của đối tác khác thì KHÔNG dùng luật cùng ngày: chưa biết họ gửi
 * mấy file một ngày, mà thay nhầm là mất cả một kỳ.
 */
export function thayKyCu(list: SaoKeNuoc[], moi: SaoKeNuoc): { list: SaoKeNuoc[]; thay: string[] } {
    const keyMoi = new Set(moi.rows.map(khoaDong));
    const thay: string[] = [];
    const giu = list.filter((s) => {
        if (tenFile(s.filename) === tenFile(moi.filename)) { thay.push(s.filename); return false; }
        if (s.kieu === "naza" && moi.kieu === "naza" && s.ngay && s.ngay === moi.ngay) { thay.push(s.filename); return false; }
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
    phai_nhan_vnd: number | null;   // theo sao kê (NAZA có sheet TỔNG) — có thể ÂM
    uoc_vnd: number | null;         // không có thì ước = tiền COD × tỷ giá, CHƯA trừ phí
    /** Kỳ âm (chỉ có phí + tiền hàng) không cộng vào "đã gửi về": NAZA trừ khoản đó ở chỗ khác. */
    tinh_vao_da_gui: boolean;
    /** Kỳ âm đã được NAZA trừ thẳng vào tiền COD Đài cùng ngày (bản gộp, như 24/09/2026). */
    tru_vao_dai: string | null;
    phi_rmb: number | null; don_phi: number; tien_hang_vnd: number | null;
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
    da_gui_ve: { vnd: number; co_uoc: boolean; cod_local: number; so_ky: number; ky_am: number; am_vnd: number };
    da_tra: { so_don: number; cod_local: number };
};

/**
 * Khớp từng kỳ với MỌI đơn của nước đó (đã giao, chưa giao, cả hoàn/huỷ): trạng thái giao
 * thường chậm hơn tiền — đối tác đã trả mà bảng mình còn ghi "đang giao" thì vẫn phải nhận ra
 * là đã trả, không thì đơn đó bị đếm vào "chưa giao" lẫn "trả cho đơn mình không có".
 *
 * Khoá như Đài (reconcile): mã vận đơn trước, mã đơn sau. Mỗi kỳ khớp riêng nên một đơn được
 * hai kỳ trả là bắt được (tra_hai_lan).
 *
 * "Đã gửi về" cộng số phải nhận các kỳ DƯƠNG, như màn Đài (kỳ âm Đài cũng không cộng — NAZA
 * mang sang trừ kỳ sau, số kỳ sau đã trừ rồi). Kỳ âm Sing 24/09/2026 (−3.600.206đ) NAZA trừ thẳng
 * vào tiền COD Đài cùng ngày (bản gộp) — cộng ở đây nữa là trừ hai lần. `ngayGopDai` = các ngày
 * kỳ Đài có gộp phần Sing, để màn hình ghi rõ khoản âm đó đã trừ ở đâu.
 */
export function khopSaoKeNuoc(don: DonCod[], kho: SaoKeNuoc[], rateVnd: number, ngayGopDai: string[] = []): KetQuaKhop {
    const uid = (i: number) => `D${i}`;
    const pos: PosOrder[] = don.map((d, i) => ({
        order_uid: uid(i), order_id: d.order_id, tracking: d.tracking || null,
        order_date: d.order_date || "", status_category: d.nhom, status_name: d.trang_thai,
        cod_local: Number(d.cod_local) || 0, marketer: "", sale: "",
    }));
    const traO = new Map<string, { ky: string; so_tien: number }[]>();
    const out: KetQuaKhop = {
        ky: [], don: [], lech: [], khong_co_don: [], tra_hai_lan: [],
        da_gui_ve: { vnd: 0, co_uoc: false, cod_local: 0, so_ky: kho.length, ky_am: 0, am_vnd: 0 },
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
        const uoc = phai == null && rateVnd > 0 && cod > 0 ? Math.round(cod * rateVnd) : null;
        const am = phai != null && phai < 0;
        out.ky.push({
            id: s.id, filename: s.filename, uploaded_at: s.uploaded_at, kieu: s.kieu, ngay: s.ngay,
            so_dong: s.rows.length, cod_local: Math.round(cod * 100) / 100,
            phai_nhan_vnd: phai, uoc_vnd: uoc,
            tinh_vao_da_gui: !am,
            tru_vao_dai: am && s.ngay && ngayGopDai.includes(s.ngay) ? s.ngay : null,
            phi_rmb: s.naza?.phi_rmb ?? null, don_phi: s.naza?.don_phi ?? 0, tien_hang_vnd: s.naza?.tien_hang_vnd ?? null,
            khop, lech, khong_co_don: khong, cot: s.cot, canh_bao: s.canh_bao || [],
        });
        out.da_gui_ve.cod_local += cod;
        if (am) { out.da_gui_ve.ky_am++; out.da_gui_ve.am_vnd += phai; }
        else if (phai != null) out.da_gui_ve.vnd += phai;
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
