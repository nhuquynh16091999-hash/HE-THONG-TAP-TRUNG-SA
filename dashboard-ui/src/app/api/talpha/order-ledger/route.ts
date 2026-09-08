import { NextRequest, NextResponse } from "next/server";
import { readStoreFresh } from "@/lib/talpha/store";
import {
    buildLedger, summarise,
    type OrderSource, type PaidLine, type FeeLine,
} from "@/lib/talpha/order-ledger";
import type { StatementRow } from "@/lib/talpha/cod-recon";
import type { NazaStatement } from "@/lib/talpha/naza-statement";
import { PARTNER_STATUS_VI } from "@/lib/talpha/partner-file";

export const dynamic = "force-dynamic";

// ═══════════════════════════════════════════════════════════════════
// SỔ ĐƠN HÀNG — một dòng mỗi đơn, kèm đủ vòng đời của tiền.
//
// Ghép ba kho lại:
//   kho `tracking`         → đơn, khách, hàng, trạng thái giao (từ file đối tác)
//   kho `cod_statements`   → tiền 3PL đã trả + phí từng đơn + tỷ giá từng kỳ
//   config products        → giá vốn
//
// Chỉ ĐỌC. Mọi thay đổi dữ liệu đi qua route tracking/import và cod-recon.
// ═══════════════════════════════════════════════════════════════════

type PartnerMeta = {
    order_no: string; ship_method: string; cod_local: number; marketer: string;
    recon: string; store_name: string; store_code: string;
    ship_date: string | null; track17_code: string | null;
    order_date?: string | null;
    contact_name?: string; phone?: string;
    sku?: string; quantity?: string;
    return_order_no?: string;
};
type TrackingStore = {
    statuses: Record<string, { status: string | null; raw_status?: string | null;
        order_date?: string | null; ship_date?: string | null }>;
    partner?: Record<string, PartnerMeta>;
};

type Statement = {
    id: string; filename: string; uploaded_at: string;
    rows: StatementRow[];
    naza?: {
        summary: NazaStatement["summary"];
        fee_lines: NazaStatement["fee_lines"];
        checks: NazaStatement["checks"];
        fee_audit: NazaStatement["fee_audit"];
    };
};

export async function GET(req: NextRequest) {
    const q = req.nextUrl.searchParams;
    const asOf = /^\d{4}-\d{2}-\d{2}$/.test(q.get("to") || "")
        ? (q.get("to") as string)
        : new Date().toISOString().slice(0, 10);

    try {
        const track = await readStoreFresh<TrackingStore>("tracking", { statuses: {}, partner: {} });
        const stm = await readStoreFresh<{ statements: Statement[] }>("cod_statements", { statements: [] });

        // ── Đơn ────────────────────────────────────────────────────────
        const partner = track.partner || {};
        const orders: OrderSource[] = Object.entries(partner).map(([tracking, p]) => {
            const st = track.statuses[tracking];
            return {
                order_no: p.order_no || tracking,
                tracking,
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

        const { rows, extra } = buildLedger(orders, paid, fees, { asOf });
        const summary = summarise(rows, extra);

        // ── Cảnh báo ở mức kỳ ─────────────────────────────────────────
        const notes: string[] = [];
        if (!orders.length) {
            notes.push("Chưa có đơn nào. Vào tab Theo dõi vận đơn bấm “Đọc bảng đối tác” để nạp.");
        }
        if (!stm.statements.length) {
            notes.push("Chưa tải bản sao kê nào — chưa biết đơn nào đã về tiền.");
        }
        if (summary.cogs_missing_orders) {
            const codes = [...new Set(rows.flatMap((r) => r.cogs_missing))].sort();
            notes.push(
                `${summary.cogs_missing_orders}/${summary.total} đơn chưa tính được giá vốn ` +
                `(thiếu ${codes.length} mã: ${codes.slice(0, 12).join(", ")}${codes.length > 12 ? "…" : ""}). ` +
                "Khai vào talpha_rules.json → products.<mã>.cost_price_rmb (giá nhập bằng TỆ). " +
                "Chừng nào chưa khai, cột “Còn lại” mới là số TRƯỚC giá vốn.",
            );
        }
        if (summary.extra_lines) {
            notes.push(
                `${summary.extra_lines} dòng sao kê không ghép được vào đơn nào — ` +
                "3PL trả cho đơn mình không có. Tra lại mã vận đơn.",
            );
        }
        const wrongFee = rows.filter((r) => r.fee_wrong).length;
        if (wrongFee) notes.push(`${wrongFee} đơn bị tính phí sai bảng giá.`);

        return NextResponse.json({
            as_of: asOf,
            rows,
            summary,
            extra,
            status_vi: PARTNER_STATUS_VI,
            statements: stm.statements.map((s) => ({ id: s.id, filename: s.filename })),
            warnings: notes,
        });
    } catch (e) {
        console.error("order-ledger GET lỗi:", e);
        return NextResponse.json({ error: "Không dựng được sổ đơn hàng" }, { status: 500 });
    }
}
