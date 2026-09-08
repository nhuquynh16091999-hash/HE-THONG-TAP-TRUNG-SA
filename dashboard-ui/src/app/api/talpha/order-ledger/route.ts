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

        // NGÀY CHỐT của từng kỳ = ngày nhận hàng muộn nhất trong sheet COD của kỳ
        // đó. Dùng chính dữ liệu của kỳ chứ không dùng ngày tải file lên: tải lên
        // lúc nào là chuyện của người, còn kỳ chốt tới đâu là chuyện của NAZA.
        const periodDates = stm.statements
            .map((st) => st.rows.reduce((mx, r) => (r.paid_date > mx ? r.paid_date : mx), ""))
            .filter(Boolean);

        const { rows, extra } = buildLedger(orders, paid, fees, { asOf, periodDates });
        const summary = summarise(rows, extra);

        // ── BÁO CÁO TỪNG KỲ SAO KÊ ────────────────────────────────────
        //
        // Việc thật của mỗi tuần, đúng lời Sỹ Anh: "bên vận chuyển gửi file đối
        // soát — những đơn nào về, và có bị lệch không". Bốn loại lệch, do chính
        // Sỹ Anh chốt:
        //   1. 3PL trả khác số trên đơn
        //   2. Đã giao mà chưa về tiền   (không thuộc kỳ nào — tính toàn cục)
        //   3. 3PL trả cho đơn mình không có
        //   4. Phí thu sai bảng giá
        //
        // Tính theo TỪNG KỲ chứ không gộp: một tuần một file, và câu hỏi luôn là
        // "kỳ NÀY có vấn đề gì", không phải "từ đầu tới giờ".
        const byPeriod = stm.statements.map((st) => {
            const mine = rows.filter((r) => r.paid_period === st.filename);
            const lech = mine.filter((r) => r.diff_twd !== null && Math.abs(r.diff_twd) > 1);
            const phiSai = mine.filter((r) => r.fee_wrong);
            const thua = extra.filter((e) => e.period === st.filename);
            const n = st.naza;
            // NGÀY CHỐT KỲ = ngày nhận hàng muộn nhất trong sheet COD của kỳ đó.
            // KHÔNG dùng uploaded_at để sắp thứ tự: tải bảy file lên cùng một lúc
            // thì thời điểm tải gần như bằng nhau và "kỳ mới nhất" hoá ra chỉ vào
            // kỳ cũ nhất. Đã dính thật.
            const periodDate = st.rows.reduce((mx, r) => (r.paid_date > mx ? r.paid_date : mx), "");
            return {
                id: st.id,
                filename: st.filename,
                uploaded_at: st.uploaded_at,
                period_date: periodDate,
                orders_paid: mine.length,
                total_twd: mine.reduce((a, r) => a + (r.paid_twd ?? 0), 0),
                fee_rmb: mine.reduce((a, r) => a + (r.ship_fee_rmb ?? 0) + (r.op_fee_rmb ?? 0), 0),
                // Bốn loại lệch
                lech_tien: lech.map((r) => ({
                    order_no: r.order_no, tracking: r.tracking,
                    cod_twd: r.cod_twd, paid_twd: r.paid_twd, diff_twd: r.diff_twd,
                })),
                phi_sai: phiSai.map((r) => ({
                    order_no: r.order_no, tracking: r.tracking, ship_fee_rmb: r.ship_fee_rmb,
                })),
                thua_sao_ke: thua.map((e) => ({
                    order_no: e.order_no, tracking: e.tracking, amount_twd: e.amount_twd,
                })),
                // Phép quyết toán của chính kỳ đó, do NAZA khai
                settlement: n ? {
                    cod_twd: n.summary.cod_twd,
                    rate_twd_rmb: n.summary.rate_twd_rmb,
                    ship_fee_rmb: n.summary.ship_fee_rmb,
                    op_fee_rmb: n.summary.op_fee_rmb,
                    rate_rmb_vnd: n.summary.rate_rmb_vnd,
                    purchase_vnd: n.summary.purchase_vnd,
                    payable_vnd: n.summary.payable_vnd,
                    math_ok: n.checks.math_ok,
                    math_note: n.checks.math_note,
                } : null,
            };
        }).sort((a, b) => (a.period_date < b.period_date ? 1 : -1));

        // Loại lệch thứ 2 KHÔNG thuộc kỳ nào: đơn đã giao mà chưa kỳ nào trả
        // tiền. Gắn nó vào một kỳ cụ thể là sai — nó là món nợ đang treo.
        const chuaVeTien = rows
            .filter((r) => (r.light === "vang" || r.light === "do") && r.paid_twd === null)
            .map((r) => ({
                order_no: r.order_no, tracking: r.tracking, cod_twd: r.cod_twd,
                age_days: r.age_days, ky_da_qua: r.ky_da_qua, qua_han: r.light === "do",
                contact_name: r.contact_name, phone: r.phone,
            }))
            .sort((a, b) => b.ky_da_qua - a.ky_da_qua || b.cod_twd - a.cod_twd);

        // ── VIỆC PHẢI LÀM HÔM NAY ─────────────────────────────────────
        //
        // Đây là thứ ĐẦU TIÊN Sỹ Anh muốn thấy khi mở màn: "hôm nay có việc gì
        // cần làm không". Không có việc thì phải NÓI RÕ là không có, chứ không
        // để màn hình trống cho người đọc tự đoán.
        //
        // Mọi việc ở đây TỰ HẾT khi tiền về — không có nút "đã làm", vì Sỹ Anh
        // chốt là máy tự lo, không thêm thao tác tay.
        const moiNhat = byPeriod[0];
        const quaHan = chuaVeTien.filter((x) => x.qua_han);
        const viec: { id: string; muc: "gap" | "soat" | "ghi"; tieu_de: string;
            so: number; don_vi: string; chi_tiet: string; }[] = [];

        if (quaHan.length) {
            viec.push({
                id: "doi-naza", muc: "gap",
                tieu_de: "Nhắn NAZA đòi tiền",
                so: quaHan.length, don_vi: "đơn",
                chi_tiet: `Đã qua từ 2 kỳ sao kê mà vẫn chưa được trả — tổng ` +
                    `${Math.round(quaHan.reduce((a, x) => a + x.cod_twd, 0)).toLocaleString("vi-VN")} TWD. ` +
                    "Bấm Xuất file gửi 3PL để lấy danh sách.",
            });
        }
        if (moiNhat?.lech_tien.length) {
            viec.push({
                id: "lech-tien", muc: "soat",
                tieu_de: "Soi đơn 3PL trả khác số",
                so: moiNhat.lech_tien.length, don_vi: "đơn",
                chi_tiet: moiNhat.lech_tien.slice(0, 3).map((l) =>
                    `${l.order_no}: đơn ghi ${l.cod_twd} · họ trả ${l.paid_twd}`).join(" · "),
            });
        }
        if (moiNhat?.thua_sao_ke.length) {
            viec.push({
                id: "thua", muc: "soat",
                tieu_de: "Tra lại đơn NAZA trả mà mình không có",
                so: moiNhat.thua_sao_ke.length, don_vi: "dòng",
                chi_tiet: moiNhat.thua_sao_ke.slice(0, 3).map((t) =>
                    `${t.order_no} · ${t.tracking}`).join(" · "),
            });
        }
        if (moiNhat?.phi_sai.length) {
            viec.push({
                id: "phi-sai", muc: "soat",
                tieu_de: "Hỏi NAZA về phí thu sai bảng giá",
                so: moiNhat.phi_sai.length, don_vi: "đơn",
                chi_tiet: moiNhat.phi_sai.slice(0, 3).map((f) => f.order_no).join(" · "),
            });
        }
        if (moiNhat?.settlement?.payable_vnd != null) {
            viec.push({
                id: "ghi-so", muc: "ghi",
                tieu_de: "Ghi sổ kế toán kỳ mới nhất",
                so: Math.round(moiNhat.settlement.payable_vnd), don_vi: "đ",
                chi_tiet: `Tiền thực nhận về tài khoản của kỳ ${moiNhat.filename}. ` +
                    "Đối chiếu với sao kê ngân hàng rồi ghi vào sổ.",
            });
        }

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
            viec,
            periods: byPeriod,
            chua_ve_tien: chuaVeTien,
            statements: stm.statements.map((s) => ({ id: s.id, filename: s.filename })),
            warnings: notes,
        });
    } catch (e) {
        console.error("order-ledger GET lỗi:", e);
        return NextResponse.json({ error: "Không dựng được sổ đơn hàng" }, { status: 500 });
    }
}
