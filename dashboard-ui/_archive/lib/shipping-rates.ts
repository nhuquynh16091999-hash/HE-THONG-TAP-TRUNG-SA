/**
 * Shipping rate per order — biểu phí Boss confirm 2026-05-06
 * UAE (JNT): 3.5 + 11×1.05 = 15.05 AED (TC) / 3.5 + 5×1.05 = 8.75 AED (Hoàn)
 * KSA (JNT): 3.5 + 17×1.15 = 23.05 SAR (TC) / 3.5 + 12×1.15 = 17.3 SAR (Hoàn)
 * KWT (Postal Plus): 0.2 + 0.7 = 0.9 KWD (TC) / 0.2 + 0.25 = 0.45 KWD (Hoàn)
 * AUD: chưa có rate
 *
 * Logic: status HUY/DON_THO → 0. DON_HOAN → phí hoàn. Còn lại (xuất kho/đang giao/TC) → phí TC default.
 */

const FX_AED = 7020;
const FX_SAR = 6669;
const FX_KWD = 82000;

/**
 * Returns SQL CASE expression returning shipping cost VỚI VND PER ORDER.
 * @param saleOrderAlias alias of sale_order table (default 's')
 */
export function getShippingPerOrderSQL(saleOrderAlias = 's'): string {
    const a = saleOrderAlias;
    const r_UAE_TC = 15.05 * FX_AED, r_UAE_RT = 8.75 * FX_AED;
    const r_KSA_TC = 23.05 * FX_SAR, r_KSA_RT = 17.3 * FX_SAR;
    const r_KWT_TC = 0.9 * FX_KWD, r_KWT_RT = 0.45 * FX_KWD;
    return `CASE
        WHEN ${a}.status_category IN ('HUY','DON_THO') THEN 0
        WHEN ${a}.status_category = 'DON_HOAN' THEN
            CASE ${a}.order_currency WHEN 'AED' THEN ${r_UAE_RT} WHEN 'SAR' THEN ${r_KSA_RT} WHEN 'KWD' THEN ${r_KWT_RT} ELSE 0 END
        ELSE
            CASE ${a}.order_currency WHEN 'AED' THEN ${r_UAE_TC} WHEN 'SAR' THEN ${r_KSA_TC} WHEN 'KWD' THEN ${r_KWT_TC} ELSE 0 END
    END`;
}

/**
 * Returns SQL CASE expression với output AED-equivalent (= VND/7020).
 * Dùng cho ZEN8 marketing-tab có formatMoney × 7020.
 */
export function getShippingPerOrderAEDSQL(saleOrderAlias = 's'): string {
    const a = saleOrderAlias;
    const r_UAE_TC = 15.05, r_UAE_RT = 8.75;
    const r_KSA_TC = 23.05 * FX_SAR / FX_AED, r_KSA_RT = 17.3 * FX_SAR / FX_AED;
    const r_KWT_TC = 0.9 * FX_KWD / FX_AED, r_KWT_RT = 0.45 * FX_KWD / FX_AED;
    return `CASE
        WHEN ${a}.status_category IN ('HUY','DON_THO') THEN 0
        WHEN ${a}.status_category = 'DON_HOAN' THEN
            CASE ${a}.order_currency WHEN 'AED' THEN ${r_UAE_RT} WHEN 'SAR' THEN ${r_KSA_RT} WHEN 'KWD' THEN ${r_KWT_RT} ELSE 0 END
        ELSE
            CASE ${a}.order_currency WHEN 'AED' THEN ${r_UAE_TC} WHEN 'SAR' THEN ${r_KSA_TC} WHEN 'KWD' THEN ${r_KWT_TC} ELSE 0 END
    END`;
}
