import { NextRequest, NextResponse } from "next/server";
import { bigquery } from "@/lib/bigquery";
import { MARKETS_PUBLIC } from "@/lib/talpha/rules";
import { trackMarket } from "@/lib/talpha/tracking";
import { loadMarketShipments } from "@/lib/talpha/tracking-market";
import { trackingFromLink } from "@/lib/talpha/cod-recon";
import {
    nhanTrangThai, nhanTrangThaiPos, nhomTheoPos, nhomTheoVanDon, tongHopCod, type DonCod,
} from "@/lib/talpha/cod-market";

export const dynamic = "force-dynamic";

const BQ_PROJECT = process.env.NEXT_PUBLIC_BQ_PROJECT || "cty-507710";
const BQ_DATASET = process.env.DATASET || "TALPHA_Dataset";

// ═══════════════════════════════════════════════════════════════════
// ĐỐI SOÁT COD — THỊ TRƯỜNG NGOÀI ĐÀI (bước 1, Sỹ Anh chốt 26/09/2026)
//
//   GET ?market=SG|AE — tiền còn ở đâu: đã giao (bên giao hàng đang giữ) / chưa giao
//                       (ngoài đường) / không tính (hoàn, huỷ), kèm danh sách đơn.
//
// Nguồn chọn theo nước, CÙNG hàm đọc với màn Theo dõi vận đơn (lib/talpha/tracking-market.ts)
// để hai màn không lệch được:
//   • Singapore: bảng đối tác + 17TRACK;
//   • UAE (từ 28/09/2026): đơn POS + trạng thái tra ở trang WeShip. Trước đó UAE đọc trạng thái
//     POS — sai: POS ghi "shipped" cả đơn khách đã từ chối;
//   • nước chưa khai tracking.markets: trạng thái đơn trên POS.
// Chưa có sao kê bên giao hàng nào của các nước này — khớp từng kỳ là bước 2, làm khi có file.
// Đài Loan KHÔNG đi qua đây: màn Đài dùng /api/talpha/cod-recon với sao kê NAZA.
// ═══════════════════════════════════════════════════════════════════

export async function GET(req: NextRequest) {
    const code = String(req.nextUrl.searchParams.get("market") || "").toUpperCase();
    const m = MARKETS_PUBLIC.markets.find((x) => x.code === code);
    if (!m || code === "TW") {
        return NextResponse.json({ error: "market phải là mã một nước ngoài Đài (SG, AE…)" }, { status: 400 });
    }

    try {
        let don: DonCod[] = [];
        let nguon: { loai: "doi_tac" | "weship" | "pos"; nhan: string; cap_nhat: string | null };

        const tm = trackMarket(code);
        if (tm.code === code) {
            const { shipments, store, lastImport } = await loadMarketShipments(tm,
                (): { registered: Record<string, never>; statuses: Record<string, unknown>; last_sync?: { at: string; ok: boolean } } =>
                    ({ registered: {}, statuses: {} }));
            const laPos = tm.source === "pos";
            don = shipments.map((s) => {
                const p = nhomTheoVanDon(s.status, s.sub_status);
                return {
                    order_id: s.order_id, tracking: s.track17_code || "", order_date: s.order_date,
                    // Đơn POS chưa có mã AWB = hàng chưa rời kho, đừng gọi là "Đã tạo vận đơn".
                    trang_thai: laPos && !s.track17_code ? "Chưa gửi hàng" : nhanTrangThai(s.status, s.raw_status),
                    nhom: p.nhom, ly_do: p.ly_do,
                    cod_local: Number(s.cod_local) || 0, khach: s.customer || "",
                };
            });
            nguon = laPos
                ? { loai: "weship", nhan: "Đơn POS + trạng thái tra ở WeShip", cap_nhat: store.last_sync?.ok ? store.last_sync.at : null }
                : { loai: "doi_tac", nhan: "Bảng đối tác + 17TRACK", cap_nhat: lastImport };
        } else {
            const [rows] = await bigquery.query({
                query: `SELECT v.order_id, CAST(v.order_date AS STRING) AS order_date,
                               v.status_category, v.status_name,
                               SAFE_DIVIDE(o.cod, NULLIF(v.pos_money_divisor, 0)) AS cod,
                               o.tracking_link, o.bill_full_name
                        FROM \`${BQ_PROJECT}.${BQ_DATASET}.vw_orders_std\` v
                        LEFT JOIN \`${BQ_PROJECT}.${BQ_DATASET}.sale_order\` o
                               ON v.shop_id = o.shop_id AND v.order_id = o.id
                        WHERE v.market = @m
                        ORDER BY v.order_date DESC`,
                params: { m: code },
            });
            for (const r of rows as Record<string, unknown>[]) {
                const p = nhomTheoPos(r.status_category as string);
                if (!p) continue;
                don.push({
                    order_id: String(r.order_id ?? ""),
                    tracking: trackingFromLink(r.tracking_link as string | null) || "",
                    order_date: r.order_date ? String(r.order_date).slice(0, 10) : null,
                    trang_thai: nhanTrangThaiPos(r.status_name as string, r.status_category as string),
                    nhom: p.nhom, ly_do: p.ly_do,
                    cod_local: Number(r.cod) || 0,
                    khach: String(r.bill_full_name || ""),
                });
            }
            nguon = { loai: "pos", nhan: "Đơn trên POS (chưa có bảng đơn của bên giao hàng)", cap_nhat: null };
        }

        return NextResponse.json({
            market: { code: m.code, display: m.display, currency: m.currency, symbol: m.symbol, rate_vnd: m.rate_vnd },
            nguon,
            sao_ke: 0,
            tong: tongHopCod(don, m.rate_vnd),
            don,
        });
    } catch (e) {
        console.error("cod-recon/market lỗi:", e);
        return NextResponse.json({ error: "Không đọc được đơn của nước này" }, { status: 500 });
    }
}
