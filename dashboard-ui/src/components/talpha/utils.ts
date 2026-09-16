/**
 * Định dạng tiền/số và quy đổi tỷ giá cho các tab TALPHA.
 * Doanh thu là tiền địa phương của từng nước (TWD · SGD · AED) → quy về VND.
 * Chi phí quảng cáo ĐÃ là VND → không quy đổi.
 */
export { cn } from "@/lib/utils";

// ═══ Ba thị trường: nạp từ /api/talpha/markets (xem markets-context.tsx) ═══
// Trước 15/09/2026 file này gõ cứng bảng tỷ giá riêng chỉ có Đài (TW: 800, mặc định
// 800) — thêm Singapore, UAE là tiền của hai nước đó bị nhân 800 trên các tab. Nay chỉ
// đọc bản MarketsProvider nạp từ config/talpha_rules.json; nước chưa nạp/chưa có tỷ giá
// → 0, không đoán.
export type MarketPublic = {
    key: string; code: string; display: string; currency: string; symbol: string;
    rate_vnd: number; status: "dang_ban" | "sap_chay"; tokens: string[];
};
let MARKETS: MarketPublic[] = [];
export function setMarkets(list: MarketPublic[]) { MARKETS = list; }
const timNuoc = (code?: string) => MARKETS.find((m) => m.code === code || m.key === code);
function rateVnd(code?: string): number { return timNuoc(code)?.rate_vnd || 0; }

// Số chia tiền POS (X13) nay chỉ khai một chỗ: config/talpha_rules.json →
// markets.*.pos_money_divisor, đọc qua `posMoneyDivisor()` trong lib/talpha/rules.ts.
// Bản sao ở file này (MONEY_DIVISORS · moneyDivisor · toVND) đã gỡ 11/09/2026 —
// không ai gọi, và hai bảng số chia song song là cách chắc chắn nhất để một ngày
// nào đó chúng lệch nhau rồi tiền Đài tụt đúng 100 lần.

/** Tên thị trường hiển thị từ shop_label. */
export function marketName(code?: string): string {
    if (!code) return "Unknown";
    return timNuoc(code)?.display || code;
}

// ═══ Phí 3PL ═══
// ⚠️ sale_order.shipping_fee trong BigQuery mirror cột `cod` (rác) — KHÔNG dùng.
// Chi phí một đơn giao thành công = packing + delivery + cod_local×codPct + codFlat.
// ⚠️ ĐÀI LOAN CHƯA KHAI: hệ cũ để trống vì Đài là market test. Giờ Đài là thị
// trường DUY NHẤT nên bảng rỗng nghĩa là mọi con số "chi phí vận chuyển" trên
// dashboard đang bằng 0 — thiếu, chứ không phải bằng không. Khai vào
// config/talpha_rules.json → shipping_fees.TW rồi đồng bộ xuống đây.
export const SHIPPING_FEES: Record<string, { packing: number; delivery: number; codPct: number; codFlat: number }> = {};

/** Phí vận chuyển ước tính (VND) từ số đơn giao và doanh thu tiền địa phương. */
function shippingVND(code: string, orders: number, revenueLocal: number): number {
    const f = SHIPPING_FEES[code || ""];
    if (!f || orders <= 0) return 0;
    const local = orders * (f.packing + f.delivery + f.codFlat) + revenueLocal * f.codPct;
    return local * rateVnd(code);
}

/** Như shippingVND nhưng nhận doanh thu đã ở VND (vw_orders_std.revenue_vnd). */
export function shippingVNDFromRevVnd(code: string, orders: number, revenueVnd: number): number {
    const rate = rateVnd(code);
    return rate ? shippingVND(code, orders, revenueVnd / rate) : 0;
}

// ═══ Formatting (same style as AUUS1) ═══
export function formatCurrency(amount: number) {
    return formatVNDCompact(amount);
}

export function formatVNDCompact(vnd: number) {
    const abs = Math.abs(vnd);
    const sign = vnd < 0 ? "-" : "";
    if (abs >= 1_000_000_000) return `${sign}${(abs / 1_000_000_000).toFixed(1).replace(".", ",")}tỷ`;
    if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1).replace(".", ",")}tr`;
    if (abs >= 1_000) return `${sign}${Math.round(abs / 1_000).toLocaleString("vi-VN")}K`;
    return `${sign}${Math.round(abs).toLocaleString("vi-VN")}₫`;
}

export function formatMoney(amount: number) {
    return new Intl.NumberFormat("vi-VN").format(Math.round(amount));
}

export function formatNumber(amount: number) {
    return new Intl.NumberFormat("vi-VN").format(amount);
}

export function formatNumberCompact(amount: number) {
    const abs = Math.abs(amount);
    const sign = amount < 0 ? "-" : "";
    if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1)}M`;
    if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(1)}K`;
    return `${sign}${Math.round(abs)}`;
}

export const COLORS = {
    indigo: "#6E695E",
    emerald: "#00E27A",
    rose: "#FF3131",
    amber: "#FF9042",
    slate: "#B1AEA0",
};
