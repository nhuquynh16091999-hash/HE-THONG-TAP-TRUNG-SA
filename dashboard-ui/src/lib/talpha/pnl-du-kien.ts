// Doanh thu + giá vốn DỰ KIẾN theo tỉ lệ giao thành công từng nước — dùng chung tab P&L và
// tab Tổng quan để hai tab ra MỘT con số lãi (11/11/2026, Sỹ Anh: "không đúng thực tế vì thiếu
// tỉ lệ giao thành công"). Hàm thuần, chạy ở trình duyệt.
//
//   Doanh thu dự kiến = doanh số × tỉ lệ giao của nước (r từ /api/talpha/pnl-costs?ty_le=1 —
//   cùng thước Kế toán → Lãi lỗ). Phần doanh số ngoài tab nước / nước chưa đo được r → lấy r
//   bình quân (trọng số doanh số); không có nước nào đo được → coi giao hết (r = 1).
//   Phí ship: đơn hoàn vẫn mất → không động tới.
//   Giá vốn: nước trong hoan_ve_kho (UAE — hàng về kho D&T bán tiếp) chỉ mất phần giao được;
//   nước khác mất cả giá vốn đơn hoàn.

export type SoNgayNuoc = { code: string; date: string; doanh_so: number };
export type CogsNgayNuoc = { code: string; date: string; cogs_vnd: number };
export type TyLeNuoc = { r: number | null; giao?: number; hoan?: number; tu?: string | null; den?: string | null; tam?: boolean; loi?: string };

export type NguonDuKien = {
    markets: { code: string | null; doanh_so: number }[];
    days: { date: string; doanh_so: number }[];
    market_days?: SoNgayNuoc[];
    cost_days?: { date: string; cogs_vnd: number }[];
    cost_market_days?: CogsNgayNuoc[];
    ty_le_giao?: Record<string, TyLeNuoc>;
    hoan_ve_kho?: string[];
};

export type DuKien = {
    /** r bình quân theo doanh số các nước đo được — null nếu không nước nào đo được. */
    rTB: number | null;
    /** r áp cho một nước (đo được → của nó; không → bình quân; không có gì → 1). */
    rDung: (code: string | null | undefined) => number;
    cogsSauHoan: (code: string, cogsVnd: number) => number;
    theoNgay: Map<string, { dt: number; cogs: number }>;
    dt: number; cogs: number;
    /** dt ÷ doanh số cả kỳ. */
    rKy: number | null;
    /** Nước có doanh số mà chưa đo được tỉ lệ giao. */
    nuocThieuR: string[];
};

export function duKienTheoTyLe(n: NguonDuKien): DuKien {
    const tyLe = n.ty_le_giao || {};
    const veKho = new Set(n.hoan_ve_kho || []);
    const rCua = (code: string | null | undefined): number | null => (code ? tyLe[code]?.r ?? null : null);
    const coR = n.markets.filter((m) => rCua(m.code) != null);
    const dsCoR = coR.reduce((s, m) => s + m.doanh_so, 0);
    const rTB = dsCoR > 0 ? coR.reduce((s, m) => s + m.doanh_so * rCua(m.code)!, 0) / dsCoR : null;
    const rDung = (code: string | null | undefined) => rCua(code) ?? rTB ?? 1;
    const cogsSauHoan = (code: string, cogsVnd: number) => (veKho.has(code) ? cogsVnd * rDung(code) : cogsVnd);

    const dsNuocNgay = new Map<string, { ds: number; dt: number }>();
    for (const d of n.market_days || []) {
        const x = dsNuocNgay.get(d.date) || { ds: 0, dt: 0 };
        x.ds += d.doanh_so; x.dt += d.doanh_so * rDung(d.code);
        dsNuocNgay.set(d.date, x);
    }
    const cogsGiam = new Map<string, number>();
    for (const d of n.cost_market_days || []) {
        const g = d.cogs_vnd - cogsSauHoan(d.code, d.cogs_vnd);
        if (g) cogsGiam.set(d.date, (cogsGiam.get(d.date) || 0) + g);
    }
    const cogsNgay = new Map((n.cost_days || []).map((d) => [d.date, d.cogs_vnd]));

    const theoNgay = new Map<string, { dt: number; cogs: number }>();
    const ngay = new Set([...n.days.map((d) => d.date), ...cogsNgay.keys()]);
    const dsNgay = new Map(n.days.map((d) => [d.date, d.doanh_so]));
    let dt = 0, cogs = 0, ds = 0;
    for (const date of ngay) {
        const dsN = dsNgay.get(date) || 0;
        const x = dsNuocNgay.get(date) || { ds: 0, dt: 0 };
        const dtN = x.dt + Math.max(0, dsN - x.ds) * (rTB ?? 1);
        const cgN = (cogsNgay.get(date) || 0) - (cogsGiam.get(date) || 0);
        theoNgay.set(date, { dt: dtN, cogs: cgN });
        dt += dtN; cogs += cgN; ds += dsN;
    }
    return {
        rTB, rDung, cogsSauHoan, theoNgay, dt, cogs,
        rKy: ds > 0 ? dt / ds : null,
        nuocThieuR: n.markets.filter((m) => m.code && m.doanh_so > 0 && rCua(m.code) == null).map((m) => m.code!),
    };
}
