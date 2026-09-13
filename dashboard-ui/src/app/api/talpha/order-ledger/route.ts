import { NextRequest, NextResponse } from "next/server";
import { readStoreFresh } from "@/lib/talpha/store";
import {
    buildLedger, summarise,
    type OrderSource, type PaidLine, type FeeLine,
} from "@/lib/talpha/order-ledger";
import type { StatementRow } from "@/lib/talpha/cod-recon";
import {
    expectedShipFee, matchChannel, OP_FEE_PER_PARCEL, type NazaStatement,
} from "@/lib/talpha/naza-statement";
import {
    docTienHang, ghepDotVaoKy, ngaySaoKe, type DotTienHang,
} from "@/lib/talpha/purchase-sheet";
import { PARTNER_STATUS_VI } from "@/lib/talpha/partner-file";
import {
    bankKey, doneKey, doiLabel, emptyActions, fxLoss, periodState,
    shouldResurface, STATE_LABEL, BANK_TOLERANCE_VND,
    type CodActions,
} from "@/lib/talpha/cod-actions";

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

// ═══════════════════════════════════════════════════════════════════
// LUỒNG TIỀN MỘT KỲ — đi đúng từng bước của sheet TỔNG NAZA
// ───────────────────────────────────────────────────────────────────
//     Tổng COD (TWD) × tỷ giá → RMB − phí thao tác − phí ship → RMB ròng
//     × tỷ giá → VND − PHÍ MUA HÀNG → PHẢI NHẬN
//
// Trước 13/09/2026 thẻ kỳ lấy "Tiền COD" bằng cách cộng CHỈ những đơn tìm thấy
// trong sổ đơn: kỳ 9.11 hiện 57.946 NT$ trong khi sao kê là 64.740, và "Phí NAZA
// thu" hiện 1.035¥ trong khi NAZA trừ 2.573¥. Bốn con số trên cùng một thẻ không
// cộng trừ ra được "Phải nhận". Nay mọi số trên thẻ lấy từ chính luồng NAZA; phần
// đơn khớp sổ đơn hiện riêng.
//
// Tiền hàng (Sỹ Anh chốt 13/09/2026):
//   • kỳ NAZA ghi phí mua hàng → NAZA trừ vào COD, nhưng TIN SỐ TRONG FILE TIỀN
//     HÀNG nếu hai bên lệch — "phải nhận" tính lại theo file;
//   • kỳ NAZA không ghi (24/07 → 14/08) → Sỹ Anh tự chuyển khoản riêng, tiền hàng
//     là khoản chi riêng, KHÔNG trừ vào tiền NAZA trả.
// ═══════════════════════════════════════════════════════════════════
type SummaryNaza = NazaStatement["summary"];

function luongTien(sm: SummaryNaza | null, dot: DotTienHang | null, soDongSaoKe: number) {
    if (!sm) return null;
    const cod = sm.cod_twd ?? null;
    const tw = sm.rate_twd_rmb ?? null;
    const rv = sm.rate_rmb_vnd ?? null;
    const rmb = cod != null && tw != null ? cod * tw : null;
    const phiThaoTac = Math.abs(sm.op_fee_rmb ?? 0);
    const phiShip = Math.abs(sm.ship_fee_rmb ?? 0);
    const rmbRong = sm.net_rmb ?? (rmb != null ? rmb - phiThaoTac - phiShip : null);
    const vnd = rmbRong != null && rv != null ? rmbRong * rv : null;

    const nazaTru = sm.purchase_vnd ?? null;
    const cachTra: "naza_tru" | "tu_chuyen" = nazaTru != null ? "naza_tru" : "tu_chuyen";
    // Số tiền hàng đem trừ trong luồng: kỳ NAZA trừ thì theo FILE (không có file
    // thì đành theo NAZA); kỳ tự chuyển khoản thì luồng NAZA không trừ gì.
    const tienHangTrongLuong = cachTra === "naza_tru" ? (dot ? dot.tong_vnd : nazaTru!) : 0;
    const phaiNhan = sm.payable_vnd == null ? null
        // Giữ nguyên phần điều chỉnh kỳ trước NAZA đã tính: payable = VND − tiền hàng NAZA ± chuyển kỳ.
        : cachTra === "naza_tru" ? sm.payable_vnd + nazaTru! - tienHangTrongLuong
        : sm.payable_vnd;

    let daTra: number | null = null, conNo: number | null = null;
    if (dot && cachTra === "naza_tru") { daTra = dot.tong_vnd; conNo = 0; }   // NAZA trừ rồi = đã trả
    else if (dot) {
        daTra = dot.da_tra_vnd ?? 0;
        conNo = dot.con_thieu_vnd ?? Math.max(0, dot.tong_vnd - (dot.da_tra_vnd ?? 0));
    }

    return {
        so_dong_sao_ke: soDongSaoKe,
        cod_twd: cod, ty_gia_twd_rmb: tw, rmb,
        phi_thao_tac_rmb: phiThaoTac, phi_ship_rmb: phiShip, phi_gop: !!sm.fees_combined,
        rmb_rong: rmbRong, ty_gia_rmb_vnd: rv, vnd,
        tien_hang: {
            cach_tra: cachTra,
            naza_tru_vnd: nazaTru,
            file: dot ? {
                ngay: dot.ngay, tong_vnd: dot.tong_vnd, moi_vnd: dot.moi_vnd,
                no_ky_truoc_vnd: dot.no_ky_truoc_vnd, da_ghi_thanh_toan: dot.da_ghi_thanh_toan,
                dong: dot.dong,
            } : null,
            trong_luong_vnd: tienHangTrongLuong,
            lech_naza_vnd: cachTra === "naza_tru" && dot ? nazaTru! - dot.tong_vnd : null,
            da_tra_vnd: daTra,
            con_no_vnd: conNo,
        },
        phai_nhan_vnd: phaiNhan,
    };
}

export async function GET(req: NextRequest) {
    const q = req.nextUrl.searchParams;
    const asOf = /^\d{4}-\d{2}-\d{2}$/.test(q.get("to") || "")
        ? (q.get("to") as string)
        : new Date().toISOString().slice(0, 10);

    try {
        const track = await readStoreFresh<TrackingStore>("tracking", { statuses: {}, partner: {} });
        const stm = await readStoreFresh<{ statements: Statement[] }>("cod_statements", { statements: [] });
        // Việc do NGƯỜI ghi — tiền về tài khoản, đã đòi, đã bỏ qua. Kho riêng
        // với kho sao kê: nạp lại file thì số máy đọc phải tính lại, còn việc
        // người đã làm thì không được mất.
        const act = await readStoreFresh<CodActions>("cod_actions", emptyActions());
        const bankOf = (fn: string) => (act.bank || {})[bankKey(fn)];
        const doneOf = (k: string) => (act.done || {})[k];

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
        // ── ĐƠN GIAO LẠI: vì sao một đơn trông như bị trả thiếu ──────
        //
        // Đơn hoàn rồi gửi lại cho khách khác thì NAZA cấp MÃ VẬN ĐƠN MỚI, và
        // đặt mã đơn = mã vận đơn CŨ + "-Z" (转寄 = chuyển tiếp). Sổ đơn của
        // mình làm ngược: giữ mã vận đơn CŨ ở cột mã vận đơn, rồi nhét mã cũ
        // vào ngoặc ở cột mã đơn — "T1467 (7564042426-z)".
        //
        // Hệ quả: dashboard ghép theo mã vận đơn nên lấy ra dòng sao kê của một
        // đơn KHÁC đang dùng lại mã đó, rồi kết luận "trả thiếu 650". Trong khi
        // tiền thật đã về đủ, nằm ở nhóm "3PL trả cho đơn mình không có" ngay
        // bên dưới, dưới mã vận đơn mới.
        //
        // Đã dính 3 đơn trong kỳ 2026.9.11: T1467 · T1468 · T1471, tổng 4.097 NT$
        // bị đếm hai lần theo hai chiều ngược nhau.
        //
        // Hàm này KHÔNG sửa một con số nào — chỉ tìm ra khoản tiền tương ứng để
        // nói đúng bản chất: lỗi gán mã vận đơn trong sổ, không phải mất tiền.
        const maTrongNgoac = (s?: string | null): string | null =>
            String(s ?? "").match(/\((\d+)\s*-\s*z\)/i)?.[1] ?? null;

        function giaiThichGiaoLai(
            r: { order_no: string; cod_twd: number },
            thuaKy: { order_no: string; tracking: string; amount_twd: number }[],
        ): { tracking: string; amount_twd: number } | null {
            const maCu = maTrongNgoac(r.order_no);
            if (!maCu) return null;
            const hit = thuaKy.find((e) =>
                String(e.order_no).replace(/[-\s]*z$/i, "").trim() === maCu
                && e.amount_twd === r.cod_twd);
            return hit ? { tracking: hit.tracking, amount_twd: hit.amount_twd } : null;
        }

        // File tiền hàng: đọc một lần mỗi 5 phút, lỗi không làm sập màn.
        const tienHang = await docTienHang();
        const dotCuaKy = ghepDotVaoKy(
            tienHang.dot,
            stm.statements.map((x) => ({ id: x.id, ngay: ngaySaoKe(x.filename) })),
        );

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
                // Phần đơn KHỚP SỔ ĐƠN — không phải tổng của kỳ. Tổng kỳ ở `luong`.
                orders_paid: mine.length,
                total_twd: mine.reduce((a, r) => a + (r.paid_twd ?? 0), 0),
                fee_rmb: mine.reduce((a, r) => a + (r.ship_fee_rmb ?? 0) + (r.op_fee_rmb ?? 0), 0),
                ngay_sao_ke: ngaySaoKe(st.filename),
                luong: luongTien(n?.summary ?? null, dotCuaKy.get(st.id) ?? null, st.rows.length),
                // Bốn loại lệch
                lech_tien: lech.map((r) => ({
                    order_no: r.order_no, tracking: r.tracking,
                    cod_twd: r.cod_twd, paid_twd: r.paid_twd, diff_twd: r.diff_twd,
                    // Đơn GIAO LẠI bị gán sai mã vận đơn — tiền KHÔNG thiếu.
                    da_tra_o_ma_khac: giaiThichGiaoLai(r, thua),
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
                // ── KHÂU CUỐI: tiền thật vào tài khoản ────────────────
                //
                // Sao kê chỉ nói NAZA PHẢI chuyển bao nhiêu. Họ chuyển thật bao
                // nhiêu thì chỉ ngân hàng biết, và Sỹ Anh xác nhận chưa ai kiểm
                // kỹ khoản này. Đây là chỗ tiền chảy ra mà cả hệ thống không
                // thấy: file soát sạch 8 mục vẫn không nói được gì về nó.
                bank: bankOf(st.filename) || null,
                ...(() => {
                    const { state, lech_vnd } = periodState(
                        n?.summary.payable_vnd ?? null, bankOf(st.filename),
                    );
                    return { trang_thai: state, trang_thai_chu: STATE_LABEL[state], lech_bank_vnd: lech_vnd };
                })(),
            };
        }).sort((a, b) => (a.period_date < b.period_date ? 1 : -1));

        // Ngày chốt của mọi kỳ, cũ → mới. Dùng để đếm "đã qua mấy kỳ" cho cả
        // đơn quá hạn lẫn việc đã đòi mà NAZA vẫn im.
        const periodEnds = byPeriod.map((p) => p.period_date).filter(Boolean).sort();

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

        // ── TỶ GIÁ ĐÃ LẤY CỦA MÌNH BAO NHIÊU ──────────────────────────
        //
        // Sỹ Anh chốt: tỷ giá NAZA đặt thì phải chịu, không cãi được. Vậy bảng
        // phần trăm không giúp quyết định gì. Đổi sang câu trả lời được: nó lấy
        // mất bao nhiêu TIỀN, lấy kỳ tốt nhất chính NAZA từng đặt làm mốc.
        const fx = fxLoss(byPeriod.map((p) => ({
            filename: p.filename,
            period_date: p.period_date,
            rate_twd_rmb: p.settlement?.rate_twd_rmb ?? null,
            rate_rmb_vnd: p.settlement?.rate_rmb_vnd ?? null,
            cod_twd: p.total_twd,
        })));

        // Loại lệch thứ 2 KHÔNG thuộc kỳ nào: đơn đã giao mà chưa kỳ nào trả
        // tiền. Gắn nó vào một kỳ cụ thể là sai — nó là món nợ đang treo.
        const chuaVeTien = rows
            .filter((r) => (r.light === "vang" || r.light === "do") && r.paid_twd === null)
            .map((r) => {
                const k = doneKey("doi", r.tracking || r.order_no);
                const d = doneOf(k);
                const { ky_da_qua: kyTuKhiDoi } = shouldResurface(d, periodEnds);
                return {
                    order_no: r.order_no, tracking: r.tracking, cod_twd: r.cod_twd,
                    age_days: r.age_days, ky_da_qua: r.ky_da_qua, qua_han: r.light === "do",
                    contact_name: r.contact_name, phone: r.phone,
                    // Trí nhớ: đã đòi chưa, mấy lần, đòi rồi mà mấy kỳ vẫn im
                    doi_key: k,
                    da_doi: d ? { ...d, ky_tu_khi_doi: kyTuKhiDoi } : null,
                    doi_chu: doiLabel(d, kyTuKhiDoi),
                };
            })
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
        /** Ngày đọc cho người, không đọc cho máy: 2026-08-25 → 25/08/2026. */
        const dmy = (s: string) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : "—");
        // MỌI mục ở đây thuộc phạm vi MỘT KỲ — kỳ đang chọn, không phải cộng
        // dồn. Bản trước để lẫn một mục cộng dồn cả 7 kỳ vào giữa, thành ra
        // "80 đơn sao kê bỏ sót" trông như NAZA vừa bỏ sót 80 đơn trong một
        // tuần, trong khi 76 đơn trong đó hoàn toàn bình thường. Mục đó nay
        // nằm riêng ở khối "tiền còn nằm ở NAZA".
        const checks: { nhom: "A" | "B"; ten: string; ok: boolean | null; chi_tiet: string }[] = [];
        if (moiNhat) {
            const ck = stMoi?.naza?.checks;
            checks.push({
                nhom: "A", ten: "Phép tính trong file",
                ok: ck?.math_ok ?? null,
                chi_tiet: ck?.math_note || "Chưa đọc được sheet TỔNG.",
            });
            // Câu cũ in `orders_paid` và `total_twd` — số đơn KHỚP SỔ ĐƠN — trong khi
            // phép so thật là giữa chi tiết FILE và sheet TỔNG. Kỳ 9.11 màn hình ghi
            // "54 dòng COD cộng ra 57.946 NT$ — khớp sheet TỔNG" trong khi sheet TỔNG
            // là 60 dòng 64.740: một câu sai nằm dưới dấu tích xanh.
            //
            // Và phí chưa từng được soát: kỳ 9.11 bộ đọc bỏ sót cả sheet phí (NAZA đổi
            // tên cột), chi tiết ra 0¥ trong khi TỔNG trừ 2.573¥, mà không mục nào kêu.
            const gap = ck?.cod_gap ?? null;
            const smMoi = stMoi?.naza?.summary;
            const phiChiTiet = (ck?.ship_fee_detail_total ?? 0) + (smMoi?.fees_combined ? 0 : (ck?.op_fee_detail_total ?? 0));
            const phiTong = Math.abs(smMoi?.ship_fee_rmb ?? 0) + Math.abs(smMoi?.op_fee_rmb ?? 0);
            const lechPhi = smMoi ? phiChiTiet - phiTong : null;
            const codOk = gap !== null && Math.abs(gap) < 0.5;
            const phiOk = lechPhi === null || Math.abs(lechPhi) < 0.5;
            checks.push({
                nhom: "A", ten: "Chi tiết cộng ra đúng số tổng",
                ok: gap === null ? null : codOk && phiOk,
                chi_tiet: gap === null ? "Không đọc được số tổng."
                    : !codOk
                        ? `Chi tiết COD lệch sheet TỔNG ${vnd(gap)} NT$. Hỏi lại NAZA.`
                        : !phiOk
                            ? (phiChiTiet === 0
                                ? `Không đọc được dòng phí nào trong sheet phí, trong khi sheet TỔNG trừ ${vnd(phiTong)}¥ — ` +
                                  "mục soát phí phía dưới đang không soát gì. Tải lại file sao kê kỳ này."
                                : `Sheet phí chi tiết cộng ra ${vnd(phiChiTiet)}¥ nhưng sheet TỔNG trừ ${vnd(phiTong)}¥ — lệch ${vnd(lechPhi!)}¥.`)
                            : `${stMoi?.rows.length ?? 0} dòng COD cộng ra ${vnd(ck?.cod_detail_total ?? 0)} NT$, ` +
                              `phí cộng ra ${vnd(phiChiTiet)}¥ — khớp sheet TỔNG.`,
            });
            const dw = rMoi?.d_twd_rmb, dv = rMoi?.d_rmb_vnd;
            const moTa = (nhan: string, gia: number | null, d: number | null, loiKhiTang: boolean) => {
                if (gia == null) return `${nhan}: không đọc được.`;
                if (d == null) return `${nhan} ${gia} — chưa có kỳ trước để so.`;
                if (Math.abs(d) < 0.05) return `${nhan} ${gia} — giữ nguyên.`;
                const loi = (d > 0) === loiKhiTang;
                return `${nhan} ${gia} — ${d > 0 ? "tăng" : "giảm"} ${Math.abs(d).toFixed(2)}% so kỳ trước, ${loi ? "có lợi" : "BẤT LỢI"} cho mình.`;
            };
            // Nói bằng TIỀN chứ không bằng phần trăm suông: "giảm 0,34%" không
            // ai hình dung được là mất bao nhiêu, mà tỷ giá thì không cãi được
            // nên thứ duy nhất còn đáng biết là mất bao nhiêu đồng.
            const fxMoi = fx.rows.find((x) => x.filename === moiNhat.filename);
            const thiet = fxMoi?.thiet_vnd ?? null;
            checks.push({
                nhom: "A", ten: "Tỷ giá kỳ này",
                // Cố ý để null (dấu "i" xanh) chứ không phải false (dấu "!" đỏ):
                // Sỹ Anh phải chịu tỷ giá NAZA đặt, nên đây là tin để biết, không
                // phải việc để xử. Tô đỏ một thứ không xử được thì lần sau người
                // ta phớt lờ luôn cả dấu đỏ thật.
                ok: thiet != null && thiet < 1 ? true : null,
                chi_tiet: `${moTa("TWD→RMB", rMoi?.rate_twd_rmb ?? null, dw ?? null, true)} ${moTa("RMB→VND", rMoi?.rate_rmb_vnd ?? null, dv ?? null, true)}` +
                    (thiet == null ? " Chưa đọc được tỷ giá."
                        : fxMoi?.tot_nhat ? " Đây là tỷ giá TỐT NHẤT NAZA từng đặt."
                            : ` So với kỳ tốt nhất NAZA từng đặt, kỳ này nhận ít đi ${vnd(thiet)}đ.`),
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

            // Tách hai loại: MẤT TIỀN THẬT, và GÁN SAI MÃ VẬN ĐƠN (tiền đã về
            // đủ, chỉ nằm dưới mã khác). Gộp chung là người đọc đi đòi NAZA một
            // khoản họ đã trả rồi.
            const lechThat = moiNhat.lech_tien.filter((l) => !l.da_tra_o_ma_khac);
            const lechDoMa = moiNhat.lech_tien.filter((l) => l.da_tra_o_ma_khac);
            checks.push({
                nhom: "B", ten: "3PL trả khác số trên đơn",
                ok: moiNhat.lech_tien.length === 0,
                chi_tiet: moiNhat.lech_tien.length === 0 ? "Mọi đơn trả đúng số."
                    : [
                        ...lechThat.slice(0, 3).map((l) =>
                            `${l.order_no}: đơn ghi ${vnd(l.cod_twd)} · họ trả ${vnd(l.paid_twd ?? 0)} NT$ ` +
                            `(${(l.diff_twd ?? 0) > 0 ? "dư" : "thiếu"} ${vnd(Math.abs(l.diff_twd ?? 0))})`),
                        ...lechDoMa.slice(0, 3).map((l) =>
                            `${l.order_no}: KHÔNG thiếu tiền — NAZA đã trả đủ ` +
                            `${vnd(l.da_tra_o_ma_khac!.amount_twd)} NT$ dưới mã vận đơn ` +
                            `${l.da_tra_o_ma_khac!.tracking}. Đơn giao lại được cấp mã vận đơn MỚI, ` +
                            `sổ đơn còn ghi mã cũ ${l.tracking} — sửa mã vận đơn trong Google Sheet đối tác`),
                    ].join(" · "),
            });
            // Soát 0 dòng thì KHÔNG phải "đúng": kỳ 9.11 hiện "0/0 dòng đúng bảng giá"
            // với dấu tích xanh, trong khi NAZA trừ 2.573¥ mà bộ đọc không thấy dòng nào.
            const soDongPhi = (fa?.ok ?? 0) + (fa?.wrong ?? 0) + (fa?.unknown_channel ?? 0);
            checks.push({
                nhom: "B", ten: "Phí vận chuyển đúng bảng giá",
                ok: soDongPhi === 0 && phiTong > 0 ? false : (fa?.wrong ?? 0) === 0,
                chi_tiet: soDongPhi === 0 && phiTong > 0
                    ? `Không có dòng phí nào để soát, trong khi NAZA trừ ${vnd(phiTong)}¥ — xem mục A, tải lại file sao kê kỳ này.`
                    : (fa?.wrong ?? 0) === 0
                        ? `${fa?.ok ?? 0}/${soDongPhi} dòng phí CỦA KỲ NÀY đúng bảng giá — 7-Eleven/FamilyMart 27¥ · HCT 32¥ · Yamato 38¥.`
                        : `${fa!.wrong} dòng sai, chênh ${vnd(fa!.overcharge_rmb)} ¥.`,
            });
            // Tiền hàng — so số NAZA trừ với file tiền hàng của Sỹ Anh.
            {
                const th = moiNhat.luong?.tien_hang;
                const f = th?.file;
                const dmyIso = (x?: string | null) => (x ? `${x.slice(8, 10)}/${x.slice(5, 7)}` : "—");
                let ok: boolean | null, chi: string;
                if (!th) { ok = null; chi = "Kỳ này không có sheet TỔNG để biết NAZA trừ tiền hàng hay không."; }
                else if (tienHang.loi && !f) { ok = false; chi = tienHang.loi; }
                else if (!f) {
                    ok = false;
                    chi = `File tiền hàng không có đợt thanh toán nào trong 4 ngày quanh ngày sao kê ${dmyIso(moiNhat.ngay_sao_ke)}.`;
                } else if (th.cach_tra === "naza_tru") {
                    const lech = th.lech_naza_vnd ?? 0;
                    ok = Math.abs(lech) < 1;
                    chi = ok
                        ? `NAZA trừ tiền hàng ${vnd(th.naza_tru_vnd!)}đ — khớp file tiền hàng (đợt ${dmyIso(f.ngay)}, dòng ${f.dong}).`
                        : `NAZA trừ ${vnd(th.naza_tru_vnd!)}đ nhưng file tiền hàng ghi ${vnd(f.tong_vnd)}đ — ` +
                          `NAZA trừ ${lech > 0 ? "DƯ" : "THIẾU"} ${vnd(Math.abs(lech))}đ. Phải nhận đã tính lại theo file: ` +
                          `${vnd(moiNhat.luong!.phai_nhan_vnd ?? 0)}đ.`;
                    if (!f.da_ghi_thanh_toan) chi += " File chưa ghi “đã thanh toán” cho đợt này, dù NAZA đã trừ.";
                } else {
                    // Còn nợ tiền hàng không phải lỗi đối soát, nhưng cũng không được tích xanh cho qua.
                    ok = (th.con_no_vnd ?? 0) > 0 ? null : true;
                    chi = `Kỳ này NAZA không trừ tiền hàng — đợt ${dmyIso(f.ngay)} ${vnd(f.tong_vnd)}đ tự chuyển khoản riêng. ` +
                        `Đã trả ${vnd(th.da_tra_vnd ?? 0)}đ` + ((th.con_no_vnd ?? 0) > 0 ? `, còn nợ ${vnd(th.con_no_vnd!)}đ.` : ".");
                }
                if (f && f.no_ky_truoc_vnd > 0) chi += ` Đợt này gồm ${vnd(f.no_ky_truoc_vnd)}đ nợ kỳ trước.`;
                checks.push({ nhom: "B", ten: "Tiền hàng khớp file tiền hàng", ok, chi_tiet: chi });
            }
            const ow = fa?.op_wrong || [];
            checks.push({
                nhom: "B", ten: `Phí thao tác đúng ${fa?.op_expected ?? 3}¥/đơn`,
                ok: soDongPhi === 0 && phiTong > 0 ? false : ow.length === 0,
                chi_tiet: (soDongPhi === 0 && phiTong > 0
                    ? "Không có dòng phí nào để soát — xem mục A."
                    : ow.length === 0
                    ? `Cả kỳ đều đúng ${fa?.op_expected ?? 3}¥.`
                    : `${ow.length} đơn thu khác mức: ` + ow.slice(0, 3).map((o) => `${o.order_id} thu ${o.charged}¥`).join(" · "))
                    + " Lưu ý: bảng giá ghi MIỄN PHÍ, khoản này vẫn nên hỏi NAZA.",
            });
        }
        // ── VIỆC HÔM NAY, CÓ TRÍ NHỚ ──────────────────────────────────
        //
        // Bản trước không nhớ gì: "Nhắn NAZA đòi tiền 4 đơn" hiện y hệt mỗi
        // ngày, đòi hôm qua rồi hôm nay vẫn thế. Nay mỗi việc có khoá riêng,
        // bấm đóng là ghi vào kho `cod_actions` kèm ngày.
        //
        // Nhưng đóng KHÔNG phải là quên. NAZA trả tiền theo kỳ, nên phép thử
        // thật là: sang kỳ sao kê sau, tiền về chưa? Chưa về thì việc nổi lại
        // và nặng hơn, vì đã đòi một lần mà họ vẫn im (shouldResurface).
        const quaHan = chuaVeTien.filter((x) => x.qua_han);
        type Viec = {
            id: string; muc: "gap" | "soat" | "ghi"; tieu_de: string;
            so: number; don_vi: string; chi_tiet: string;
            /** Khoá để bấm đóng. Rỗng = việc tự hết khi số liệu đổi, không đóng tay. */
            done_key: string;
            /** Nút nào hợp với việc này. */
            nut: ("da_doi" | "da_hoi" | "bo_qua" | "nhap_bank")[];
            /** Đã đóng lần nào chưa — để màn hình nói "đòi rồi mà vẫn im". */
            ghi_chu: string;
        };
        const viec: Viec[] = [];

        // Đòi tiền: gộp các đơn CHƯA đòi hoặc đã đòi mà qua kỳ vẫn im.
        const canDoi = quaHan.filter((x) => shouldResurface(doneOf(x.doi_key), periodEnds).lai);
        if (canDoi.length) {
            const daTungDoi = canDoi.filter((x) => x.da_doi).length;
            viec.push({
                id: "doi-naza", muc: "gap",
                tieu_de: "Nhắn NAZA đòi tiền",
                so: canDoi.length, don_vi: "đơn",
                chi_tiet: "Đã qua từ 2 kỳ sao kê mà vẫn chưa được trả — tổng " +
                    `${Math.round(canDoi.reduce((a, x) => a + x.cod_twd, 0)).toLocaleString("vi-VN")} NT$.` +
                    (daTungDoi ? ` ${daTungDoi} đơn đã đòi một lần rồi mà NAZA vẫn im.` : ""),
                done_key: "", nut: ["da_doi"],
                ghi_chu: daTungDoi ? `${daTungDoi}/${canDoi.length} đơn đã đòi trước đó` : "",
            });
        }

        const lechChuaXu = (moiNhat?.lech_tien || []).filter(
            (l) => !doneOf(doneKey("lech", l.tracking || l.order_no)),
        );
        if (lechChuaXu.length) {
            viec.push({
                id: "lech-tien", muc: "soat",
                tieu_de: "NAZA trả khác số ghi trên đơn",
                so: lechChuaXu.length, don_vi: "đơn",
                chi_tiet: lechChuaXu.slice(0, 3).map((l) =>
                    `${l.order_no}: đơn ghi ${Math.round(l.cod_twd).toLocaleString("vi-VN")} · họ trả ${Math.round(l.paid_twd ?? 0).toLocaleString("vi-VN")}`).join(" · "),
                done_key: doneKey("lech", lechChuaXu[0].tracking || lechChuaXu[0].order_no),
                nut: ["da_hoi", "bo_qua"], ghi_chu: "",
            });
        }

        const thuaChuaXu = (moiNhat?.thua_sao_ke || []).filter(
            (t) => !doneOf(doneKey("thua", t.tracking || t.order_no)),
        );
        if (thuaChuaXu.length) {
            viec.push({
                id: "thua", muc: "soat",
                tieu_de: "Tra lại đơn NAZA trả mà mình không có",
                so: thuaChuaXu.length, don_vi: "dòng",
                chi_tiet: thuaChuaXu.slice(0, 3).map((t) => `${t.order_no} · ${t.tracking}`).join(" · "),
                done_key: doneKey("thua", thuaChuaXu[0].tracking || thuaChuaXu[0].order_no),
                nut: ["da_hoi", "bo_qua"], ghi_chu: "",
            });
        }

        const phiChuaXu = (moiNhat?.phi_sai || []).filter(
            (f) => !doneOf(doneKey("phi", f.tracking || f.order_no)),
        );
        if (phiChuaXu.length) {
            viec.push({
                id: "phi-sai", muc: "soat",
                tieu_de: "Hỏi NAZA về phí thu sai bảng giá",
                so: phiChuaXu.length, don_vi: "đơn",
                chi_tiet: phiChuaXu.slice(0, 3).map((f) => f.order_no).join(" · "),
                done_key: doneKey("phi", phiChuaXu[0].tracking || phiChuaXu[0].order_no),
                nut: ["da_hoi", "bo_qua"], ghi_chu: "",
            });
        }

        // KHÂU CUỐI — và là khâu chưa ai canh.
        //
        // GỘP thành MỘT việc chứ không tách mỗi kỳ một dòng. Sáu kỳ đang chờ mà
        // đẻ ra sáu dòng chữ giống hệt nhau thì danh sách việc dài gấp ba lần
        // phần còn lại, và ba việc thật sự khẩn — đòi tiền, soi lệch — bị đẩy
        // chìm xuống dưới. Chỗ nhập số của từng kỳ đã có sẵn ngay trong bảng ②.
        const choNhap = [...byPeriod].reverse().filter((p) => p.trang_thai === "cho_nhap");
        if (choNhap.length) {
            const cuNhat = choNhap[0];
            const tong = choNhap.reduce((a, p) => a + (p.settlement?.payable_vnd ?? 0), 0);
            viec.push({
                id: "bank", muc: "ghi",
                tieu_de: choNhap.length === 1
                    ? `Nhập tiền thật về của kỳ chốt ${dmy(cuNhat.period_date)}`
                    : `Đối chiếu ngân hàng ${choNhap.length} kỳ chưa ai kiểm`,
                so: Math.round(tong), don_vi: "đ",
                chi_tiet: (choNhap.length === 1
                    ? "File đã soát xong. "
                    : `Từ kỳ chốt ${dmy(cuNhat.period_date)} tới nay. File kỳ nào cũng soát xong, nhưng `) +
                    "mở app ngân hàng gõ số thật vào mới biết NAZA chuyển đủ chưa — đây là khâu duy nhất " +
                    "hệ thống không tự thấy được. Kỳ để càng lâu càng khó tra lại sao kê ngân hàng.",
                done_key: cuNhat.filename, nut: ["nhap_bank"], ghi_chu: "",
            });
        }
        // Kỳ đã nhập mà lệch quá ngưỡng thì nặng hơn hẳn: tiền đã chuyển rồi,
        // thiếu là thiếu thật, không phải chờ nữa.
        for (const p of byPeriod) {
            if (p.trang_thai !== "lech") continue;
            if (doneOf(doneKey("lech", `BANK-${p.filename}`))) continue;
            viec.push({
                id: `bank-lech:${p.filename}`, muc: "gap",
                tieu_de: `Kỳ chốt ${dmy(p.period_date)} — tiền về không khớp`,
                so: Math.round(p.lech_bank_vnd ?? 0), don_vi: "đ",
                chi_tiet: `Sao kê tính phải nhận ${vnd(p.settlement?.payable_vnd ?? 0)}đ, ` +
                    `thực nhận ${vnd(p.bank?.thuc_nhan_vnd ?? 0)}đ ngày ${dmy(p.bank?.ngay_ve || "")}. ` +
                    `${(p.lech_bank_vnd ?? 0) < 0 ? "Thiếu" : "Dư"} ${vnd(Math.abs(p.lech_bank_vnd ?? 0))}đ.`,
                done_key: doneKey("lech", `BANK-${p.filename}`),
                nut: ["da_hoi", "bo_qua"], ghi_chu: "",
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
            fx,
            periods: byPeriod,
            chua_ve_tien: chuaVeTien,
            tien_ve: (() => {
                // ── TIỀN VỀ: NAZA đã gửi bao nhiêu, còn phải gửi bao nhiêu ──
                //
                // "Đã gửi về" = cộng số "phải trả" NAZA ghi trên sao kê từng kỳ — đó là
                // tiền họ thật sự chuyển. "Phải nhận" tính lại theo file tiền hàng; hai
                // số chỉ khác nhau khi NAZA trừ tiền hàng lệch file. Kỳ âm không có
                // số phải trả: NAZA đã trừ nó vào kỳ sau nên cộng là đủ, không sót.
                // Chưa kỳ nào đối chiếu ngân hàng thì đó vẫn là số NAZA CAM KẾT.
                const kyCoSo = byPeriod.filter((p) => p.settlement?.payable_vnd != null);
                const daGuiVe = kyCoSo.reduce((a, p) => a + (p.settlement?.payable_vnd ?? 0), 0);
                const phaiNhanTheoFile = byPeriod.reduce((a, p) => a + (p.luong?.phai_nhan_vnd ?? 0), 0);
                const kyDaDoiChieu = byPeriod.filter((p) => p.bank?.thuc_nhan_vnd != null);

                // Dự tính theo đúng luồng NAZA, dùng tỷ giá của kỳ mới nhất có đủ hai
                // tỷ giá. Phí: đơn đã bị NAZA trừ phí ship ở một kỳ trước thì không trừ
                // lại; đơn chưa bị trừ thì trừ phí ship theo bảng giá kênh giao (kg đầu)
                // cộng phí thao tác. Tiền hàng các kỳ tới chưa biết nên CHƯA trừ.
                const kyGia = byPeriod.find((p) => p.luong?.ty_gia_twd_rmb && p.luong?.ty_gia_rmb_vnd);
                const tw = kyGia?.luong?.ty_gia_twd_rmb ?? null;
                const rv = kyGia?.luong?.ty_gia_rmb_vnd ?? null;
                const chuaTra = rows.filter((r) => r.paid_twd === null);
                const KHONG_BAO_GIO_TRA = new Set(["Returned", "Cancelled"]);
                const uocTinh = (ds: typeof rows) => {
                    let cod = 0, phi = 0, chuaTruPhi = 0;
                    for (const r of ds) {
                        cod += r.cod_twd;
                        if (r.ship_fee_rmb == null) {
                            chuaTruPhi++;
                            phi += (expectedShipFee(matchChannel(r.ship_method || ""), null) ?? 0) + OP_FEE_PER_PARCEL;
                        }
                    }
                    const vndUoc = tw != null && rv != null ? (cod * tw - phi) * rv : null;
                    return { so_don: ds.length, cod_twd: cod, don_chua_tru_phi: chuaTruPhi, phi_uoc_rmb: phi, vnd_uoc: vndUoc };
                };
                const hoan = chuaTra.filter((r) => r.status === "Returned");
                const huy = chuaTra.filter((r) => r.status === "Cancelled");
                return {
                    da_gui_ve_vnd: daGuiVe,
                    phai_nhan_theo_file_vnd: phaiNhanTheoFile,
                    so_ky: kyCoSo.length,
                    ky_da_doi_chieu_bank: kyDaDoiChieu.length,
                    thuc_nhan_vnd: kyDaDoiChieu.reduce((a, p) => a + (p.bank?.thuc_nhan_vnd ?? 0), 0),
                    ty_gia: { twd_rmb: tw, rmb_vnd: rv, ngay_sao_ke: kyGia?.ngay_sao_ke ?? null },
                    con_lai_da_giao: uocTinh(chuaTra.filter((r) => r.status === "Delivered")),
                    con_lai_tat_ca: uocTinh(chuaTra.filter((r) => !KHONG_BAO_GIO_TRA.has(r.status || ""))),
                    khong_tinh: {
                        hoan: hoan.length, huy: huy.length,
                        cod_twd: [...hoan, ...huy].reduce((a, r) => a + r.cod_twd, 0),
                    },
                    tien_hang: { loi: tienHang.loi, so_dot: tienHang.dot.length, doc_luc: tienHang.doc_luc },
                };
            })(),
            // Con số mở đầu màn hình: bao nhiêu tiền đã đi qua chuyển khoản mà
            // chưa ai đối chiếu với ngân hàng. Đây là lỗ to nhất của cả tab.
            tong_quan: (() => {
                const choNhap = byPeriod.filter((p) => p.trang_thai === "cho_nhap");
                const lech = byPeriod.filter((p) => p.trang_thai === "lech");
                const khop = byPeriod.filter((p) => p.trang_thai === "khop");
                return {
                    ky_cho_nhap: choNhap.length,
                    tien_cho_nhap_vnd: choNhap.reduce((a, p) => a + (p.settlement?.payable_vnd ?? 0), 0),
                    ky_lech: lech.length,
                    tien_lech_vnd: lech.reduce((a, p) => a + (p.lech_bank_vnd ?? 0), 0),
                    ky_khop: khop.length,
                    bank_tolerance_vnd: BANK_TOLERANCE_VND,
                };
            })(),
            statements: stm.statements.map((s) => ({ id: s.id, filename: s.filename })),
            warnings: notes,
        });
    } catch (e) {
        console.error("order-ledger GET lỗi:", e);
        return NextResponse.json({ error: "Không dựng được sổ đơn hàng" }, { status: 500 });
    }
}
