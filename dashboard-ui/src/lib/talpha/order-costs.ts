// ═══════════════════════════════════════════════════════════════════
// Giá vốn và phí ship của TỪNG ĐƠN đã chốt — dùng chung cho tab P&L (/api/talpha/pnl-costs)
// và tab P&L theo SP (/api/talpha/product-pnl). Một chỗ tính, hai tab không lệch nhau.
//
// Cùng tập đơn với cột Doanh Số của file TỔNG TEAM: đơn trên POS trừ huỷ, nháp và đơn trống,
// ngày theo giờ Việt Nam. Tiền đơn quy VND như Sheet: (cod > 0 ? cod : total_price) ÷ số chia
// của shop × tỷ giá.
//
// GIÁ VỐN: mã 3 số trong tên sản phẩm POS ("011-ATTL birth month set", "040 - VONGVANG1")
// → giá tệ trong talpha_rules.json → products, quy VND theo cost_rate_rmb_vnd. Cùng cách
// Sổ đơn hàng đọc cột SKU của file đối tác (productCodes · costPriceVnd). Tên gõ tay không
// có mã thì tra product_name_aliases; shop UAE đánh số sản phẩm riêng nên tra giá theo tên
// (markets.UAE.product_costs_vnd, bằng đồng). Không đi qua vw_orders_std: view nối qua bảng
// product_catalog, mà bảng đó 0 dòng từ ngày dựng dự án nên cogs_vnd của view luôn 0.
// Mã chưa khai giá KHÔNG coi là 0 — trả ra danh sách thiếu.
//
// PHÍ SHIP — ƯỚC TÍNH, vì phí từng đơn chỉ có khi 3PL gửi sao kê:
//   • Đài (TW): phí trung bình một kiện trong các kỳ sao kê NAZA đã tải lên.
//   • Singapore (SG): bảng giá shipping_fees.SG tính cho TỪNG đơn — chặng đầu theo 0,1 kg
//     (cân lấy trung bình kiện NAZA Đài, cùng loại hàng) + chặng cuối + phí gửi lẻ + phí
//     thu hộ COD (% tiền của chính đơn đó, có mức sàn).
//   • UAE (AE): bảng giá D&T Fulfillment shipping_fees.AE — phí fulfillment theo bậc số đơn
//     trung bình/ngày + vận chuyển đơn thành công (đồng giá dưới 1 kg) + thu hộ COD % tiền đơn.
//   • Nước khác: không đoán — null để giao diện ghi "thiếu".
// ═══════════════════════════════════════════════════════════════════
import { bigquery } from "@/lib/bigquery";
import {
    COST_RATE_RMB_VND, EXCHANGE_RATES, POS_TIMEZONE, RULES, SHOP2MKT,
    costPriceVnd, posMoneyDivisor,
} from "@/lib/talpha/rules";
import { productCodes } from "@/lib/talpha/order-ledger";
import { readStoreFresh } from "@/lib/talpha/store";

const BQ_PROJECT = process.env.NEXT_PUBLIC_BQ_PROJECT || "cty-507710";
const BQ_DATASET = process.env.DATASET || "TALPHA_Dataset";

type FeeLine = { ship_fee?: number; op_fee?: number; chargeable_kg?: number | null };
type Statement = {
    naza?: {
        summary?: { rate_rmb_vnd?: number | null; fees_combined?: boolean };
        fee_lines?: FeeLine[];
    };
};
type SgFees = {
    first_leg_per_100g?: { thuong?: number };
    last_leg?: { first_2kg?: number; extra_per_kg?: number };
    cod_fee?: { pct?: number; min?: number };
    single_parcel_fee?: number;
};
type AeFees = {
    fulfillment_fee_tiers?: { max_orders_per_day: number; fee: number }[];
    delivered_ship_fee?: number;
    cod_fee_pct?: number;
};

const FEES = (RULES as unknown as { shipping_fees?: Record<string, unknown> }).shipping_fees || {};
const SG_FEES = (FEES.SG as SgFees | undefined) || null;
const AE_FEES = (FEES.AE as AeFees | undefined) || null;

/** Phí fulfillment D&T theo bậc: bậc đầu tiên có trần ≥ số đơn trung bình/ngày; vượt hết thì bậc cuối. */
function phiFulfillmentAe(donMoiNgay: number): number | null {
    const bac = [...(AE_FEES?.fulfillment_fee_tiers || [])].sort((a, b) => a.max_orders_per_day - b.max_orders_per_day);
    if (!bac.length) return null;
    return (bac.find((b) => donMoiNgay < b.max_orders_per_day) || bac[bac.length - 1]).fee;
}

// Khoá so sánh cho tên gõ tay: chữ HOA, dạng NFC. POS có lúc lưu tiếng Việt ở dạng dấu
// tách rời (NFD) — "MỌC TÓC VN" hai kiểu mã hoá nhìn giống hệt nhau mà so bằng thì trượt.
export const khoaTen = (s: string) => s.normalize("NFC").trim().toUpperCase();
const ALIASES: Record<string, string> = Object.fromEntries(
    Object.entries((RULES as unknown as { product_name_aliases?: Record<string, string> }).product_name_aliases || {})
        .filter(([k]) => !k.startsWith("_"))
        .map(([k, v]) => [khoaTen(k), v]));

// Shop nào đặt tên sản phẩm theo mã 3 số của bảng giá. UAE đánh số riêng ("Oralhoe Dental 002")
// — đọc số cuối tên là lấy nhầm giá mã 002 (vòng phong thuỷ). markets.*.product_code_in_name.
const MA_3_SO_THEO_SHOP: Record<string, boolean> = Object.fromEntries(
    Object.values(RULES.markets as Record<string, { shop_label?: string; product_code_in_name?: boolean }>)
        .filter((m) => m && typeof m === "object" && m.shop_label)
        .map((m) => [String(m.shop_label).toUpperCase(), m.product_code_in_name !== false]));

// Giá vốn theo TÊN sản phẩm, bằng ĐỒNG, riêng từng shop (markets.*.product_costs_vnd) — shop UAE
// đặt tên riêng và Sỹ Anh báo giá bằng đồng (25/09/2026). Một cái = tiền hàng + hộp trang sức.
const GIA_THEO_TEN: Record<string, Record<string, number>> = {};
for (const m of Object.values(RULES.markets as Record<string, {
    shop_label?: string; product_costs_vnd?: Record<string, { hang?: number; hop?: number } | string>;
}>)) {
    if (!m || typeof m !== "object" || !m.shop_label || !m.product_costs_vnd) continue;
    const bang: Record<string, number> = {};
    for (const [ten, v] of Object.entries(m.product_costs_vnd)) {
        if (ten.startsWith("_") || typeof v !== "object" || !(Number(v.hang) > 0)) continue;
        bang[khoaTen(ten)] = Number(v.hang) + Number(v.hop || 0);
    }
    GIA_THEO_TEN[String(m.shop_label).toUpperCase()] = bang;
}

/** Đọc kho sao kê NAZA (Đài): phí trung bình một kiện + cân tính phí trung bình. */
async function docSaoKeNaza() {
    const kho = await readStoreFresh<{ statements: Statement[] }>("cod_statements", { statements: [] });
    let kien = 0, vnd = 0, ky = 0, kienCoCan = 0, tongCan = 0, tongNac = 0;
    for (const s of kho.statements || []) {
        const lines = s.naza?.fee_lines || [];
        if (!lines.length) continue;
        ky += 1;
        const rate = s.naza?.summary?.rate_rmb_vnd || COST_RATE_RMB_VND;
        // File gộp "phí vận chuyển + phí thao tác" vào một cột thì op_fee đã nằm trong ship_fee.
        const gop = !!s.naza?.summary?.fees_combined;
        for (const l of lines) {
            const rmb = Math.abs(Number(l.ship_fee || 0)) + (gop ? 0 : Math.abs(Number(l.op_fee || 0)));
            kien += 1;
            vnd += rmb * rate;
            const kg = Number(l.chargeable_kg || 0);
            if (kg > 0) {
                kienCoCan += 1;
                tongCan += kg;
                // Chặng đầu Singapore tính theo TỪNG 0,1 kg — làm tròn lên từng kiện rồi mới lấy trung bình.
                tongNac += Math.ceil(kg * 10 - 1e-9);
            }
        }
    }
    return {
        tw: kien ? { per_order_vnd: vnd / kien, parcels: kien, periods: ky } : null,
        can: kienCoCan ? { kg_tb: tongCan / kienCoCan, nac_100g_tb: tongNac / kienCoCan, kien: kienCoCan } : null,
    };
}

/** Phí ship một đơn Singapore theo bảng giá (RMB). null = thiếu bảng giá hoặc thiếu cân. */
function shipSgRmb(codRmb: number, can: { kg_tb: number; nac_100g_tb: number } | null): number | null {
    const f = SG_FEES;
    if (!f || !can || !f.first_leg_per_100g?.thuong || !f.last_leg?.first_2kg) return null;
    const changDau = f.first_leg_per_100g.thuong * can.nac_100g_tb;
    const changCuoi = f.last_leg.first_2kg + Math.max(0, can.kg_tb - 2) * (f.last_leg.extra_per_kg || 0);
    const cod = Math.max((f.cod_fee?.pct || 0) * codRmb, f.cod_fee?.min || 0);
    return changDau + changCuoi + cod + (f.single_parcel_fee || 0);
}

/**
 * Một dòng hàng của đơn, đã tra giá. `sp` = khoá sản phẩm để gom tab P&L theo SP:
 * mã 3 số ("040"), hoặc "<SHOP>:<TÊN>" cho hàng tra giá theo tên (UAE), hoặc
 * "?:<tên>" khi chưa tra được giá. Dòng ghép nhiều mã ("042 - BLACK + 043 - COFFEE")
 * tách thành nhiều dòng, mỗi mã một dòng, cùng số lượng.
 */
export type DongHang = { sp: string; ten: string; qty: number; gia_vnd: number | null };
export type DonChiPhi = {
    key: string; shop: string; d: string;
    /** Tiền đơn quy VND — cùng cách Sheet tính cột Doanh Số. */
    vnd: number;
    cogs: number;
    /** true = mọi dòng hàng đều đã có giá vốn. */
    du: boolean;
    /** Phí ship ước tính (VND); null = nước chưa có sao kê/bảng giá. */
    ship: number | null;
    dong: DongHang[];
};
export type ThieuGia = { ma: string; ten: string; qty: number; orders: number };

export async function tinhChiPhiDon(from: string, to: string): Promise<{
    don: DonChiPhi[]; thieu: ThieuGia[]; ship_basis: Record<string, string>;
}> {
    const [rows] = await bigquery.query({
        query: `
            WITH don AS (
                SELECT CAST(id AS STRING) AS id, shop_id, UPPER(shop_label) AS shop,
                       DATE(TIMESTAMP(inserted_at), @tz) AS d,
                       IFNULL(cod, 0) AS cod, IFNULL(total_price, 0) AS total_price
                FROM \`${BQ_PROJECT}.${BQ_DATASET}.sale_order\`
                WHERE DATE(TIMESTAMP(inserted_at), @tz) BETWEEN @from AND @to
                  AND status_category NOT IN ('HUY', 'DON_THO')
                  -- Đơn trống (0 sản phẩm, 0 tiền) — Sheet không đếm (sql_la_don_trong).
                  AND NOT (IFNULL(SAFE_CAST(total_quantity AS FLOAT64), 0) = 0
                           AND IFNULL(total_price, 0) = 0 AND IFNULL(cod, 0) = 0)
            )
            SELECT don.id, don.shop, CAST(don.d AS STRING) AS d, don.cod, don.total_price,
                   i.product_name, i.variation_name, IFNULL(i.quantity, 0) AS qty
            FROM don
            LEFT JOIN \`${BQ_PROJECT}.${BQ_DATASET}.order_items\` i
                   ON CAST(i.order_id AS STRING) = don.id AND i.shop_id = don.shop_id`,
        params: { from, to, tz: POS_TIMEZONE },
    });

    const donMap = new Map<string, DonChiPhi>();
    const thieu = new Map<string, { ma: string; ten: string; qty: number; don: Set<string> }>();
    for (const r of rows as any[]) {
        const key = `${r.shop}-${r.id}`;
        let o = donMap.get(key);
        if (!o) {
            const local = (Number(r.cod) > 0 ? Number(r.cod) : Number(r.total_price)) / posMoneyDivisor(r.shop);
            o = { key, shop: r.shop, d: r.d, vnd: local * (EXCHANGE_RATES[SHOP2MKT[r.shop]] || 0), cogs: 0, du: true, ship: null, dong: [] };
            donMap.set(key, o);
        }
        if (r.product_name == null && r.variation_name == null) { o.du = false; continue; }  // đơn không có dòng hàng
        const ten = `${r.product_name || ""} ${r.variation_name || ""}`.trim();
        const qty = Number(r.qty || 0);
        const ghiThieu = (ma: string) => {
            const t = thieu.get(ma) || { ma, ten, qty: 0, don: new Set<string>() };
            t.qty += qty; t.don.add(key); thieu.set(ma, t);
            o!.du = false;
            o!.dong.push({ sp: `?:${ten || "(không tên)"}`, ten, qty, gia_vnd: null });
        };
        // Tên khai tay ở product_name_aliases thắng; sau đó giá theo tên của shop (UAE); cuối cùng
        // mới đọc mã 3 số trong tên (chỉ ở shop đặt tên theo mã của bảng giá).
        const biDanh = ALIASES[khoaTen(ten)];
        const giaTen = GIA_THEO_TEN[r.shop]?.[khoaTen(ten)];
        if (!biDanh && giaTen !== undefined) {
            o.cogs += giaTen * qty;
            o.dong.push({ sp: `${r.shop}:${khoaTen(ten)}`, ten, qty, gia_vnd: giaTen });
            continue;
        }
        const codes = biDanh ? [biDanh] : MA_3_SO_THEO_SHOP[r.shop] === false ? [] : productCodes(ten);
        if (!codes.length) { ghiThieu(ten || "(không tên)"); continue; }
        for (const c of codes) {
            const gia = costPriceVnd(c);
            if (gia === null) { ghiThieu(c); continue; }
            o.cogs += gia * qty;
            o.dong.push({ sp: c, ten, qty, gia_vnd: gia });
        }
    }

    const naza = await docSaoKeNaza();
    // UAE: bậc phí fulfillment theo số đơn TRUNG BÌNH/NGÀY của khoảng đang xem.
    const soNgay = Math.max(1, Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1);
    const donAe = [...donMap.values()].filter((o) => o.shop === "AE").length;
    const fulfillAe = phiFulfillmentAe(donAe / soNgay);
    const tyGiaAe = EXCHANGE_RATES[SHOP2MKT.AE] || 0;
    for (const o of donMap.values()) {
        if (o.shop === "TW") o.ship = naza.tw ? naza.tw.per_order_vnd : null;
        else if (o.shop === "SG") {
            const rmb = shipSgRmb(o.vnd / COST_RATE_RMB_VND, naza.can);
            o.ship = rmb === null ? null : rmb * COST_RATE_RMB_VND;
        } else if (o.shop === "AE") {
            o.ship = fulfillAe === null || !AE_FEES?.delivered_ship_fee || !tyGiaAe ? null
                : (fulfillAe + AE_FEES.delivered_ship_fee + (AE_FEES.cod_fee_pct || 0) * (o.vnd / tyGiaAe)) * tyGiaAe;
        }
    }

    // Cơ sở ước tính phí ship từng nước — giao diện in ra để người đọc biết số từ đâu.
    const fmt = (n: number) => Math.round(n).toLocaleString("vi-VN");
    const tbShip = (shop: string) => {
        const ds = [...donMap.values()].filter((o) => o.shop === shop && o.ship !== null);
        return ds.length ? ds.reduce((s, o) => s + (o.ship || 0), 0) / ds.length : null;
    };
    const ship_basis: Record<string, string> = {};
    if (naza.tw) {
        ship_basis.TW = `${fmt(naza.tw.per_order_vnd)}đ/đơn = trung bình ${fmt(naza.tw.parcels)} kiện trong ${naza.tw.periods} kỳ sao kê NAZA (phí vận chuyển + phí thao tác, quy VND theo tỷ giá từng kỳ).`;
    }
    const sg = tbShip("SG");
    if (SG_FEES && naza.can && sg !== null) {
        ship_basis.SG = `trung bình ${fmt(sg)}đ/đơn theo bảng giá Singapore: chặng đầu `
            + `${SG_FEES.first_leg_per_100g?.thuong} tệ/0,1 kg × ${naza.can.nac_100g_tb.toFixed(2)} (cân tính phí trung bình `
            + `${naza.can.kg_tb.toFixed(2)} kg của ${fmt(naza.can.kien)} kiện NAZA Đài) + chặng cuối ${SG_FEES.last_leg?.first_2kg} tệ `
            + `+ gửi lẻ ${SG_FEES.single_parcel_fee || 0} tệ + thu hộ COD ${((SG_FEES.cod_fee?.pct || 0) * 100).toFixed(0)}% tiền đơn `
            + `(tối thiểu ${SG_FEES.cod_fee?.min || 0} tệ), quy ${fmt(COST_RATE_RMB_VND)}đ/tệ. Chưa gồm phí hàng hoàn.`;
    }
    const ae = tbShip("AE");
    if (AE_FEES && ae !== null) {
        ship_basis.AE = `trung bình ${fmt(ae)}đ/đơn theo bảng giá D&T Fulfillment: `
            + `fulfillment ${fulfillAe} AED (${(donAe / soNgay).toFixed(1)} đơn/ngày) + vận chuyển đơn thành công `
            + `${AE_FEES.delivered_ship_fee} AED + thu hộ COD ${((AE_FEES.cod_fee_pct || 0) * 100).toFixed(0)}% tiền đơn, `
            + `quy ${fmt(tyGiaAe)}đ/AED. Đơn hoàn chỉ mất phí fulfillment — P&L đang tính như đơn giao thành công.`;
    }

    return {
        don: [...donMap.values()],
        thieu: [...thieu.values()]
            .map((t) => ({ ma: t.ma, ten: t.ten, qty: t.qty, orders: t.don.size }))
            .sort((a, b) => b.orders - a.orders),
        ship_basis,
    };
}
