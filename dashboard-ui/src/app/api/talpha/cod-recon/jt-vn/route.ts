import { NextRequest, NextResponse } from "next/server";
import { RULES } from "@/lib/talpha/rules";
import { trackMarket } from "@/lib/talpha/tracking";
import { loadMarketShipments } from "@/lib/talpha/tracking-market";
import { nhanTrangThai, nhomTheoVanDon } from "@/lib/talpha/cod-market";
import { hanToken, JtHetHan, keoJtVn, lamSachToken, soJtVn, type DonPosVn, type JtDuLieu } from "@/lib/talpha/jt-vn";
import { readStoreFresh, updateStore } from "@/lib/talpha/store";

export const dynamic = "force-dynamic";

// ═══════════════════════════════════════════════════════════════════
// TIỀN COD VỀ — VIỆT NAM (J&T), 13/11/2026
//
//   GET    ?market=VN[&keo=1] — số đối soát: kỳ J&T + đơn đang luân chuyển + đối chiếu đơn POS.
//                               Token còn hạn và lần kéo trước cũ hơn keo_lai_phut (hoặc keo=1)
//                               thì kéo lại từ J&T; không thì dùng lần kéo đã cất.
//   POST   ?market=VN  {token} — dán token đăng nhập J&T VIP (localStorage.YL_TOKEN), kéo thử ngay.
//   DELETE ?market=VN          — xoá token đã lưu.
//
// Token cất ở kho RIÊNG (jt_vn_token) và KHÔNG BAO GIỜ trả ra ngoài; số kéo về cất ở jt_vn.
// ═══════════════════════════════════════════════════════════════════

type KhoToken = { token: string | null; het_han: string | null; luu_luc: string | null };
type KhoSo = { du_lieu: JtDuLieu | null; loi: string | null; loi_luc: string | null };
const TOKEN0 = (): KhoToken => ({ token: null, het_han: null, luu_luc: null });
const SO0 = (): KhoSo => ({ du_lieu: null, loi: null, loi_luc: null });

const CFG = ((RULES as unknown as { cod_settlement?: { jt_vn?: { tu_ngay?: string; keo_lai_phut?: number } } })
    .cod_settlement?.jt_vn) || {};
const TU_NGAY = CFG.tu_ngay || "2026-10-15";
const KEO_LAI_MS = (CFG.keo_lai_phut ?? 15) * 60_000;

const sai = (req: NextRequest) => String(req.nextUrl.searchParams.get("market") || "").toUpperCase() !== "VN";
const SAI = { error: "Màn này chỉ cho Việt Nam (market=VN)" };
const conHan = (t: KhoToken, now = Date.now()) => !!t.token && (!t.het_han || Date.parse(t.het_han) > now + 60_000);

async function donPos(): Promise<DonPosVn[]> {
    const tm = trackMarket("VN");
    if (tm.code !== "VN") return [];
    const { shipments } = await loadMarketShipments(tm,
        (): { registered: Record<string, never>; statuses: Record<string, unknown> } => ({ registered: {}, statuses: {} }));
    return shipments.map((s) => ({
        order_id: s.order_id, tracking: s.track17_code || "", order_date: s.order_date,
        trang_thai: s.track17_code ? nhanTrangThai(s.status, s.raw_status) : "Chưa gửi hàng",
        nhom: nhomTheoVanDon(s.status, s.sub_status).nhom,
        cod: Number(s.cod_local) || 0, khach: s.customer || "",
    }));
}

/** Kéo J&T rồi cất; token hết hạn thì xoá hạn (để màn báo dán lại) nhưng giữ số cũ. */
async function keoVaCat(t: KhoToken, cu: JtDuLieu | null): Promise<{ du_lieu: JtDuLieu | null; loi: string | null; het: boolean }> {
    try {
        const du = await keoJtVn(t.token!, TU_NGAY, cu);
        await updateStore<KhoSo>("jt_vn", SO0(), () => ({ du_lieu: du, loi: null, loi_luc: null }));
        return { du_lieu: du, loi: null, het: false };
    } catch (e) {
        const het = e instanceof JtHetHan;
        const loi = het ? "Token J&T đã hết hạn — đăng nhập J&T VIP rồi dán token mới." : `Không kéo được J&T: ${(e as Error).message}`;
        console.error("cod-recon/jt-vn kéo lỗi:", e);
        await updateStore<KhoSo>("jt_vn", SO0(), (c) => ({ ...c, loi, loi_luc: new Date().toISOString() }));
        if (het) await updateStore<KhoToken>("jt_vn_token", TOKEN0(), (c) => ({ ...c, het_han: new Date().toISOString() }));
        return { du_lieu: cu, loi, het };
    }
}

export async function GET(req: NextRequest) {
    if (sai(req)) return NextResponse.json(SAI, { status: 400 });
    try {
        const [t, kho] = await Promise.all([
            readStoreFresh<KhoToken>("jt_vn_token", TOKEN0()),
            readStoreFresh<KhoSo>("jt_vn", SO0()),
        ]);
        let du = kho.du_lieu, loi = kho.loi;
        const cu = du ? Date.now() - Date.parse(du.keo_luc) : Infinity;
        if (conHan(t) && (req.nextUrl.searchParams.get("keo") === "1" || cu > KEO_LAI_MS)) {
            const r = await keoVaCat(t, du);
            du = r.du_lieu; loi = r.loi;
        }
        const pos = await donPos();
        const t2 = await readStoreFresh<KhoToken>("jt_vn_token", TOKEN0());
        return NextResponse.json({
            so: du ? soJtVn(du, pos) : null,
            keo_luc: du?.keo_luc ?? null,
            so_du_cap_nhat: du?.so_du_cap_nhat ?? null,
            tu_ngay: TU_NGAY,
            token: { co: !!t2.token, het_han: t2.het_han, con_han: conHan(t2), luu_luc: t2.luu_luc },
            loi,
        });
    } catch (e) {
        console.error("cod-recon/jt-vn lỗi:", e);
        return NextResponse.json({ error: "Không đọc được số đối soát J&T" }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    if (sai(req)) return NextResponse.json(SAI, { status: 400 });
    let body: { token?: string };
    try { body = await req.json(); } catch { return NextResponse.json({ error: "Thiếu token" }, { status: 400 }); }
    const token = lamSachToken(body.token || "");
    if (!/^[\w-]+\.[\w-]+\.[\w-]+$/.test(token)) {
        return NextResponse.json({ error: "Đây không giống token J&T (phải là chuỗi dài có 2 dấu chấm). Dùng nút “Chép token J&T” trên trang J&T rồi dán lại." }, { status: 400 });
    }
    const het = hanToken(token);
    if (het && Date.parse(het) <= Date.now()) {
        return NextResponse.json({ error: "Token này đã hết hạn — đăng nhập lại J&T VIP rồi chép token mới." }, { status: 400 });
    }
    const t: KhoToken = { token, het_han: het, luu_luc: new Date().toISOString() };
    const kho = await readStoreFresh<KhoSo>("jt_vn", SO0());
    // Kéo thử TRƯỚC khi lưu: token sai thì không đè token đang chạy.
    try {
        const du = await keoJtVn(token, TU_NGAY, kho.du_lieu);
        await updateStore<KhoToken>("jt_vn_token", TOKEN0(), () => t);
        await updateStore<KhoSo>("jt_vn", SO0(), () => ({ du_lieu: du, loi: null, loi_luc: null }));
        return NextResponse.json({ ok: true, het_han: het, so_ky: du.ky.length, dang_chay: du.dang_chay.length });
    } catch (e) {
        if (e instanceof JtHetHan) return NextResponse.json({ error: "J&T không nhận token này (sai hoặc đã hết hạn)." }, { status: 400 });
        console.error("cod-recon/jt-vn POST lỗi:", e);
        return NextResponse.json({ error: `Không kéo được J&T: ${(e as Error).message}` }, { status: 502 });
    }
}

export async function DELETE(req: NextRequest) {
    if (sai(req)) return NextResponse.json(SAI, { status: 400 });
    await updateStore<KhoToken>("jt_vn_token", TOKEN0(), () => TOKEN0());
    return NextResponse.json({ ok: true });
}
