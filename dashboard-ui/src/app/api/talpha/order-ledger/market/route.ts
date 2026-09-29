import { NextRequest, NextResponse } from "next/server";
import { bigquery } from "@/lib/bigquery";
import { MARKETS_PUBLIC, PHONE_RULES } from "@/lib/talpha/rules";
import { buildAlerts, trackMarket } from "@/lib/talpha/tracking";
import { loadMarketShipments } from "@/lib/talpha/tracking-market";
import { buildMarketLedger, type ProductInfo } from "@/lib/talpha/market-ledger";

export const dynamic = "force-dynamic";

const BQ_PROJECT = process.env.NEXT_PUBLIC_BQ_PROJECT || "cty-507710";
const BQ_DATASET = process.env.DATASET || "TALPHA_Dataset";

// ═══════════════════════════════════════════════════════════════════
// SỔ ĐƠN HÀNG — THỊ TRƯỜNG NGOÀI ĐÀI (Sỹ Anh yêu cầu 29/09/2026)
//
//   GET ?market=SG|AE — mọi đơn của nước đó: khách, hàng, trạng thái giao, đèn việc phải làm,
//                       link WhatsApp của khách.
//
// Đơn và trạng thái đọc CHUNG hàm với Theo dõi vận đơn và Đối soát COD (loadMarketShipments):
//   • Singapore: bảng đối tác (BigQuery partner_orders) + 17TRACK;
//   • UAE: đơn POS + trạng thái tra ở WeShip.
// Hàng của đơn đọc thêm: Singapore ở cột SKU của bảng đối tác, UAE ở dòng hàng POS (order_items).
// Đài Loan KHÔNG đi qua đây: sổ Đài là /api/talpha/order-ledger (bảng NAZA + sao kê NAZA).
// ═══════════════════════════════════════════════════════════════════

type Empty = { registered: Record<string, never>; statuses: Record<string, unknown>; last_sync?: { at: string; ok: boolean } };

/** Hàng của từng đơn. Đọc hỏng thì trả rỗng kèm lời báo — sổ vẫn hiện đơn, chỉ thiếu cột hàng. */
async function docHang(code: string, partnerMarket: string | null): Promise<{ map: Map<string, ProductInfo>; loi: string | null }> {
    const map = new Map<string, ProductInfo>();
    try {
        if (partnerMarket) {
            const [rows] = await bigquery.query({
                query: `SELECT order_no, sku, SAFE_CAST(quantity AS INT64) AS quantity
                        FROM \`${BQ_PROJECT}.${BQ_DATASET}.partner_orders\` WHERE market = @m`,
                params: { m: partnerMarket },
            });
            for (const r of rows as { order_no: string; sku: string | null; quantity: number | null }[]) {
                const k = String(r.order_no || "").trim();
                if (!k || map.has(k)) continue;
                map.set(k, { sku: String(r.sku || "").trim(), quantity: r.quantity ?? null });
            }
        } else {
            const [rows] = await bigquery.query({
                query: `SELECT i.order_id, i.product_name, i.variation_name, SAFE_CAST(i.quantity AS INT64) AS quantity
                        FROM \`${BQ_PROJECT}.${BQ_DATASET}.order_items\` i
                        JOIN (SELECT DISTINCT shop_id, order_id FROM \`${BQ_PROJECT}.${BQ_DATASET}.vw_orders_std\` WHERE market = @m) v
                          ON v.shop_id = i.shop_id AND v.order_id = i.order_id
                        ORDER BY i.order_id, i.product_name`,
                params: { m: code },
            });
            const gop = new Map<string, { ten: string[]; sl: number }>();
            for (const r of rows as { order_id: string; product_name: string | null; variation_name: string | null; quantity: number | null }[]) {
                const k = String(r.order_id || "");
                const g = gop.get(k) || { ten: [], sl: 0 };
                const sl = Number(r.quantity) || 0;
                const ten = [r.product_name, r.variation_name].filter(Boolean).join(" · ") || "(không tên)";
                g.ten.push(sl > 1 ? `${ten} ×${sl}` : ten);
                g.sl += sl;
                gop.set(k, g);
            }
            for (const [k, g] of gop) map.set(k, { sku: g.ten.join(", "), quantity: g.sl || null });
        }
        return { map, loi: null };
    } catch (e) {
        console.warn("order-ledger/market: không đọc được hàng của đơn:", e);
        return { map, loi: "Không đọc được sản phẩm của đơn — cột Hàng đang trống." };
    }
}

export async function GET(req: NextRequest) {
    const code = String(req.nextUrl.searchParams.get("market") || "").toUpperCase();
    const m = MARKETS_PUBLIC.markets.find((x) => x.code === code);
    const tm = trackMarket(code);
    if (!m || code === "TW" || tm.code !== code) {
        return NextResponse.json({ error: "market phải là mã một nước ngoài Đài đã khai tracking.markets (SG, AE)" }, { status: 400 });
    }
    try {
        const { shipments, store, lastImport } = await loadMarketShipments(tm, (): Empty => ({ registered: {}, statuses: {} }));
        const alerts = buildAlerts(shipments, new Date(), { staleDays: tm.stale_days });
        const hang = await docHang(code, tm.source === "partner" ? tm.partner_market : null);
        const rows = buildMarketLedger(shipments, hang.map, alerts, {
            rateVnd: m.rate_vnd,
            phone: PHONE_RULES[code] ?? null,
            carrier: tm.provider === "weship" ? "WeShip" : undefined,
            currency: m.currency,
        });
        const laPos = tm.source === "pos";
        return NextResponse.json({
            market: { code: m.code, display: m.display, currency: m.currency, symbol: m.symbol, rate_vnd: m.rate_vnd },
            nguon: laPos
                ? { nhan: "Đơn POS + trạng thái tra ở WeShip", cap_nhat: store.last_sync?.ok ? store.last_sync.at : null, loai: "tra" }
                : { nhan: "Bảng đối tác + 17TRACK", cap_nhat: lastImport, loai: "nap" },
            canh_bao: hang.loi,
            rows,
        });
    } catch (e) {
        console.error("order-ledger/market lỗi:", e);
        return NextResponse.json({ error: "Không đọc được đơn của nước này" }, { status: 500 });
    }
}
