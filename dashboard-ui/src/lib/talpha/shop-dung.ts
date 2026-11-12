/**
 * Shop "đứng im": ads của nước vẫn tiêu mà shop POS của nước đó không có đơn mới nhiều ngày.
 *
 * Vì sao cần (12/11/2026): bộ soát theo từng shop chỉ kêu khi số dòng về 0 hoặc tụt mạnh. Shop
 * hỏng khoá API / đổi shop thì đơn cũ vẫn nguyên, không có đơn mới — mọi chốt đều báo "ổn".
 * Chỉ kêu khi ads CÒN TIÊU: nước đang nghỉ (không chạy quảng cáo) không có đơn là đúng, kêu là
 * spam nhóm. Ngưỡng nằm ở config/talpha_rules.json → thresholds.
 */
export type ShopDung = { shop: string; ngay_cuoi: string | null; so_ngay: number | null; ads_vnd: number };

const NGAY_MS = 86400000;

/**
 * shops      — mã shop của các nước đang bán (TW, SG…)
 * donCuoi    — mã shop → ngày tạo đơn mới nhất "YYYY-MM-DD" (không có = chưa từng có đơn)
 * adsTheoShop— mã shop → tiền ads (VND) của `ngay` ngày trọn gần nhất
 * homNay     — "YYYY-MM-DD" giờ VN
 */
export function timShopDung(
    shops: string[], donCuoi: Record<string, string | null | undefined>,
    adsTheoShop: Record<string, number>, homNay: string,
    { ngay = 3, adsMin = 500000 }: { ngay?: number; adsMin?: number } = {},
): ShopDung[] {
    const nay = Date.parse(`${homNay}T00:00:00Z`);
    const out: ShopDung[] = [];
    for (const shop of shops) {
        const ads = Math.round(Number(adsTheoShop[shop] || 0));
        if (!(ads >= adsMin)) continue;
        const d = String(donCuoi[shop] || "").slice(0, 10);
        const t = /^\d{4}-\d{2}-\d{2}$/.test(d) ? Date.parse(`${d}T00:00:00Z`) : NaN;
        const soNgay = Number.isFinite(t) && Number.isFinite(nay) ? Math.round((nay - t) / NGAY_MS) : null;
        if (soNgay != null && soNgay < ngay) continue;
        out.push({ shop, ngay_cuoi: Number.isFinite(t) ? d : null, so_ngay: soNgay, ads_vnd: ads });
    }
    return out;
}
