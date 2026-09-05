/**
 * TALPHA-specific constants — used only by TALPHA tabs.
 * Completely isolated from STRAMARK and AUUS1.
 * Exchange rates are in utils.ts (synced from talpha.yaml)
 */
import { MONEY_DIVISORS } from "./utils";

export const DATASET = process.env.NEXT_PUBLIC_DATASET || "TALPHA_Dataset";
// ⚠️ TALPHA data lives in GCP project cty-507710 (NOT levelup-465304).
export const BQ_PROJECT = process.env.NEXT_PUBLIC_BQ_PROJECT || "cty-507710";
export const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
export const APP_NAME = "TALPHA";
export const APP_VERSION = "v2.0";

// ═══ Fully-qualified table reference ═══
export const TBL = (name: string) => `\`${BQ_PROJECT}.${DATASET}.${name}\``;

// ═══ Shared SQL fragments (real schema) ═══
// Revenue = cod đưa về đơn vị tiền thật, realized only (delivered). total_price is 0 for
// delivered orders.
// ⚠️ X13 — số chia KHÁC NHAU theo shop: GCC lưu minor units (÷100), shop Đài lưu NGUYÊN
// TWD (÷1). Gõ `cod / 100` cứng là làm tiền Đài tụt 100 lần. Ưu tiên đọc thẳng
// vw_orders_std.revenue_vnd (view đã quy sẵn); chỉ dùng các mảnh dưới khi buộc phải
// query bảng thô sale_order.
const MONEY_DIV_CASE = (a = "") => {
    const p = a ? a + "." : "";
    const whens = Object.entries(MONEY_DIVISORS)
        .filter(([k]) => k.length === 2)   // chỉ shop_label (SA/AE/…), bỏ tên đầy đủ
        .map(([k, v]) => `WHEN '${k}' THEN ${v}`)
        .join(" ");
    return `CASE ${p}shop_label ${whens} ELSE 100 END`;
};

export const SQL = {
    // local-currency revenue per order; pass table alias (e.g. "o" or "")
    revLocal: (a = "") => `(${a ? a + "." : ""}cod / ${MONEY_DIV_CASE(a)})`,
    // shipping cost per order in local currency
    shipLocal: (a = "") => {
        const p = a ? a + "." : "";
        return `((COALESCE(${p}shipping_fee,0) + COALESCE(${p}partner_fee,0) + COALESCE(${p}return_fee,0)) / ${MONEY_DIV_CASE(a)})`;
    },
    // realized-revenue filter (delivered successfully)
    delivered: (a = "") => `${a ? a + "." : ""}status_category = 'GIAO_THANH_CONG'`,
    // marketer name extracted from the JSON string column
    marketer: (a = "") => `COALESCE(NULLIF(JSON_EXTRACT_SCALAR(${a ? a + "." : ""}marketer, '$.name'), ''), 'Unknown')`,
};
