/**
 * Định dạng tiền/số và quy đổi tỷ giá cho các tab TALPHA.
 * Doanh thu là tiền địa phương (TWD) → quy về VND.
 * Chi phí quảng cáo ĐÃ là VND → không quy đổi.
 */
export { cn } from "@/lib/utils";

// ═══ Exchange rates: local currency → VND ═══
// ═══ MỘT thị trường: Đài Loan (từ 05/09/2026) ═══
// Nguồn chuẩn là config/talpha_rules.json. Bảng dưới là bản sao dùng ở phía
// client (component không đọc được file), khai theo CẢ mã shop_label lẫn tên
// đầy đủ vì dữ liệu cũ dùng lẫn hai cách. Sửa tỷ giá = sửa rules file TRƯỚC.
export const EXCHANGE_RATES: Record<string, number> = {
    TW: 800, Taiwan: 800,     // TWD → VND
};

const MARKET_NAMES: Record<string, string> = {
    TW: "Taiwan",
};

const DEFAULT_RATE = 800;             // chỉ còn một thị trường

// Số chia tiền POS (X13) nay chỉ khai một chỗ: config/talpha_rules.json →
// markets.*.pos_money_divisor, đọc qua `posMoneyDivisor()` trong lib/talpha/rules.ts.
// Bản sao ở file này (MONEY_DIVISORS · moneyDivisor · toVND) đã gỡ 11/09/2026 —
// không ai gọi, và hai bảng số chia song song là cách chắc chắn nhất để một ngày
// nào đó chúng lệch nhau rồi tiền Đài tụt đúng 100 lần.

/** Tên thị trường hiển thị từ shop_label. */
export function marketName(code?: string): string {
    if (!code) return "Unknown";
    return MARKET_NAMES[code] || code;
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
    return local * (EXCHANGE_RATES[code] || DEFAULT_RATE);
}

/** Như shippingVND nhưng nhận doanh thu đã ở VND (vw_orders_std.revenue_vnd). */
export function shippingVNDFromRevVnd(code: string, orders: number, revenueVnd: number): number {
    return shippingVND(code, orders, revenueVnd / (EXCHANGE_RATES[code] || DEFAULT_RATE));
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
    indigo: "#6366f1",
    emerald: "#34d399",
    rose: "#f43f5e",
    amber: "#fbbf24",
    slate: "#94a3b8",
};
