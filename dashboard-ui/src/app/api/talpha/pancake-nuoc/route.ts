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
import {
    PANCAKE_API, chuanTenPage, trangCuaCamp, demTrongNgay, hetLoTrongNgay, hanToken, laTrangCuaNuoc,
    type HoiThoai,
} from "@/lib/talpha/pancake";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const BQ_PROJECT = process.env.NEXT_PUBLIC_BQ_PROJECT || "cty-507710";
const BQ_DATASET = process.env.DATASET || "TALPHA_Dataset";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const homNayVN = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);

// Pancake 429 khi gọi dồn: mỗi lượt cách nhau GIAN_MS, gặp 429 thì chờ 5s · 10s · 20s rồi thử lại.
const GIAN_MS = 400;
async function goiPancake(url: string): Promise<any> {
    for (let lan = 0; lan < 4; lan++) {
        const r = await fetch(url, { cache: "no-store" });
        if (r.status === 429) { await sleep(5000 * 2 ** lan); continue; }
        const j = await r.json().catch(() => null);
        if (!r.ok || !j) throw new Error(`Pancake HTTP ${r.status}`);
        if (j.success === false) throw new Error(`Pancake: ${j.message || "lỗi"}${j.error_code ? ` (mã ${j.error_code})` : ""}`);
        return j;
    }
    throw new Error("Pancake 429 — gọi dồn quá, thử lại sau");
}

// Danh sách page của tài khoản — 10 phút mới hỏi lại.
let dsPage: { at: number; tok: string; pages: { id: string; name: string }[] } | null = null;
async function cacPage(tok: string) {
    if (dsPage && dsPage.tok === tok && Date.now() - dsPage.at < 600_000) return dsPage.pages;
    const j = await goiPancake(`${PANCAKE_API}/pages?access_token=${encodeURIComponent(tok)}`);
    const c = j.categorized || {};
    const pages = [...(c.activated || []), ...(c.inactivated || [])]
        .filter((p: any) => p && p.id).map((p: any) => ({ id: String(p.id), name: String(p.name || "") }));
    dsPage = { at: Date.now(), tok, pages };
    return pages;
}

/** Mọi hội thoại có thể TẠO trong ngày `ngay` của một page (lật bằng current_count, tối đa 25 lô). */
async function hoiThoaiNgay(tok: string, pageId: string, ngay: string): Promise<HoiThoai[]> {
    const out: HoiThoai[] = [];
    let cc = 0;
    for (let lo = 0; lo < 25; lo++) {
        const j = await goiPancake(`${PANCAKE_API}/pages/${pageId}/conversations?access_token=${encodeURIComponent(tok)}&current_count=${cc}`);
        const ds: HoiThoai[] = (j.conversations || []).map((h: any) => ({
            id: String(h.id), type: h.type, inserted_at: h.inserted_at, updated_at: h.updated_at, has_phone: !!h.has_phone,
        }));
        out.push(...ds);
        if (hetLoTrongNgay(ds, ngay)) break;
        cc += ds.length;
        await sleep(GIAN_MS);
    }
    return out;
}

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
    const tok = String(process.env.TALPHA_PANCAKE_API_TOKEN || "").trim();
    const het = hanToken(tok);
    const pancake = { ok: false, het_han: het ? new Date(het).toISOString() : null, loi: "" };
    const pages: KetQua[] = [];
    if (!tok) pancake.loi = "chưa khai TALPHA_PANCAKE_API_TOKEN";
    else if (het && het < Date.now()) pancake.loi = `token Pancake đã hết hạn ${new Date(het).toISOString().slice(0, 10)}`;
    else {
        try {
            const tatCa = await cacPage(tok);
            // Khớp theo tên camp là chính; luật đuôi tên CHỈ nhận đúng mã nước (… JP) — "Prime Leather
            // Japan", "GoutEase … Spray Japan" là page SẢN PHẨM bán ở Đài, đuôi "Japan" là tên hàng.
            const cua = tatCa.filter((p) => chuTrang.has(chuanTenPage(p.name)) || laTrangCuaNuoc(p.name, [nuoc.code]));
            for (const p of cua) {
                const ct = chuTrang.get(chuanTenPage(p.name));
                try {
                    const dem = demTrongNgay(await hoiThoaiNgay(tok, p.id, ngay), ngay);
                    pages.push({ page_id: p.id, name: p.name, nv: ct?.nv || null, camps: ct ? [...ct.camps] : [], ...dem });
                } catch (e: any) {
                    // Page chưa chạy camp nào mà Pancake báo lỗi (chưa có gói cước…) thì bỏ, khỏi làm rối tin.
                    if (ct) pages.push({ page_id: p.id, name: p.name, nv: ct.nv || null, camps: [...ct.camps], loi: String(e?.message || e) });
                }
                await sleep(GIAN_MS);
            }
            // Page có camp mà tài khoản Pancake không thấy — nói ra, đừng lặng lẽ thành 0 mess.
            const thay = new Set(tatCa.map((p) => chuanTenPage(p.name)));
            for (const [k, v] of chuTrang) if (!thay.has(k)) pages.push({ page_id: null, name: v.ten, nv: v.nv, camps: [...v.camps], loi: "tài khoản Pancake không thấy page này" });
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
