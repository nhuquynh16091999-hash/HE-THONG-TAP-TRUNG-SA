import { NextRequest, NextResponse } from "next/server";
import { bigquery } from "@/lib/bigquery";
import {
    COST_RATE_RMB_VND, EXCHANGE_RATES, POS_TIMEZONE, REPORT_START_DATE, RULES, SHOP2MKT,
    costPriceVnd, posMoneyDivisor,
} from "@/lib/talpha/rules";
import { productCodes } from "@/lib/talpha/order-ledger";
import { readStoreFresh } from "@/lib/talpha/store";

export const dynamic = "force-dynamic";

const BQ_PROJECT = process.env.NEXT_PUBLIC_BQ_PROJECT || "cty-507710";
const BQ_DATASET = process.env.DATASET || "TALPHA_Dataset";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ═══════════════════════════════════════════════════════════════════
// Chi phí cho tab P&L: GIÁ VỐN và PHÍ SHIP của mọi đơn đã chốt, theo ngày và theo nước.
//
// Doanh số, tiền ads, số đơn tab lấy từ file TỔNG TEAM (sheet-report) — route này chỉ
// thêm hai khoản Sheet không có. Cùng tập đơn với cột Doanh Số của Sheet: đơn trên POS
// trừ huỷ, nháp và đơn trống, ngày theo giờ Việt Nam.
//
// GIÁ VỐN: mã 3 số trong tên sản phẩm POS ("011-ATTL birth month set", "040 - VONGVANG1")
// → giá tệ trong talpha_rules.json → products, quy VND theo cost_rate_rmb_vnd. Cùng cách
// Sổ đơn hàng đọc cột SKU của file đối tác (productCodes · costPriceVnd). Tên gõ tay không
// có mã thì tra product_name_aliases; shop UAE đánh số sản phẩm riêng nên chỉ tra aliases.
// Không đi qua vw_orders_std: view nối qua bảng product_catalog, mà bảng đó 0 dòng từ
// ngày dựng dự án nên cogs_vnd của view luôn 0.
// Mã chưa khai giá KHÔNG coi là 0 — trả ra danh sách thiếu.
//
// PHÍ SHIP — ƯỚC TÍNH, vì phí từng đơn chỉ có khi 3PL gửi sao kê:
//   • Đài (TW): phí trung bình một kiện trong các kỳ sao kê NAZA đã tải lên.
//   • Singapore (SG): bảng giá shipping_fees.SG tính cho TỪNG đơn — chặng đầu theo 0,1 kg
//     (cân lấy trung bình kiện NAZA Đài, cùng loại hàng) + chặng cuối + phí gửi lẻ + phí
//     thu hộ COD (% tiền của chính đơn đó, có mức sàn).
//   • Nước khác: không đoán — null để giao diện ghi "thiếu".
// ═══════════════════════════════════════════════════════════════════

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

const SG_FEES: SgFees | null =
    ((RULES as unknown as { shipping_fees?: Record<string, SgFees> }).shipping_fees?.SG) || null;
// Khoá so sánh cho tên gõ tay: chữ HOA, dạng NFC. POS có lúc lưu tiếng Việt ở dạng dấu
// tách rời (NFD) — "MỌC TÓC VN" hai kiểu mã hoá nhìn giống hệt nhau mà so bằng thì trượt.
const khoaTen = (s: string) => s.normalize("NFC").trim().toUpperCase();
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

export async function GET(req: NextRequest) {
    const sp = req.nextUrl.searchParams;
    const fromIn = sp.get("from") || "";
    const to = sp.get("to") || "";
    if (!DATE_RE.test(fromIn) || !DATE_RE.test(to)) {
        return NextResponse.json({ error: "from/to phải dạng YYYY-MM-DD" }, { status: 400 });
    }
    const from = REPORT_START_DATE && fromIn < REPORT_START_DATE ? REPORT_START_DATE : fromIn;

    try {
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

        // Gom theo đơn: tiền đơn (VND, cùng cách Sheet quy doanh số), giá vốn đã biết, đủ giá chưa.
        type Don = { shop: string; d: string; vnd: number; cogs: number; du: boolean };
        const donMap = new Map<string, Don>();
        const thieu = new Map<string, { ma: string; ten: string; qty: number; don: Set<string> }>();
        for (const r of rows as any[]) {
            const key = `${r.shop}-${r.id}`;
            let o = donMap.get(key);
            if (!o) {
                const local = (Number(r.cod) > 0 ? Number(r.cod) : Number(r.total_price)) / posMoneyDivisor(r.shop);
                o = { shop: r.shop, d: r.d, vnd: local * (EXCHANGE_RATES[SHOP2MKT[r.shop]] || 0), cogs: 0, du: true };
                donMap.set(key, o);
            }
            if (r.product_name == null && r.variation_name == null) { o.du = false; continue; }  // đơn không có dòng hàng
            const ten = `${r.product_name || ""} ${r.variation_name || ""}`.trim();
            const qty = Number(r.qty || 0);
            // Tên khai tay ở product_name_aliases thắng; sau đó mới đọc mã 3 số trong tên
            // (chỉ ở shop đặt tên theo mã của bảng giá).
            const biDanh = ALIASES[khoaTen(ten)];
            const codes = biDanh ? [biDanh] : MA_3_SO_THEO_SHOP[r.shop] === false ? [] : productCodes(ten);
            const ghiThieu = (ma: string) => {
                const t = thieu.get(ma) || { ma, ten, qty: 0, don: new Set<string>() };
                t.qty += qty; t.don.add(key); thieu.set(ma, t);
                o!.du = false;
            };
            if (!codes.length) { ghiThieu(ten || "(không tên)"); continue; }
            for (const c of codes) {
                const gia = costPriceVnd(c);
                if (gia === null) ghiThieu(c);
                else o.cogs += gia * qty;
            }
        }

        const naza = await docSaoKeNaza();
        const shipDon = (o: Don): number | null => {
            if (o.shop === "TW") return naza.tw ? naza.tw.per_order_vnd : null;
            if (o.shop === "SG") {
                const rmb = shipSgRmb(o.vnd / COST_RATE_RMB_VND, naza.can);
                return rmb === null ? null : rmb * COST_RATE_RMB_VND;
            }
            return null;
        };

        type Bucket = { orders: number; cogs_vnd: number; orders_cogs_full: number; ship_vnd: number; orders_no_ship: number };
        const rong = (): Bucket => ({ orders: 0, cogs_vnd: 0, orders_cogs_full: 0, ship_vnd: 0, orders_no_ship: 0 });
        const cong = (b: Bucket, o: Don) => {
            b.orders += 1;
            b.cogs_vnd += o.cogs;
            if (o.du) b.orders_cogs_full += 1;
            const s = shipDon(o);
            if (s === null) b.orders_no_ship += 1; else b.ship_vnd += s;
        };
        const tong = rong();
        const ngay = new Map<string, Bucket>();
        const nuoc = new Map<string, Bucket>();
        for (const o of donMap.values()) {
            cong(tong, o);
            const n = ngay.get(o.d) || rong(); cong(n, o); ngay.set(o.d, n);
            const m = nuoc.get(o.shop) || rong(); cong(m, o); nuoc.set(o.shop, m);
        }

        // Cơ sở ước tính phí ship từng nước — giao diện in ra để người đọc biết số từ đâu.
        const fmt = (n: number) => Math.round(n).toLocaleString("vi-VN");
        const ship_basis: Record<string, string> = {};
        if (naza.tw) {
            ship_basis.TW = `${fmt(naza.tw.per_order_vnd)}đ/đơn = trung bình ${fmt(naza.tw.parcels)} kiện trong ${naza.tw.periods} kỳ sao kê NAZA (phí vận chuyển + phí thao tác, quy VND theo tỷ giá từng kỳ).`;
        }
        const sg = nuoc.get("SG");
        if (SG_FEES && naza.can && sg && sg.orders > sg.orders_no_ship) {
            ship_basis.SG = `trung bình ${fmt(sg.ship_vnd / (sg.orders - sg.orders_no_ship))}đ/đơn theo bảng giá Singapore: chặng đầu `
                + `${SG_FEES.first_leg_per_100g?.thuong} tệ/0,1 kg × ${naza.can.nac_100g_tb.toFixed(2)} (cân tính phí trung bình `
                + `${naza.can.kg_tb.toFixed(2)} kg của ${fmt(naza.can.kien)} kiện NAZA Đài) + chặng cuối ${SG_FEES.last_leg?.first_2kg} tệ `
                + `+ gửi lẻ ${SG_FEES.single_parcel_fee || 0} tệ + thu hộ COD ${((SG_FEES.cod_fee?.pct || 0) * 100).toFixed(0)}% tiền đơn `
                + `(tối thiểu ${SG_FEES.cod_fee?.min || 0} tệ), quy ${fmt(COST_RATE_RMB_VND)}đ/tệ. Chưa gồm phí hàng hoàn.`;
        }

        return NextResponse.json({
            from, to,
            total: tong,
            days: [...ngay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, b]) => ({ date, ...b })),
            markets: [...nuoc.entries()].map(([code, b]) => ({
                code, ...b,
                ship_per_order_vnd: b.orders > b.orders_no_ship ? b.ship_vnd / (b.orders - b.orders_no_ship) : null,
            })),
            ship_basis,
            missing_costs: [...thieu.values()]
                .map((t) => ({ ma: t.ma, ten: t.ten, qty: t.qty, orders: t.don.size }))
                .sort((a, b) => b.orders - a.orders),
            cost_rate_rmb_vnd: COST_RATE_RMB_VND,
        });
    } catch (e: any) {
        console.error("pnl-costs:", e?.message || e);
        return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
    }
}
