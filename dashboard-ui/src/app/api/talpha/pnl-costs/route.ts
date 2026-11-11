import { NextRequest, NextResponse } from "next/server";
import { COST_RATE_RMB_VND, MARKETS_PUBLIC, REPORT_START_DATE } from "@/lib/talpha/rules";
import { tyLeGiao, type TyLeGiao } from "@/lib/talpha/lai-lo";
import { CFG_TY_LE, KQKD, napKienNuoc } from "@/lib/talpha/lai-lo-nguon";
import { homNayVN } from "@/lib/talpha/order-ledger";
import { tinhChiPhiDon, type DonChiPhi } from "@/lib/talpha/order-costs";
import { getAccess } from "@/lib/talpha/access";
import { canMarket, seesAllMarkets } from "@/lib/talpha/access-rules";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Chi phí cho tab P&L và Tổng quan: GIÁ VỐN và PHÍ SHIP của mọi đơn đã chốt, theo ngày và
// theo nước. Doanh số, tiền ads, số đơn hai tab lấy từ file TỔNG TEAM (sheet-report) — route
// này chỉ thêm hai khoản Sheet không có. Cách tính nằm ở lib/talpha/order-costs.ts, dùng chung
// với tab P&L theo SP (/api/talpha/product-pnl).
//
// ?ty_le=1 (tab P&L, 11/11/2026): thêm TỈ LỆ GIAO THÀNH CÔNG từng nước — cùng thước với
// Kế toán → Lãi lỗ (lib/talpha/lai-lo.ts → tyLeGiao, đo theo tiền COD trên kiện đã có kết quả
// lên đơn 90→21 ngày trước). Tab P&L nhân doanh số với tỉ lệ này ra doanh thu dự kiến.
export async function GET(req: NextRequest) {
    const sp = req.nextUrl.searchParams;
    const fromIn = sp.get("from") || "";
    const to = sp.get("to") || "";
    if (!DATE_RE.test(fromIn) || !DATE_RE.test(to)) {
        return NextResponse.json({ error: "from/to phải dạng YYYY-MM-DD" }, { status: 400 });
    }
    const from = REPORT_START_DATE && fromIn < REPORT_START_DATE ? REPORT_START_DATE : fromIn;

    // Phân quyền theo team: chỉ đơn của nước người xem được (proxy.ts đã chặn người chưa đăng nhập).
    const a = await getAccess(req);
    const hep = !a || !seesAllMarkets(a);

    try {
        const { don, thieu, ship_basis } = await tinhChiPhiDon(from, to, hep ? (shop) => !!a && canMarket(a, shop) : undefined);

        type Bucket = { orders: number; cogs_vnd: number; orders_cogs_full: number; ship_vnd: number; orders_no_ship: number };
        const rong = (): Bucket => ({ orders: 0, cogs_vnd: 0, orders_cogs_full: 0, ship_vnd: 0, orders_no_ship: 0 });
        const cong = (b: Bucket, o: DonChiPhi) => {
            b.orders += 1;
            b.cogs_vnd += o.cogs;
            if (o.du) b.orders_cogs_full += 1;
            if (o.ship === null) b.orders_no_ship += 1; else b.ship_vnd += o.ship;
        };
        const tong = rong();
        const ngay = new Map<string, Bucket>();
        const nuoc = new Map<string, Bucket>();
        const ngayNuoc = new Map<string, Bucket>();
        for (const o of don) {
            cong(tong, o);
            const n = ngay.get(o.d) || rong(); cong(n, o); ngay.set(o.d, n);
            const m = nuoc.get(o.shop) || rong(); cong(m, o); nuoc.set(o.shop, m);
            const k = `${o.shop}|${o.d}`;
            const nn = ngayNuoc.get(k) || rong(); cong(nn, o); ngayNuoc.set(k, nn);
        }

        // Tỉ lệ giao từng nước đang bán mà người xem được. Nước nào đọc kiện lỗi thì để null +
        // ghi lỗi — giao diện báo ra, không bịa tỉ lệ.
        let ty_le_giao: Record<string, (TyLeGiao & { loi?: string }) | { r: null; loi: string }> | undefined;
        if (sp.get("ty_le") === "1") {
            const homNay = homNayVN();
            const asOf = to < homNay ? to : homNay;
            const nuocXem = MARKETS_PUBLIC.markets
                .filter((m) => m.status === "dang_ban" && (!hep || (!!a && canMarket(a, m.code))));
            ty_le_giao = Object.fromEntries(await Promise.all(nuocXem.map(async (m) => {
                try {
                    const n = await napKienNuoc(m.code, from, to, asOf);
                    return [m.code, tyLeGiao(n.kien, asOf, CFG_TY_LE)] as const;
                } catch (e: any) {
                    console.error(`pnl-costs ty_le ${m.code}:`, e?.message || e);
                    return [m.code, { r: null, loi: e?.message || String(e) }] as const;
                }
            })));
        }

        return NextResponse.json({
            from, to,
            total: tong,
            days: [...ngay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, b]) => ({ date, ...b })),
            markets: [...nuoc.entries()].map(([code, b]) => ({
                code, ...b,
                ship_per_order_vnd: b.orders > b.orders_no_ship ? b.ship_vnd / (b.orders - b.orders_no_ship) : null,
            })),
            market_days: [...ngayNuoc.entries()].sort(([x], [y]) => x.localeCompare(y)).map(([k, b]) => {
                const [code, date] = k.split("|");
                return { code, date, ...b };
            }),
            ty_le_giao,
            // Nước mà hàng hoàn quay về kho bán tiếp → đơn hoàn KHÔNG mất giá vốn (UAE — kho D&T).
            hoan_ve_kho: (KQKD.hang_hoan?.quay_lai_kho_ban_tiep || ["AE"]).map((x) => x.toUpperCase()),
            ship_basis,
            missing_costs: thieu,
            cost_rate_rmb_vnd: COST_RATE_RMB_VND,
        });
    } catch (e: any) {
        console.error("pnl-costs:", e?.message || e);
        return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
    }
}
