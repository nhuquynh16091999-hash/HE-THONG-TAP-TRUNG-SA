// GET /api/talpha/pancake-nuoc?market=JP&date=YYYY-MM-DD[&trang=Tên page 1|Tên page 2]
//
// Số của MỘT nước một ngày theo PAGE — cho nước mà Meta không báo số tin nhắn (Nhật, Sỹ Anh yêu
// cầu 09/10/2026: tin Zalo mỗi giờ có mess, giá mess, đơn, doanh số). Bot Zalo ghép thêm tiền
// ads từng camp (Meta trực tiếp, /api/talpha/realtime) bằng tên page trong tên camp.
//
//   • tin nhắn / bình luận mới / có SĐT — Pancake (lib/talpha/pancake.ts), token tài khoản ở
//     TALPHA_PANCAKE_API_TOKEN;
//   • page của nước = page có tên nằm trong tên camp của nước đó tháng này (fb_ads_data), cộng
//     page tên có mã nước (… JP), cộng ?trang= bot gửi (camp tạo hôm nay chưa kịp sync);
//   • chủ page = marketer của camp gần nhất chạy page đó;
//   • đơn / doanh số theo page — bảng sale_order, CÙNG luật Sheet (bỏ HUY, DON_THO, đơn trống),
//     tiền quy bằng posMoneyDivisor + tỷ giá của nước.
import { NextRequest, NextResponse } from "next/server";
import { bigquery } from "@/lib/bigquery";
import { MARKETS_PUBLIC, EXCHANGE_RATES, posMoneyDivisor, campaignMarket, DISPLAY, normCampMarketer, CAMP_MARKETS } from "@/lib/talpha/rules";
import { chuanTenPage, trangCuaCamp, demTrongNgay, laTrangCuaNuoc } from "@/lib/talpha/pancake";
import { cacPage, hoiThoaiTu, sleep, GIAN_MS, tokenPancake } from "@/lib/talpha/pancake-api";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const BQ_PROJECT = process.env.NEXT_PUBLIC_BQ_PROJECT || "cty-507710";
const BQ_DATASET = process.env.DATASET || "TALPHA_Dataset";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const homNayVN = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);

type KetQua = Record<string, unknown>;
const NHO = new Map<string, { at: number; kq: KetQua }>();

export async function GET(req: NextRequest) {
    const sp = req.nextUrl.searchParams;
    const code = String(sp.get("market") || "").toUpperCase();
    const nuoc = MARKETS_PUBLIC.markets.find((m) => m.code === code);
    if (!nuoc) return NextResponse.json({ error: `market lạ: ${code || "(trống)"}` }, { status: 400 });
    const ngay = sp.get("date") || homNayVN();
    if (!DATE_RE.test(ngay)) return NextResponse.json({ error: "date phải dạng YYYY-MM-DD" }, { status: 400 });
    const trangThem = String(sp.get("trang") || "").split("|").map((x) => x.trim()).filter(Boolean);

    // Bot gửi mỗi giờ + bản tin thường cùng giờ: giữ 3 phút để hai lượt không gọi Pancake hai lần.
    const khoa = `${code}|${ngay}|${trangThem.map(chuanTenPage).sort().join("|")}`;
    const hit = NHO.get(khoa);
    if (hit && Date.now() - hit.at < 180_000) return NextResponse.json(hit.kq);

    const loi: string[] = [];
    const thang = ngay.slice(0, 7);

    // ── Camp của nước này trong tháng → page (tên) → chủ page + camp ──
    const chuTrang = new Map<string, { ten: string; nv: string | null; camps: Set<string>; ngayCuoi: string }>();
    const ghiCamp = (cn: string, d: string) => {
        const t = trangCuaCamp(cn);
        if (!t) return;
        const k = chuanTenPage(t);
        const p = cn.split("/").map((x) => x.trim());
        const mi = p.findIndex((s) => s.toUpperCase() in CAMP_MARKETS);
        const key = mi >= 0 && mi + 1 < p.length ? normCampMarketer(p[mi + 1]) : null;
        const cu = chuTrang.get(k);
        if (!cu) chuTrang.set(k, { ten: t, nv: key ? DISPLAY[key] || key : null, camps: new Set([cn]), ngayCuoi: d });
        else {
            cu.camps.add(cn);
            if (d >= cu.ngayCuoi && key) { cu.nv = DISPLAY[key] || key; cu.ngayCuoi = d; }
        }
    };
    try {
        const [rows] = await bigquery.query({
            query: `SELECT campaign_name, CAST(MAX(date) AS STRING) AS d FROM \`${BQ_PROJECT}.${BQ_DATASET}.fb_ads_data\`
                    WHERE date >= DATE(@dau) AND date <= DATE(@ngay) GROUP BY 1`,
            params: { dau: `${thang}-01`, ngay },
        });
        for (const r of rows as { campaign_name: string; d: string }[]) {
            if (campaignMarket(r.campaign_name).market === nuoc.key) ghiCamp(r.campaign_name, r.d);
        }
    } catch (e: any) { loi.push(`đọc camp tháng ${thang} lỗi: ${e?.message || e}`); }
    for (const t of trangThem) if (!chuTrang.has(chuanTenPage(t))) chuTrang.set(chuanTenPage(t), { ten: t, nv: null, camps: new Set(), ngayCuoi: "" });

    // ── Pancake: tin nhắn mới theo page ──
    const { tok, het_han, loi: loiTok } = tokenPancake();
    const pancake = { ok: false, het_han, loi: loiTok };
    const pages: KetQua[] = [];
    if (!loiTok) {
        try {
            const tatCa = await cacPage(tok);
            // Khớp theo tên camp là chính; luật đuôi tên CHỈ nhận đúng mã nước (… JP) — "Prime Leather
            // Japan", "GoutEase … Spray Japan" là page SẢN PHẨM bán ở Đài, đuôi "Japan" là tên hàng.
            const cua = tatCa.filter((p) => chuTrang.has(chuanTenPage(p.name)) || laTrangCuaNuoc(p.name, [nuoc.code]));
            for (const p of cua) {
                const ct = chuTrang.get(chuanTenPage(p.name));
                try {
                    const dem = demTrongNgay((await hoiThoaiTu(tok, p.id, ngay)).hts, ngay);
                    pages.push({ page_id: p.id, name: p.name, nv: ct?.nv || null, camps: ct ? [...ct.camps] : [], ...dem });
                } catch (e: any) {
                    // Page chưa chạy camp nào mà Pancake báo lỗi (chưa có gói cước…) thì bỏ, khỏi làm rối tin.
                    if (ct) pages.push({ page_id: p.id, name: p.name, nv: ct.nv || null, camps: [...ct.camps], loi: String(e?.message || e) });
                }
                await sleep(GIAN_MS);
            }
            // Page có camp mà tài khoản Pancake không thấy — nói ra, đừng lặng lẽ thành 0 mess.
            const thay = new Set(tatCa.map((p) => chuanTenPage(p.name)));
            // Chỉ báo khi camp CÓ TIÊU trong ngày: page đổi tên (10/10/2026 "Lucky Silver JP" thành
            // "Veloura Collection Gold") thì camp cũ đã tắt vẫn mang tên cũ — báo là nhiễu.
            for (const [k, v] of chuTrang) if (!thay.has(k) && v.ngayCuoi === ngay) pages.push({ page_id: null, name: v.ten, nv: v.nv, camps: [...v.camps], loi: "tài khoản Pancake không thấy page này (page đổi tên?)" });
            pancake.ok = true;
        } catch (e: any) { pancake.loi = String(e?.message || e); }
    }

    // ── Đơn + doanh số theo page (bảng đơn, cùng luật Sheet) ──
    const don: KetQua[] = [];
    try {
        const [rows] = await bigquery.query({
            query: `SELECT IFNULL(page_name, '') AS page_name, CAST(page_id AS STRING) AS page_id,
                           JSON_EXTRACT_SCALAR(marketer, '$.name') AS tag, COUNT(*) AS n, SUM(IFNULL(cod, 0)) AS cod
                    FROM \`${BQ_PROJECT}.${BQ_DATASET}.sale_order\`
                    WHERE UPPER(shop_label) = @code
                      AND DATE(TIMESTAMP(inserted_at), 'Asia/Ho_Chi_Minh') = DATE(@ngay)
                      AND status_category NOT IN ('HUY', 'DON_THO')
                      AND NOT (IFNULL(SAFE_CAST(total_quantity AS FLOAT64), 0) = 0
                               AND IFNULL(total_price, 0) = 0 AND IFNULL(cod, 0) = 0)
                    GROUP BY 1, 2, 3`,
            params: { code, ngay },
        });
        const chia = posMoneyDivisor(code), ty = EXCHANGE_RATES[nuoc.key] || 0;
        for (const r of rows as { page_name: string; page_id: string | null; tag: string | null; n: number; cod: number }[]) {
            const local = Number(r.cod || 0) / chia;
            don.push({ page_name: r.page_name, page_id: r.page_id, tag: r.tag, don: Number(r.n), ds_local: Math.round(local), ds_vnd: Math.round(local * ty) });
        }
    } catch (e: any) { loi.push(`đọc đơn lỗi: ${e?.message || e}`); }

    const kq: KetQua = {
        market: code, key: nuoc.key, date: ngay, currency: nuoc.currency, symbol: nuoc.symbol, rate_vnd: nuoc.rate_vnd,
        pancake, pages, don, loi, luc: new Date().toISOString(),
    };
    NHO.set(khoa, { at: Date.now(), kq });
    return NextResponse.json(kq);
}
