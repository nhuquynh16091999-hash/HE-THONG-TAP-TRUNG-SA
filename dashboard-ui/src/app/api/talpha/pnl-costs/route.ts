import { NextRequest, NextResponse } from "next/server";
import { COST_RATE_RMB_VND, REPORT_START_DATE } from "@/lib/talpha/rules";
import { tinhChiPhiDon, type DonChiPhi } from "@/lib/talpha/order-costs";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Chi phí cho tab P&L và Tổng quan: GIÁ VỐN và PHÍ SHIP của mọi đơn đã chốt, theo ngày và
// theo nước. Doanh số, tiền ads, số đơn hai tab lấy từ file TỔNG TEAM (sheet-report) — route
// này chỉ thêm hai khoản Sheet không có. Cách tính nằm ở lib/talpha/order-costs.ts, dùng chung
// với tab P&L theo SP (/api/talpha/product-pnl).
export async function GET(req: NextRequest) {
    const sp = req.nextUrl.searchParams;
    const fromIn = sp.get("from") || "";
    const to = sp.get("to") || "";
    if (!DATE_RE.test(fromIn) || !DATE_RE.test(to)) {
        return NextResponse.json({ error: "from/to phải dạng YYYY-MM-DD" }, { status: 400 });
    }
    const from = REPORT_START_DATE && fromIn < REPORT_START_DATE ? REPORT_START_DATE : fromIn;

    try {
        const { don, thieu, ship_basis } = await tinhChiPhiDon(from, to);

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
        for (const o of don) {
            cong(tong, o);
            const n = ngay.get(o.d) || rong(); cong(n, o); ngay.set(o.d, n);
            const m = nuoc.get(o.shop) || rong(); cong(m, o); nuoc.set(o.shop, m);
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
            missing_costs: thieu,
            cost_rate_rmb_vnd: COST_RATE_RMB_VND,
        });
    } catch (e: any) {
        console.error("pnl-costs:", e?.message || e);
        return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
    }
}
