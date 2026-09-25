import { NextRequest, NextResponse } from "next/server";
import { bigquery } from "@/lib/bigquery";
import { COST_RATE_RMB_VND, POS_TIMEZONE, REPORT_START_DATE, costPriceVnd } from "@/lib/talpha/rules";
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
// Sổ đơn hàng đọc cột SKU của file đối tác (productCodes · costPriceVnd). Không đi qua
// vw_orders_std: view nối qua bảng product_catalog, mà bảng đó 0 dòng từ ngày dựng dự án
// nên cogs_vnd của view luôn 0. Mã chưa khai giá KHÔNG coi là 0 — trả ra danh sách thiếu.
//
// PHÍ SHIP: chưa có phí từng đơn trước khi 3PL gửi sao kê, nên ƯỚC TÍNH = số đơn × phí
// trung bình một kiện trong các kỳ sao kê NAZA đã tải lên (tab Đối soát COD). Nước chưa
// có sao kê thì không đoán — trả null để giao diện ghi "thiếu".
// ═══════════════════════════════════════════════════════════════════

type FeeLine = { ship_fee?: number; op_fee?: number };
type Statement = {
    filename?: string;
    naza?: {
        summary?: { rate_rmb_vnd?: number | null; fees_combined?: boolean };
        fee_lines?: FeeLine[];
    };
};

// Sao kê trong kho hiện chỉ có NAZA Đài Loan (shop TW). Singapore dự kiến cũng đi NAZA
// nhưng chưa có kỳ nào — có thì sao kê cần ghi nước để tách, chưa tới lúc đó.
const SAO_KE_THEO_SHOP: Record<string, true> = { TW: true };

async function phiShipTrungBinh() {
    const kho = await readStoreFresh<{ statements: Statement[] }>("cod_statements", { statements: [] });
    let kien = 0, vnd = 0, ky = 0;
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
        }
    }
    return kien ? { per_order_vnd: vnd / kien, parcels: kien, periods: ky } : null;
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
                           DATE(TIMESTAMP(inserted_at), @tz) AS d
                    FROM \`${BQ_PROJECT}.${BQ_DATASET}.sale_order\`
                    WHERE DATE(TIMESTAMP(inserted_at), @tz) BETWEEN @from AND @to
                      AND status_category NOT IN ('HUY', 'DON_THO')
                      -- Đơn trống (0 sản phẩm, 0 tiền) — Sheet không đếm (sql_la_don_trong).
                      AND NOT (IFNULL(SAFE_CAST(total_quantity AS FLOAT64), 0) = 0
                               AND IFNULL(total_price, 0) = 0 AND IFNULL(cod, 0) = 0)
                )
                SELECT don.id, don.shop, CAST(don.d AS STRING) AS d,
                       i.product_name, i.variation_name, IFNULL(i.quantity, 0) AS qty
                FROM don
                LEFT JOIN \`${BQ_PROJECT}.${BQ_DATASET}.order_items\` i
                       ON CAST(i.order_id AS STRING) = don.id AND i.shop_id = don.shop_id`,
            params: { from, to, tz: POS_TIMEZONE },
        });

        // Gom theo đơn: giá vốn đã biết + đơn có dòng nào chưa có giá không.
        type Don = { shop: string; d: string; cogs: number; du: boolean };
        const donMap = new Map<string, Don>();
        const thieu = new Map<string, { ma: string; ten: string; qty: number; don: Set<string> }>();
        for (const r of rows as any[]) {
            const key = `${r.shop}-${r.id}`;
            const o = donMap.get(key) || { shop: r.shop, d: r.d, cogs: 0, du: true };
            donMap.set(key, o);
            if (r.product_name == null && r.variation_name == null) { o.du = false; continue; }  // đơn không có dòng hàng
            const ten = `${r.product_name || ""} ${r.variation_name || ""}`.trim();
            const qty = Number(r.qty || 0);
            const codes = productCodes(ten);
            const ghiThieu = (ma: string) => {
                const t = thieu.get(ma) || { ma, ten, qty: 0, don: new Set<string>() };
                t.qty += qty; t.don.add(key); thieu.set(ma, t);
                o.du = false;
            };
            if (!codes.length) { ghiThieu(ten || "(không tên)"); continue; }
            for (const c of codes) {
                const gia = costPriceVnd(c);
                if (gia === null) ghiThieu(c);
                else o.cogs += gia * qty;
            }
        }

        const ship = await phiShipTrungBinh();
        const shipDon = (shop: string) => (SAO_KE_THEO_SHOP[shop] && ship ? ship.per_order_vnd : null);

        type Bucket = { orders: number; cogs_vnd: number; orders_cogs_full: number; ship_vnd: number; orders_no_ship: number };
        const rong = (): Bucket => ({ orders: 0, cogs_vnd: 0, orders_cogs_full: 0, ship_vnd: 0, orders_no_ship: 0 });
        const cong = (b: Bucket, o: Don) => {
            b.orders += 1;
            b.cogs_vnd += o.cogs;
            if (o.du) b.orders_cogs_full += 1;
            const s = shipDon(o.shop);
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

        return NextResponse.json({
            from, to,
            total: tong,
            days: [...ngay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, b]) => ({ date, ...b })),
            markets: [...nuoc.entries()].map(([code, b]) => ({ code, ...b, ship_per_order_vnd: shipDon(code) })),
            ship_basis: ship ? { ...ship, shops: Object.keys(SAO_KE_THEO_SHOP) } : null,
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
