/**
 * TALPHA-specific formatting utils.
 * Revenue is in local currency (SAR/AED/KWD/OMR) → convert to VND.
 * Ads spend is already in VND → no conversion.
 */
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

// ═══ Exchange rates: local currency → VND ═══
// Synced from config/projects/talpha.yaml (valid_from: 2026-02-01)
// Keyed by BOTH market code (sale_order.shop_label: AE/SA/…) and full name.
export const EXCHANGE_RATES: Record<string, number> = {
    SA: 6850, Saudi: 6850,    // SAR → VND
    AE: 7010, UAE: 7010,      // AED → VND
    KW: 83000, Kuwait: 83000, // KWD → VND
    OM: 66700, Oman: 66700,   // OMR → VND
    QA: 7050, Qatar: 7050,    // QAR → VND
    BH: 68000, Bahrain: 68000, // BHD → VND
    TW: 800, Taiwan: 800,     // TWD → VND
};

// Map market code (shop_label) → display name.
export const MARKET_NAMES: Record<string, string> = {
    SA: "Saudi", AE: "UAE", KW: "Kuwait", OM: "Oman", QA: "Qatar", BH: "Bahrain", TW: "Taiwan",
};

// ═══ X13: số chia đưa tiền thô của POS về ĐƠN VỊ TIỀN THẬT của shop ═══
// Synced from config/talpha_rules.json (markets.*.pos_money_divisor).
// 6 shop GCC nhập giá kiểu minor units (cod=9900 ⇒ 99,00 SAR) → 100; shop Đài nhập
// NGUYÊN TWD (cod=950 ⇒ 950 TWD, verify bằng POS API 20/08) → 1. Chia 100 cho mọi shop
// là lỗi X13: doanh thu Đài tụt đúng 100 lần (AOV ra 8.987đ/đơn).
export const MONEY_DIVISORS: Record<string, number> = {
    SA: 100, Saudi: 100,
    AE: 100, UAE: 100,
    KW: 100, Kuwait: 100,
    OM: 100, Oman: 100,
    QA: 100, Qatar: 100,
    BH: 100, Bahrain: 100,
    TW: 1, Taiwan: 1,        // Đài lưu nguyên TWD
};

// Default rate for unknown shops
const DEFAULT_RATE = 6850; // SAR
// Shop mới chưa khai → giữ mặc định minor units (đa số shop là vậy)
const DEFAULT_MONEY_DIVISOR = 100;

/** Số chia tiền POS theo market code (shop_label) hoặc tên market. */
export function moneyDivisor(marketCodeOrName?: string): number {
    return MONEY_DIVISORS[marketCodeOrName || ""] || DEFAULT_MONEY_DIVISOR;
}

/**
 * Convert a local-currency amount to VND based on market code/name
 * (sale_order.shop_label = AE/SA/KW/OM/QA/BH, or a full name).
 * Ads spend is already VND — do NOT use this for ads.
 */
export function toVND(amount: number, marketCodeOrName?: string): number {
    const rate = EXCHANGE_RATES[marketCodeOrName || ""] || DEFAULT_RATE;
    return amount * rate;
}

/** Friendly market label from a shop_label code (falls back to the input). */
export function marketName(code?: string): string {
    if (!code) return "Unknown";
    return MARKET_NAMES[code] || code;
}

// ═══ Shipping fee model (3PL) — from config/projects/talpha.yaml fulfillment table ═══
// ⚠️ sale_order.shipping_fee in BigQuery mirrors `cod` (garbage) — do NOT use it.
// Successful delivery cost = packing + delivery + (cod_local × codPct) [+ flat COD fee].
// Fees are per delivered order, in the market's LOCAL currency.
export const SHIPPING_FEES: Record<string, { packing: number; delivery: number; codPct: number; codFlat: number }> = {
    SA: { packing: 2.5, delivery: 15, codPct: 0.03, codFlat: 0 },     // iMile (SAR)
    AE: { packing: 3, delivery: 12, codPct: 0.03, codFlat: 0 },       // iMile (AED)
    KW: { packing: 0.2, delivery: 0.9, codPct: 0, codFlat: 0.25 },    // PostaPlus (KWD, flat COD)
    QA: { packing: 3, delivery: 17, codPct: 0.04, codFlat: 0 },       // iMile (QAR)
    OM: { packing: 0.4, delivery: 2, codPct: 0.04, codFlat: 0 },      // iMile (OMR)
    BH: { packing: 0.4, delivery: 2, codPct: 0.05, codFlat: 0 },      // Aramex (BHD)
};

/**
 * Estimated shipping cost in VND for a market, from delivered-order count and
 * local revenue (cod in real units, i.e. already ÷100). Modelled from the 3PL
 * fee table because the DB shipping_fee column is unreliable.
 */
export function shippingVND(code: string, orders: number, revenueLocal: number): number {
    const f = SHIPPING_FEES[code || ""];
    if (!f || orders <= 0) return 0;
    const local = orders * (f.packing + f.delivery + f.codFlat) + revenueLocal * f.codPct;
    return local * (EXCHANGE_RATES[code] || DEFAULT_RATE);
}

/**
 * Same shipping model but taking revenue already in VND (vw_orders_std.revenue_vnd)
 * — converts back to local for the codPct component.
 */
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
