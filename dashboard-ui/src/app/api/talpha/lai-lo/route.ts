import { NextRequest, NextResponse } from "next/server";
import { MARKETS_PUBLIC, REPORT_START_DATE } from "@/lib/talpha/rules";
import { getAccess } from "@/lib/talpha/access";
import { canMarket, seesAllMarkets } from "@/lib/talpha/access-rules";
import { theoKhoang } from "@/lib/talpha/sheet-tong-team";
import { homNayVN } from "@/lib/talpha/order-ledger";
import { readStoreFresh } from "@/lib/talpha/store";
import {
    choLen3pl, khoanRong, phanBoVanHanh, tongKien, tongPhi, tyLeGiao,
    type ChoLen3pl, type Khoan, type KhoanVanHanh, type TongKien, type TyLeGiao,
} from "@/lib/talpha/lai-lo";
import { CFG_TY_LE, CHO_LEN_3PL_NGAY, NHOM_VAN_HANH, napKienNuoc } from "@/lib/talpha/lai-lo-nguon";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ═══════════════════════════════════════════════════════════════════
// LÃI LỖ — tab Kế toán → Lãi lỗ (04/11/2026). Cách tính: lib/talpha/lai-lo.ts.
//
//   Doanh số · ads  ← file TỔNG TEAM (lib/talpha/sheet-tong-team.ts) — khớp tab Tổng quan
//   Kiện · giá vốn · phí 3PL ← lib/talpha/lai-lo-nguon.ts — cùng nguồn Sổ đơn, Tiền COD về
//   Chi phí vận hành ← data/chi_phi_van_hanh.json (giám đốc nhập ở chính tab này)
//
// Ai đăng nhập có tab cũng xem được (Sỹ Anh chốt "tất cả"), nhưng chỉ nước của team mình.
// Chi phí CHUNG chia theo doanh số của MỌI nước — nên route đọc Sheet KHÔNG cắt team để lấy
// tỷ lệ chia, rồi chỉ trả nước người xem được. Từng khoản vận hành (tên, lương từng người)
// chỉ giám đốc thấy; người khác thấy tổng theo nước.
// ═══════════════════════════════════════════════════════════════════

type VanHanhStore = { items: KhoanVanHanh[] };
const VAN_HANH_STORE = "chi_phi_van_hanh";

type DongNuoc = {
    code: string; ten: string;
    nguon: string; co_so: string[]; loi: string | null;
    don: number; doanh_so: number; ads: number;
    ty_le: TyLeGiao | null;
    tk: TongKien | null;
    cho_len_3pl: ChoLen3pl | null;
    van_hanh: { rieng: number; chung: number };
    du_kien: Khoan; toi_thieu: Khoan;
    loi_nhuan: { du_kien: number; toi_thieu: number };
};

const congK = (a: Khoan, b: Khoan) => {
    a.doanh_thu += b.doanh_thu; a.gia_von += b.gia_von;
    a.phi.di += b.phi.di; a.phi.giao += b.phi.giao; a.phi.hoan += b.phi.hoan; a.phi.ty_gia += b.phi.ty_gia;
};

export async function GET(req: NextRequest) {
    const sp = req.nextUrl.searchParams;
    const fromIn = sp.get("from") || "", to = sp.get("to") || "";
    if (!DATE_RE.test(fromIn) || !DATE_RE.test(to)) {
        return NextResponse.json({ error: "from/to phải dạng YYYY-MM-DD" }, { status: 400 });
    }
    const from = REPORT_START_DATE && fromIn < REPORT_START_DATE ? REPORT_START_DATE : fromIn;
    const a = await getAccess(req);
    if (!a) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
    const xemHet = seesAllMarkets(a);
    const homNay = homNayVN();
    const asOf = to < homNay ? to : homNay;

    try {
        // Sheet KHÔNG cắt team: cần doanh số mọi nước để chia chi phí chung cho đúng.
        const [sheet, vh] = await Promise.all([
            theoKhoang(from, to, null),
            readStoreFresh<VanHanhStore>(VAN_HANH_STORE, { items: [] }),
        ]);
        const nuocBan = MARKETS_PUBLIC.markets.filter((m) => m.status === "dang_ban");
        const nuocXem = nuocBan.filter((m) => xemHet || canMarket(a, m.code));
        const dsMoiNuoc = Object.fromEntries(nuocBan.map((m) => [m.code, sheet.markets.find((x) => x.code === m.code)?.doanh_so || 0]));
        const pb = phanBoVanHanh(vh.items || [], from, to, dsMoiNuoc);

        const dong: DongNuoc[] = await Promise.all(nuocXem.map(async (m): Promise<DongNuoc> => {
            const s = sheet.markets.find((x) => x.code === m.code);
            const van_hanh = pb.theo_nuoc[m.code] || { rieng: 0, chung: 0 };
            const base = {
                code: m.code, ten: m.display, don: s?.don || 0, doanh_so: s?.doanh_so || 0, ads: s?.ads || 0, van_hanh,
            };
            try {
                const n = await napKienNuoc(m.code, from, to, asOf);
                const ty_le = tyLeGiao(n.kien, asOf, CFG_TY_LE);
                const ky = n.kien.filter((k) => k.ngay >= from && k.ngay <= to);
                const tk = tongKien(ky, ty_le.r);
                // UAE: kiện chính là đơn POS — không có độ trễ lên 3PL.
                const cho = m.code === "AE" ? null : choLen3pl(
                    sheet.market_days.filter((d) => d.code === m.code && d.date >= from && d.date <= to),
                    ky, ty_le.r, homNay, CHO_LEN_3PL_NGAY);
                const du_kien = khoanRong(); congK(du_kien, tk.du_kien); if (cho) congK(du_kien, cho.khoan);
                const toi_thieu = khoanRong(); congK(toi_thieu, tk.toi_thieu);
                const vhTong = van_hanh.rieng + van_hanh.chung;
                return {
                    ...base, nguon: n.nguon, co_so: n.co_so, loi: null, ty_le, tk, cho_len_3pl: cho, du_kien, toi_thieu,
                    loi_nhuan: {
                        du_kien: du_kien.doanh_thu - du_kien.gia_von - tongPhi(du_kien.phi) - base.ads - vhTong,
                        toi_thieu: toi_thieu.doanh_thu - toi_thieu.gia_von - tongPhi(toi_thieu.phi) - base.ads - vhTong,
                    },
                };
            } catch (e: any) {
                console.error(`lai-lo ${m.code}:`, e?.message || e);
                // Không đọc được kiện của nước này: không bịa doanh thu — lãi để null ở giao diện.
                return {
                    ...base, nguon: "", co_so: [], loi: e?.message || String(e), ty_le: null, tk: null, cho_len_3pl: null,
                    du_kien: khoanRong(), toi_thieu: khoanRong(), loi_nhuan: { du_kien: NaN, toi_thieu: NaN },
                };
            }
        }));

        // Phần của file TỔNG TEAM không thuộc nước đang bán nào (camp nước sắp chạy, nước đã
        // dừng…) — chỉ người xem hết mới thấy, và nó vẫn phải trừ vào lãi cả công ty.
        const tongNuoc = dong.reduce((s, d) => ({ ads: s.ads + d.ads, doanh_so: s.doanh_so + d.doanh_so, don: s.don + d.don }), { ads: 0, doanh_so: 0, don: 0 });
        const ngoai = xemHet ? {
            ads: Math.max(0, sheet.team.ads - tongNuoc.ads),
            doanh_so: Math.max(0, sheet.team.doanh_so - tongNuoc.doanh_so),
            don: Math.max(0, sheet.team.don - tongNuoc.don),
        } : null;
        const vhChuaChia = xemHet ? pb.chung_chua_chia : 0;
        // Khoản riêng của nước KHÔNG đang bán (khai nhầm, nước đã dừng) — vẫn là tiền công ty bỏ ra.
        const vhNuocKhac = xemHet ? Object.entries(pb.theo_nuoc)
            .filter(([c]) => !nuocBan.some((m) => m.code === c))
            .reduce((s, [, v]) => s + v.rieng + v.chung, 0) : 0;

        const ok = dong.filter((d) => !d.loi);
        const du_kien = khoanRong(), toi_thieu = khoanRong();
        for (const d of ok) { congK(du_kien, d.du_kien); congK(toi_thieu, d.toi_thieu); }
        const ads = tongNuoc.ads + (ngoai?.ads || 0);
        const vanHanh = dong.reduce((s, d) => s + d.van_hanh.rieng + d.van_hanh.chung, 0) + vhChuaChia + vhNuocKhac;
        const tong = {
            don: tongNuoc.don + (ngoai?.don || 0),
            doanh_so: tongNuoc.doanh_so + (ngoai?.doanh_so || 0),
            ads, van_hanh: vanHanh,
            doanh_thu_chac: ok.reduce((s, d) => s + (d.tk?.doanh_thu_chac || 0), 0),
            du_kien, toi_thieu,
            loi_nhuan: {
                du_kien: du_kien.doanh_thu - du_kien.gia_von - tongPhi(du_kien.phi) - ads - vanHanh,
                toi_thieu: toi_thieu.doanh_thu - toi_thieu.gia_von - tongPhi(toi_thieu.phi) - ads - vanHanh,
            },
            // Nước đọc kiện lỗi: lãi tổng THIẾU phần nước đó — giao diện phải báo.
            thieu_nuoc: dong.filter((d) => d.loi).map((d) => d.code),
        };

        return NextResponse.json({
            from, to, as_of: asOf, hom_nay: homNay, scoped: !xemHet,
            missing_months: sheet.missing_months,
            cfg: { ty_le: CFG_TY_LE, cho_len_3pl_ngay: CHO_LEN_3PL_NGAY, nhom_van_hanh: NHOM_VAN_HANH },
            nuoc: dong.map((d) => ({
                ...d,
                loi_nhuan: { du_kien: Number.isFinite(d.loi_nhuan.du_kien) ? d.loi_nhuan.du_kien : null, toi_thieu: Number.isFinite(d.loi_nhuan.toi_thieu) ? d.loi_nhuan.toi_thieu : null },
            })),
            ngoai_nuoc: ngoai && (ngoai.ads > 0 || ngoai.doanh_so > 0) ? ngoai : null,
            tong,
            van_hanh: {
                ghi_duoc: a.full,
                // Từng khoản (tên người, lương) chỉ giám đốc; người khác chỉ thấy tổng theo nước.
                items: a.full ? (vh.items || []) : [],
                trong_ky: a.full ? pb.chi_tiet : [],
                chung: xemHet ? pb.chung : null,
                chung_chua_chia: vhChuaChia,
                nuoc_khac: vhNuocKhac,
            },
            nuoc_ban: nuocBan.map((m) => ({ code: m.code, ten: m.display })),
        });
    } catch (e: any) {
        console.error("lai-lo:", e?.message || e);
        return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
    }
}
