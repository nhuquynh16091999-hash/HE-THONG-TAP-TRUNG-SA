// ═══════════════════════════════════════════════════════════════════
// SỔ ĐƠN ĐÀI — nạp bốn nguồn rồi ghép thành từng dòng (buildLedger).
//
// Tách khỏi app/api/talpha/order-ledger/route.ts ngày 04/11/2026 để tab Lãi lỗ
// (/api/talpha/lai-lo) đọc ĐÚNG cùng một sổ với Sổ đơn hàng và Tiền COD về: cùng
// cách ghép kiện ↔ tiền NAZA trả ↔ phí từng kiện ↔ tỷ giá từng kỳ. Chỉ ĐỌC.
// ═══════════════════════════════════════════════════════════════════
import { readStoreFresh } from "@/lib/talpha/store";
import {
    buildLedger, type OrderSource, type PaidLine, type FeeLine,
} from "@/lib/talpha/order-ledger";
import type { StatementRow } from "@/lib/talpha/cod-recon";
import { dienMaVanDonKho, type NazaStatement } from "@/lib/talpha/naza-statement";

export type PartnerMeta = {
    /** Mã vận đơn đúng như Sheet ghi. Kho cũ chưa có trường này thì khoá chính là mã. */
    tracking?: string;
    order_no: string; ship_method: string; cod_local: number; marketer: string;
    recon: string; store_name: string; store_code: string;
    ship_date: string | null; track17_code: string | null;
    order_date?: string | null;
    contact_name?: string; phone?: string;
    sku?: string; quantity?: string;
    return_order_no?: string;
};
export type TrackingStore = {
    statuses: Record<string, { status: string | null; raw_status?: string | null;
        order_date?: string | null; ship_date?: string | null }>;
    partner?: Record<string, PartnerMeta>;
    /** Lần nạp bảng đơn đối tác gần nhất — do route tracking/import ghi. */
    partner_import?: { filename?: string; imported_at?: string; rows?: number } | null;
};

export type Statement = {
    id: string; filename: string; uploaded_at: string;
    rows: StatementRow[];
    naza?: {
        summary: NazaStatement["summary"];
        fee_lines: NazaStatement["fee_lines"];
        checks: NazaStatement["checks"];
        fee_audit: NazaStatement["fee_audit"];
        sg_gop?: NazaStatement["sg_gop"];
    };
};

/** Nạp sổ đơn Đài tính tới ngày `asOf` (đếm kỳ sao kê đã qua, tuổi đơn). */
export async function napSoDonDai(asOf: string) {
    const track = await readStoreFresh<TrackingStore>("tracking", { statuses: {}, partner: {} });
    // Kỳ 05/10–16/10/2026 sheet COD bị đọc mất mã vận đơn (cột tên 运单号): điền lại từ
    // sheet PHÍ lúc đọc, không phải tải lại file. Xem dienMaVanDonTuPhi.
    const kho = await readStoreFresh<{ statements: Statement[] }>("cod_statements", { statements: [] });
    const stm = { ...kho, statements: dienMaVanDonKho(kho.statements) };

    // ── Đơn ────────────────────────────────────────────────────────
    const partner = track.partner || {};
    // Khoá kho thường là mã vận đơn, nhưng dòng dùng chung mã với dòng khác thì
    // khoá theo mã đơn (xem khoaChoDong) — nên mã vận đơn đọc từ trường riêng.
    const orders: OrderSource[] = Object.entries(partner).map(([khoa, p]) => {
        const st = track.statuses[khoa];
        return {
            order_no: p.order_no || khoa,
            tracking: p.tracking ?? khoa,
            track17_code: p.track17_code,
            return_order_no: p.return_order_no || "",
            order_date: st?.order_date || p.order_date || null,
            ship_date: p.ship_date || st?.ship_date || null,
            ship_method: p.ship_method || "",
            sku: p.sku || "",
            quantity: p.quantity || "1",
            contact_name: p.contact_name || "",
            phone: p.phone || "",
            cod_twd: Number(p.cod_local) || 0,
            status: st?.status || null,
            status_raw: st?.raw_status || "",
            recon_manual: p.recon || "",
            marketer: p.marketer || "",
        };
    });

    // ── Tiền vào và phí, gộp MỌI kỳ sao kê ────────────────────────
    //
    // Phải gộp: tiền của một đơn chỉ về đúng một lần, ở đúng một kỳ. Lấy
    // riêng một kỳ thì mọi đơn đã trả ở kỳ khác đều thành "chưa về tiền".
    //
    // Tỷ giá lấy theo TỪNG KỲ chứ không dùng chung một tỷ giá: bảy kỳ thật
    // có bảy tỷ giá khác nhau (0,1995 → 0,2037), lệch tới 2%.
    const paid: PaidLine[] = [];
    const fees: FeeLine[] = [];
    for (const s of stm.statements) {
        const rTwdRmb = s.naza?.summary?.rate_twd_rmb ?? null;
        const rRmbVnd = s.naza?.summary?.rate_rmb_vnd ?? null;
        for (const r of s.rows) {
            paid.push({
                tracking: r.tracking, order_no: r.order_id, amount_twd: r.amount,
                paid_date: r.paid_date, period: s.filename,
                rate_twd_rmb: rTwdRmb, rate_rmb_vnd: rRmbVnd,
            });
        }
        for (const f of s.naza?.fee_lines || []) {
            fees.push({
                tracking: f.tracking, order_no: f.order_id,
                ship_fee_rmb: f.ship_fee, op_fee_rmb: f.op_fee,
                expected_ship_fee: f.expected_ship_fee,
                period: s.filename, rate_rmb_vnd: rRmbVnd,
            });
        }
    }

    // NGÀY CHỐT của từng kỳ = ngày nhận hàng muộn nhất trong sheet COD của kỳ
    // đó. Dùng chính dữ liệu của kỳ chứ không dùng ngày tải file lên: tải lên
    // lúc nào là chuyện của người, còn kỳ chốt tới đâu là chuyện của NAZA.
    const periodDates = stm.statements
        .map((st) => st.rows.reduce((mx, r) => (r.paid_date > mx ? r.paid_date : mx), ""))
        .filter(Boolean);

    const { rows, extra } = buildLedger(orders, paid, fees, { asOf, periodDates });
    return { track, stm, orders, paid, fees, periodDates, rows, extra };
}
