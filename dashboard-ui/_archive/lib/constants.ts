/**
 * Frontend constants — shared across all client components.
 *
 * ⚠️ RULE: NEVER hardcode dataset/project names in SQL queries.
 *    Always use DATASET from this file.
 *
 * To change dataset for a new project, set the env var:
 *    NEXT_PUBLIC_DATASET=NewProject_Dataset
 */

export const DATASET = process.env.NEXT_PUBLIC_DATASET || "TALPHA_Dataset";
export const BQ_PROJECT = process.env.NEXT_PUBLIC_BQ_PROJECT || "talpha-faos-2026";
export const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
export const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || "TALPHA";
export const APP_VERSION = "v6.0";

// Currency — TALPHA reports in VND (GCC local currency converted at order level)
export const CURRENCY_SYMBOL = "VND";
// ── Tỷ giá GCC → VND (cập nhật 2026-06-19) ──
export const EXCHANGE_RATE_AED_TO_VND = 7010;     // 1 AED = 7,010 VND
export const EXCHANGE_RATE_SAR_TO_VND = 6850;     // 1 SAR = 6,850 VND
export const EXCHANGE_RATE_KWD_TO_VND = 83000;    // 1 KWD = 83,000 VND
export const EXCHANGE_RATE_OMR_TO_VND = 66700;    // 1 OMR = 66,700 VND
export const EXCHANGE_RATE_QAR_TO_VND = 7050;     // 1 QAR = 7,050 VND
export const EXCHANGE_RATE_BHD_TO_VND = 68000;    // 1 BHD = 68,000 VND
export const EXCHANGE_RATE_USD_TO_VND = 25500;    // 1 USD = 25,500 VND (Meta ads billing)
