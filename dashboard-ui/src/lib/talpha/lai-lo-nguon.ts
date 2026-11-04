// ═══════════════════════════════════════════════════════════════════
// LÃI LỖ — nạp KIỆN THẬT của từng nước thành `Kien` (lib/talpha/lai-lo.ts).
//
// Mỗi nước đọc đúng nguồn mà Sổ đơn hàng / Tiền COD về / Theo dõi vận đơn đang đọc — một
// kiện chỉ có một trạng thái, một số tiền, ở mọi màn:
//   • Đài (TW): sổ đơn Đài (lib/talpha/so-don-dai.ts) — bảng NAZA + 17TRACK + mọi kỳ sao kê.
//     Phí từng kiện là phí THẬT trong sheet PHÍ của sao kê (NAZA thu cả kiện hoàn); kiện chưa
//     vào kỳ nào thì lấy phí trung bình các kiện đã có. Tiền NAZA trả quy VND theo tỷ giá
//     TWD→tệ→đồng của chính kỳ đó; kiện chưa trả theo tỷ giá kỳ mới nhất.
//   • Singapore, Nhật (SG, JP): bảng đối tác (BigQuery partner_orders) + 17TRACK; phí từng kiện
//     ở sao kê NAZA nước đó (phi_dong, thu_ho); thiếu thì ước theo trung bình kiện đã có sao
//     kê, chưa có kiện nào thì theo bảng giá shipping_fees.
//   • UAE (AE): đơn POS (không có bảng đối tác) + trạng thái WeShip; POS đã ghi giao/hoàn thì
//     tin POS khi WeShip chưa kết thúc. Phí theo bảng giá D&T (chưa có sao kê nào).
// Giá vốn: mã 3 số trong SKU × bảng products (Đài theo tỷ giá tệ của kỳ trả tiền); UAE tra theo
// tên hàng (markets.UAE.product_costs_vnd) qua lib/talpha/order-costs.ts.
// ═══════════════════════════════════════════════════════════════════
import { bigquery } from "@/lib/bigquery";
import { readStoreFresh } from "@/lib/talpha/store";
import {
    COST_RATE_RMB_VND, EXCHANGE_RATES, RULES, SHOP2MKT, costPriceVnd,
} from "@/lib/talpha/rules";
import { maGocGiaoLai, productCodes } from "@/lib/talpha/order-ledger";
import { napSoDonDai } from "@/lib/talpha/so-don-dai";
import { loadPartnerMarketShipments } from "@/lib/talpha/tracking-market";
import { TERMINAL, trackMarket } from "@/lib/talpha/tracking";
import { awbFromPartner } from "@/lib/talpha/weship";
import { tinhChiPhiDon } from "@/lib/talpha/order-costs";
import { BANG_GIA_NHAT, cuocNhatRmb, phiThuHoNhat } from "@/lib/talpha/phi-ship-nhat";
import { nhomKien, type Kien } from "@/lib/talpha/lai-lo";

const BQ_PROJECT = process.env.NEXT_PUBLIC_BQ_PROJECT || "cty-507710";
const BQ_DATASET = process.env.DATASET || "TALPHA_Dataset";

type Cfg = {
    ty_le_giao?: { cua_so_ngay?: number; bo_gan_ngay?: number; mau_toi_thieu?: number };
    cho_len_3pl_ngay?: number;
    hang_hoan?: { quay_lai_kho_ban_tiep?: string[]; luu_kho_ngay?: number; ve_kho_sau_gui_ngay?: number };
    nhom_van_hanh?: string[];
};
export const KQKD: Cfg = (RULES as unknown as { ket_qua_kd?: Cfg }).ket_qua_kd || {};
export const CFG_TY_LE = {
    cua_so_ngay: Number(KQKD.ty_le_giao?.cua_so_ngay ?? 90),
    bo_gan_ngay: Number(KQKD.ty_le_giao?.bo_gan_ngay ?? 21),
    mau_toi_thieu: Number(KQKD.ty_le_giao?.mau_toi_thieu ?? 20),
};
export const CHO_LEN_3PL_NGAY = Number(KQKD.cho_len_3pl_ngay ?? 3);
export const NHOM_VAN_HANH = KQKD.nhom_van_hanh?.length ? KQKD.nhom_van_hanh : ["Lương", "Mặt bằng", "Phần mềm & công cụ", "Khác"];
const VE_KHO = new Set((KQKD.hang_hoan?.quay_lai_kho_ban_tiep || ["AE"]).map((x) => x.toUpperCase()));
const LUU_KHO = Number(KQKD.hang_hoan?.luu_kho_ngay ?? 30);
const VE_KHO_SAU_GUI = Number(KQKD.hang_hoan?.ve_kho_sau_gui_ngay ?? 14);

const FEES = (RULES as unknown as { shipping_fees?: Record<string, any> }).shipping_fees || {};
const rate = (code: string) => EXCHANGE_RATES[SHOP2MKT[code]] || 0;
const clean = (x?: string | null) => String(x || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
const soNgay = (a: string, b: string) => Math.floor((Date.parse(b) - Date.parse(a)) / 86_400_000);
const tb = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
const fmt = (n: number) => Math.round(n).toLocaleString("vi-VN");

/** Hàng hoàn còn trong hạn lưu kho miễn phí của 3PL (ước ngày về kho = ngày gửi + VE_KHO_SAU_GUI). */
function conHan(ngayGui: string | null | undefined, ngay: string, asOf: string, daHuy: boolean) {
    if (daHuy) return false;
    const goc = ngayGui || ngay;
    return !!goc && soNgay(goc, asOf) <= VE_KHO_SAU_GUI + LUU_KHO;
}

/** Giá vốn theo SKU: mọi mã phải có giá, thiếu một mã là null (cộng nửa vời ra lãi đẹp giả). */
function giaVonSku(sku: string | null | undefined, qty: number): number | null {
    const codes = productCodes(sku);
    if (!codes.length) return null;
    let s = 0;
    for (const c of codes) {
        const g = costPriceVnd(c);
        if (g === null) return null;
        s += g * qty;
    }
    return s;
}

export type NguonNuoc = { kien: Kien[]; co_so: string[]; nguon: string };

// ─────────────────────────────────────────────────────────────────────────
// ĐÀI
// ─────────────────────────────────────────────────────────────────────────
async function kienDai(asOf: string): Promise<NguonNuoc> {
    const { rows, stm } = await napSoDonDai(asOf);
    const rTw = rate("TW");
    // Tỷ giá NAZA kỳ mới nhất (TWD→tệ × tệ→đồng) — cho kiện chưa được trả tiền.
    const ky = stm.statements
        .map((s) => ({
            ngay: s.rows.reduce((mx, r) => (r.paid_date > mx ? r.paid_date : mx), ""),
            tw: s.naza?.summary?.rate_twd_rmb ?? null, rv: s.naza?.summary?.rate_rmb_vnd ?? null,
        }))
        .filter((k) => k.tw && k.rv)
        .sort((a, b) => b.ngay.localeCompare(a.ngay));
    const chuoi = ky.length ? ky[0].tw! * ky[0].rv! : null;
    const phiCo = rows.filter((r) => r.fee_vnd != null).map((r) => r.fee_vnd as number);
    const phiTb = tb(phiCo) ?? 0;

    const kien: Kien[] = rows.map((r) => {
        const ngay = r.order_date || r.ship_date || "";
        const nhom = nhomKien(r.status, null, r.status_raw, !!r.ship_date);
        // Kiện GIAO LẠI (mã gốc trong ngoặc) dùng chính hàng của kiện hoàn — giá vốn đã tính ở
        // kiện gốc, tính lại là đếm một món hàng hai lần.
        const giaoLai = !!maGocGiaoLai(r.order_no);
        return {
            nuoc: "TW", ma: r.order_no || r.tracking, ngay, ngay_gui: r.ship_date || null, nhom,
            trang_thai: r.status_raw || r.status || "",
            cod_vnd: r.cod_twd * rTw,
            cod_that_vnd: r.gross_vnd ?? (chuoi ? r.cod_twd * chuoi : null),
            gia_von_vnd: giaoLai ? 0 : r.cogs_vnd,
            phi_di_vnd: r.fee_vnd ?? phiTb,
            phi_giao_vnd: 0,
            phi_hoan_vnd: 0,
            phi_that: r.fee_vnd != null,
            hang_ve_kho: VE_KHO.has("TW"),
            hoan_con_han: nhom === "hoan" && conHan(r.ship_date, ngay, asOf, r.status === "Destroyed" || /tiêu hu/i.test(r.status_raw)),
        };
    });
    return {
        kien,
        nguon: "Bảng đơn NAZA + 17TRACK · sao kê NAZA",
        co_so: [
            `Phí 3PL: phí thật trong sheet PHÍ của ${stm.statements.length} kỳ sao kê NAZA (vận chuyển + thao tác, NAZA thu cả kiện hoàn); `
            + `kiện chưa vào kỳ nào lấy trung bình ${fmt(phiTb)}đ/kiện của ${phiCo.length} kiện đã có phí. Hoàn về kho NAZA miễn phí 1 tháng.`,
            chuoi
                ? `Chênh tỷ giá: NAZA quy TWD→tệ→đồng theo tỷ giá từng kỳ (kỳ mới nhất ${fmt(chuoi)}đ/TWD) so với ${fmt(rTw)}đ/TWD của Doanh số.`
                : "Chênh tỷ giá: chưa có kỳ sao kê nào ghi đủ tỷ giá.",
            "Giá vốn: mã SP trong cột SKU bảng NAZA × bảng products; kiện giao lại không tính giá vốn lần hai.",
        ],
    };
}

// ─────────────────────────────────────────────────────────────────────────
// SINGAPORE · NHẬT — bảng đối tác + sao kê NAZA nước đó
// ─────────────────────────────────────────────────────────────────────────
type SaoKeNuoc = {
    statements: {
        filename: string; ngay?: string;
        rows?: { tracking: string; amount: number }[];
        naza?: {
            ty_gia_rmb?: number | null; ty_gia_vnd?: number | null;
            phi_dong?: { tracking: string; kg: number | null; ship: number; first_leg: number; op: number }[];
            thu_ho?: { tracking: string; phi_rmb: number }[];
        } | null;
    }[];
};

async function kienDoiTac(code: "SG" | "JP", asOf: string): Promise<NguonNuoc> {
    const mk = trackMarket(code);
    if (mk.code !== code) throw new Error(`chưa khai tracking.markets.${code}`);
    const [{ shipments }, sk] = await Promise.all([
        loadPartnerMarketShipments(mk, () => ({ registered: {}, statuses: {} })),
        readStoreFresh<SaoKeNuoc>(`cod_statements_${code.toLowerCase()}`, { statements: [] }),
    ]);
    const rLocal = rate(code);

    // Phí từng kiện trong sao kê, quy VND theo tỷ giá tệ của kỳ đó. Một kiện có thể bị thu ở
    // hai kỳ (NAZA thu bù hàng đặc thù kỳ sau) — cộng dồn.
    const phiDi = new Map<string, number>(), thuHo = new Map<string, number>(), canKien: number[] = [];
    let chuoi: { tw: number; rv: number; ngay: string } | null = null;
    for (const s of sk.statements) {
        const n = s.naza;
        if (!n) continue;
        const rv = Number(n.ty_gia_vnd) || COST_RATE_RMB_VND;
        for (const l of n.phi_dong || []) {
            const k = clean(l.tracking);
            phiDi.set(k, (phiDi.get(k) || 0) + (Number(l.ship) + Number(l.first_leg) + Number(l.op)) * rv);
            if (Number(l.kg) > 0) canKien.push(Number(l.kg));
        }
        for (const l of n.thu_ho || []) {
            const k = clean(l.tracking);
            thuHo.set(k, (thuHo.get(k) || 0) + Number(l.phi_rmb) * rv);
        }
        const ngay = s.ngay || "";
        if (n.ty_gia_rmb && n.ty_gia_vnd && (!chuoi || ngay > chuoi.ngay)) chuoi = { tw: n.ty_gia_rmb, rv: n.ty_gia_vnd, ngay };
    }
    const phiCo = [...phiDi.values()];
    const f = FEES[code] || {};

    // Ước khi kiện chưa vào sao kê nào: trung bình kiện đã có (≥ 3 kiện), không thì bảng giá.
    let phiDiUoc: number | null = phiCo.length >= 3 ? tb(phiCo) : null;
    let cachUoc = phiDiUoc != null ? `trung bình ${fmt(phiDiUoc)}đ/kiện của ${phiCo.length} kiện đã có trong sao kê` : "";
    if (phiDiUoc == null) {
        if (code === "SG" && f.first_leg_per_100g?.thuong && f.last_leg?.first_2kg) {
            const kg = tb(canKien) ?? 0.3;
            const rmb = f.first_leg_per_100g.thuong * Math.ceil(kg * 10 - 1e-9) + f.last_leg.first_2kg + Number(f.single_parcel_fee || 0);
            phiDiUoc = rmb * COST_RATE_RMB_VND;
            cachUoc = `bảng giá Singapore (${kg.toFixed(1)} kg/kiện): ${rmb.toFixed(1)} tệ`;
        } else if (code === "JP") {
            const rmb = cuocNhatRmb(1) ?? 0;
            phiDiUoc = rmb * COST_RATE_RMB_VND;
            cachUoc = `bảng giá NAZA Nhật 0,5 kg đầu: ${rmb} tệ`;
        } else phiDiUoc = 0;
    }

    const kien: Kien[] = shipments.map((s) => {
        const k = clean(s.tracking);
        const ngay = s.order_date || s.ship_date || "";
        const nhom = nhomKien(s.status, s.sub_status, s.raw_status, !!s.ship_date);
        const codVnd = s.cod_local * rLocal;
        const codRmb = chuoi ? s.cod_local * chuoi.tw : codVnd / COST_RATE_RMB_VND;
        let di = phiDi.get(k);
        const that = di != null;
        let giao = 0, hoan = 0;
        if (code === "SG") {
            // Thu hộ COD chỉ khi thu được tiền: % tiền đơn, có mức sàn. Hoàn: nhập kho hàng hoàn.
            giao = thuHo.get(k) ?? Math.max(Number(f.cod_fee?.pct || 0) * codRmb, Number(f.cod_fee?.min || 0)) * COST_RATE_RMB_VND;
            hoan = Number(f.returns?.return_inbound || 0) * COST_RATE_RMB_VND;
            di = di ?? phiDiUoc!;
        } else {
            // Nhật: phí ủy thác thu hộ thu DÙ khách có nhận hay không → vào phí chặng đi.
            // Hoàn = phí từ chối nhận (xử lý hàng hoàn).
            const thuHoNhat = thuHo.get(k) ?? (phiThuHoNhat(s.cod_local, BANG_GIA_NHAT) ?? 0) * rLocal;
            di = (di ?? phiDiUoc!) + thuHoNhat;
            hoan = Number(f.refusal_fee_jpy || 0) * rLocal;
        }
        return {
            nuoc: code, ma: s.order_id || s.tracking, ngay, ngay_gui: s.ship_date || null, nhom,
            trang_thai: s.raw_status || s.status || "",
            cod_vnd: codVnd,
            cod_that_vnd: chuoi ? s.cod_local * chuoi.tw * chuoi.rv : null,
            gia_von_vnd: giaVonSku(s.sku, s.quantity || 1),
            phi_di_vnd: di, phi_giao_vnd: giao, phi_hoan_vnd: hoan, phi_that: that,
            hang_ve_kho: VE_KHO.has(code),
            hoan_con_han: nhom === "hoan" && conHan(s.ship_date, ngay, asOf, /tiêu hu/i.test(String(s.raw_status || "")) || s.status === "Destroyed"),
        };
    });

    const tenNuoc = code === "SG" ? "Singapore" : "Nhật";
    return {
        kien,
        nguon: `Bảng đối tác ${tenNuoc} + 17TRACK · sao kê NAZA ${tenNuoc}`,
        co_so: [
            `Phí 3PL: phí thật từng kiện trong ${sk.statements.length} kỳ sao kê ${tenNuoc} (vận chuyển + chặng đầu + thao tác${code === "SG" ? ", thu hộ COD" : ""}); kiện chưa có sao kê ước ${cachUoc}.`,
            code === "SG"
                ? `Thu hộ COD ${(Number(f.cod_fee?.pct || 0) * 100).toFixed(0)}% (tối thiểu ${f.cod_fee?.min || 0} tệ) chỉ khi giao được; hàng hoàn mất phí đi + nhập kho hoàn ${f.returns?.return_inbound || 0} tệ, lưu tối đa 30 ngày rồi huỷ.`
                : `Phí thu hộ theo bậc tiền COD thu dù khách có nhận hay không; khách từ chối mất thêm ${fmt(Number(f.refusal_fee_jpy || 0))}¥, hàng về kho NAZA Nhật.`,
            chuoi
                ? `Chênh tỷ giá: NAZA quy ${code === "SG" ? "S$" : "¥"}→tệ ${chuoi.tw} × ${fmt(chuoi.rv)}đ/tệ (kỳ mới nhất) so với ${fmt(rLocal)}đ của Doanh số.`
                : `Chênh tỷ giá: chưa có kỳ sao kê nào ghi tỷ giá — tính theo ${fmt(rLocal)}đ.`,
            "Giá vốn: mã SP trong cột SKU bảng đối tác × bảng products.",
        ],
    };
}

// ─────────────────────────────────────────────────────────────────────────
// UAE — đơn POS + WeShip, bảng giá D&T Fulfillment
// ─────────────────────────────────────────────────────────────────────────
const POS_SANG_CHUAN: Record<string, string> = {
    GIAO_THANH_CONG: "Delivered", DON_HOAN: "Returned", HUY: "Cancelled", DANG_GIAO: "InTransit",
};

async function kienUae(from: string, to: string, asOf: string): Promise<NguonNuoc> {
    const mk = trackMarket("AE");
    const tu = new Date(Date.parse(`${asOf}T00:00:00Z`) - (CFG_TY_LE.cua_so_ngay + 30) * 86_400_000).toISOString().slice(0, 10);
    const batDau = from < tu ? from : tu;
    const [[rows], store, chiPhi] = await Promise.all([
        bigquery.query({
            query: `SELECT v.order_id, CAST(v.order_date AS STRING) AS order_date, v.status_name, v.status_category,
                           SAFE_DIVIDE(o.cod, NULLIF(v.pos_money_divisor, 0)) AS cod, o.partner, o.time_send_partner
                    FROM \`${BQ_PROJECT}.${BQ_DATASET}.vw_orders_std\` v
                    LEFT JOIN \`${BQ_PROJECT}.${BQ_DATASET}.sale_order\` o ON v.shop_id = o.shop_id AND v.order_id = o.id
                    WHERE v.market = @m AND v.status_category NOT IN ('DON_THO')
                      AND v.order_date BETWEEN DATE(@tu) AND DATE(@den)`,
            params: { m: mk.pos_market || "AE", tu: batDau, den: to },
        }),
        readStoreFresh<{ statuses: Record<string, { status?: string | null; sub_status?: string | null; raw_status?: string | null; source?: string }> }>(
            mk.store, { statuses: {} }),
        tinhChiPhiDon(from, to, (shop) => shop === "AE"),
    ]);
    const gv = new Map(chiPhi.don.map((d) => [d.key.replace(/^AE-/, ""), d]));
    const f = FEES.AE || {};
    const rAe = rate("AE");
    // Phí fulfillment theo bậc số đơn TRUNG BÌNH/NGÀY của kỳ đang xem (đơn hoàn cũng mất).
    const soNgayKy = Math.max(1, soNgay(from, to) + 1);
    const donKy = (rows as any[]).filter((r) => r.order_date >= from && r.order_date <= to && r.status_category !== "HUY").length;
    const bac = [...(f.fulfillment_fee_tiers || [])].sort((a: any, b: any) => a.max_orders_per_day - b.max_orders_per_day);
    const fulfill = bac.length ? (bac.find((b: any) => donKy / soNgayKy < b.max_orders_per_day) || bac[bac.length - 1]).fee : 0;

    const kien: Kien[] = (rows as any[]).map((r) => {
        const awb = awbFromPartner(r.partner);
        const w = awb ? store.statuses[awb] : undefined;
        const ws = w?.source === "weship" ? w.status || null : null;
        // WeShip đã kết thúc thì tin WeShip; chưa thì POS (Lộc cập nhật giao/hoàn trên POS) — rồi mới tới WeShip dở dang.
        const pos = POS_SANG_CHUAN[String(r.status_category || "").toUpperCase()] || null;
        const st = ws && TERMINAL.has(ws) ? ws : pos && TERMINAL.has(pos) ? pos : ws || pos;
        const daGui = !!awb || !!r.time_send_partner || pos === "InTransit";
        const nhom = nhomKien(st, ws ? w?.sub_status : null, ws ? w?.raw_status : null, daGui);
        const cod = Number(r.cod) || 0;
        const d = gv.get(String(r.order_id));
        return {
            nuoc: "AE", ma: String(r.order_id), ngay: String(r.order_date || ""), ngay_gui: null, nhom,
            trang_thai: (ws && w?.raw_status) || r.status_name || r.status_category || "",
            cod_vnd: cod * rAe, cod_that_vnd: null,
            gia_von_vnd: d ? (d.du ? d.cogs : null) : null,
            phi_di_vnd: fulfill * rAe,
            phi_giao_vnd: (Number(f.delivered_ship_fee || 0) + Number(f.cod_fee_pct || 0) * cod) * rAe,
            phi_hoan_vnd: Number(f.return_ship_fee || 0) * rAe,
            phi_that: false,
            hang_ve_kho: VE_KHO.has("AE"),
        };
    });
    return {
        kien,
        nguon: "Đơn POS UAE + trạng thái WeShip",
        co_so: [
            `Phí 3PL: bảng giá D&T Fulfillment (chưa có sao kê) — fulfillment ${fulfill} AED/đơn (${(donKy / soNgayKy).toFixed(1)} đơn/ngày, đơn hoàn cũng mất) `
            + `+ vận chuyển đơn thành công ${f.delivered_ship_fee} AED + thu hộ ${(Number(f.cod_fee_pct || 0) * 100).toFixed(0)}% tiền đơn; đơn hoàn miễn phí vận chuyển.`,
            "Hàng hoàn về kho D&T bán tiếp được → đơn hoàn không mất giá vốn. Chưa trừ phí lưu kho "
            + `${f.storage_fee_aed_per_cbm_month ?? 75} AED/CBM/tháng (D&T thu khi hàng xuất mỗi ngày dưới 10% tồn kho) — chưa có số CBM hàng tồn.`,
            "Giá vốn: mã vạch hàng trên POS (đổi tên vẫn ra đúng món), không có thì tên hàng × markets.UAE.product_costs_vnd (tiền hàng + hộp).",
        ],
    };
}

/** Mọi kiện của một nước (cả kiện cũ ngoài kỳ — để đo tỉ lệ giao). */
export function napKienNuoc(code: string, from: string, to: string, asOf: string): Promise<NguonNuoc> {
    if (code === "TW") return kienDai(asOf);
    if (code === "SG" || code === "JP") return kienDoiTac(code, asOf);
    if (code === "AE") return kienUae(from, to, asOf);
    return Promise.reject(new Error(`chưa có nguồn kiện cho ${code}`));
}
