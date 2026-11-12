/**
 * ĐỐI SOÁT COD VIỆT NAM — đọc thẳng trang khách hàng J&T VIP (khachhang.jtexpress.vn).
 *
 * 13/11/2026 Sỹ Anh chọn "gọi API bằng token": J&T Việt Nam KHÔNG có cổng API công khai cho
 * đối soát; trang J&T VIP gọi API nội bộ `ylvipapi.jtexpress.vn/api/fcf/*` bằng header
 * `authToken` = localStorage.YL_TOKEN của phiên đăng nhập (JWT, sống chưa tới một ngày). Người
 * dùng dán token vào dashboard; máy chủ kéo số rồi CẤT LẠI, nên token hết hạn thì màn vẫn hiện
 * lần kéo cuối.
 *
 * API đã soi (POST JSON, chỉ cần authToken — token sai trả HTTP 401):
 *   queryFreightCheckForPage  {startCreateTime,endCreateTime,current,size} — các kỳ đối soát
 *   queryFreightCheckForDetail {reconciliationNumber,current,size}          — từng vận đơn của kỳ
 *   queryOngoingCodAmountDetail/codMoneyNum?current&size  {}               — đơn đang luân chuyển
 *   queryOngoingCodAmountSummary · queryLatestOverviewByCustomer           — tổng + số dư
 *
 * Một kỳ (J&T chốt mỗi ngày ~04h, trả tiền vài ngày một lần):
 *   tiền đối soát (payCurrentPayableAmount) = COD ký nhận − phí (cước + thu hộ + hoàn) ± điều chỉnh
 *   thực nhận (endingBalance)               = tiền đối soát + dư nợ kỳ trước (openingBalance)
 *   thực nhận ÂM thì không trả, mang sang làm dư nợ của kỳ sau.
 *   → tiền J&T đã chuyển về = Σ max(0, thực nhận) của các kỳ "FINISH_PAY".
 *
 * Mã đơn KH của J&T (customerOrderId) = mã đơn POS "S<shop>O<số đơn>" → nối thẳng với POS.
 */

export const JT_API = "https://ylvipapi.jtexpress.vn/api/fcf/";

export class JtHetHan extends Error {
    constructor() { super("Token J&T sai hoặc đã hết hạn"); }
}

// ─── Kiểu dữ liệu cất trong kho (data/jt_vn.json) ────────────────────────────────

export type JtDonKy = {
    van_don: string; ma_kh: string; order_id: string | null;
    gui_luc: string | null; ky_nhan_luc: string | null;
    cod: number; cuoc: number; phi_cod: number; phi_hoan: number; phi_giao_1_phan: number;
    dieu_chinh: number; rong: number; tinh: string;
};
export type JtKy = {
    ma: string; tao_luc: string; tra_luc: string | null; da_tra: boolean;
    cod: number; phi: number; dieu_chinh: number; du_no_truoc: number; doi_soat: number; thuc_nhan: number;
    /** null = chưa kéo được chi tiết kỳ này. */
    don: JtDonKy[] | null;
};
export type JtDangChay = {
    van_don: string; ma_kh: string; order_id: string | null; trang_thai: string;
    cod: number; cuoc: number; giao_luc: string | null;
};
export type JtDuLieu = {
    keo_luc: string;
    so_du: number | null; so_du_cap_nhat: string | null;
    dang_chay_tong: { so_don: number; cod: number; cuoc: number } | null;
    ky: JtKy[];
    dang_chay: JtDangChay[];
};

// ─── Hàm thuần ───────────────────────────────────────────────────────────────────

/** Giờ hết hạn của token (trường exp của JWT) — không đọc được thì null. */
export function hanToken(token: string): string | null {
    const p = String(token || "").trim().replace(/^"|"$/g, "").split(".");
    if (p.length !== 3) return null;
    try {
        const json = Buffer.from(p[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8");
        const exp = Number(JSON.parse(json).exp);
        return Number.isFinite(exp) && exp > 0 ? new Date(exp * 1000).toISOString() : null;
    } catch {
        return null;
    }
}

/** Token người dùng dán: bỏ nháy, khoảng trắng; nhận cả khi dán nguyên "authToken: xxx". */
export function lamSachToken(s: string): string {
    return String(s || "").replace(/^\s*authToken\s*[:=]\s*/i, "").trim().replace(/^["']|["']$/g, "").trim();
}

/** "S1329125435O159" → "159" (số đơn POS). */
export function orderIdTuMaKh(ma: string | null | undefined): string | null {
    const m = String(ma || "").match(/^S\d+O(\d+)$/i);
    return m ? m[1] : null;
}

const so = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const chu = (v: unknown) => (v == null ? "" : String(v));

/** Chữ trạng thái J&T trả bằng tiếng Trung → tiếng Việt (lạ thì giữ nguyên). */
const TRANG_THAI: Record<string, string> = {
    "运输中": "Đang vận chuyển", "派件中": "Đang giao", "已签收": "Đã ký nhận", "签收": "Đã ký nhận",
    "问题件": "Kiện có vấn đề", "退件登记": "Đăng ký hoàn", "退件确认": "Đã xác nhận hoàn",
    "退件中": "Đang hoàn", "退件签收": "Đã hoàn về", "已揽收": "Đã lấy hàng", "揽收": "Đã lấy hàng",
    "到件": "Đến bưu cục", "发件": "Rời bưu cục", "留仓": "Lưu kho", "未知状态": "Không rõ",
};
export const trangThaiJt = (s: string) => TRANG_THAI[s] || s || "—";

export function chuanKy(r: Record<string, unknown>): JtKy {
    return {
        ma: chu(r.reconciliationNumber),
        tao_luc: chu(r.createTime),
        tra_luc: r.payTime ? chu(r.payTime) : null,
        da_tra: chu(r.totalPayStatus) === "FINISH_PAY",
        cod: so(r.totalCodFee), phi: so(r.totalMonthFee), dieu_chinh: so(r.monthAdjustmentAmount),
        du_no_truoc: so(r.openingBalance), doi_soat: so(r.payCurrentPayableAmount), thuc_nhan: so(r.endingBalance),
        don: null,
    };
}

export function chuanDonKy(r: Record<string, unknown>): JtDonKy {
    const ma = chu(r.customerOrderId);
    return {
        van_don: chu(r.waybillNo), ma_kh: ma, order_id: orderIdTuMaKh(ma),
        gui_luc: r.sendTime ? chu(r.sendTime) : null, ky_nhan_luc: r.signTime ? chu(r.signTime) : null,
        cod: so(r.codAmount), cuoc: so(r.monthTaxAmount), phi_cod: so(r.monthCodAmount),
        phi_hoan: so(r.monthRefundAmount), phi_giao_1_phan: so(r.monthPartialSignFee),
        dieu_chinh: so(r.adjustmentAmount), rong: so(r.difference),
        tinh: [r.recipientProv, r.recipientCity].filter(Boolean).map(chu).join(", "),
    };
}

export function chuanDangChay(r: Record<string, unknown>): JtDangChay {
    const ma = chu(r.customerOrderId);
    return {
        van_don: chu(r.waybillNo), ma_kh: ma, order_id: orderIdTuMaKh(ma),
        trang_thai: trangThaiJt(chu(r.waybillStatusCode)),
        cod: so(r.codMoney), cuoc: so(r.taxAfterFee), giao_luc: r.deliveryTime ? chu(r.deliveryTime) : null,
    };
}

/** Đơn POS tối thiểu để đối chiếu (route đọc từ cùng nguồn với màn Theo dõi vận đơn). */
export type DonPosVn = {
    order_id: string; tracking: string; order_date: string | null; trang_thai: string;
    nhom: "da_giao" | "chua_giao" | "khong_tinh"; cod: number; khach: string;
};

export type SoJtVn = {
    tong: {
        da_ve: number; so_ky_da_tra: number; so_lan_chuyen: number; lan_tra_cuoi: string | null;
        cho_tra: number; so_ky_cho_tra: number;
        so_du: number | null;
        dang_chay: { so_don: number; cod: number; cuoc: number };
        cod_da_doi_soat: number; phi_da_tru: number; don_da_doi_soat: number;
        cuoc_tb: number | null; don_co_cuoc: number;
    };
    /** ngay / den: ngày đầu–cuối kỳ đọc từ mã kỳ ("…-20261106-1108" = 06→08/11). */
    ky: (JtKy & { so_don: number | null; ngay: string; den: string })[];
    dang_chay: JtDangChay[];
    doi_chieu: {
        /** POS báo đã giao nhưng chưa thấy ở kỳ nào, cũng không nằm trong "đang luân chuyển". */
        da_giao_chua_doi_soat: DonPosVn[];
        /** J&T trả COD khác số trên đơn POS. */
        lech_cod: { order_id: string; van_don: string; ky: string; cod_pos: number; cod_jt: number; khach: string }[];
        /** Vận đơn J&T có trong kỳ mà mã đơn không ra đơn POS nào. */
        khong_co_tren_pos: { van_don: string; ma_kh: string; ky: string; cod: number }[];
        so_don_pos: number;
    };
};

/** Ngày đầu–cuối của kỳ từ mã "238LC41894-20261106-1108"; mã lạ thì lấy ngày J&T tạo kỳ. */
export function ngayKy(k: Pick<JtKy, "ma" | "tao_luc">): { ngay: string; den: string } {
    const m = k.ma.match(/-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})$/);
    if (!m) return { ngay: k.tao_luc.slice(0, 10), den: k.tao_luc.slice(0, 10) };
    const ngay = `${m[1]}-${m[2]}-${m[3]}`;
    // Kỳ vắt qua năm mới: tháng cuối nhỏ hơn tháng đầu.
    const nam = Number(m[4]) < Number(m[2]) ? Number(m[1]) + 1 : Number(m[1]);
    return { ngay, den: `${nam}-${m[4]}-${m[5]}` };
}

/** Dựng số cho màn hình từ lần kéo J&T + đơn POS. Thuần — có phép thử. */
export function soJtVn(d: JtDuLieu, pos: DonPosVn[]): SoJtVn {
    const ky = [...d.ky].sort((a, b) => b.tao_luc.localeCompare(a.tao_luc) || b.ma.localeCompare(a.ma));
    const daTra = ky.filter((k) => k.da_tra);
    const choTra = ky.filter((k) => !k.da_tra);

    const posTheoId = new Map(pos.map((p) => [p.order_id, p]));
    const posTheoVd = new Map(pos.filter((p) => p.tracking).map((p) => [p.tracking, p]));
    const timPos = (orderId: string | null, vd: string) =>
        (orderId ? posTheoId.get(orderId) : undefined) || posTheoVd.get(vd);

    const daDoiSoat = new Set<string>();     // order_id hoặc mã vận đơn đã vào một kỳ
    const lech: SoJtVn["doi_chieu"]["lech_cod"] = [];
    const khongCo: SoJtVn["doi_chieu"]["khong_co_tren_pos"] = [];
    let codDs = 0, phiDs = 0, donDs = 0, cuocTong = 0, donCoCuoc = 0;
    for (const k of ky) {
        for (const x of k.don || []) {
            donDs++;
            codDs += x.cod;
            phiDs += x.cuoc + x.phi_cod + x.phi_hoan + x.phi_giao_1_phan;
            if (x.cuoc > 0) { cuocTong += x.cuoc; donCoCuoc++; }
            daDoiSoat.add(x.van_don);
            if (x.order_id) daDoiSoat.add(`#${x.order_id}`);
            const p = timPos(x.order_id, x.van_don);
            if (!p) { if (x.cod > 0 || x.cuoc > 0) khongCo.push({ van_don: x.van_don, ma_kh: x.ma_kh, ky: k.ma, cod: x.cod }); continue; }
            if (x.cod > 0 && Math.abs(x.cod - p.cod) >= 1) {
                lech.push({ order_id: p.order_id, van_don: x.van_don, ky: k.ma, cod_pos: p.cod, cod_jt: x.cod, khach: p.khach });
            }
        }
    }
    const dangChayKey = new Set<string>();
    for (const x of d.dang_chay) { dangChayKey.add(x.van_don); if (x.order_id) dangChayKey.add(`#${x.order_id}`); }
    const daGiaoChua = pos.filter((p) => p.nhom === "da_giao"
        && !daDoiSoat.has(`#${p.order_id}`) && !(p.tracking && daDoiSoat.has(p.tracking))
        && !dangChayKey.has(`#${p.order_id}`) && !(p.tracking && dangChayKey.has(p.tracking)));

    const dct = d.dang_chay_tong || {
        so_don: d.dang_chay.length,
        cod: d.dang_chay.reduce((a, x) => a + x.cod, 0),
        cuoc: d.dang_chay.reduce((a, x) => a + x.cuoc, 0),
    };
    return {
        tong: {
            da_ve: daTra.reduce((a, k) => a + Math.max(0, k.thuc_nhan), 0),
            so_ky_da_tra: daTra.length,
            so_lan_chuyen: daTra.filter((k) => k.thuc_nhan > 0).length,
            lan_tra_cuoi: daTra.map((k) => k.tra_luc).filter((x): x is string => !!x).sort().pop() || null,
            cho_tra: choTra.reduce((a, k) => a + Math.max(0, k.thuc_nhan), 0),
            so_ky_cho_tra: choTra.length,
            so_du: d.so_du,
            dang_chay: dct,
            cod_da_doi_soat: codDs, phi_da_tru: phiDs, don_da_doi_soat: donDs,
            cuoc_tb: donCoCuoc ? Math.round(cuocTong / donCoCuoc) : null, don_co_cuoc: donCoCuoc,
        },
        ky: ky.map((k) => ({ ...k, so_don: k.don ? k.don.length : null, ...ngayKy(k) })),
        dang_chay: d.dang_chay,
        doi_chieu: { da_giao_chua_doi_soat: daGiaoChua, lech_cod: lech, khong_co_tren_pos: khongCo, so_don_pos: pos.length },
    };
}

// ─── Gọi J&T ─────────────────────────────────────────────────────────────────────

type JtResp = { code?: number; msg?: string; data?: Record<string, unknown> & { records?: Record<string, unknown>[]; pages?: number } };

async function goi(token: string, duong: string, body: unknown): Promise<JtResp["data"]> {
    const r = await fetch(JT_API + duong, {
        method: "POST",
        headers: { "Content-Type": "application/json;charset=UTF-8", authToken: token, langType: "VN" },
        body: JSON.stringify(body ?? {}),
        signal: AbortSignal.timeout(20000),
        cache: "no-store",
    });
    if (r.status === 401 || r.status === 403) throw new JtHetHan();
    if (!r.ok) throw new Error(`J&T trả HTTP ${r.status} ở ${duong}`);
    const j = (await r.json()) as JtResp;
    if (j.code !== 1) {
        if (/token|登录|login|过期|expire/i.test(String(j.msg))) throw new JtHetHan();
        throw new Error(`J&T báo lỗi ở ${duong}: ${j.msg ?? "không rõ"}`);
    }
    return j.data;
}

/** Lật hết các trang của một API có phân trang. */
async function hetTrang(token: string, duong: (trang: number) => string, body: (trang: number) => unknown) {
    const out: Record<string, unknown>[] = [];
    for (let trang = 1; trang <= 50; trang++) {
        const d = await goi(token, duong(trang), body(trang));
        out.push(...(d?.records || []));
        if (!d?.pages || trang >= Number(d.pages)) break;
    }
    return out;
}

const fmt = (d: Date) => {
    const vn = new Date(d.getTime() + 7 * 3600_000);
    return vn.toISOString().slice(0, 10);
};

/**
 * Kéo một lần đủ số. Chi tiết của kỳ ĐÃ TRẢ không đổi nữa → lấy lại từ lần kéo trước (`cu`),
 * chỉ kéo chi tiết kỳ mới hoặc chưa trả.
 */
export async function keoJtVn(token: string, tuNgay: string, cu: JtDuLieu | null, now = new Date()): Promise<JtDuLieu> {
    const den = fmt(now);
    const kyRaw = await hetTrang(token, () => "queryFreightCheckForPage", (trang) => ({
        reconciliationNumber: "", startCreateTime: `${tuNgay} 00:00:00`, endCreateTime: `${den} 23:59:59`,
        createTime: [`${tuNgay} 00:00:00`, `${den} 23:59:59`], current: trang, size: 100,
    }));
    const cuTheoMa = new Map((cu?.ky || []).map((k) => [k.ma, k]));
    const ky: JtKy[] = [];
    for (const r of kyRaw) {
        const k = chuanKy(r);
        const c = cuTheoMa.get(k.ma);
        if (c && c.da_tra && k.da_tra && c.don) { ky.push({ ...k, don: c.don }); continue; }
        const don = await hetTrang(token, () => "queryFreightCheckForDetail",
            (trang) => ({ reconciliationNumber: k.ma, current: trang, size: 500 }));
        ky.push({ ...k, don: don.map(chuanDonKy) });
    }
    const dangChay = await hetTrang(token,
        (trang) => `queryOngoingCodAmountDetail/codMoneyNum?current=${trang}&size=500`, () => ({}));
    const [tong, tq] = await Promise.all([
        goi(token, "queryOngoingCodAmountSummary", {}).catch(() => null),
        goi(token, "queryLatestOverviewByCustomer", {}).catch(() => null),
    ]);
    return {
        keo_luc: now.toISOString(),
        so_du: tq && tq.notClearedBalance != null ? so(tq.notClearedBalance) : null,
        so_du_cap_nhat: tq?.lastUpdateTime ? chu(tq.lastUpdateTime) : null,
        dang_chay_tong: tong ? { so_don: so(tong.codMoneyNum), cod: so(tong.codMoney), cuoc: so(tong.taxAfterFee) } : null,
        ky,
        dang_chay: dangChay.map(chuanDangChay),
    };
}
