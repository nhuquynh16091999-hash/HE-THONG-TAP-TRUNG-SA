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

        // ── TỶ GIÁ QUA CÁC KỲ ─────────────────────────────────────────
        //
        // Tỷ giá là số NAZA TỰ ĐẶT, không phải số thị trường, và họ đổi gần như
        // mỗi kỳ (đo thật: TWD→RMB 0,1995 → 0,2037, biến động 2,1%). Không ai
        // soát thì lệch 1% trên 300.000 TWD là ~2,3 triệu đồng bốc hơi lặng lẽ.
        // Nên so từng kỳ với kỳ LIỀN TRƯỚC và nói rõ lợi hay hại cho mình.
        const rateTrend = [...byPeriod].reverse().map((p, i, arr) => {
            const prev = i > 0 ? arr[i - 1] : null;
            const tw = p.settlement?.rate_twd_rmb ?? null;
            const rv = p.settlement?.rate_rmb_vnd ?? null;
            const pct = (a: number | null, b: number | null) =>
                a == null || b == null || b === 0 ? null : (a / b - 1) * 100;
            return {
                filename: p.filename, period_date: p.period_date,
                rate_twd_rmb: tw, rate_rmb_vnd: rv,
                d_twd_rmb: pct(tw, prev?.settlement?.rate_twd_rmb ?? null),
                d_rmb_vnd: pct(rv, prev?.settlement?.rate_rmb_vnd ?? null),
            };
        }).reverse();

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
        const stMoi = stm.statements.find((x) => x.id === moiNhat?.id);
        const fa = stMoi?.naza?.fee_audit;
        const rMoi = rateTrend[0];

        // ── 8 MỤC KIỂM TRA ────────────────────────────────────────────
        // Nhóm A soát chính FILE (tin được số trong đó không), nhóm B soát ĐƠN
        // (file đúng rồi thì so với đơn của mình). Thứ tự này không đảo được:
        // file sai mà đem so đơn thì mọi kết luận đều vô nghĩa.
        const vnd = (n: number) => Math.round(n).toLocaleString("vi-VN");
        const checks: { nhom: "A" | "B"; ten: string; ok: boolean | null; chi_tiet: string }[] = [];
        if (moiNhat) {
            const ck = stMoi?.naza?.checks;
            checks.push({
                nhom: "A", ten: "Phép tính trong file",
                ok: ck?.math_ok ?? null,
                chi_tiet: ck?.math_note || "Chưa đọc được sheet TỔNG.",
            });
            const gap = ck?.cod_gap ?? null;
            checks.push({
                nhom: "A", ten: "Chi tiết cộng ra đúng số tổng",
                ok: gap === null ? null : Math.abs(gap) < 0.5,
                chi_tiet: gap === null ? "Không đọc được số tổng."
                    : Math.abs(gap) < 0.5
                        ? `${moiNhat.orders_paid} dòng COD cộng ra ${vnd(moiNhat.total_twd)} NT$ — khớp sheet TỔNG.`
                        : `Chi tiết lệch sheet TỔNG ${vnd(gap)} NT$. Hỏi lại NAZA.`,
            });
            const dw = rMoi?.d_twd_rmb, dv = rMoi?.d_rmb_vnd;
            const moTa = (nhan: string, gia: number | null, d: number | null, loiKhiTang: boolean) => {
                if (gia == null) return `${nhan}: không đọc được.`;
                if (d == null) return `${nhan} ${gia} — chưa có kỳ trước để so.`;
                if (Math.abs(d) < 0.05) return `${nhan} ${gia} — giữ nguyên.`;
                const loi = (d > 0) === loiKhiTang;
                return `${nhan} ${gia} — ${d > 0 ? "tăng" : "giảm"} ${Math.abs(d).toFixed(2)}% so kỳ trước, ${loi ? "có lợi" : "BẤT LỢI"} cho mình.`;
            };
            checks.push({
                nhom: "A", ten: "Tỷ giá so kỳ trước",
                ok: (dw == null || Math.abs(dw) < 0.05) && (dv == null || Math.abs(dv) < 0.05) ? true : null,
                chi_tiet: `${moTa("TWD→RMB", rMoi?.rate_twd_rmb ?? null, dw ?? null, true)} ${moTa("RMB→VND", rMoi?.rate_rmb_vnd ?? null, dv ?? null, true)} Tỷ giá do NAZA đặt, chưa ai đối chiếu thị trường.`,
            });
            const dups = fa?.duplicates || [];
            checks.push({
                nhom: "A", ten: "Thu hai lần phí trên một đơn",
                ok: dups.length === 0,
                chi_tiet: dups.length === 0
                    ? "Không mã vận đơn nào bị tính phí quá một lần trong kỳ."
                    : `${dups.length} mã bị tính phí ${dups[0].times} lần — thu dư ${vnd(fa!.duplicate_extra_rmb)} ¥. ` +
                      dups.slice(0, 3).map((d) => `${d.order_ids.join("/")} · ${d.tracking}`).join(" · "),
            });

            const quaHanN = rows.filter((r) => r.light === "do" && r.paid_twd === null).length;
            const choN = rows.filter((r) => r.light === "vang" && r.paid_twd === null).length;
            checks.push({
                nhom: "B", ten: "Đơn giao thành công mà sao kê bỏ sót",
                ok: quaHanN === 0,
                chi_tiet: `${choN + quaHanN} đơn đã giao chưa thấy trên bất kỳ kỳ nào` +
                    (quaHanN ? ` — ${quaHanN} đơn đã qua từ 2 kỳ, PHẢI ĐÒI.` : " — đều còn trong nhịp thanh toán."),
            });
            checks.push({
                nhom: "B", ten: "3PL trả khác số trên đơn",
                ok: moiNhat.lech_tien.length === 0,
                chi_tiet: moiNhat.lech_tien.length === 0 ? "Mọi đơn trả đúng số."
                    : moiNhat.lech_tien.slice(0, 3).map((l) =>
                        `${l.order_no}: đơn ghi ${l.cod_twd} · họ trả ${l.paid_twd}`).join(" · "),
            });
            checks.push({
                nhom: "B", ten: "Phí vận chuyển đúng bảng giá",
                ok: (fa?.wrong ?? 0) === 0,
                chi_tiet: (fa?.wrong ?? 0) === 0
                    ? `${fa?.ok ?? 0} dòng đúng bảng giá — 7-Eleven/FamilyMart 27¥ · HCT 32¥ · Yamato 38¥.`
                    : `${fa!.wrong} dòng sai, chênh ${vnd(fa!.overcharge_rmb)} ¥.`,
            });
            const ow = fa?.op_wrong || [];
            checks.push({
                nhom: "B", ten: `Phí thao tác đúng ${fa?.op_expected ?? 3}¥/đơn`,
                ok: ow.length === 0,
                chi_tiet: (ow.length === 0
                    ? `Cả kỳ đều đúng ${fa?.op_expected ?? 3}¥.`
                    : `${ow.length} đơn thu khác mức: ` + ow.slice(0, 3).map((o) => `${o.order_id} thu ${o.charged}¥`).join(" · "))
                    + " Lưu ý: bảng giá ghi MIỄN PHÍ, khoản này vẫn nên hỏi NAZA.",
            });
        }
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

        // ── Cảnh báo — KÈM CHI TIẾT ĐỦ ĐỂ SỬA NGAY ────────────────────
        //
        // Bản trước chỉ nói "thiếu 6 mã: 002, 011…" rồi bảo mở file JSON ra sửa.
        // Đọc xong vẫn phải tự đi tra mã nào là hàng gì, bao nhiêu đơn dính, có
        // đáng ưu tiên không. Nên mỗi cảnh báo giờ mang theo BẢNG chi tiết —
        // nhìn là biết sửa cái nào trước.
        type Note = {
            id: string; level: "canh_bao" | "nhac";
            title: string; detail: string;
            cols?: string[];
            items?: (string | number)[][];
            fix?: string;
        };
        const notes: Note[] = [];

        if (!orders.length) {
            notes.push({
                id: "khong-don", level: "canh_bao",
                title: "Chưa có đơn nào",
                detail: "Vào tab Theo dõi vận đơn bấm “Đọc bảng đối tác” để nạp đơn từ file 3PL.",
            });
        }
        if (!stm.statements.length) {
            notes.push({
                id: "khong-sao-ke", level: "canh_bao",
                title: "Chưa tải bản sao kê nào",
                detail: "Chưa biết đơn nào đã về tiền. Vào tab Đối soát COD tải file NAZA lên.",
            });
        }

        // Đơn không ra giá vốn vì HAI lý do khác nhau, và cách sửa cũng khác nhau:
        // mã chưa khai giá thì Sỹ Anh đọc bảng giá cho một con số, còn ô SKU bỏ
        // trống thì phải điền vào file 3PL. Gộp chung một cảnh báo là đọc xong
        // vẫn không biết phải làm gì.
        const thieuMaGia = rows.filter((r) => r.cogs_missing.length > 0);
        const trongSku = rows.filter(
            (r) => r.cogs_vnd === null && r.cogs_missing.length === 0 && r.product_codes.length === 0,
        );

        if (thieuMaGia.length) {
            // Gom theo MÃ chứ không theo đơn: một mã khai một lần là sửa xong
            // hàng chục đơn. Xếp mã nhiều đơn nhất lên trước để biết sửa cái nào
            // đáng công nhất.
            const byCode = new Map<string, { orders: number; qty: number; skus: Set<string>; vd: string[] }>();
            for (const r of rows) {
                for (const c of r.cogs_missing) {
                    const e = byCode.get(c) || { orders: 0, qty: 0, skus: new Set<string>(), vd: [] };
                    e.orders++; e.qty += r.quantity;
                    if (r.sku) e.skus.add(r.sku);
                    if (e.vd.length < 3) e.vd.push(r.order_no);
                    byCode.set(c, e);
                }
            }
            const items = [...byCode.entries()]
                .sort((a, b) => b[1].orders - a[1].orders)
                .map(([code, e]) => [
                    code,
                    [...e.skus][0] || "(không rõ tên)",
                    e.orders, e.qty, e.vd.join(", "),
                ]);
            notes.push({
                id: "thieu-gia-von", level: "canh_bao",
                title: `${thieuMaGia.length}/${summary.total} đơn có mã hàng chưa khai giá vốn`,
                detail: `Thiếu giá nhập của ${items.length} mã dưới đây. Chừng nào chưa khai, cột “Còn lại” của những đơn đó là số TRƯỚC giá vốn — cao hơn thật.`,
                cols: ["Mã", "Tên hàng", "Số đơn", "Số lượng", "Ví dụ đơn"],
                items,
                fix: "Cho tau giá nhập MỘT CÁI bằng tệ của từng mã là tau khai vào ngay.",
            });
        }

        if (trongSku.length) {
            notes.push({
                id: "trong-o-sku", level: "canh_bao",
                title: `${trongSku.length}/${summary.total} đơn bỏ trống ô SKU trong file 3PL`,
                detail: "Những đơn này có tiền COD, có mã vận đơn, nhưng ô SKU trong file để trắng nên không biết bán hàng gì — không tra ra giá vốn được. Cột “Còn lại” của chúng là số TRƯỚC giá vốn, tức cao hơn thật.",
                cols: ["Mã đơn", "Ngày lên đơn", "Khách", "Tiền COD", "Trạng thái"],
                items: trongSku.map((r) => [
                    r.order_no, r.order_date || "(trống)", r.contact_name || "(trống)",
                    `${Math.round(r.cod_twd).toLocaleString("vi-VN")} NT$`,
                    r.status || "(chưa có)",
                ]),
                fix: "Mở Google Sheet đơn hàng, điền ô SKU cho các mã đơn trên rồi bấm Tải lại — không cần sửa gì trong hệ thống.",
            });
        }

        if (extra.length) {
            notes.push({
                id: "thua-sao-ke", level: "canh_bao",
                title: `${extra.length} dòng sao kê không ghép được vào đơn nào`,
                detail: "NAZA trả tiền cho những mã vận đơn này, nhưng file đơn của mình không có. Hoặc đơn chưa được nhập, hoặc mã vận đơn ghi sai.",
                cols: ["Mã đơn NAZA ghi", "Mã vận đơn", "Số tiền", "Kỳ sao kê"],
                items: extra.map((e) => [
                    e.order_no || "(trống)", e.tracking,
                    `${Math.round(e.amount_twd).toLocaleString("vi-VN")} NT$`,
                    (e.period || "").replace(/ĐỐI SOÁT COD|TAIWAN|\.xlsx/gi, "").trim(),
                ]),
                fix: "Tra hai mã vận đơn này trong Google Sheet xem đơn nào của mình.",
            });
        }

        const feeBad = rows.filter((r) => r.fee_wrong);
        if (feeBad.length) {
            notes.push({
                id: "phi-sai", level: "canh_bao",
                title: `${feeBad.length} đơn bị tính phí vận chuyển sai bảng giá`,
                detail: "Phí NAZA thu khác mức đã ký trong bảng giá.",
                cols: ["Mã đơn", "Mã vận đơn", "Kênh giao", "Phí đã thu"],
                items: feeBad.map((r) => [r.order_no, r.tracking, r.ship_method,
                    `${Math.round(r.ship_fee_rmb ?? 0).toLocaleString("vi-VN")}¥`]),
                fix: "Gửi danh sách này cho NAZA hỏi lại.",
            });
        }

        // Sáu mã trùng mã vận đơn trong file đơn — lỗi dữ liệu của mình.
        const dupTrk = new Map<string, string[]>();
        for (const r of rows) {
            const k = r.tracking.replace(/\D/g, "").replace(/^0+/, "");
            if (!k) continue;
            (dupTrk.get(k) || dupTrk.set(k, []).get(k)!).push(r.order_no);
        }
        const dups = [...dupTrk.entries()].filter(([, v]) => v.length > 1);
        if (dups.length) {
            notes.push({
                id: "trung-van-don", level: "nhac",
                title: `${dups.length} mã vận đơn bị gán cho nhiều đơn khác nhau`,
                detail: "Một mã vận đơn chỉ được thuộc về một đơn. Trùng thì đối soát có thể khớp nhầm đơn.",
                cols: ["Mã vận đơn", "Các đơn cùng mang mã này"],
                items: dups.map(([t, os]) => [t, os.join(" · ")]),
                fix: "Sửa trong Google Sheet đơn hàng.",
            });
        }

        const thieuTrk = rows.filter((r) => !r.tracking.trim());
        if (thieuTrk.length) {
            notes.push({
                id: "thieu-van-don", level: "nhac",
                title: `${thieuTrk.length} đơn không có mã vận đơn`,
                detail: "Không có mã vận đơn thì chỉ khớp được bằng mã đơn — kém chắc chắn hơn hẳn.",
                cols: ["Mã đơn", "Trạng thái", "Khách", "COD"],
                items: thieuTrk.slice(0, 50).map((r) => [r.order_no, r.status_raw,
                    r.contact_name || "—", `${Math.round(r.cod_twd).toLocaleString("vi-VN")} NT$`]),
                fix: "Điền mã vận đơn vào Google Sheet đơn hàng.",
            });
        }

        return NextResponse.json({
            as_of: asOf,
            rows,
            summary,
            extra,
            status_vi: PARTNER_STATUS_VI,
            viec,
            checks,
            rate_trend: rateTrend,
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
